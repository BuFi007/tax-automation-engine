import type { SqlDatabase } from '@tax-engine/sql-store';
import { openSqlDatabase } from '@tax-engine/sql-store/bun';

import { hashCanonical } from '@tax-engine/core';
import { signerRequestSchema, type SignerRequest } from '@tax-engine/wsfe-signer/contracts';
import { z } from 'zod';
import { fiscalWorkspaceIdSchema } from './arca-fiscal-beta';

const attemptSchema = z.object({
  invoiceId: z.uuid(),
  workspaceId: fiscalWorkspaceIdSchema,
  environment: z.literal('homologation'),
  connectionId: z.uuid(),
  invoiceUpdatedAt: z.iso.datetime({ offset: true }),
  issuerProfileRef: z.string().min(1).max(500),
  taxpayerReferenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  representedCuitCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  pointOfSale: z.number().int().positive().max(99998),
  voucherNumber: z.string().regex(/^[1-9]\d{0,7}$/),
  signerRequestId: z.string().regex(/^[1-9]\d{0,14}$/),
  idempotencyKey: z.uuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type PersonalWsfeAttemptInput = z.infer<typeof attemptSchema>;
export type PersonalWsfeAttempt = Readonly<Omit<PersonalWsfeAttemptInput, 'issuerProfileRef'> & {
  issuerProfileReferenceHash: string;
  claimState: 'active' | 'rejected';
  payloadExpiresAt: string;
  payloadReference: string | null;
  payloadHash: string | null;
  signerRequest: SignerRequest | null;
}>;

/** Tax stores no receptor identity, represented CUIT, certificate or WSAA ticket. */
export class PersonalWsfeAttemptStore {
  readonly #db: SqlDatabase;

  constructor(path: string | SqlDatabase, requireDurable = true) {
    if (requireDurable && (typeof path === 'string'
      ? !path || path === ':memory:' || /(?:\?|&)mode=memory(?:&|$)/i.test(path)
      : !path.durable))
      throw new Error('PERSONAL_WSFE_DURABLE_DB_REQUIRED');
    this.#db = openSqlDatabase(path);
    this.#db.configure({ wal: true });
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS personal_wsfe_attempts (
        invoice_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment = 'homologation'),
        connection_id TEXT NOT NULL,
        invoice_updated_at TEXT NOT NULL,
        issuer_profile_reference_hash TEXT NOT NULL,
        taxpayer_reference_hash TEXT NOT NULL,
        represented_cuit_commitment TEXT NOT NULL,
        point_of_sale INTEGER NOT NULL,
        voucher_number TEXT NOT NULL,
        signer_request_id TEXT NOT NULL UNIQUE,
        idempotency_key TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL,
        claim_state TEXT NOT NULL DEFAULT 'active' CHECK (claim_state IN ('active', 'rejected')),
        payload_expires_at TEXT NOT NULL,
        payload_reference TEXT,
        payload_hash TEXT,
        signer_request_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS personal_wsfe_active_voucher
        ON personal_wsfe_attempts (represented_cuit_commitment, point_of_sale, voucher_number)
        WHERE claim_state = 'active';
    `);
  }

  get(invoiceId: string): PersonalWsfeAttempt | null {
    const row = this.#db.query<Record<string, string | number | null>, [string]>(
      'SELECT * FROM personal_wsfe_attempts WHERE invoice_id = ?'
    ).get(invoiceId);
    if (!row) return null;
    return {
      invoiceId: String(row.invoice_id),
      workspaceId: String(row.workspace_id),
      environment: 'homologation',
      connectionId: String(row.connection_id),
      invoiceUpdatedAt: String(row.invoice_updated_at),
      issuerProfileReferenceHash: String(row.issuer_profile_reference_hash),
      taxpayerReferenceHash: String(row.taxpayer_reference_hash),
      representedCuitCommitment: String(row.represented_cuit_commitment),
      pointOfSale: Number(row.point_of_sale),
      voucherNumber: String(row.voucher_number),
      signerRequestId: String(row.signer_request_id),
      idempotencyKey: String(row.idempotency_key),
      requestHash: String(row.request_hash),
      claimState: row.claim_state === 'rejected' ? 'rejected' : 'active',
      payloadExpiresAt: String(row.payload_expires_at),
      payloadReference: row.payload_reference === null ? null : String(row.payload_reference),
      payloadHash: row.payload_hash === null ? null : String(row.payload_hash),
      signerRequest: row.signer_request_json === null ? null
        : signerRequestSchema.parse(JSON.parse(String(row.signer_request_json)) as unknown),
    };
  }

  freeze(raw: PersonalWsfeAttemptInput, now: Date = new Date()): PersonalWsfeAttempt {
    const input = attemptSchema.parse(raw);
    const issuerProfileReferenceHash = hashCanonical(input.issuerProfileRef);
    const frozen = {
      invoiceId: input.invoiceId, workspaceId: input.workspaceId, environment: input.environment,
      connectionId: input.connectionId, invoiceUpdatedAt: input.invoiceUpdatedAt,
      issuerProfileReferenceHash, taxpayerReferenceHash: input.taxpayerReferenceHash,
      representedCuitCommitment: input.representedCuitCommitment, pointOfSale: input.pointOfSale,
      voucherNumber: input.voucherNumber, signerRequestId: input.signerRequestId,
      idempotencyKey: input.idempotencyKey, requestHash: input.requestHash,
      claimState: 'active' as const,
      payloadExpiresAt: new Date(now.getTime() + 6 * 24 * 60 * 60_000).toISOString(),
      payloadReference: null, payloadHash: null, signerRequest: null,
    };
    const matches = (record: PersonalWsfeAttempt) =>
      hashCanonical({ ...record, claimState: null, payloadExpiresAt: null, payloadReference: null, payloadHash: null, signerRequest: null })
        === hashCanonical({ ...frozen, claimState: null, payloadExpiresAt: null });
    const existing = this.get(input.invoiceId);
    if (existing) {
      if (!matches(existing)) throw new Error('PERSONAL_WSFE_ATTEMPT_CONFLICT');
      return existing;
    }
    try {
      // ponytail: one SQLite writer serializes this issuer/POS sequence; move to
      // per-issuer leasing only if concurrent invoice throughput requires it.
      this.#db.query(`INSERT INTO personal_wsfe_attempts (
        invoice_id, workspace_id, environment, connection_id, invoice_updated_at,
        issuer_profile_reference_hash, taxpayer_reference_hash, represented_cuit_commitment,
        point_of_sale, voucher_number, signer_request_id, idempotency_key, request_hash,
        payload_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        input.invoiceId, input.workspaceId, input.environment, input.connectionId, input.invoiceUpdatedAt,
        issuerProfileReferenceHash, input.taxpayerReferenceHash, input.representedCuitCommitment,
        input.pointOfSale, input.voucherNumber, input.signerRequestId, input.idempotencyKey, input.requestHash,
        frozen.payloadExpiresAt,
      );
    } catch {
      const raced = this.get(input.invoiceId);
      if (raced && matches(raced)) return raced;
      throw new Error('PERSONAL_WSFE_ATTEMPT_CONFLICT');
    }
    return this.get(input.invoiceId)!;
  }

  attachPayload(invoiceId: string, reference: string, payloadHash: string): PersonalWsfeAttempt {
    if (!/^vault:\/\/wsfe\/[0-9a-f-]{36}$/.test(reference) || !/^[a-f0-9]{64}$/.test(payloadHash))
      throw new Error('PERSONAL_WSFE_PAYLOAD_INVALID');
    const existing = this.get(invoiceId);
    if (!existing) throw new Error('PERSONAL_WSFE_ATTEMPT_NOT_FOUND');
    if (existing.payloadReference !== null) {
      if (existing.payloadReference !== reference || existing.payloadHash !== payloadHash)
        throw new Error('PERSONAL_WSFE_PAYLOAD_CONFLICT');
      return existing;
    }
    this.#db.query(`UPDATE personal_wsfe_attempts SET payload_reference = ?, payload_hash = ?
      WHERE invoice_id = ? AND payload_reference IS NULL`).run(reference, payloadHash, invoiceId);
    const attached = this.get(invoiceId)!;
    if (attached.payloadReference !== reference || attached.payloadHash !== payloadHash)
      throw new Error('PERSONAL_WSFE_PAYLOAD_CONFLICT');
    return attached;
  }

  attachSignerRequest(invoiceId: string, raw: SignerRequest): PersonalWsfeAttempt {
    const request = signerRequestSchema.parse(raw);
    const existing = this.get(invoiceId);
    if (!existing || !existing.payloadReference || !existing.payloadHash)
      throw new Error('PERSONAL_WSFE_ATTEMPT_NOT_PREPARED');
    if (request.environment !== 'homologation' || request.workspaceId !== existing.workspaceId
      || request.runId !== invoiceId || request.subjectId !== invoiceId
      || request.requestId !== existing.signerRequestId
      || request.authorityPayloadRef !== existing.payloadReference
      || request.expected.pointOfSale !== existing.pointOfSale)
      throw new Error('PERSONAL_WSFE_SIGNER_REQUEST_MISMATCH');
    if (existing.signerRequest) {
      if (hashCanonical(existing.signerRequest) !== hashCanonical(request))
        throw new Error('PERSONAL_WSFE_SIGNER_REQUEST_CONFLICT');
      return existing;
    }
    this.#db.query(`UPDATE personal_wsfe_attempts SET signer_request_json = ?
      WHERE invoice_id = ? AND signer_request_json IS NULL`).run(JSON.stringify(request), invoiceId);
    const attached = this.get(invoiceId)!;
    if (!attached.signerRequest || hashCanonical(attached.signerRequest) !== hashCanonical(request))
      throw new Error('PERSONAL_WSFE_SIGNER_REQUEST_CONFLICT');
    return attached;
  }

  /** A definitive ARCA rejection leaves the voucher unused; retain the attempt but release its active claim. */
  releaseRejectedVoucher(invoiceId: string): void {
    if (!this.get(invoiceId)) throw new Error('PERSONAL_WSFE_ATTEMPT_NOT_FOUND');
    this.#db.query("UPDATE personal_wsfe_attempts SET claim_state = 'rejected' WHERE invoice_id = ?")
      .run(invoiceId);
  }

  close(): void { this.#db.close(); }
}
