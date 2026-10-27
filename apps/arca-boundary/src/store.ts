import { randomUUID } from 'node:crypto';

import { hashCanonical } from '@tax-engine/core';
import type { SqlDatabase } from '@tax-engine/sql-store';
import { openSqlDatabase } from '@tax-engine/sql-store/bun';

import {
  anyAuthorityPayloadSchema,
  type AnyAuthorityPayload,
  type IssuerProvisionReceipt,
  type PayloadStoreReceipt,
  type PayloadTerminalReceipt,
  type PayloadTerminalRequest,
  ticketResponseSchema,
  type TicketResponse,
} from './contracts';
import {
  commitRepresentedCuit,
  deriveDomainKey,
  openJson,
  sealJson,
} from './crypto';

// WSFEX (Factura E) and WSFE (Factura C) payloads are cryptographically domain
// separated: each family seals under its own HKDF domain key and carries its own
// `vault://<family>/` reference prefix, so a ciphertext from one family can never
// be opened — nor a reference resolved — under the other.
export type PayloadFamily = 'wsfex' | 'wsfe';
export const PAYLOAD_DOMAIN: Record<PayloadFamily, 'authority-payloads' | 'authority-payloads-wsfe'> = {
  wsfex: 'authority-payloads',
  wsfe: 'authority-payloads-wsfe',
};

export type IssuerCredential = Readonly<{
  workspaceId: string;
  issuerProfileRef: string;
  environment: 'homologation' | 'production';
  certificateHolderCuit: string;
  representedCuit: string;
  representedCuitCommitment: string | null;
  certificatePem: string;
  privateKeyPem: string;
  certificateFingerprint: string;
  delegationConfirmed: boolean;
  active: boolean;
}>;

export class ArcaBoundaryStore {
  readonly #db: SqlDatabase;
  readonly #payloadKeys: Record<PayloadFamily, Buffer>;
  readonly #issuerKey: Buffer;
  readonly #ticketKey: Buffer;
  readonly #representedCuitCommitmentKey: Buffer;

  constructor(
    masterKey: Buffer,
    path: string | SqlDatabase = process.env.ARCA_BOUNDARY_DB_PATH ?? ':memory:',
    representedCuitCommitmentKey = deriveDomainKey(
      masterKey,
      'represented-cuit-commitments'
    )
  ) {
    this.#payloadKeys = {
      wsfex: deriveDomainKey(masterKey, PAYLOAD_DOMAIN.wsfex),
      wsfe: deriveDomainKey(masterKey, PAYLOAD_DOMAIN.wsfe),
    };
    this.#issuerKey = deriveDomainKey(masterKey, 'issuer-credentials');
    this.#ticketKey = deriveDomainKey(masterKey, 'wsaa-tickets');
    if (representedCuitCommitmentKey.length !== 32)
      throw new Error('ARCA_BOUNDARY_CUIT_COMMITMENT_KEY_INVALID');
    this.#representedCuitCommitmentKey = Buffer.from(representedCuitCommitmentKey);
    this.#db = openSqlDatabase(path);
    this.#db.configure({ wal: true, foreignKeys: true, secureDelete: true });
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS authority_payloads (
        reference TEXT PRIMARY KEY,
        workspace_id_hash TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL UNIQUE,
        encrypted_payload TEXT NOT NULL,
        stored_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        resolution_state TEXT NOT NULL DEFAULT 'unresolved',
        terminal_command_hash TEXT,
        terminal_evidence_hash TEXT,
        authority_identity_hash TEXT,
        retention_policy_id TEXT,
        terminal_at TEXT,
        retire_after TEXT,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS authority_payload_tombstones (
        reference TEXT PRIMARY KEY,
        workspace_id_hash TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL UNIQUE,
        stored_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        terminal_evidence_hash TEXT NOT NULL,
        authority_identity_hash TEXT NOT NULL,
        retention_policy_id TEXT NOT NULL,
        terminal_at TEXT NOT NULL,
        retired_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS issuer_credentials (
        issuer_profile_ref TEXT PRIMARY KEY,
        workspace_id_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        certificate_holder_cuit_hash TEXT NOT NULL,
        represented_cuit_hash TEXT NOT NULL,
        represented_cuit_commitment TEXT NOT NULL,
        certificate_fingerprint TEXT NOT NULL,
        credential_bundle_hash TEXT NOT NULL,
        encrypted_bundle TEXT NOT NULL,
        delegation_confirmed INTEGER NOT NULL,
        active INTEGER NOT NULL,
        stored_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS wsaa_tickets (
        cache_key TEXT PRIMARY KEY,
        issuer_profile_ref TEXT NOT NULL,
        encrypted_ticket TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS boundary_events (
        event_id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        subject_hash TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      );
    `);
    this.ensureCertificateHolderColumn();
    this.ensureIssuerColumn('represented_cuit_commitment', 'TEXT');
    this.ensurePayloadColumn('resolution_state', "TEXT NOT NULL DEFAULT 'unresolved'");
    this.ensurePayloadColumn('terminal_command_hash', 'TEXT');
    this.ensurePayloadColumn('terminal_evidence_hash', 'TEXT');
    this.ensurePayloadColumn('authority_identity_hash', 'TEXT');
    this.ensurePayloadColumn('retention_policy_id', 'TEXT');
    this.ensurePayloadColumn('terminal_at', 'TEXT');
    this.ensurePayloadColumn('retire_after', 'TEXT');
  }

  storePayload(input: Readonly<{
    workspaceId: string;
    payload: AnyAuthorityPayload;
    expiresAt: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): PayloadStoreReceipt {
    const payload = anyAuthorityPayloadSchema.parse(input.payload);
    const family = payloadFamily(payload);
    const payloadHash = hashCanonical(payload);
    const inputHash = hashCanonical({ workspaceId: input.workspaceId, payloadHash, expiresAt: input.expiresAt });
    const idempotencyKeyHash = hashCanonical({ workspaceId: input.workspaceId, idempotencyKey: input.idempotencyKey });
    const existing = this.#db.query<PayloadRow, [string]>('SELECT * FROM authority_payloads WHERE idempotency_key_hash = ?').get(idempotencyKeyHash);
    if (existing) {
      if (existing.input_hash !== inputHash) throw new Error('AUTHORITY_PAYLOAD_IDEMPOTENCY_CONFLICT');
      return payloadReceipt(existing);
    }
    const retired = this.#db.query<PayloadTombstoneRow, [string]>(
      'SELECT * FROM authority_payload_tombstones WHERE idempotency_key_hash = ?'
    ).get(idempotencyKeyHash);
    if (retired) {
      if (retired.input_hash !== inputHash)
        throw new Error('AUTHORITY_PAYLOAD_IDEMPOTENCY_CONFLICT');
      return payloadReceipt(retired);
    }
    const reference = `vault://${family}/${randomUUID()}`;
    const encryptedPayload = sealJson(this.#payloadKeys[family], payloadAad(reference, payloadHash), payload);
    this.#db.query(`
      INSERT INTO authority_payloads (
        reference, workspace_id_hash, payload_hash, input_hash, idempotency_key_hash, encrypted_payload, stored_at, expires_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `).run(reference, hashCanonical(input.workspaceId), payloadHash, inputHash, idempotencyKeyHash, encryptedPayload, input.occurredAt, input.expiresAt);
    this.appendEvent('authority_payload_stored', hashCanonical(reference), payloadHash, input.occurredAt);
    return { version: 'authority-payload-store-receipt-v1', reference, payloadHash, storedAt: input.occurredAt, expiresAt: input.expiresAt };
  }

  resolvePayload(reference: string, occurredAt: string): Readonly<{ payload: AnyAuthorityPayload; payloadHash: string }> {
    const family = referenceFamily(reference);
    const row = this.#db.query<PayloadRow, [string]>('SELECT * FROM authority_payloads WHERE reference = ?').get(reference);
    if (!row || row.revoked_at) throw new Error('AUTHORITY_PAYLOAD_NOT_FOUND');
    if (row.resolution_state !== 'unresolved' && row.resolution_state !== 'officially_reconciled')
      throw new Error('AUTHORITY_PAYLOAD_RESOLUTION_STATE_INVALID');
    if (
      row.resolution_state === 'officially_reconciled'
      && (!row.retire_after || Date.parse(row.retire_after) <= Date.parse(occurredAt))
    ) throw new Error('AUTHORITY_PAYLOAD_TERMINAL_RETENTION_ELAPSED');
    // The family key + AAD already bind the ciphertext to its reference family;
    // re-parsing and re-checking the family is defence in depth against confusion.
    const payload = anyAuthorityPayloadSchema.parse(openJson(this.#payloadKeys[family], payloadAad(row.reference, row.payload_hash), row.encrypted_payload));
    if (payloadFamily(payload) !== family) throw new Error('AUTHORITY_PAYLOAD_FAMILY_MISMATCH');
    if (hashCanonical(payload) !== row.payload_hash) throw new Error('AUTHORITY_PAYLOAD_HASH_MISMATCH');
    this.appendEvent('authority_payload_resolved', hashCanonical(reference), row.payload_hash, occurredAt);
    return { payload, payloadHash: row.payload_hash };
  }

  revokePayload(workspaceId: string, reference: string, occurredAt: string): void {
    const row = this.#db.query<PayloadRow, [string]>('SELECT * FROM authority_payloads WHERE reference = ?').get(reference);
    if (!row || row.workspace_id_hash !== hashCanonical(workspaceId)) throw new Error('AUTHORITY_PAYLOAD_NOT_FOUND');
    if (row.resolution_state === 'unresolved')
      throw new Error('AUTHORITY_PAYLOAD_UNRESOLVED_REVOCATION_FORBIDDEN');
    if (!row.retire_after || Date.parse(row.retire_after) > Date.parse(occurredAt))
      throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_ACTIVE');
    this.#db.transaction(() => this.retirePayloadRow(row, occurredAt))();
    this.#db.checkpoint();
  }

  markPayloadTerminal(
    input: PayloadTerminalRequest,
    policy: Readonly<{ retentionPolicyId: string; terminalRetentionMs: number }>,
    occurredAt: string
  ): PayloadTerminalReceipt {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(policy.retentionPolicyId))
      throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_INVALID');
    if (
      !Number.isSafeInteger(policy.terminalRetentionMs)
      || policy.terminalRetentionMs < 24 * 60 * 60_000
    ) throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_INVALID');
    const terminalAt = Date.parse(occurredAt);
    if (!Number.isFinite(terminalAt)) throw new Error('AUTHORITY_PAYLOAD_OCCURRED_AT_INVALID');
    const commandHash = hashCanonical({
      version: input.version,
      workspaceIdHash: hashCanonical(input.workspaceId),
      referenceHash: hashCanonical(input.reference),
      payloadHash: input.payloadHash,
      terminalState: input.terminalState,
      authorityIdentityHash: input.authorityIdentityHash,
    });
    return this.#db.transaction(() => {
      const row = this.#db.query<PayloadRow, [string]>(
        'SELECT * FROM authority_payloads WHERE reference = ?'
      ).get(input.reference);
      if (
        !row
        || row.workspace_id_hash !== hashCanonical(input.workspaceId)
        || row.payload_hash !== input.payloadHash
      ) throw new Error('AUTHORITY_PAYLOAD_NOT_FOUND');
      if (row.resolution_state === 'officially_reconciled') {
        if (row.terminal_command_hash !== commandHash)
          throw new Error('AUTHORITY_PAYLOAD_TERMINAL_CONFLICT');
        return terminalReceipt(row);
      }
      if (row.resolution_state !== 'unresolved')
        throw new Error('AUTHORITY_PAYLOAD_RESOLUTION_STATE_INVALID');
      const policyRetireAfter = terminalAt + policy.terminalRetentionMs;
      const retireAfter = new Date(
        Math.max(policyRetireAfter, Date.parse(row.expires_at))
      ).toISOString();
      const updated = this.#db.query(`
        UPDATE authority_payloads
        SET resolution_state = 'officially_reconciled', terminal_command_hash = ?,
            terminal_evidence_hash = ?, authority_identity_hash = ?,
            retention_policy_id = ?, terminal_at = ?, retire_after = ?
        WHERE reference = ? AND resolution_state = 'unresolved'
      `).run(
        commandHash,
        input.terminalEvidenceHash,
        input.authorityIdentityHash,
        policy.retentionPolicyId,
        occurredAt,
        retireAfter,
        input.reference
      );
      if (updated.changes !== 1)
        throw new Error('AUTHORITY_PAYLOAD_TERMINAL_CONFLICT');
      this.appendEvent(
        'authority_payload_officially_reconciled',
        hashCanonical(input.reference),
        input.terminalEvidenceHash,
        occurredAt
      );
      return terminalReceipt(this.requiredPayload(input.reference));
    })();
  }

  retireEligiblePayloads(
    retentionPolicyId: string,
    occurredAt: string
  ): number {
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(retentionPolicyId))
      throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_INVALID');
    if (!Number.isFinite(Date.parse(occurredAt)))
      throw new Error('AUTHORITY_PAYLOAD_OCCURRED_AT_INVALID');
    const retired = this.#db.transaction(() => {
      const rows = this.#db.query<PayloadRow, [string, string]>(`
        SELECT * FROM authority_payloads
        WHERE resolution_state = 'officially_reconciled'
          AND retention_policy_id = ?
          AND retire_after IS NOT NULL
          AND retire_after <= ?
      `).all(retentionPolicyId, occurredAt);
      for (const row of rows) this.retirePayloadRow(row, occurredAt);
      return rows.length;
    })();
    if (retired > 0) this.#db.checkpoint();
    return retired;
  }

  provisionIssuer(input: Readonly<{
    credential: IssuerCredential;
    credentialBundleHash: string;
    replaceCertificateFingerprint: string | null;
    occurredAt: string;
  }>): IssuerProvisionReceipt {
    const representedCuitCommitment = commitRepresentedCuit(
      this.#representedCuitCommitmentKey,
      input.credential.representedCuit
    );
    const credential: IssuerCredential = {
      ...input.credential,
      representedCuitCommitment,
    };
    const credentialBundleHash = hashCanonical({
      validatedCredentialBundleHash: input.credentialBundleHash,
      representedCuitCommitment,
    });
    const existing = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE issuer_profile_ref = ?').get(input.credential.issuerProfileRef);
    if (existing) {
      if (existing.credential_bundle_hash === credentialBundleHash) return issuerReceipt(existing);
      if (!input.replaceCertificateFingerprint || input.replaceCertificateFingerprint !== existing.certificate_fingerprint) {
        throw new Error('WSAA_ISSUER_ROTATION_PRECONDITION_FAILED');
      }
    } else if (input.replaceCertificateFingerprint) {
      throw new Error('WSAA_ISSUER_ROTATION_TARGET_NOT_FOUND');
    }
    const encryptedBundle = sealJson(
      this.#issuerKey,
      issuerAad(credential.issuerProfileRef, credential.environment, credential.certificateFingerprint),
      credential
    );
    this.#db.transaction(() => {
      this.#db.query(`
      INSERT INTO issuer_credentials (
        issuer_profile_ref, workspace_id_hash, environment, certificate_holder_cuit_hash, represented_cuit_hash, represented_cuit_commitment, certificate_fingerprint,
        credential_bundle_hash, encrypted_bundle, delegation_confirmed, active, stored_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(issuer_profile_ref) DO UPDATE SET
        workspace_id_hash = excluded.workspace_id_hash,
        environment = excluded.environment,
        certificate_holder_cuit_hash = excluded.certificate_holder_cuit_hash,
        represented_cuit_hash = excluded.represented_cuit_hash,
        represented_cuit_commitment = excluded.represented_cuit_commitment,
        certificate_fingerprint = excluded.certificate_fingerprint,
        credential_bundle_hash = excluded.credential_bundle_hash,
        encrypted_bundle = excluded.encrypted_bundle,
        delegation_confirmed = excluded.delegation_confirmed,
        active = 1,
        updated_at = excluded.updated_at
      `).run(
      credential.issuerProfileRef,
      hashCanonical(credential.workspaceId),
      credential.environment,
      hashCanonical(credential.certificateHolderCuit),
      hashCanonical(credential.representedCuit),
      representedCuitCommitment,
      credential.certificateFingerprint,
      credentialBundleHash,
      encryptedBundle,
      credential.delegationConfirmed ? 1 : 0,
      existing?.stored_at ?? input.occurredAt,
      input.occurredAt
      );
      if (existing) this.deleteIssuerTickets(input.credential.issuerProfileRef);
      this.appendEvent(existing ? 'wsaa_issuer_rotated' : 'wsaa_issuer_provisioned', hashCanonical(input.credential.issuerProfileRef), input.credential.certificateFingerprint, input.occurredAt);
    })();
    return {
      version: 'wsaa-issuer-provision-receipt-v1',
      issuerProfileRef: input.credential.issuerProfileRef,
      environment: input.credential.environment,
      certificateFingerprint: input.credential.certificateFingerprint,
      representedCuitCommitment,
      delegationConfirmed: input.credential.delegationConfirmed,
      storedAt: input.occurredAt,
    };
  }

  getIssuer(workspaceId: string, issuerProfileRef: string, environment: 'homologation' | 'production'): IssuerCredential {
    const row = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE issuer_profile_ref = ?').get(issuerProfileRef);
    if (!row || !row.active || row.workspace_id_hash !== hashCanonical(workspaceId) || row.environment !== environment) throw new Error('WSAA_ISSUER_NOT_FOUND');
    return this.openIssuer(row);
  }

  inspectIssuer(workspaceId: string, issuerProfileRef: string, environment: 'homologation' | 'production'): IssuerCredential | null {
    const row = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE issuer_profile_ref = ?').get(issuerProfileRef);
    if (!row || row.workspace_id_hash !== hashCanonical(workspaceId) || row.environment !== environment) return null;
    return { ...this.openIssuer(row), active: Boolean(row.active), delegationConfirmed: Boolean(row.delegation_confirmed) };
  }

  hasValidTicket(cacheKey: string, occurredAt: string): boolean {
    const row = this.#db.query<{ encrypted_ticket: string; expires_at: string }, [string]>(
      'SELECT encrypted_ticket, expires_at FROM wsaa_tickets WHERE cache_key = ?'
    ).get(cacheKey);
    if (!row || Date.parse(row.expires_at) <= Date.parse(occurredAt) + 60_000) return false;
    const ticket = ticketResponseSchema.parse(openJson(this.#ticketKey, `wsaa-ticket:${cacheKey}`, row.encrypted_ticket));
    return ticket.expiresAt === row.expires_at;
  }

  firstDelegatedIssuer(environment: 'homologation' | 'production'): IssuerCredential | null {
    const row = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE environment = ? AND active = 1 AND delegation_confirmed = 1 ORDER BY updated_at DESC LIMIT 1').get(environment);
    return row ? this.openIssuer(row) : null;
  }

  revokeIssuer(issuerProfileRef: string, certificateFingerprint: string, occurredAt: string): void {
    const row = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE issuer_profile_ref = ?').get(issuerProfileRef);
    if (!row || row.certificate_fingerprint !== certificateFingerprint) throw new Error('WSAA_ISSUER_REVOCATION_PRECONDITION_FAILED');
    if (!row.active) return;
    this.#db.transaction(() => {
      this.#db.query('UPDATE issuer_credentials SET active = 0, delegation_confirmed = 0, updated_at = ? WHERE issuer_profile_ref = ?').run(occurredAt, issuerProfileRef);
      this.deleteIssuerTickets(issuerProfileRef);
      this.appendEvent('wsaa_issuer_revoked', hashCanonical(issuerProfileRef), certificateFingerprint, occurredAt);
    })();
  }

  getTicket(cacheKey: string, occurredAt: string): TicketResponse | null {
    const row = this.#db.query<{ encrypted_ticket: string; expires_at: string }, [string]>(
      'SELECT encrypted_ticket, expires_at FROM wsaa_tickets WHERE cache_key = ?'
    ).get(cacheKey);
    if (!row) return null;
    if (Date.parse(row.expires_at) <= Date.parse(occurredAt) + 60_000) {
      this.#db.query('DELETE FROM wsaa_tickets WHERE cache_key = ?').run(cacheKey);
      return null;
    }
    const ticket = ticketResponseSchema.parse(openJson(this.#ticketKey, `wsaa-ticket:${cacheKey}`, row.encrypted_ticket));
    if (ticket.expiresAt !== row.expires_at) throw new Error('WSAA_TICKET_BINDING_MISMATCH');
    return ticket;
  }

  /** Reuse an authority-identical homologation ticket across enrolled aliases only. */
  reusableAliasTicket(credential: IssuerCredential, service: string, occurredAt: string, allowedWorkspaces: ReadonlySet<string>): TicketResponse | null {
    if (credential.environment !== 'homologation' || !allowedWorkspaces.has(credential.workspaceId)) return null;
    const rows = this.#db.query<IssuerRow, [string, string, string]>(`
      SELECT * FROM issuer_credentials WHERE environment = ? AND certificate_fingerprint = ?
        AND represented_cuit_commitment = ? AND active = 1 AND delegation_confirmed = 1
    `).all(credential.environment, credential.certificateFingerprint, credential.representedCuitCommitment!);
    for (const row of rows) {
      const source = this.openIssuer(row);
      if (!allowedWorkspaces.has(source.workspaceId) || source.representedCuit !== credential.representedCuit
        || source.certificateHolderCuit !== credential.certificateHolderCuit) continue;
      const key = hashCanonical({ environment: source.environment, workspaceId: source.workspaceId,
        issuerProfileRef: source.issuerProfileRef, service, certificateFingerprint: source.certificateFingerprint,
        representedCuitCommitment: source.representedCuitCommitment });
      const ticket = this.getTicket(key, occurredAt);
      if (ticket && ticket.representedCuit === credential.representedCuit
        && ticket.representedCuitCommitment === credential.representedCuitCommitment) return ticket;
    }
    return null;
  }

  storeTicket(cacheKey: string, issuerProfileRef: string, ticket: TicketResponse): void {
    const validated = ticketResponseSchema.parse(ticket);
    this.#db.query(`
      INSERT INTO wsaa_tickets (cache_key, issuer_profile_ref, encrypted_ticket, expires_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET encrypted_ticket = excluded.encrypted_ticket, expires_at = excluded.expires_at
    `).run(cacheKey, issuerProfileRef, sealJson(this.#ticketKey, `wsaa-ticket:${cacheKey}`, validated), validated.expiresAt);
  }

  private deleteIssuerTickets(issuerProfileRef: string): void {
    this.#db.query('DELETE FROM wsaa_tickets WHERE issuer_profile_ref = ?').run(issuerProfileRef);
  }

  appendTicketEvent(issuerProfileRef: string, ticketHash: string, occurredAt: string): void {
    this.appendEvent('wsaa_ticket_obtained', hashCanonical(issuerProfileRef), ticketHash, occurredAt);
  }

  close(): void {
    this.#db.close();
    for (const key of Object.values(this.#payloadKeys)) key.fill(0);
    this.#issuerKey.fill(0);
    this.#ticketKey.fill(0);
    this.#representedCuitCommitmentKey.fill(0);
  }

  private openIssuer(row: IssuerRow): IssuerCredential {
    if (!/^[a-f0-9]{64}$/.test(row.represented_cuit_commitment ?? ''))
      throw new Error('WSAA_ISSUER_REPRESENTED_CUIT_UNBOUND');
    const opened = openJson(this.#issuerKey, issuerAad(row.issuer_profile_ref, environment(row.environment), row.certificate_fingerprint), row.encrypted_bundle) as Partial<IssuerCredential>;
    const credential = {
      ...opened,
      certificateHolderCuit: opened.certificateHolderCuit ?? opened.representedCuit,
    } as IssuerCredential;
    if (
      credential.issuerProfileRef !== row.issuer_profile_ref
      || hashCanonical(credential.workspaceId) !== row.workspace_id_hash
      || credential.environment !== row.environment
      || credential.certificateFingerprint !== row.certificate_fingerprint
      || hashCanonical(credential.certificateHolderCuit) !== row.certificate_holder_cuit_hash
      || hashCanonical(credential.representedCuit) !== row.represented_cuit_hash
      || credential.representedCuitCommitment !== row.represented_cuit_commitment
      || commitRepresentedCuit(
        this.#representedCuitCommitmentKey,
        credential.representedCuit
      ) !== row.represented_cuit_commitment
    ) throw new Error('WSAA_ISSUER_BINDING_MISMATCH');
    return credential;
  }

  private ensureCertificateHolderColumn(): void {
    const columns = this.#db.query<{ name: string }, []>('PRAGMA table_info(issuer_credentials)').all();
    if (columns.some(column => column.name === 'certificate_holder_cuit_hash')) return;
    this.#db.exec('ALTER TABLE issuer_credentials ADD COLUMN certificate_holder_cuit_hash TEXT');
    this.#db.exec('UPDATE issuer_credentials SET certificate_holder_cuit_hash = represented_cuit_hash WHERE certificate_holder_cuit_hash IS NULL');
  }

  private ensureIssuerColumn(name: string, type: string): void {
    const columns = this.#db.query<{ name: string }, []>('PRAGMA table_info(issuer_credentials)').all();
    if (!columns.some(column => column.name === name))
      this.#db.exec(`ALTER TABLE issuer_credentials ADD COLUMN ${name} ${type}`);
  }

  private ensurePayloadColumn(name: string, type: string): void {
    const columns = this.#db.query<{ name: string }, []>('PRAGMA table_info(authority_payloads)').all();
    if (!columns.some(column => column.name === name))
      this.#db.exec(`ALTER TABLE authority_payloads ADD COLUMN ${name} ${type}`);
  }

  private requiredPayload(reference: string): PayloadRow {
    const row = this.#db.query<PayloadRow, [string]>(
      'SELECT * FROM authority_payloads WHERE reference = ?'
    ).get(reference);
    if (!row) throw new Error('AUTHORITY_PAYLOAD_NOT_FOUND');
    return row;
  }

  private retirePayloadRow(row: PayloadRow, occurredAt: string): void {
    if (
      row.resolution_state !== 'officially_reconciled'
      || !row.terminal_evidence_hash
      || !row.authority_identity_hash
      || !row.retention_policy_id
      || !row.terminal_at
      || !row.retire_after
      || row.retire_after > occurredAt
    ) throw new Error('AUTHORITY_PAYLOAD_RETIREMENT_NOT_ELIGIBLE');
    this.#db.query(`
      INSERT INTO authority_payload_tombstones (
        reference, workspace_id_hash, payload_hash, input_hash,
        idempotency_key_hash, stored_at, expires_at, terminal_evidence_hash,
        authority_identity_hash, retention_policy_id, terminal_at, retired_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(reference) DO NOTHING
    `).run(
      row.reference,
      row.workspace_id_hash,
      row.payload_hash,
      row.input_hash,
      row.idempotency_key_hash,
      row.stored_at,
      row.expires_at,
      row.terminal_evidence_hash,
      row.authority_identity_hash,
      row.retention_policy_id,
      row.terminal_at,
      occurredAt
    );
    const removed = this.#db.query(
      'DELETE FROM authority_payloads WHERE reference = ? AND resolution_state = ?'
    ).run(row.reference, 'officially_reconciled');
    if (removed.changes !== 1)
      throw new Error('AUTHORITY_PAYLOAD_RETIREMENT_CONFLICT');
    this.appendEvent(
      'authority_payload_retired',
      hashCanonical(row.reference),
      row.terminal_evidence_hash,
      occurredAt
    );
  }

  private appendEvent(action: string, subjectHash: string, artifactHash: string, occurredAt: string): void {
    this.#db.query('INSERT INTO boundary_events (event_id, action, subject_hash, artifact_hash, occurred_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), action, subjectHash, artifactHash, occurredAt);
  }
}

type PayloadRow = {
  reference: string;
  workspace_id_hash: string;
  payload_hash: string;
  input_hash: string;
  idempotency_key_hash: string;
  encrypted_payload: string;
  stored_at: string;
  expires_at: string;
  resolution_state: string;
  terminal_command_hash: string | null;
  terminal_evidence_hash: string | null;
  authority_identity_hash: string | null;
  retention_policy_id: string | null;
  terminal_at: string | null;
  retire_after: string | null;
  revoked_at: string | null;
};

type PayloadTombstoneRow = {
  reference: string;
  workspace_id_hash: string;
  payload_hash: string;
  input_hash: string;
  idempotency_key_hash: string;
  stored_at: string;
  expires_at: string;
  terminal_evidence_hash: string;
  authority_identity_hash: string;
  retention_policy_id: string;
  terminal_at: string;
  retired_at: string;
};

type IssuerRow = {
  issuer_profile_ref: string;
  workspace_id_hash: string;
  environment: string;
  certificate_holder_cuit_hash: string;
  represented_cuit_hash: string;
  represented_cuit_commitment: string | null;
  certificate_fingerprint: string;
  credential_bundle_hash: string;
  encrypted_bundle: string;
  delegation_confirmed: number;
  active: number;
  stored_at: string;
  updated_at: string;
};

function payloadFamily(payload: AnyAuthorityPayload): PayloadFamily {
  if (payload.version === 'wsfex-authority-payload-v1') return 'wsfex';
  if (payload.version === 'wsfe-authority-payload-v1') return 'wsfe';
  throw new Error('AUTHORITY_PAYLOAD_SCHEMA_UNKNOWN');
}

export function referenceFamily(reference: string): PayloadFamily {
  if (reference.startsWith('vault://wsfex/')) return 'wsfex';
  if (reference.startsWith('vault://wsfe/')) return 'wsfe';
  throw new Error('AUTHORITY_PAYLOAD_REFERENCE_INVALID');
}

export function payloadAad(reference: string, payloadHash: string): string {
  return `authority-payload:${reference}:${payloadHash}`;
}

export function issuerAad(issuerProfileRef: string, environmentValue: 'homologation' | 'production', certificateFingerprint: string): string {
  return `wsaa-issuer:${issuerProfileRef}:${environmentValue}:${certificateFingerprint}`;
}

function payloadReceipt(row: Pick<
  PayloadRow,
  'reference' | 'payload_hash' | 'stored_at' | 'expires_at'
>): PayloadStoreReceipt {
  return { version: 'authority-payload-store-receipt-v1', reference: row.reference, payloadHash: row.payload_hash, storedAt: row.stored_at, expiresAt: row.expires_at };
}

function issuerReceipt(row: IssuerRow): IssuerProvisionReceipt {
  if (!/^[a-f0-9]{64}$/.test(row.represented_cuit_commitment ?? ''))
    throw new Error('WSAA_ISSUER_REPRESENTED_CUIT_UNBOUND');
  return {
    version: 'wsaa-issuer-provision-receipt-v1', issuerProfileRef: row.issuer_profile_ref, environment: environment(row.environment),
    certificateFingerprint: row.certificate_fingerprint,
    representedCuitCommitment: row.represented_cuit_commitment!,
    delegationConfirmed: Boolean(row.delegation_confirmed), storedAt: row.updated_at,
  };
}

function terminalReceipt(row: PayloadRow): PayloadTerminalReceipt {
  if (
    row.resolution_state !== 'officially_reconciled'
    || !row.retention_policy_id
    || !row.retire_after
    || !row.terminal_evidence_hash
    || !row.authority_identity_hash
  ) throw new Error('AUTHORITY_PAYLOAD_TERMINAL_RECEIPT_INVALID');
  return {
    version: 'authority-payload-terminal-receipt-v1',
    referenceHash: hashCanonical(row.reference),
    payloadHash: row.payload_hash,
    authorityIdentityHash: row.authority_identity_hash!,
    terminalState: 'officially_reconciled',
    retentionPolicyId: row.retention_policy_id,
    retireAfter: row.retire_after,
    terminalEvidenceHash: row.terminal_evidence_hash,
  };
}

function environment(value: string): 'homologation' | 'production' {
  if (value !== 'homologation' && value !== 'production') throw new Error('WSAA_ISSUER_ENVIRONMENT_INVALID');
  return value;
}
