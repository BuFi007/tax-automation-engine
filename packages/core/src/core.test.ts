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
  sumMoney,
} from './index';

describe('deterministic financial core', () => {
  test('keeps decimal money exact', () => {
    expect(addMoney(money('0.1', 'USD'), money('0.2', 'USD'))).toEqual({ decimal: '0.3', currency: 'USD' });
    expect(multiplyMoney(money('1000000000000000.01', 'ARS'), '0.21')).toEqual({
      decimal: '210000000000000.0021',
      currency: 'ARS',
    });
    expect(() => addMoney(money('1', 'USD'), money('1', 'ARS'))).toThrow('Currency mismatch');
    const boundary = `${'9'.repeat(60)}.${'1'.repeat(30)}`;
    expect(addMoney(money(boundary, 'ARS'), money('0', 'ARS'))).toEqual({ decimal: boundary, currency: 'ARS' });
    expect(sumMoney(Array.from({ length: 10_000 }, () => money('0.000000000000000001', 'USD')), 'USD'))
      .toEqual({ decimal: '0.00000000000001', currency: 'USD' });
    expect(addMoney(money('0.000001', 'USDC'), money('1.000001', 'USDC')))
      .toEqual({ decimal: '1.000002', currency: 'USDC' });
    expect(() => money('1'.repeat(61), 'ARS')).toThrow('Invalid decimal money');
    expect(() => money(`0.${'1'.repeat(31)}`, 'ARS')).toThrow('Invalid decimal money');
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
