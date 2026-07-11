import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

import { hashCanonical } from '@tax-engine/core';
import { Database } from 'bun:sqlite';

import { openProof, rewrapProofKey } from './crypto';
import { verifiedProofHash } from './proofs';

export function rotateProofVaultMasterKey(input: Readonly<{
  databasePath: string; oldMasterKey: Buffer; newMasterKey: Buffer; occurredAt: string; dryRun: boolean;
}>): Readonly<{ proofsValidated: number; rotated: boolean }> {
  if (input.oldMasterKey.length !== 32 || input.newMasterKey.length !== 32) throw new Error('RECLAIM_PROOF_VAULT_MASTER_KEY_INVALID');
  if (input.oldMasterKey.equals(input.newMasterKey)) throw new Error('RECLAIM_PROOF_VAULT_ROTATION_KEY_UNCHANGED');
  if (!existsSync(input.databasePath)) throw new Error('RECLAIM_PROOF_VAULT_DATABASE_NOT_FOUND');
  const database = new Database(input.databasePath, { create: true });
  let committed = false;
  try {
    database.exec('PRAGMA secure_delete = ON; BEGIN EXCLUSIVE;');
    const rows = database.query<RotationRow, []>('SELECT reference, proof_hash, encrypted_payload, wrapped_data_key FROM reclaim_proofs WHERE wrapped_data_key IS NOT NULL').all();
    const rotated = rows.map((row) => {
      const payload = openProof(input.oldMasterKey, row.reference, row.proof_hash, row.encrypted_payload, row.wrapped_data_key);
      if (verifiedProofHash(payload) !== row.proof_hash) throw new Error('RECLAIM_PROOF_HASH_MISMATCH');
      return { reference: row.reference, wrappedDataKey: rewrapProofKey(input.oldMasterKey, input.newMasterKey, row.reference, row.proof_hash, row.wrapped_data_key) };
    });
    if (input.dryRun) { database.exec('ROLLBACK'); return { proofsValidated: rows.length, rotated: false }; }
    const update = database.query('UPDATE reclaim_proofs SET wrapped_data_key = ? WHERE reference = ?');
    for (const row of rotated) update.run(row.wrappedDataKey, row.reference);
    database.query('INSERT INTO proof_events (event_id, action, subject_hash, artifact_hash, occurred_at) VALUES (?, ?, ?, ?, ?)').run(
      randomUUID(), 'proof_vault_master_key_rotated', hashCanonical('reclaim-proof-vault-master-key'), hashCanonical({ proofCount: rows.length, occurredAt: input.occurredAt }), input.occurredAt
    );
    database.exec('COMMIT'); committed = true; database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return { proofsValidated: rows.length, rotated: true };
  } catch (error) {
    if (!committed) try { database.exec('ROLLBACK'); } catch {}
    throw error;
  } finally { database.close(); }
}

type RotationRow = { reference: string; proof_hash: string; encrypted_payload: string; wrapped_data_key: string };
