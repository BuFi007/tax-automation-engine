import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { hashTaxEvidenceConsentScope } from './batch';
import { parseTaxEvidenceConsentEventV1 } from './consent-event';

describe('tax evidence consent event v1', () => {
  test('accepts canonical scoped authority provenance', () => {
    expect(parseTaxEvidenceConsentEventV1(event())).toEqual(event());
    expect(parseTaxEvidenceConsentEventV1({ ...event(), workspaceId: 'workspace:legacy-1' }).workspaceId)
      .toBe('workspace:legacy-1');
  });

  test('rejects noncanonical scope ordering and a mismatched scope hash', () => {
    const input = event();
    expect(() => parseTaxEvidenceConsentEventV1({
      ...input,
      consent: { ...input.consent, sourceIds: ['fx-provider', 'bufi-invoice'] },
    })).toThrow('EVIDENCE_CONSENT_SOURCE_IDS_NOT_CANONICAL');
    expect(() => parseTaxEvidenceConsentEventV1({
      ...input,
      consent: { ...input.consent, scopeHash: hash('wrong-scope') },
    })).toThrow('EVIDENCE_CONSENT_SCOPE_HASH_INVALID');
  });
});

function event() {
  const sourceIds = ['bufi-invoice', 'fx-provider'];
  return {
    version: 'tax-evidence-consent-event-v1' as const,
    eventId: '30000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    sequence: 1,
    action: 'grant' as const,
    authoritySource: 'desk_subscription' as const,
    actorReferenceHash: hash('actor:user:owner'),
    consent: {
      purpose: 'tax_workspace_processing' as const,
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    occurredAt: '2026-07-09T00:00:00.000Z',
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
