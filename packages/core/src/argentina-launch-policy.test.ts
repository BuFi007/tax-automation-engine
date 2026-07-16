import { describe, expect, test } from 'bun:test';

import {
  argentinaLaunchPolicyReadiness,
  assertArgentinaProductionBoundary,
  parseArgentinaLaunchPolicy,
} from './argentina-launch-policy';

const HASH = 'a'.repeat(64);
const APPROVAL_HASHES = ['b', 'c', 'd', 'e'].map(value => value.repeat(64));
const fixture = () => ({
  version: 'argentina-launch-policy-v1',
  policyId: 'ar-launch-2026',
  policyVersion: '1.0.0',
  decisionMemoHash: HASH,
  effectiveFrom: '2026-07-03T00:00:00.000Z',
  expiresAt: '2026-12-31T23:59:59.000Z',
  boundary: {
    taxDocumentIssuer: 'represented_taxpayer',
    bufiRole: 'software_provider',
    authorityCredentialCustody: 'forbidden',
    paymentIntermediation: 'external_authorized_provider_only',
    invoiceFinance: 'licensed_partner_only',
    taxPaymentExecution: 'disabled',
  },
  sourceRuleIds: ['arca-wsfex-3.1.1', 'arca-wsaa-architecture', 'bcra-a8330', 'bcra-current-exchange-rules'],
  approvals: [
    { role: 'argentina_accountant', decision: 'approved', receiptHash: APPROVAL_HASHES[0], decidedAt: '2026-07-02T00:00:00.000Z' },
    { role: 'argentina_legal_counsel', decision: 'approved', receiptHash: APPROVAL_HASHES[1], decidedAt: '2026-07-02T00:00:00.000Z' },
    { role: 'security', decision: 'approved', receiptHash: APPROVAL_HASHES[2], decidedAt: '2026-07-02T00:00:00.000Z' },
    { role: 'product_owner', decision: 'approved', receiptHash: APPROVAL_HASHES[3], decidedAt: '2026-07-02T00:00:00.000Z' },
  ],
});

describe('Argentina launch policy', () => {
  test('keeps production blocked when the signed decision memo is absent', () => {
    const readiness = argentinaLaunchPolicyReadiness(null, new Date('2026-07-15T00:00:00.000Z'));
    expect(readiness.state).toBe('blocked');
    expect(readiness.failedGateIds).toEqual(['signed_decision_memo_missing']);
    expect(readiness.productionActivationAllowed).toBe(false);
    expect(() => assertArgentinaProductionBoundary(readiness)).toThrow('ARGENTINA_LAUNCH_POLICY_APPROVAL_REQUIRED');
  });

  test('accepts only the exact reviewed software-provider boundary', () => {
    const readiness = argentinaLaunchPolicyReadiness(fixture(), new Date('2026-07-15T00:00:00.000Z'));
    expect(readiness.state).toBe('approved_boundary');
    expect(readiness.bufiRole).toBe('software_provider');
    expect(readiness.taxDocumentIssuer).toBe('represented_taxpayer');
    expect(readiness.credentialCustody).toBe('forbidden');
    expect(readiness.taxPaymentExecution).toBe('disabled');
    expect(() => assertArgentinaProductionBoundary(readiness)).not.toThrow();
  });

  test('rejects duplicate professional roles instead of counting them as approval', () => {
    const input = fixture();
    input.approvals[1] = {
      role: 'argentina_accountant',
      decision: 'approved',
      receiptHash: APPROVAL_HASHES[1],
      decidedAt: '2026-07-02T00:00:00.000Z',
    };
    expect(() => parseArgentinaLaunchPolicy(input)).toThrow('ARGENTINA_LAUNCH_POLICY_DUPLICATE_APPROVAL_ROLE');
  });

  test('blocks a valid but expired policy', () => {
    const readiness = argentinaLaunchPolicyReadiness(fixture(), new Date('2027-01-01T00:00:00.000Z'));
    expect(readiness.state).toBe('blocked');
    expect(readiness.failedGateIds).toContain('policy_expired');
  });

  test('requires independent approval receipts and the primary-source floor', () => {
    const duplicateReceipt = fixture();
    duplicateReceipt.approvals[1] = { ...duplicateReceipt.approvals[1]!, receiptHash: APPROVAL_HASHES[0]! };
    expect(() => parseArgentinaLaunchPolicy(duplicateReceipt)).toThrow('ARGENTINA_LAUNCH_POLICY_APPROVAL_RECEIPTS_NOT_INDEPENDENT');

    const missingSource = fixture();
    missingSource.sourceRuleIds[3] = 'unreviewed-replacement';
    expect(() => parseArgentinaLaunchPolicy(missingSource)).toThrow('ARGENTINA_LAUNCH_POLICY_REQUIRED_SOURCE_MISSING');
  });

  test('does not leak reviewer identities in the readiness projection', () => {
    const input = fixture() as Record<string, unknown>;
    input.reviewerName = 'must never project';
    const readiness = argentinaLaunchPolicyReadiness(input, new Date('2026-07-15T00:00:00.000Z'));
    expect(JSON.stringify(readiness)).not.toContain('reviewer');
  });
});
