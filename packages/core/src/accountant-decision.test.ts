import { describe, expect, test } from 'bun:test';

import {
  accountantMandateScopeForDecision,
  assertExternalAccountantDecisionV1,
  hashExternalAccountantDecisionV1,
} from './accountant-decision';

const HASH = 'a'.repeat(64);

function decision() {
  return {
    version: 'external-accountant-decision-v1' as const,
    decisionId: '81000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace:opaque:1',
    accountantActorId: 'accountant:opaque:1',
    mandateId: 'mandate:opaque:1',
    caseRef: 'taxcase:opaque:1',
    subject: { kind: 'tax_obligation' as const, ref: 'obligation:opaque:1' },
    outcome: 'approved' as const,
    reasonCodes: [],
    evidenceHashes: [HASH],
    ruleVersionIds: ['rule:us:entity:1'],
    policyVersionIds: ['external-accountant-decision-policy-v1'],
    occurredAt: '2026-07-17T12:00:00.000Z',
    idempotencyKey: 'accountant-decision:opaque:1',
  };
}

describe('ExternalAccountantDecisionV1', () => {
  test('accepts a minimized obligation decision and hashes it deterministically', () => {
    const parsed = assertExternalAccountantDecisionV1(decision());
    expect(accountantMandateScopeForDecision(parsed)).toBe('review_tax_obligation');
    expect(hashExternalAccountantDecisionV1(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashExternalAccountantDecisionV1(parsed)).toBe(
      hashExternalAccountantDecisionV1(assertExternalAccountantDecisionV1({ ...decision() })),
    );
  });

  test('routes packet decisions to the packet-export mandate', () => {
    expect(accountantMandateScopeForDecision(assertExternalAccountantDecisionV1({
      ...decision(),
      subject: { kind: 'accountant_packet', ref: 'packet:opaque:1' },
    }))).toBe('export_accountant_packet');
  });

  test('requires a closed reason for non-approval outcomes', () => {
    expect(() => assertExternalAccountantDecisionV1({
      ...decision(),
      outcome: 'rejected',
    })).toThrow();
    expect(assertExternalAccountantDecisionV1({
      ...decision(),
      outcome: 'needs_information',
      reasonCodes: ['EVIDENCE_INCOMPLETE'],
    }).outcome).toBe('needs_information');
  });

  test('rejects raw or unmodeled authority data', () => {
    expect(() => assertExternalAccountantDecisionV1({ ...decision(), ein: '12-3456789' }))
      .toThrow();
    expect(() => assertExternalAccountantDecisionV1({ ...decision(), note: 'looks good' }))
      .toThrow();
    expect(() => assertExternalAccountantDecisionV1({
      ...decision(),
      reasonCodes: ['UNREVIEWED_FREE_TEXT'],
    })).toThrow();
    expect(() => assertExternalAccountantDecisionV1({
      ...decision(),
      accountantActorId: '123456789',
    })).toThrow();
  });
});
