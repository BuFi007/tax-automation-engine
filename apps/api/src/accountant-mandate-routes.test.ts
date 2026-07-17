import { describe, expect, test } from 'bun:test';

import { handleAccountantMandateRoute } from './accountant-mandate-routes';
import { TaxProfileStore } from './store';
import type { TaxTenantPrincipalV2 } from './tenant-principal';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const principal: TaxTenantPrincipalV2 = {
  version: 'tax-tenant-principal-v2',
  workspaceId: 'workspace:1',
  actorId: 'user:owner',
  capability: 'accountant:mandate',
  expiresAt: '2026-07-15T12:05:00.000Z',
};

describe('accountant mandate routes', () => {
  test('grants, lists and revokes one workspace-scoped mandate', async () => {
    const store = new TaxProfileStore(':memory:');
    const granted = await call(store, 'POST', '/v1/accountant-mandates', {
      mandateId: 'mandate:1',
      accountantActorId: 'accountant:1',
      accountantOrganizationId: 'firm:1',
      scopes: ['record_tax_declaration', 'approve_invoice_intent', 'approve_invoice_intent'],
      expiresAt: '2026-08-15T12:00:00.000Z',
    });
    expect(granted.status).toBe(201);
    expect((await granted.json() as any).data).toMatchObject({
      workspaceId: 'workspace:1',
      grantedByActorId: 'user:owner',
      scopes: ['approve_invoice_intent', 'record_tax_declaration'],
      revokedAt: null,
    });

    const listed = await call(store, 'GET', '/v1/accountant-mandates');
    expect((await listed.json() as any).data).toHaveLength(1);

    const revoked = await call(store, 'POST', '/v1/accountant-mandates/mandate%3A1/revoke');
    expect((await revoked.json() as any).data.revokedAt).toBe(NOW.toISOString());
    expect(() => store.requireAccountantMandate({
      mandateId: 'mandate:1', workspaceId: 'workspace:1', accountantActorId: 'accountant:1', scope: 'approve_invoice_intent', at: '2026-07-16T00:00:00.000Z',
    })).toThrow('ACCOUNTANT_MANDATE_REVOKED');
  });

  test('rejects overlong grants and cross-workspace revocation', async () => {
    const store = new TaxProfileStore(':memory:');
    await expect(call(store, 'POST', '/v1/accountant-mandates', {
      mandateId: 'mandate:long', accountantActorId: 'accountant:1', accountantOrganizationId: 'firm:1', scopes: ['review_tax_obligation'], expiresAt: '2028-01-01T00:00:00.000Z',
    })).rejects.toThrow('ACCOUNTANT_MANDATE_EXPIRY_OUT_OF_RANGE');

    store.grantAccountantMandate({
      version: 'accountant-mandate-v1', mandateId: 'mandate:other', workspaceId: 'workspace:other', accountantActorId: 'accountant:1', accountantOrganizationId: 'firm:1', scopes: ['review_tax_obligation'], grantedByActorId: 'user:other', grantedAt: NOW.toISOString(), expiresAt: '2026-08-01T00:00:00.000Z', revokedAt: null,
    });
    await expect(call(store, 'POST', '/v1/accountant-mandates/mandate%3Aother/revoke')).rejects.toThrow('ACCOUNTANT_MANDATE_WORKSPACE_UNAUTHORIZED');
  });

  test('projects only active review-mandated clients for the exact firm actor', async () => {
    const store = new TaxProfileStore(':memory:');
    const portfolioPrincipal: TaxTenantPrincipalV2 = {
      ...principal,
      workspaceId: 'firm:1',
      actorId: 'accountant:1',
      capability: 'accountant:portfolio',
    };
    store.grantAccountantMandate({
      version: 'accountant-mandate-v1',
      mandateId: 'mandate:review',
      workspaceId: 'workspace:1',
      accountantActorId: 'accountant:1',
      accountantOrganizationId: 'firm:1',
      scopes: ['review_tax_obligation'],
      grantedByActorId: 'user:owner',
      grantedAt: '2026-07-15T11:00:00.000Z',
      expiresAt: '2026-08-15T12:00:00.000Z',
      revokedAt: null,
    });
    store.grantAccountantMandate({
      version: 'accountant-mandate-v1',
      mandateId: 'mandate:other-firm',
      workspaceId: 'workspace:other',
      accountantActorId: 'accountant:1',
      accountantOrganizationId: 'firm:other',
      scopes: ['review_tax_obligation'],
      grantedByActorId: 'user:other',
      grantedAt: '2026-07-15T11:00:00.000Z',
      expiresAt: '2026-08-15T12:00:00.000Z',
      revokedAt: null,
    });

    const response = await handleAccountantMandateRoute(
      new Request('http://localhost/v1/accountant-portfolio'),
      new URL('http://localhost/v1/accountant-portfolio'),
      store,
      portfolioPrincipal,
      NOW,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get('cache-control')).toBe('private, no-store');
    expect((await response?.json() as any).data).toMatchObject({
      accountantActorId: 'accountant:1',
      accountantOrganizationId: 'firm:1',
      totals: { authorizedClientCount: 0 },
      clients: [],
    });
  });
});

async function call(store: TaxProfileStore, method: string, path: string, body?: unknown): Promise<Response> {
  const request = new Request(`http://localhost${path}`, body === undefined
    ? { method }
    : { method, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  const response = await handleAccountantMandateRoute(request, new URL(request.url), store, principal, NOW);
  if (!response) throw new Error('ROUTE_NOT_HANDLED');
  return response;
}
