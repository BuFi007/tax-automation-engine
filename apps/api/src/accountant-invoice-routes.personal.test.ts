import { expect, test } from 'bun:test';

import { handleAccountantInvoiceRoute } from './accountant-invoice-routes';
import { FacturaEAgentService } from './factura-e-agent';
import { TaxProfileStore } from './store';

test('Personal invoice queue needs a mandate for the exact owner scope', async () => {
  const store = new TaxProfileStore(':memory:');
  try {
    const agent = new FacturaEAgentService(store, null, null);
    const workspaceId = 'personal:11111111-1111-4111-8111-111111111111';
    const firmId = '22222222-2222-4222-8222-222222222222';
    const accountantId = '33333333-3333-4333-8333-333333333333';
    const principal = {
      version: 'tax-tenant-principal-v2' as const,
      workspaceId: firmId, actorId: accountantId,
      capability: 'accountant:review-queue' as const,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const url = new URL(`https://tax.test/v1/accountant-invoice-review-queue?workspaceId=${encodeURIComponent(workspaceId)}`);
    const unmandated = await handleAccountantInvoiceRoute(new Request(url), url, store, agent, principal);
    expect((await unmandated!.json() as any).data.items).toEqual([]);
    store.grantAccountantMandate({
      version: 'accountant-mandate-v1', mandateId: 'personal-export-review', workspaceId,
      accountantActorId: accountantId, accountantOrganizationId: firmId,
      scopes: ['approve_invoice_intent'], grantedByActorId: '11111111-1111-4111-8111-111111111111',
      grantedAt: new Date(Date.now() - 60_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null,
    });
    const mandated = await handleAccountantInvoiceRoute(new Request(url), url, store, agent, principal);
    expect(mandated?.status).toBe(200);
    expect((await mandated!.json() as any).data.items).toEqual([]);
    const otherUrl = new URL('https://tax.test/v1/accountant-invoice-review-queue?workspaceId=personal:44444444-4444-4444-8444-444444444444');
    const other = await handleAccountantInvoiceRoute(new Request(otherUrl), otherUrl, store, agent, principal);
    expect((await other!.json() as any).data.items).toEqual([]);
    const approvalUrl = new URL('https://tax.test/v1/accountant-invoice-approvals');
    await expect(handleAccountantInvoiceRoute(
      new Request(approvalUrl, { method: 'POST' }), approvalUrl, store, agent,
      { ...principal, version: 'tax-tenant-principal-v3', capability: 'accountant:decision',
        method: 'POST', path: approvalUrl.pathname, bodyHash: 'a'.repeat(64) },
      new Date(), JSON.stringify({
        workspaceId: 'personal:44444444-4444-4444-8444-444444444444',
        runId: '55555555-5555-4555-8555-555555555555', intentHash: 'b'.repeat(64),
        mandateId: 'personal-export-review', idempotencyKey: 'personal-approval-123456',
      }),
    )).rejects.toThrow('ACCOUNTANT_MANDATE');
  } finally {
    store.close();
  }
});
