import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { deriveDomainKey, openJson, sealJson } from '@tax-engine/arca-boundary/crypto';

export const ENCRYPTION_VERSION = 'aes-256-gcm+hkdf-sha256+wrapped-dek-v1' as const;

export function loadProofVaultMasterKey(environment: NodeJS.ProcessEnv = process.env): Buffer {
  const encoded = environment.RECLAIM_PROOF_VAULT_MASTER_KEY_FILE
    ? readFileSync(environment.RECLAIM_PROOF_VAULT_MASTER_KEY_FILE, 'utf8').trim()
    : environment.RECLAIM_PROOF_VAULT_MASTER_KEY?.trim();
  if (!encoded) throw new Error('RECLAIM_PROOF_VAULT_MASTER_KEY_REQUIRED');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) throw new Error('RECLAIM_PROOF_VAULT_MASTER_KEY_INVALID');
  return key;
}

export function sealProof(masterKey: Buffer, reference: string, proofHash: string, proofPayload: unknown) {
  const keyEncryptionKey = deriveDomainKey(masterKey, 'reclaim-proofs');
  const dataKey = randomBytes(32);
  try {
    return {
      encryptedPayload: sealJson(dataKey, proofAad(reference, proofHash), proofPayload),
      wrappedDataKey: sealJson(keyEncryptionKey, wrappedKeyAad(reference, proofHash), { key: dataKey.toString('base64') }),
    };
  } finally {
    dataKey.fill(0);
    keyEncryptionKey.fill(0);
  }
}

export function openProof(masterKey: Buffer, reference: string, proofHash: string, encryptedPayload: string, wrappedDataKey: string): unknown {
  const keyEncryptionKey = deriveDomainKey(masterKey, 'reclaim-proofs');
  let dataKey: Buffer | null = null;
  try {
    const wrapped = openJson(keyEncryptionKey, wrappedKeyAad(reference, proofHash), wrappedDataKey) as { key?: unknown };
    if (typeof wrapped.key !== 'string') throw new Error('RECLAIM_PROOF_WRAPPED_KEY_INVALID');
    dataKey = Buffer.from(wrapped.key, 'base64');
    if (dataKey.length !== 32) throw new Error('RECLAIM_PROOF_WRAPPED_KEY_INVALID');
    return openJson(dataKey, proofAad(reference, proofHash), encryptedPayload);
  } finally {
    dataKey?.fill(0);
    keyEncryptionKey.fill(0);
  }
}

export function rewrapProofKey(oldMasterKey: Buffer, newMasterKey: Buffer, reference: string, proofHash: string, wrappedDataKey: string): string {
  const oldKeyEncryptionKey = deriveDomainKey(oldMasterKey, 'reclaim-proofs');
  const newKeyEncryptionKey = deriveDomainKey(newMasterKey, 'reclaim-proofs');
  try {
    const wrapped = openJson(oldKeyEncryptionKey, wrappedKeyAad(reference, proofHash), wrappedDataKey);
    return sealJson(newKeyEncryptionKey, wrappedKeyAad(reference, proofHash), wrapped);
  } finally {
    oldKeyEncryptionKey.fill(0);
    newKeyEncryptionKey.fill(0);
  }
}

export function proofAad(reference: string, proofHash: string): string {
  return `reclaim-proof:${reference}:${proofHash}`;
}

export function wrappedKeyAad(reference: string, proofHash: string): string {
  return `reclaim-proof-dek:${reference}:${proofHash}`;
}
