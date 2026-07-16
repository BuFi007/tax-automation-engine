import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assertNoTaxEngineFundingAuthority,
  resolveArgentinaLaunchPolicyReadiness,
} from './argentina-launch-policy';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('returns a safe blocked projection when no policy is mounted', () => {
  expect(resolveArgentinaLaunchPolicyReadiness({}, new Date('2026-07-15T00:00:00.000Z'))).toMatchObject({
    state: 'blocked',
    failedGateIds: ['signed_decision_memo_missing'],
  });
});

test('rejects unreadable policy configuration without exposing the path', () => {
  expect(() => resolveArgentinaLaunchPolicyReadiness({ TAX_ENGINE_ARGENTINA_LAUNCH_POLICY_PATH: '/private/missing.json' }))
    .toThrow('ARGENTINA_LAUNCH_POLICY_CONFIGURATION_REQUIRED');
});

test('loads an approved bounded manifest from the mounted artifact', () => {
  const root = mkdtempSync(join(tmpdir(), 'tax-policy-'));
  roots.push(root);
  const path = join(root, 'policy.json');
  const hash = 'a'.repeat(64);
  const receiptHashes = ['b', 'c', 'd', 'e'].map(value => value.repeat(64));
  writeFileSync(path, JSON.stringify({
    version: 'argentina-launch-policy-v1',
    policyId: 'ar-launch-2026',
    policyVersion: '1.0.0',
    decisionMemoHash: hash,
    effectiveFrom: '2026-07-03T00:00:00.000Z',
    expiresAt: '2026-12-31T23:59:59.000Z',
    boundary: {
      taxDocumentIssuer: 'represented_taxpayer', bufiRole: 'software_provider',
      authorityCredentialCustody: 'forbidden', paymentIntermediation: 'external_authorized_provider_only',
      invoiceFinance: 'licensed_partner_only', taxPaymentExecution: 'disabled',
    },
    sourceRuleIds: ['arca-wsfex-3.1.1', 'arca-wsaa-architecture', 'bcra-a8330', 'bcra-current-exchange-rules'],
    approvals: ['argentina_accountant', 'argentina_legal_counsel', 'security', 'product_owner'].map((role, index) => ({
      role, decision: 'approved', receiptHash: receiptHashes[index], decidedAt: '2026-07-02T00:00:00.000Z',
    })),
  }));
  expect(resolveArgentinaLaunchPolicyReadiness({ TAX_ENGINE_ARGENTINA_LAUNCH_POLICY_PATH: path }, new Date('2026-07-15T00:00:00.000Z')).state).toBe('approved_boundary');
});

describe('funding boundary', () => {
  test('keeps consented factoring evidence separate from funding authority', () => {
    expect(() => assertNoTaxEngineFundingAuthority({})).not.toThrow();
    expect(() => assertNoTaxEngineFundingAuthority({ TAX_ENGINE_INVOICE_ADVANCE_REMOTE_EFFECTS_ENABLED: 'true' }))
      .toThrow('TAX_ENGINE_FUNDING_AUTHORITY_FORBIDDEN');
  });
});
