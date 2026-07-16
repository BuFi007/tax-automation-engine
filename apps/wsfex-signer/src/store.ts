import { Database } from 'bun:sqlite';

import { hashCanonical } from '@tax-engine/core';

import { signerResponseSchema, type SignerRequest, type SignerResponse } from './contracts';

const ATTEMPT_SCHEMA_VERSION = 4;
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

export type WsfexSequenceReservation = Readonly<{
  environment: SignerRequest['environment'];
  representedCuitCommitment: string;
  workspaceIdHash: string;
  issuerProfileReferenceHash: string;
  runId: string;
  intentHash: string;
  subjectIdHash: string;
  idempotencyKey: string;
  requestId: string;
  documentType: 19;
  pointOfSale: number;
  invoiceNumber: string;
  state: 'reserved' | 'consumed';
  reservedAt: string;
  expiresAt: string;
  consumedAt: string | null;
}>;

type SequenceReservationInput = Readonly<{
  environment: SignerRequest['environment'];
  representedCuitCommitment: string;
  workspaceId: string;
  issuerProfileRef: string;
  runId: string;
  intentHash: string;
  subjectId: string;
  idempotencyKey: string;
  requestId: string;
  documentType: 19;
  pointOfSale: number;
  invoiceNumber: string;
  reservedAt: string;
  expiresAt: string;
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
    return this.beginRecord(input);
  }

  beginWithSequenceReservation(input: Readonly<{
    request: SignerRequest;
    issuerProfileRef: string;
    representedCuitCommitment: string;
    payloadReferenceHash: string;
    payloadHash: string;
    invoiceNumber: string;
    occurredAt: string;
  }>): SignerAttempt {
    return this.#db.transaction(() => {
      const identity = identityFor(input.request, input.representedCuitCommitment);
      const existing = this.get(identity);
      if (existing) return existing;
      const reservation = this.getSequenceReservationByRequestId(identity);
      if (!reservation) throw new Error('WSFEX_SEQUENCE_RESERVATION_REQUIRED');
      assertSequenceReservationBinding(reservation, input);
      if (reservation.state !== 'reserved') throw new Error('WSFEX_SEQUENCE_RESERVATION_CONSUMED');
      if (Date.parse(reservation.expiresAt) <= Date.parse(input.occurredAt))
        throw new Error('WSFEX_SEQUENCE_RESERVATION_EXPIRED');
      const attempt = this.beginRecord(input);
      const consumed = this.#db.query(`
        UPDATE wsfex_sequence_reservations
        SET state = 'consumed', consumed_at = ?
        WHERE environment = ?
          AND represented_cuit_commitment = ?
          AND request_id = ?
          AND state = 'reserved'
      `).run(
        input.occurredAt,
        reservation.environment,
        reservation.representedCuitCommitment,
        reservation.requestId
      );
      if (consumed.changes !== 1) throw new Error('WSFEX_SEQUENCE_RESERVATION_CONFLICT');
      return attempt;
    })();
  }

  reserveSequence(input: SequenceReservationInput): Readonly<{
    reservation: WsfexSequenceReservation;
    replayed: boolean;
  }> {
    validateSequenceReservationInput(input);
    return this.#db.transaction(() => {
      const replay = this.getSequenceReservationByIdempotency(
        input.environment,
        input.representedCuitCommitment,
        input.idempotencyKey
      );
      if (replay) {
        if (replay.state === 'reserved' && Date.parse(replay.expiresAt) <= Date.parse(input.reservedAt)) {
          this.#db.query(`
            DELETE FROM wsfex_sequence_reservations
            WHERE environment = ?
              AND represented_cuit_commitment = ?
              AND idempotency_key = ?
              AND state = 'reserved'
              AND expires_at <= ?
          `).run(input.environment, input.representedCuitCommitment, input.idempotencyKey, input.reservedAt);
        } else {
          assertSequenceReservationInputBinding(replay, input);
          return { reservation: replay, replayed: true };
        }
      }
      this.#db.query(`
        DELETE FROM wsfex_sequence_reservations
        WHERE environment = ?
          AND represented_cuit_commitment = ?
          AND state = 'reserved'
          AND expires_at <= ?
      `).run(input.environment, input.representedCuitCommitment, input.reservedAt);
      const active = this.#db.query<{ request_id: string }, [string, string]>(`
        SELECT request_id FROM wsfex_sequence_reservations
        WHERE environment = ?
          AND represented_cuit_commitment = ?
          AND state = 'reserved'
        LIMIT 1
      `).get(input.environment, input.representedCuitCommitment);
      if (active) throw new Error('WSFEX_SEQUENCE_RESERVATION_BUSY');
      this.#db.query(`
        INSERT INTO wsfex_sequence_reservations (
          environment, represented_cuit_commitment, workspace_id_hash,
          issuer_profile_reference_hash, run_id, intent_hash, subject_id_hash,
          idempotency_key, request_id, document_type, point_of_sale,
          invoice_number, state, reserved_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?, NULL)
      `).run(
        input.environment,
        input.representedCuitCommitment,
        hashCanonical(input.workspaceId),
        hashCanonical(input.issuerProfileRef),
        input.runId,
        input.intentHash,
        hashCanonical(input.subjectId),
        input.idempotencyKey,
        input.requestId,
        input.documentType,
        input.pointOfSale,
        input.invoiceNumber,
        input.reservedAt,
        input.expiresAt
      );
      const reservation = this.getSequenceReservationByIdempotency(
        input.environment,
        input.representedCuitCommitment,
        input.idempotencyKey
      );
      if (!reservation) throw new Error('WSFEX_SEQUENCE_RESERVATION_PERSIST_FAILED');
      return { reservation, replayed: false };
    })();
  }

  getSequenceReservationByIdempotency(
    environment: SignerRequest['environment'],
    representedCuitCommitment: string,
    idempotencyKey: string
  ): WsfexSequenceReservation | null {
    const row = this.#db.query<SequenceReservationRow, [string, string, string]>(`
      SELECT * FROM wsfex_sequence_reservations
      WHERE environment = ?
        AND represented_cuit_commitment = ?
        AND idempotency_key = ?
    `).get(environment, representedCuitCommitment, idempotencyKey);
    return row ? sequenceReservationFromRow(row) : null;
  }

  private getSequenceReservationByRequestId(
    identity: SignerAttemptIdentity
  ): WsfexSequenceReservation | null {
    const row = this.#db.query<SequenceReservationRow, [string, string, string]>(`
      SELECT * FROM wsfex_sequence_reservations
      WHERE environment = ?
        AND represented_cuit_commitment = ?
        AND request_id = ?
    `).get(identity.environment, identity.representedCuitCommitment, identity.requestId);
    return row ? sequenceReservationFromRow(row) : null;
  }

  private beginRecord(input: Readonly<{
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
      CREATE TABLE IF NOT EXISTS wsfex_sequence_reservations (
        environment TEXT NOT NULL CHECK (environment IN ('homologation', 'production')),
        represented_cuit_commitment TEXT NOT NULL,
        workspace_id_hash TEXT NOT NULL,
        issuer_profile_reference_hash TEXT NOT NULL,
        run_id TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        subject_id_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        request_id TEXT NOT NULL,
        document_type INTEGER NOT NULL CHECK (document_type = 19),
        point_of_sale INTEGER NOT NULL,
        invoice_number TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed')),
        reserved_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        PRIMARY KEY (environment, represented_cuit_commitment, idempotency_key),
        UNIQUE (environment, represented_cuit_commitment, request_id),
        UNIQUE (
          environment,
          represented_cuit_commitment,
          document_type,
          point_of_sale,
          invoice_number
        )
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

function validateSequenceReservationInput(input: SequenceReservationInput): void {
  if (!/^[a-f0-9]{64}$/.test(input.representedCuitCommitment))
    throw new Error('WSFEX_REPRESENTED_CUIT_COMMITMENT_INVALID');
  if (!/^[a-f0-9]{64}$/.test(input.intentHash))
    throw new Error('WSFEX_SEQUENCE_RESERVATION_INTENT_HASH_INVALID');
  if (!/^[1-9]\d{0,14}$/.test(input.requestId)) throw new Error('WSFEX_REQUEST_ID_INVALID');
  if (!/^[1-9]\d{0,7}$/.test(input.invoiceNumber)) throw new Error('WSFEX_INVOICE_NUMBER_INVALID');
  const reservedAt = Date.parse(input.reservedAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(reservedAt) || !Number.isFinite(expiresAt)
    || expiresAt <= reservedAt || expiresAt - reservedAt > 15 * 60_000)
    throw new Error('WSFEX_SEQUENCE_RESERVATION_TTL_INVALID');
}

function assertSequenceReservationInputBinding(
  reservation: WsfexSequenceReservation,
  input: SequenceReservationInput
): void {
  if (reservation.environment !== input.environment
    || reservation.representedCuitCommitment !== input.representedCuitCommitment
    || reservation.workspaceIdHash !== hashCanonical(input.workspaceId)
    || reservation.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
    || reservation.runId !== input.runId
    || reservation.intentHash !== input.intentHash
    || reservation.subjectIdHash !== hashCanonical(input.subjectId)
    || reservation.idempotencyKey !== input.idempotencyKey
    || reservation.requestId !== input.requestId
    || reservation.documentType !== input.documentType
    || reservation.pointOfSale !== input.pointOfSale
    || reservation.invoiceNumber !== input.invoiceNumber)
    throw new Error('WSFEX_SEQUENCE_RESERVATION_BINDING_MISMATCH');
}

function assertSequenceReservationBinding(
  reservation: WsfexSequenceReservation,
  input: Readonly<{
    request: SignerRequest;
    issuerProfileRef: string;
    representedCuitCommitment: string;
    invoiceNumber: string;
  }>
): void {
  if (reservation.environment !== input.request.environment
    || reservation.representedCuitCommitment !== input.representedCuitCommitment
    || reservation.workspaceIdHash !== hashCanonical(input.request.workspaceId)
    || reservation.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
    || reservation.runId !== input.request.runId
    || reservation.intentHash !== input.request.intentHash
    || reservation.subjectIdHash !== hashCanonical(input.request.subjectId)
    || reservation.requestId !== input.request.requestId
    || reservation.documentType !== input.request.expected.documentType
    || reservation.pointOfSale !== input.request.expected.pointOfSale
    || reservation.invoiceNumber !== input.invoiceNumber)
    throw new Error('WSFEX_SEQUENCE_RESERVATION_BINDING_MISMATCH');
}

function sequenceReservationFromRow(row: SequenceReservationRow): WsfexSequenceReservation {
  if (row.document_type !== 19) throw new Error('WSFEX_SEQUENCE_RESERVATION_DOCUMENT_INVALID');
  if (row.state !== 'reserved' && row.state !== 'consumed')
    throw new Error('WSFEX_SEQUENCE_RESERVATION_STATE_INVALID');
  return {
    environment: environment(row.environment),
    representedCuitCommitment: row.represented_cuit_commitment,
    workspaceIdHash: row.workspace_id_hash,
    issuerProfileReferenceHash: row.issuer_profile_reference_hash,
    runId: row.run_id,
    intentHash: row.intent_hash,
    subjectIdHash: row.subject_id_hash,
    idempotencyKey: row.idempotency_key,
    requestId: row.request_id,
    documentType: 19,
    pointOfSale: row.point_of_sale,
    invoiceNumber: row.invoice_number,
    state: row.state,
    reservedAt: row.reserved_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
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

type SequenceReservationRow = {
  environment: string;
  represented_cuit_commitment: string;
  workspace_id_hash: string;
  issuer_profile_reference_hash: string;
  run_id: string;
  intent_hash: string;
  subject_id_hash: string;
  idempotency_key: string;
  request_id: string;
  document_type: number;
  point_of_sale: number;
  invoice_number: string;
  state: string;
  reserved_at: string;
  expires_at: string;
  consumed_at: string | null;
};
