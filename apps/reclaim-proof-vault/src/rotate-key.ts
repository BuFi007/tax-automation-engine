import { readFileSync } from 'node:fs';

import { rotateProofVaultMasterKey } from './rotation';

const oldMasterKey = readKey(required('RECLAIM_PROOF_VAULT_MASTER_KEY_FILE'));
const newMasterKey = readKey(required('RECLAIM_PROOF_VAULT_NEW_MASTER_KEY_FILE'));
try {
  console.info(JSON.stringify({ version: 'reclaim-proof-vault-key-rotation-v1', ...rotateProofVaultMasterKey({
    databasePath: required('RECLAIM_PROOF_VAULT_DB_PATH'), oldMasterKey, newMasterKey,
    occurredAt: new Date().toISOString(), dryRun: process.argv.includes('--dry-run'),
  }) }));
} finally { oldMasterKey.fill(0); newMasterKey.fill(0); }
function required(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name}_REQUIRED`); return value; }
function readKey(path: string): Buffer { const key = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64'); if (key.length !== 32) throw new Error('RECLAIM_PROOF_VAULT_MASTER_KEY_INVALID'); return key; }
