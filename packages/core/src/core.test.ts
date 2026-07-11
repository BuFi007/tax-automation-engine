import { describe, expect, test } from 'bun:test';

import {
  TAX_APPROVAL_ACTIONS,
  TAX_READ_CAPABILITIES,
  addMoney,
  assertActiveConsent,
  buildCapabilityManifest,
  hashScope,
  money,
  multiplyMoney,
} from './index';

describe('deterministic financial core', () => {
  test('keeps decimal money exact', () => {
    expect(addMoney(money('0.1', 'USD'), money('0.2', 'USD'))).toEqual({ decimal: '0.3', currency: 'USD' });
    expect(multiplyMoney(money('1000000000000000.01', 'ARS'), '0.21')).toEqual({
      decimal: '210000000000000.0021',
      currency: 'ARS',
    });
    expect(() => addMoney(money('1', 'USD'), money('1', 'ARS'))).toThrow('Currency mismatch');
  });

  test('requires an active, untampered consent scope', () => {
    const scopeIds = ['bank:1', 'quickbooks:1'];
    const grant = {
      purpose: 'tax_workspace_processing' as const,
      version: 'consent-v1',
      scopeIds,
      scopeHash: hashScope(scopeIds),
      grantedAt: '2026-07-10T00:00:00.000Z',
      revokedAt: null,
    };
    expect(assertActiveConsent([grant], 'tax_workspace_processing', ['bank:1'])).toBe(grant);
    expect(() => assertActiveConsent([{ ...grant, scopeHash: 'tampered' }], 'tax_workspace_processing', ['bank:1'])).toThrow();
  });

  test('publishes the fixed 22 read and 4 approval-aware action contract', () => {
    const manifest = buildCapabilityManifest();
    expect(Object.keys(TAX_READ_CAPABILITIES)).toHaveLength(22);
    expect(TAX_APPROVAL_ACTIONS).toHaveLength(4);
    expect(manifest.reads).toHaveLength(22);
    expect(manifest.approvalAwareActions.every(action => action.requiresApproval && action.state === 'approval_required')).toBe(true);
  });
});
