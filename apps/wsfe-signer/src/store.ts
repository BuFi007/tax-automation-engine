import { Database } from 'bun:sqlite';

import { signerResponseSchema, type SignerRequest, type SignerResponse } from './contracts';

export type SignerAttempt = Readonly<{
  requestId: string;
  intentHash: string;
  payloadReferenceHash: string;
  payloadHash: string;
  documentType: 11 | 12 | 13;
  pointOfSale: number;
  invoiceNumber: string;
  state: 'pending' | 'ambiguous' | 'accepted' | 'rejected';
  response: SignerResponse | null;
  createdAt: string;
  updatedAt: string;
}>;

// The store keeps only hashes and safe document coordinates (never the receptor
// DocNro, token/sign, represented CUIT, opaque payload reference, or raw SOAP).
export class SignerAttemptStore {
  readonly #db: Database;

  constructor(path = process.env.WSFE_SIGNER_DB_PATH ?? ':memory:') {
    this.#db = new Database(path, { create: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS wsfe_attempts (
        request_id TEXT PRIMARY KEY,
        intent_hash TEXT NOT NULL,
        payload_reference_hash TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        document_type INTEGER NOT NULL,
        point_of_sale INTEGER NOT NULL,
        invoice_number TEXT NOT NULL,
        state TEXT NOT NULL,
        response_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  get(requestId: string): SignerAttempt | null {
    const row = this.#db.query<{
      request_id: string; intent_hash: string; payload_reference_hash: string; payload_hash: string; document_type: number;
      point_of_sale: number; invoice_number: string; state: string; response_json: string | null; created_at: string; updated_at: string;
    }, [string]>('SELECT * FROM wsfe_attempts WHERE request_id = ?').get(requestId);
    if (!row) return null;
    return {
      requestId: row.request_id,
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

  begin(input: Readonly<{
    request: SignerRequest;
    payloadReferenceHash: string;
    payloadHash: string;
    invoiceNumber: string;
    occurredAt: string;
  }>): SignerAttempt {
    const existing = this.get(input.request.requestId);
    if (existing) return existing;
    this.#db.query(`
      INSERT INTO wsfe_attempts (
        request_id, intent_hash, payload_reference_hash, payload_hash, document_type, point_of_sale, invoice_number,
        state, response_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)
    `).run(
      input.request.requestId,
      input.request.intentHash,
      input.payloadReferenceHash,
      input.payloadHash,
      input.request.expected.documentType,
      input.request.expected.pointOfSale,
      input.invoiceNumber,
      input.occurredAt,
      input.occurredAt
    );
    return this.get(input.request.requestId)!;
  }

  complete(requestId: string, response: SignerResponse, occurredAt: string): SignerAttempt {
    const existing = this.get(requestId);
    if (!existing) throw new Error('WSFE_ATTEMPT_NOT_FOUND');
    this.#db.query('UPDATE wsfe_attempts SET state = ?, response_json = ?, updated_at = ? WHERE request_id = ?')
      .run(response.status, JSON.stringify(response), occurredAt, requestId);
    return this.get(requestId)!;
  }
}

function documentType(value: number): 11 | 12 | 13 {
  if (value !== 11 && value !== 12 && value !== 13) throw new Error('WSFE_STORED_DOCUMENT_TYPE_INVALID');
  return value;
}

function attemptState(value: string): SignerAttempt['state'] {
  if (!['pending', 'ambiguous', 'accepted', 'rejected'].includes(value)) throw new Error('WSFE_STORED_ATTEMPT_STATE_INVALID');
  return value as SignerAttempt['state'];
}
