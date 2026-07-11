import { loadProofVaultMasterKey } from './crypto';
import { createProofVaultHandler } from './http';
import { ReclaimProofStore } from './store';

const tokens = {
  writer: requiredToken('RECLAIM_PROOF_VAULT_TOKEN'),
  reviewer: requiredToken('RECLAIM_PROOF_VAULT_REVIEW_TOKEN'),
  admin: requiredToken('RECLAIM_PROOF_VAULT_ADMIN_TOKEN'),
};
if (new Set(Object.values(tokens)).size !== 3) throw new Error('RECLAIM_PROOF_VAULT_TOKENS_MUST_BE_DISTINCT');
if (process.env.NODE_ENV === 'production' && process.env.RECLAIM_PROOF_VAULT_PRODUCTION_APPROVED !== 'true') throw new Error('RECLAIM_PROOF_VAULT_PRODUCTION_APPROVAL_REQUIRED');
const masterKey = loadProofVaultMasterKey();
const store = new ReclaimProofStore(masterKey);
masterKey.fill(0);
const server = Bun.serve({ port: Number(process.env.PORT ?? 4400), fetch: createProofVaultHandler(store, tokens) });
export { server };
function requiredToken(name: string): string { const value = process.env[name]; if (!value || value.length < 32) throw new Error(`${name}_REQUIRED`); return value; }
if (import.meta.main) console.info(`Reclaim proof vault listening on port ${server.port}; raw zkTLS evidence remains encrypted and outside agent context`);
