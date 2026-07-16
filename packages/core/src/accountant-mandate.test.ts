import { describe, expect, test } from 'bun:test';

import { assertActiveAccountantMandate, type AccountantMandateV1 } from './accountant-mandate';

const mandate: AccountantMandateV1 = {
  version: 'accountant-mandate-v1',
  mandateId: 'mandate:1',
  workspaceId: 'workspace:1',
  accountantActorId: 'accountant:1',
  accountantOrganizationId: 'accounting-firm:1',
  scopes: ['approve_invoice_intent'],
  grantedByActorId: 'user:owner',
  grantedAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2026-08-01T00:00:00.000Z',
  revokedAt: null,
};

describe('accountant mandate', () => {
  test('authorizes only the exact workspace, actor, scope and active window', () => {
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1',
      accountantActorId: 'accountant:1',
      scope: 'approve_invoice_intent',
      at: '2026-07-15T00:00:00.000Z',
    })).not.toThrow();

    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:2', accountantActorId: 'accountant:1', scope: 'approve_invoice_intent', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_WORKSPACE_UNAUTHORIZED');
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:2', scope: 'approve_invoice_intent', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_ACTOR_UNAUTHORIZED');
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:1', scope: 'record_tax_declaration', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_SCOPE_UNAUTHORIZED');
  });

  test('fails closed after expiry or revocation', () => {
    expect(() => assertActiveAccountantMandate(mandate, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:1', scope: 'approve_invoice_intent', at: mandate.expiresAt,
    })).toThrow('ACCOUNTANT_MANDATE_EXPIRED');
    expect(() => assertActiveAccountantMandate({ ...mandate, revokedAt: '2026-07-10T00:00:00.000Z' }, {
      workspaceId: 'workspace:1', accountantActorId: 'accountant:1', scope: 'approve_invoice_intent', at: '2026-07-15T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_REVOKED');
  });
});
