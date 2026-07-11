import { createHash } from 'node:crypto';

import type { TaxConsentGrant, TaxConsentPurpose } from './types';

export function hashScope(scopeIds: readonly string[]): string {
  return createHash('sha256').update([...scopeIds].sort().join('\n')).digest('hex');
}

export function hasActiveConsent(
  grants: readonly TaxConsentGrant[],
  purpose: TaxConsentPurpose,
  requiredScopeIds: readonly string[]
): boolean {
  const grant = grants.find(candidate => candidate.purpose === purpose && candidate.revokedAt === null);
  if (!grant) return false;
  const granted = new Set(grant.scopeIds);
  return requiredScopeIds.every(scopeId => granted.has(scopeId)) && grant.scopeHash === hashScope(grant.scopeIds);
}

export function assertActiveConsent(
  grants: readonly TaxConsentGrant[],
  purpose: TaxConsentPurpose,
  requiredScopeIds: readonly string[]
): TaxConsentGrant {
  const grant = grants.find(candidate => candidate.purpose === purpose && candidate.revokedAt === null);
  if (!grant || !hasActiveConsent(grants, purpose, requiredScopeIds)) {
    throw new Error(`Missing active ${purpose} consent`);
  }
  return grant;
}
