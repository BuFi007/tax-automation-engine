import { Database } from 'bun:sqlite';

import { hashCanonical } from '@tax-engine/core';

import { signerResponseSchema, type SignerRequest, type SignerResponse } from './contracts';

const ATTEMPT_SCHEMA_VERSION = 3;
const SCOPED_PRIMARY_KEY = [
  'environment',
  'represented_cuit_commitment',
  'request_id',
] as const;
const SCOPED_COLUMNS = [
  ...SCOPED_PRIMARY_KEY,
  'workspace_id_hash',
  'issuer_profile_reference_hash',
  'subject_id_hash',
  'run_id',
  'intent_hash',
  'payload_reference_hash',
  'payload_hash',
  'document_type',
  'point_of_sale',
  'invoice_number',
  'state',
  'response_json',
  'created_at',
  'updated_at',
] as const;

export type SignerAttemptIdentity = Readonly<{
  environment: SignerRequest['environment'];
  representedCuitCommitment: string;
  requestId: string;
}>;

export type SignerAttempt = Readonly<{
  environment: SignerRequest['environment'];
  representedCuitCommitment: string;
  workspaceIdHash: string;
  issuerProfileReferenceHash: string;
  subjectIdHash: string;
  requestId: string;
  runId: string;
  intentHash: string;
  payloadReferenceHash: string;
  payloadHash: string;
  documentType: 19 | 20 | 21;
  pointOfSale: number;
  invoiceNumber: string;
  state: 'pending' | 'ambiguous' | 'accepted' | 'rejected';
  response: SignerResponse | null;
  createdAt: string;
  updatedAt: string;
}>;

export class SignerAttemptStore {
  readonly #db: Database;

  constructor(path = process.env.WSFEX_SIGNER_DB_PATH ?? ':memory:') {
    this.#db = new Database(path, { create: true });
    try {
      this.#db.exec('PRAGMA journal_mode = WAL;');
      this.migrateSchema();
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  close(): void {
    this.#db.close();
  }

  get(identity: SignerAttemptIdentity): SignerAttempt | null {
    const key = storedIdentity(identity);
    const row = this.#db.query<AttemptRow, [string, string, string]>(`
      SELECT * FROM wsfex_attempts
      WHERE environment = ?
        AND represented_cuit_commitment = ?
        AND request_id = ?
    `).get(key.environment, key.representedCuitCommitment, key.requestId);
    return row ? attemptFromRow(row) : null;
  }

  begin(input: Readonly<{
    request: SignerRequest;
    issuerProfileRef: string;
    representedCuitCommitment: string;
    payloadReferenceHash: string;
    payloadHash: string;
    invoiceNumber: string;
    occurredAt: string;
  }>): SignerAttempt {
    const identity = identityFor(input.request, input.representedCuitCommitment);
    const existing = this.get(identity);
    if (existing) return existing;
    const key = storedIdentity(identity);
    this.#db.query(`
      INSERT INTO wsfex_attempts (
        environment, represented_cuit_commitment, workspace_id_hash,
        issuer_profile_reference_hash, subject_id_hash, request_id, run_id,
        intent_hash, payload_reference_hash, payload_hash, document_type, point_of_sale, invoice_number,
        state, response_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
    `).run(
      key.environment,
      key.representedCuitCommitment,
      hashCanonical(input.request.workspaceId),
      hashCanonical(input.issuerProfileRef),
      hashCanonical(input.request.subjectId),
      key.requestId,
      input.request.runId,
      input.request.intentHash,
      input.payloadReferenceHash,
      input.payloadHash,
      input.request.expected.documentType,
      input.request.expected.pointOfSale,
      input.invoiceNumber,
      input.occurredAt,
      input.occurredAt
    );
    return this.get(identity)!;
  }

  complete(identity: SignerAttemptIdentity, response: SignerResponse, occurredAt: string): SignerAttempt {
    if (response.requestId !== identity.requestId) throw new Error('WSFEX_ATTEMPT_RESPONSE_REQUEST_ID_MISMATCH');
    if (response.status === 'preflight_rejected')
      throw new Error('WSFEX_ATTEMPT_PREFLIGHT_RESPONSE_FORBIDDEN');
    const existing = this.get(identity);
    if (!existing) throw new Error('WSFEX_ATTEMPT_NOT_FOUND');
    const key = storedIdentity(identity);
    const updated = this.#db.query(`
      UPDATE wsfex_attempts
      SET state = ?, response_json = ?, updated_at = ?
      WHERE environment = ?
        AND represented_cuit_commitment = ?
        AND request_id = ?
        AND CASE state
          WHEN 'pending' THEN 0
          WHEN 'ambiguous' THEN 1
          WHEN 'rejected' THEN 2
          WHEN 'accepted' THEN 3
          ELSE 99
        END <= ?
    `).run(
      response.status,
      JSON.stringify(response),
      occurredAt,
      key.environment,
      key.representedCuitCommitment,
      key.requestId,
      response.status === 'accepted' ? 3 : response.status === 'rejected' ? 2 : 1
    );
    const completed = this.get(identity)!;
    if (updated.changes === 0 && !completed.response)
      throw new Error('WSFEX_ATTEMPT_COMPLETION_CONFLICT');
    return completed;
  }

  private migrateSchema(): void {
    this.#db.transaction(() => {
      const table = this.#db.query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
      ).get('wsfex_attempts');
      if (!table) {
        this.createScopedSchema();
        return;
      }

      const columns = this.#db.query<{ name: string; pk: number }, []>('PRAGMA table_info(wsfex_attempts)').all();
      const columnNames = columns.map(column => column.name);
      const primaryKey = columns
        .filter(column => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map(column => column.name);
      const storedVersion = this.#db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version ?? 0;
      if (sameColumns(primaryKey, SCOPED_PRIMARY_KEY)) {
        if (storedVersion > ATTEMPT_SCHEMA_VERSION || SCOPED_COLUMNS.some(column => !columnNames.includes(column))) {
          throw new Error('WSFEX_ATTEMPT_SCHEMA_RECONCILIATION_REQUIRED');
        }
        this.#db.exec(`PRAGMA user_version = ${ATTEMPT_SCHEMA_VERSION};`);
        return;
      }

      const isGlobalRequestIdSchema = primaryKey.length === 1
        && primaryKey[0] === 'request_id'
        && !columns.some(column => column.name === 'represented_cuit_commitment');
      const isWorkspaceScopedV2 = sameColumns(primaryKey, [
        'environment',
        'workspace_id_hash',
        'issuer_profile_reference_hash',
        'request_id',
      ]);
      if (!isGlobalRequestIdSchema && !isWorkspaceScopedV2)
        throw new Error('WSFEX_ATTEMPT_SCHEMA_RECONCILIATION_REQUIRED');

      const legacyCount = this.#db.query<{ count: number }, []>(
        'SELECT COUNT(*) AS count FROM wsfex_attempts'
      ).get()?.count ?? 0;
      if (legacyCount > 0) {
        throw new Error(
          isWorkspaceScopedV2
            ? 'WSFEX_WORKSPACE_SCOPED_ATTEMPT_RECONCILIATION_REQUIRED'
            : 'WSFEX_LEGACY_ATTEMPT_RECONCILIATION_REQUIRED'
        );
      }

      // An empty v1 table carries no identity to reinterpret. Replacing it in this
      // transaction is safe; any populated v1 database is rejected above because
      // its rows cannot be assigned to tenant scopes without operator evidence.
      this.#db.exec('DROP TABLE wsfex_attempts;');
      this.createScopedSchema();
    })();
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS wsfex_authority_sequence_leases (
        environment TEXT NOT NULL CHECK (environment IN ('homologation', 'production')),
        represented_cuit_commitment TEXT NOT NULL,
        owner_token TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL,
        PRIMARY KEY (environment, represented_cuit_commitment)
      );
    `);
  }

  private createScopedSchema(): void {
    this.#db.exec(`
      CREATE TABLE wsfex_attempts (
        environment TEXT NOT NULL CHECK (environment IN ('homologation', 'production')),
        represented_cuit_commitment TEXT NOT NULL,
        workspace_id_hash TEXT NOT NULL,
        issuer_profile_reference_hash TEXT NOT NULL,
        subject_id_hash TEXT NOT NULL,
        request_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        payload_reference_hash TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        document_type INTEGER NOT NULL,
        point_of_sale INTEGER NOT NULL,
        invoice_number TEXT NOT NULL,
        state TEXT NOT NULL,
        response_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (environment, represented_cuit_commitment, request_id)
      );
      PRAGMA user_version = ${ATTEMPT_SCHEMA_VERSION};
    `);
  }

  acquireAuthoritySequenceLease(
    identity: SignerAttemptIdentity,
    now = new Date(),
    leaseMs = 5 * 60_000
  ): string {
    if (!/^[a-f0-9]{64}$/.test(identity.representedCuitCommitment)) {
      throw new Error('WSFEX_REPRESENTED_CUIT_COMMITMENT_INVALID');
    }
    if (!Number.isFinite(now.getTime()) || leaseMs < 30_000) {
      throw new Error('WSFEX_AUTHORITY_SEQUENCE_LEASE_INVALID');
    }
    const ownerToken = crypto.randomUUID();
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    return this.#db.transaction(() => {
      const inserted = this.#db.query(`
        INSERT OR IGNORE INTO wsfex_authority_sequence_leases (
          environment, represented_cuit_commitment, owner_token, lease_expires_at
        ) VALUES (?, ?, ?, ?)
      `).run(
        identity.environment,
        identity.representedCuitCommitment,
        ownerToken,
        expiresAt
      );
      if (inserted.changes === 1) return ownerToken;
      const reclaimed = this.#db.query(`
        UPDATE wsfex_authority_sequence_leases
        SET owner_token = ?, lease_expires_at = ?
        WHERE environment = ? AND represented_cuit_commitment = ?
          AND lease_expires_at <= ?
      `).run(
        ownerToken,
        expiresAt,
        identity.environment,
        identity.representedCuitCommitment,
        now.toISOString()
      );
      if (reclaimed.changes !== 1) throw new Error('WSFEX_AUTHORITY_SEQUENCE_BUSY');
      return ownerToken;
    })();
  }

  releaseAuthoritySequenceLease(identity: SignerAttemptIdentity, ownerToken: string): void {
    this.#db.query(`
      DELETE FROM wsfex_authority_sequence_leases
      WHERE environment = ? AND represented_cuit_commitment = ? AND owner_token = ?
    `).run(identity.environment, identity.representedCuitCommitment, ownerToken);
  }
}

export function identityFor(
  request: SignerRequest,
  representedCuitCommitment: string
): SignerAttemptIdentity {
  return {
    environment: request.environment,
    representedCuitCommitment,
    requestId: request.requestId,
  };
}

function storedIdentity(identity: SignerAttemptIdentity) {
  return {
    environment: identity.environment,
    representedCuitCommitment: identity.representedCuitCommitment,
    requestId: identity.requestId,
  };
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
}

function attemptFromRow(row: AttemptRow): SignerAttempt {
  return {
    environment: environment(row.environment),
    representedCuitCommitment: row.represented_cuit_commitment,
    workspaceIdHash: row.workspace_id_hash,
    issuerProfileReferenceHash: row.issuer_profile_reference_hash,
    subjectIdHash: row.subject_id_hash,
    requestId: row.request_id,
    runId: row.run_id,
    intentHash: row.intent_hash,
    payloadReferenceHash: row.payload_reference_hash,
    payloadHash: row.payload_hash,
    documentType: documentType(row.document_type),
    pointOfSale: row.point_of_sale,
    invoiceNumber: row.invoice_number,
    state: attemptState(row.state),
    response: row.response_json ? signerResponseSchema.parse(JSON.parse(row.response_json)) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function environment(value: string): SignerAttempt['environment'] {
  if (value !== 'homologation' && value !== 'production') throw new Error('WSFEX_STORED_ENVIRONMENT_INVALID');
  return value;
}

function documentType(value: number): 19 | 20 | 21 {
  if (value !== 19 && value !== 20 && value !== 21) throw new Error('WSFEX_STORED_DOCUMENT_TYPE_INVALID');
  return value;
}

function attemptState(value: string): SignerAttempt['state'] {
  if (!['pending', 'ambiguous', 'accepted', 'rejected'].includes(value)) throw new Error('WSFEX_STORED_ATTEMPT_STATE_INVALID');
  return value as SignerAttempt['state'];
}

type AttemptRow = {
  environment: string;
  represented_cuit_commitment: string;
  workspace_id_hash: string;
  issuer_profile_reference_hash: string;
  subject_id_hash: string;
  request_id: string;
  run_id: string;
  intent_hash: string;
  payload_reference_hash: string;
  payload_hash: string;
  document_type: number;
  point_of_sale: number;
  invoice_number: string;
  state: string;
  response_json: string | null;
  created_at: string;
  updated_at: string;
};
