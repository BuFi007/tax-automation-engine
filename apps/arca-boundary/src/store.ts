import { randomUUID } from 'node:crypto';

import { hashCanonical } from '@tax-engine/core';
import { Database } from 'bun:sqlite';

import { anyAuthorityPayloadSchema, type AnyAuthorityPayload, type IssuerProvisionReceipt, type PayloadStoreReceipt } from './contracts';
import { deriveDomainKey, openJson, sealJson } from './crypto';

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
  certificatePem: string;
  privateKeyPem: string;
  certificateFingerprint: string;
  delegationConfirmed: boolean;
  active: boolean;
}>;

export class ArcaBoundaryStore {
  readonly #db: Database;
  readonly #payloadKeys: Record<PayloadFamily, Buffer>;
  readonly #issuerKey: Buffer;

  constructor(masterKey: Buffer, path = process.env.ARCA_BOUNDARY_DB_PATH ?? ':memory:') {
    this.#payloadKeys = {
      wsfex: deriveDomainKey(masterKey, PAYLOAD_DOMAIN.wsfex),
      wsfe: deriveDomainKey(masterKey, PAYLOAD_DOMAIN.wsfe),
    };
    this.#issuerKey = deriveDomainKey(masterKey, 'issuer-credentials');
    this.#db = new Database(path, { create: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS authority_payloads (
        reference TEXT PRIMARY KEY,
        workspace_id_hash TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        idempotency_key_hash TEXT NOT NULL UNIQUE,
        encrypted_payload TEXT NOT NULL,
        stored_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS issuer_credentials (
        issuer_profile_ref TEXT PRIMARY KEY,
        workspace_id_hash TEXT NOT NULL,
        environment TEXT NOT NULL,
        certificate_holder_cuit_hash TEXT NOT NULL,
        represented_cuit_hash TEXT NOT NULL,
        certificate_fingerprint TEXT NOT NULL,
        credential_bundle_hash TEXT NOT NULL,
        encrypted_bundle TEXT NOT NULL,
        delegation_confirmed INTEGER NOT NULL,
        active INTEGER NOT NULL,
        stored_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
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
    if (Date.parse(row.expires_at) <= Date.parse(occurredAt)) throw new Error('AUTHORITY_PAYLOAD_EXPIRED');
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
    if (row.revoked_at) return;
    this.#db.query('UPDATE authority_payloads SET revoked_at = ? WHERE reference = ?').run(occurredAt, reference);
    this.appendEvent('authority_payload_revoked', hashCanonical(reference), row.payload_hash, occurredAt);
  }

  provisionIssuer(input: Readonly<{
    credential: IssuerCredential;
    credentialBundleHash: string;
    replaceCertificateFingerprint: string | null;
    occurredAt: string;
  }>): IssuerProvisionReceipt {
    const existing = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE issuer_profile_ref = ?').get(input.credential.issuerProfileRef);
    if (existing) {
      if (existing.credential_bundle_hash === input.credentialBundleHash) return issuerReceipt(existing);
      if (!input.replaceCertificateFingerprint || input.replaceCertificateFingerprint !== existing.certificate_fingerprint) {
        throw new Error('WSAA_ISSUER_ROTATION_PRECONDITION_FAILED');
      }
    } else if (input.replaceCertificateFingerprint) {
      throw new Error('WSAA_ISSUER_ROTATION_TARGET_NOT_FOUND');
    }
    const encryptedBundle = sealJson(
      this.#issuerKey,
      issuerAad(input.credential.issuerProfileRef, input.credential.environment, input.credential.certificateFingerprint),
      input.credential
    );
    this.#db.query(`
      INSERT INTO issuer_credentials (
        issuer_profile_ref, workspace_id_hash, environment, certificate_holder_cuit_hash, represented_cuit_hash, certificate_fingerprint,
        credential_bundle_hash, encrypted_bundle, delegation_confirmed, active, stored_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(issuer_profile_ref) DO UPDATE SET
        workspace_id_hash = excluded.workspace_id_hash,
        environment = excluded.environment,
        certificate_holder_cuit_hash = excluded.certificate_holder_cuit_hash,
        represented_cuit_hash = excluded.represented_cuit_hash,
        certificate_fingerprint = excluded.certificate_fingerprint,
        credential_bundle_hash = excluded.credential_bundle_hash,
        encrypted_bundle = excluded.encrypted_bundle,
        delegation_confirmed = excluded.delegation_confirmed,
        active = 1,
        updated_at = excluded.updated_at
    `).run(
      input.credential.issuerProfileRef,
      hashCanonical(input.credential.workspaceId),
      input.credential.environment,
      hashCanonical(input.credential.certificateHolderCuit),
      hashCanonical(input.credential.representedCuit),
      input.credential.certificateFingerprint,
      input.credentialBundleHash,
      encryptedBundle,
      input.credential.delegationConfirmed ? 1 : 0,
      existing?.stored_at ?? input.occurredAt,
      input.occurredAt
    );
    this.appendEvent(existing ? 'wsaa_issuer_rotated' : 'wsaa_issuer_provisioned', hashCanonical(input.credential.issuerProfileRef), input.credential.certificateFingerprint, input.occurredAt);
    return {
      version: 'wsaa-issuer-provision-receipt-v1',
      issuerProfileRef: input.credential.issuerProfileRef,
      environment: input.credential.environment,
      certificateFingerprint: input.credential.certificateFingerprint,
      delegationConfirmed: input.credential.delegationConfirmed,
      storedAt: input.occurredAt,
    };
  }

  getIssuer(workspaceId: string, issuerProfileRef: string, environment: 'homologation' | 'production'): IssuerCredential {
    const row = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE issuer_profile_ref = ?').get(issuerProfileRef);
    if (!row || !row.active || row.workspace_id_hash !== hashCanonical(workspaceId) || row.environment !== environment) throw new Error('WSAA_ISSUER_NOT_FOUND');
    return this.openIssuer(row);
  }

  firstDelegatedIssuer(environment: 'homologation' | 'production'): IssuerCredential | null {
    const row = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE environment = ? AND active = 1 AND delegation_confirmed = 1 ORDER BY updated_at DESC LIMIT 1').get(environment);
    return row ? this.openIssuer(row) : null;
  }

  revokeIssuer(issuerProfileRef: string, certificateFingerprint: string, occurredAt: string): void {
    const row = this.#db.query<IssuerRow, [string]>('SELECT * FROM issuer_credentials WHERE issuer_profile_ref = ?').get(issuerProfileRef);
    if (!row || row.certificate_fingerprint !== certificateFingerprint) throw new Error('WSAA_ISSUER_REVOCATION_PRECONDITION_FAILED');
    if (!row.active) return;
    this.#db.query('UPDATE issuer_credentials SET active = 0, delegation_confirmed = 0, updated_at = ? WHERE issuer_profile_ref = ?').run(occurredAt, issuerProfileRef);
    this.appendEvent('wsaa_issuer_revoked', hashCanonical(issuerProfileRef), certificateFingerprint, occurredAt);
  }

  appendTicketEvent(issuerProfileRef: string, ticketHash: string, occurredAt: string): void {
    this.appendEvent('wsaa_ticket_obtained', hashCanonical(issuerProfileRef), ticketHash, occurredAt);
  }

  close(): void {
    this.#db.close();
  }

  private openIssuer(row: IssuerRow): IssuerCredential {
    const opened = openJson(this.#issuerKey, issuerAad(row.issuer_profile_ref, environment(row.environment), row.certificate_fingerprint), row.encrypted_bundle) as Partial<IssuerCredential>;
    const credential = {
      ...opened,
      certificateHolderCuit: opened.certificateHolderCuit ?? opened.representedCuit,
    } as IssuerCredential;
    if (
      credential.issuerProfileRef !== row.issuer_profile_ref
      || credential.environment !== row.environment
      || credential.certificateFingerprint !== row.certificate_fingerprint
      || hashCanonical(credential.certificateHolderCuit) !== row.certificate_holder_cuit_hash
      || hashCanonical(credential.representedCuit) !== row.represented_cuit_hash
    ) throw new Error('WSAA_ISSUER_BINDING_MISMATCH');
    return credential;
  }

  private ensureCertificateHolderColumn(): void {
    const columns = this.#db.query<{ name: string }, []>('PRAGMA table_info(issuer_credentials)').all();
    if (columns.some(column => column.name === 'certificate_holder_cuit_hash')) return;
    this.#db.exec('ALTER TABLE issuer_credentials ADD COLUMN certificate_holder_cuit_hash TEXT');
    this.#db.exec('UPDATE issuer_credentials SET certificate_holder_cuit_hash = represented_cuit_hash WHERE certificate_holder_cuit_hash IS NULL');
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
  revoked_at: string | null;
};

type IssuerRow = {
  issuer_profile_ref: string;
  workspace_id_hash: string;
  environment: string;
  certificate_holder_cuit_hash: string;
  represented_cuit_hash: string;
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

function payloadReceipt(row: PayloadRow): PayloadStoreReceipt {
  return { version: 'authority-payload-store-receipt-v1', reference: row.reference, payloadHash: row.payload_hash, storedAt: row.stored_at, expiresAt: row.expires_at };
}

function issuerReceipt(row: IssuerRow): IssuerProvisionReceipt {
  return {
    version: 'wsaa-issuer-provision-receipt-v1', issuerProfileRef: row.issuer_profile_ref, environment: environment(row.environment),
    certificateFingerprint: row.certificate_fingerprint, delegationConfirmed: Boolean(row.delegation_confirmed), storedAt: row.updated_at,
  };
}

function environment(value: string): 'homologation' | 'production' {
  if (value !== 'homologation' && value !== 'production') throw new Error('WSAA_ISSUER_ENVIRONMENT_INVALID');
  return value;
}
