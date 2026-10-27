import { describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';

import type { ArcaSetupAutomationService } from './arca-setup-automation';
import { handleArcaSetupProviderRoute, handleArcaSetupReceiptRoute, handleArcaSetupUserRoute } from './arca-setup-routes';
import { verifyBoundTaxTenantPrincipalForRawBody, type TaxTenantPrincipalV3 } from './tenant-principal';

const SECRET = 'motora-onboarding-secret-at-least-32-bytes';
const EXECUTION = '90000000-0000-4000-8000-000000000001';

function signed(path: string, body: string, workspaceId = 'workspace-1', actorId = 'user-1') {
  const encoded = Buffer.from(JSON.stringify({
    version: 'tax-tenant-principal-v3', workspaceId, actorId, capability: 'arca:onboard', method: 'POST', path,
    bodyHash: createHash('sha256').update(body).digest('hex'),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  })).toString('base64url');
  return { 'x-tax-tenant-principal': encoded, 'x-tax-tenant-signature': createHmac('sha256', SECRET).update(encoded).digest('hex') };
}

function fakeService(): ArcaSetupAutomationService & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    get: () => ({ workspaceId: 'workspace-1' }),
    status: () => ({ executionId: EXECUTION, workspaceId: 'workspace-1', phase: 'awaiting_user_authentication' }),
    statusForOnboarding: () => null,
    control: async (input: { action: string }) => { calls.push(`control:${input.action}`); return { mode: 'pause_requested' }; },
    handoffLink: async (input: { purpose: string }) => { calls.push(`handoff:${input.purpose}`); return { url: 'https://executor.example/handoff/x?ticket=t', expiresAt: 'later' }; },
    retry: async () => { calls.push('retry'); return { phase: 'running' }; },
    cancel: async () => { calls.push('cancel'); return { progress: { phase: 'cancelled' } }; },
    authorize: async () => { calls.push('authorize'); return { phase: 'running' }; },
    ingestReceipt: async () => { throw new Error('ARCA_SETUP_SIGNATURE_INVALID'); },
    providerQueue: () => [],
  } as unknown as ArcaSetupAutomationService & { calls: string[] };
}

async function call(path: string, body: string, headers: Record<string, string>, service = fakeService()) {
  const request = new Request(`https://tax.test${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  const rawBody = await request.text();
  const principal = verifyBoundTaxTenantPrincipalForRawBody(request, rawBody, SECRET, 'arca:onboard') as TaxTenantPrincipalV3;
  return { response: await handleArcaSetupUserRoute(request, new URL(request.url), service, principal, rawBody), service };
}

describe('automated ARCA connection routes', () => {
  test('a principal signed for one request cannot authorize another body or path', async () => {
    const path = `/v1/arca-onboarding/automation/${EXECUTION}/retry`;
    const body = JSON.stringify({ actorId: 'user-1', idempotencyKey: 'retry-0001' });
    const headers = signed(path, body);
    const ok = await call(path, body, headers);
    expect(ok.response?.status).toBe(200);
    await expect(call(path, JSON.stringify({ actorId: 'user-1', idempotencyKey: 'retry-0002' }), headers)).rejects.toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    await expect(call(`/v1/arca-onboarding/automation/${EXECUTION}/cancel`, body, headers)).rejects.toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
  });

  test('another workspace or actor cannot act on the execution', async () => {
    const path = `/v1/arca-onboarding/automation/${EXECUTION}/cancel`;
    const body = JSON.stringify({ actorId: 'user-2', idempotencyKey: 'cancel-0001' });
    await expect(call(path, body, signed(path, body, 'workspace-2', 'user-2'))).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    const own = JSON.stringify({ actorId: 'user-1', idempotencyKey: 'cancel-0001' });
    await expect(call(path, own, signed(path, own, 'workspace-1', 'user-2'))).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
  });

  test('the hosted-browser link is returned uncached and only on the user channel', async () => {
    const path = `/v1/arca-onboarding/automation/${EXECUTION}/handoff-link`;
    const body = JSON.stringify({ actorId: 'user-1' });
    const { response } = await call(path, body, signed(path, body));
    expect(response?.headers.get('cache-control')).toBe('no-store');
    expect(response?.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('receipts without a valid signature are rejected as unauthorized', async () => {
    const request = new Request('https://tax.test/v1/arca-setup/receipts', { method: 'POST', body: '{}' });
    const response = await handleArcaSetupReceiptRoute(request, new URL(request.url), fakeService());
    expect(response?.status).toBe(401);
  });

  test('provider operations need the dedicated operator token', async () => {
    const request = new Request('https://tax.test/v1/arca-setup/provider/queue', { headers: { authorization: 'Bearer wrong' } });
    const response = await handleArcaSetupProviderRoute(request, new URL(request.url), fakeService(), 'o'.repeat(40));
    expect(response?.status).toBe(401);
    const allowed = new Request('https://tax.test/v1/arca-setup/provider/queue', { headers: { authorization: `Bearer ${'o'.repeat(40)}` } });
    expect((await handleArcaSetupProviderRoute(allowed, new URL(allowed.url), fakeService(), 'o'.repeat(40)))?.status).toBe(200);
  });

  test('control and the read-only preview link are request-bound like every other action', async () => {
    const controlPath = `/v1/arca-onboarding/automation/${EXECUTION}/control`;
    const body = JSON.stringify({ actorId: 'user-1', action: 'pause', requestId: '91000000-0000-4000-8000-000000000001' });
    const { response, service } = await call(controlPath, body, signed(controlPath, body));
    expect(response?.status).toBe(200);
    expect(service.calls).toEqual(['control:pause']);
    // A pause assertion cannot be replayed as take_control.
    const take = JSON.stringify({ actorId: 'user-1', action: 'take_control', requestId: '91000000-0000-4000-8000-000000000001' });
    await expect(call(controlPath, take, signed(controlPath, body))).rejects.toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    const viewPath = `/v1/arca-onboarding/automation/${EXECUTION}/view-link`;
    const view = JSON.stringify({ actorId: 'user-1' });
    const viewed = await call(viewPath, view, signed(viewPath, view));
    expect(viewed.service.calls).toEqual(['handoff:customer_view']);
    expect(viewed.response?.headers.get('cache-control')).toBe('no-store');
  });
});
