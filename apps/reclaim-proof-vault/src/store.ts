import { randomUUID } from 'node:crypto';

import { hashCanonical } from '@tax-engine/core';
import { Database } from 'bun:sqlite';

import type { CustodyReceipt, CustodyRequest, RetentionPolicyRequest } from './contracts';
import { ENCRYPTION_VERSION, openProof, sealProof } from './crypto';
import { verifiedProofHash } from './proofs';

export class ReclaimProofStore {
  readonly #db: Database;
  readonly #masterKey: Buffer;

  constructor(masterKey: Buffer, path = process.env.RECLAIM_PROOF_VAULT_DB_PATH ?? ':memory:') {
    this.#masterKey = Buffer.from(masterKey);
    this.#db = new Database(path, { create: true });
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      CREATE TABLE IF NOT EXISTS retention_policies (
        policy_id TEXT PRIMARY KEY, policy_hash TEXT NOT NULL, policy_version TEXT NOT NULL,
        retention_days INTEGER NOT NULL, allowed_purposes TEXT NOT NULL, active INTEGER NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS reclaim_proofs (
        reference TEXT PRIMARY KEY, workspace_id_hash TEXT NOT NULL, session_binding_hash TEXT NOT NULL UNIQUE,
        request_hash TEXT NOT NULL, proof_hash TEXT NOT NULL, run_id_hash TEXT NOT NULL,
        provider_id TEXT NOT NULL, provider_version TEXT NOT NULL, purpose TEXT NOT NULL,
        retention_policy_id TEXT NOT NULL, encrypted_payload TEXT NOT NULL, wrapped_data_key TEXT,
        verified_at TEXT NOT NULL, stored_at TEXT NOT NULL, expires_at TEXT NOT NULL, erased_at TEXT,
        FOREIGN KEY(retention_policy_id) REFERENCES retention_policies(policy_id)
      );
      CREATE TABLE IF NOT EXISTS proof_events (
        event_id TEXT PRIMARY KEY, action TEXT NOT NULL, subject_hash TEXT NOT NULL,
        artifact_hash TEXT NOT NULL, occurred_at TEXT NOT NULL
      );
    `);
  }

  putPolicy(policy: RetentionPolicyRequest, occurredAt: string): Readonly<{ policyHash: string; storedAt: string }> {
    const policyHash = hashCanonical({
      version: policy.version,
      policyId: policy.policyId,
      policyVersion: policy.policyVersion,
      retentionDays: policy.retentionDays,
      allowedPurposes: policy.allowedPurposes,
      deletionMode: policy.deletionMode,
    });
    const existing = this.#db.query<PolicyRow, [string]>('SELECT * FROM retention_policies WHERE policy_id = ?').get(policy.policyId);
    if (existing?.policy_hash === policyHash) return { policyHash, storedAt: existing.updated_at };
    if (existing && policy.replacePolicyHash !== existing.policy_hash) throw new Error('RETENTION_POLICY_PRECONDITION_FAILED');
    if (!existing && policy.replacePolicyHash) throw new Error('RETENTION_POLICY_TARGET_NOT_FOUND');
    this.#db.query(`
      INSERT INTO retention_policies (policy_id, policy_hash, policy_version, retention_days, allowed_purposes, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(policy_id) DO UPDATE SET policy_hash=excluded.policy_hash, policy_version=excluded.policy_version,
        retention_days=excluded.retention_days, allowed_purposes=excluded.allowed_purposes, active=1, updated_at=excluded.updated_at
    `).run(policy.policyId, policyHash, policy.policyVersion, policy.retentionDays, JSON.stringify(policy.allowedPurposes), existing?.created_at ?? occurredAt, occurredAt);
    this.event('retention_policy_stored', hashCanonical(policy.policyId), policyHash, occurredAt);
    return { policyHash, storedAt: occurredAt };
  }

  store(input: CustodyRequest, occurredAt: string): CustodyReceipt {
    if (verifiedProofHash(input.proofPayload) !== input.proofHash) throw new Error('RECLAIM_PROOF_HASH_MISMATCH');
    const policy = this.#db.query<PolicyRow, [string]>('SELECT * FROM retention_policies WHERE policy_id = ? AND active = 1').get(input.retentionPolicyId);
    if (!policy) throw new Error('RETENTION_POLICY_NOT_FOUND');
    const purposes = JSON.parse(policy.allowed_purposes) as unknown;
    if (!Array.isArray(purposes) || !purposes.includes(input.purpose)) throw new Error('RETENTION_POLICY_PURPOSE_NOT_ALLOWED');
    const sessionBindingHash = hashCanonical({ workspaceId: input.workspaceId, sessionId: input.sessionId, purpose: input.purpose });
    const requestHash = hashCanonical({
      runId: input.runId, workspaceId: input.workspaceId, sessionId: input.sessionId, purpose: input.purpose,
      providerId: input.providerId, providerVersion: input.providerVersion, proofHash: input.proofHash,
      retentionPolicyId: input.retentionPolicyId, verifiedAt: input.verifiedAt,
    });
    const existing = this.#db.query<ProofRow, [string]>('SELECT * FROM reclaim_proofs WHERE session_binding_hash = ?').get(sessionBindingHash);
    if (existing) {
      if (existing.request_hash !== requestHash || existing.erased_at) throw new Error('RECLAIM_PROOF_SESSION_CONFLICT');
      return receipt(existing);
    }
    const reference = `vault://reclaim/${randomUUID()}`;
    const sealed = sealProof(this.#masterKey, reference, input.proofHash, input.proofPayload);
    const expiresAt = new Date(Date.parse(occurredAt) + policy.retention_days * 86_400_000).toISOString();
    this.#db.transaction(() => {
      this.#db.query(`INSERT INTO reclaim_proofs (
        reference, workspace_id_hash, session_binding_hash, request_hash, proof_hash, run_id_hash,
        provider_id, provider_version, purpose, retention_policy_id, encrypted_payload, wrapped_data_key,
        verified_at, stored_at, expires_at, erased_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
        reference, hashCanonical(input.workspaceId), sessionBindingHash, requestHash, input.proofHash, hashCanonical(input.runId),
        input.providerId, input.providerVersion, input.purpose, input.retentionPolicyId, sealed.encryptedPayload,
        sealed.wrappedDataKey, input.verifiedAt, occurredAt, expiresAt
      );
      this.event('reclaim_proof_stored', hashCanonical(reference), input.proofHash, occurredAt);
    })();
    return { version: 'reclaim-proof-custody-receipt-v1', opaqueReference: reference, artifactHash: input.proofHash,
      encryptionVersion: ENCRYPTION_VERSION, retentionPolicyId: input.retentionPolicyId, storedAt: occurredAt };
  }

  resolve(reference: string, occurredAt: string): Readonly<{ proofPayload: unknown; artifactHash: string; verifiedAt: string }> {
    const row = this.#db.query<ProofRow, [string]>('SELECT * FROM reclaim_proofs WHERE reference = ?').get(reference);
    if (!row || row.erased_at || !row.wrapped_data_key) throw new Error('RECLAIM_PROOF_NOT_FOUND');
    if (Date.parse(row.expires_at) <= Date.parse(occurredAt)) {
      this.eraseRow(row, occurredAt, 'retention_expired');
      throw new Error('RECLAIM_PROOF_EXPIRED');
    }
    const proofPayload = openProof(this.#masterKey, row.reference, row.proof_hash, row.encrypted_payload, row.wrapped_data_key);
    if (verifiedProofHash(proofPayload) !== row.proof_hash) throw new Error('RECLAIM_PROOF_HASH_MISMATCH');
    this.event('reclaim_proof_resolved', hashCanonical(reference), row.proof_hash, occurredAt);
    return { proofPayload, artifactHash: row.proof_hash, verifiedAt: row.verified_at };
  }

  erase(workspaceId: string, reference: string, occurredAt: string, reason: string): void {
    const row = this.#db.query<ProofRow, [string]>('SELECT * FROM reclaim_proofs WHERE reference = ?').get(reference);
    if (!row || row.workspace_id_hash !== hashCanonical(workspaceId)) throw new Error('RECLAIM_PROOF_NOT_FOUND');
    if (!row.erased_at) this.eraseRow(row, occurredAt, reason);
  }

  purgeExpired(occurredAt: string): number {
    const rows = this.#db.query<ProofRow, [string]>('SELECT * FROM reclaim_proofs WHERE erased_at IS NULL AND expires_at <= ?').all(occurredAt);
    this.#db.transaction(() => rows.forEach((row) => this.eraseRow(row, occurredAt, 'retention_expired')))();
    return rows.length;
  }

  health(): Readonly<{ version: 'reclaim-proof-vault-health-v1'; encryptionReady: true; activePolicyCount: number }> {
    const row = this.#db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM retention_policies WHERE active = 1').get();
    return { version: 'reclaim-proof-vault-health-v1', encryptionReady: true, activePolicyCount: row?.count ?? 0 };
  }

  close(): void { this.#masterKey.fill(0); this.#db.close(); }

  private eraseRow(row: ProofRow, occurredAt: string, reason: string): void {
    this.#db.query('UPDATE reclaim_proofs SET wrapped_data_key = NULL, erased_at = ? WHERE reference = ? AND erased_at IS NULL').run(occurredAt, row.reference);
    this.event('reclaim_proof_erased', hashCanonical(row.reference), hashCanonical({ proofHash: row.proof_hash, reason }), occurredAt);
  }

  private event(action: string, subjectHash: string, artifactHash: string, occurredAt: string): void {
    this.#db.query('INSERT INTO proof_events (event_id, action, subject_hash, artifact_hash, occurred_at) VALUES (?, ?, ?, ?, ?)')
      .run(randomUUID(), action, subjectHash, artifactHash, occurredAt);
  }
}

type PolicyRow = { policy_id: string; policy_hash: string; policy_version: string; retention_days: number; allowed_purposes: string; active: number; created_at: string; updated_at: string };
export type ProofRow = { reference: string; workspace_id_hash: string; session_binding_hash: string; request_hash: string; proof_hash: string; run_id_hash: string; provider_id: string; provider_version: string; purpose: string; retention_policy_id: string; encrypted_payload: string; wrapped_data_key: string | null; verified_at: string; stored_at: string; expires_at: string; erased_at: string | null };

function receipt(row: ProofRow): CustodyReceipt {
  return { version: 'reclaim-proof-custody-receipt-v1', opaqueReference: row.reference, artifactHash: row.proof_hash,
    encryptionVersion: ENCRYPTION_VERSION, retentionPolicyId: row.retention_policy_id, storedAt: row.stored_at };
}
