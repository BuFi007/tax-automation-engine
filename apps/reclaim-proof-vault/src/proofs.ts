import { hashCanonical } from '@tax-engine/core';

export function normalizeProofPayload(payload: unknown): ReadonlyArray<Record<string, unknown>> {
  let decoded = payload;
  if (typeof decoded === 'string') {
    try {
      decoded = JSON.parse(decodeURIComponent(decoded));
    } catch {
      throw new Error('RECLAIM_PROOF_PAYLOAD_INVALID');
    }
  }
  const values = Array.isArray(decoded) ? decoded : [decoded];
  if (values.length === 0 || values.some((value) => !value || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error('RECLAIM_PROOF_PAYLOAD_INVALID');
  }
  return values as ReadonlyArray<Record<string, unknown>>;
}

export function verifiedProofHash(payload: unknown): string {
  return hashCanonical(normalizeProofPayload(payload));
}
