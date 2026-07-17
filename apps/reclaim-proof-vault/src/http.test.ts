import { afterEach, describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import type { CustodyRequest } from './contracts';
import { createProofVaultHandler } from './http';
import { ReclaimProofStore } from './store';

const key = Buffer.alloc(32, 4);
let store: ReclaimProofStore;
afterEach(() => store?.close());

describe('proof-vault HTTP scopes', () => {
  test('authenticates before parsing and keeps writer, reviewer, and admin scopes distinct', async () => {
    store = new ReclaimProofStore(key);
    const handler = createProofVaultHandler(store, { writer: 'w'.repeat(32), reviewer: 'r'.repeat(32), admin: 'a'.repeat(32) }, () => new Date(NOW));
    expect((await handler(new Request('https://vault.test/v1/reclaim-proofs', { method: 'POST', body: '{secret' }))).status).toBe(401);
    await post(handler, '/v1/retention-policies', 'a'.repeat(32), policy());
    const custody = await post(handler, '/v1/reclaim-proofs', 'w'.repeat(32), request());
    expect(custody.status).toBe(201);
    const receipt = await custody.json() as { opaqueReference: string };
    expect((await post(handler, '/v1/reclaim-proofs/resolve', 'w'.repeat(32), { version: 'reclaim-proof-resolve-v2', workspaceId: 'workspace-1', opaqueReference: receipt.opaqueReference })).status).toBe(401);
    expect((await post(handler, '/v1/reclaim-proofs/resolve', 'r'.repeat(32), { version: 'reclaim-proof-resolve-v2', workspaceId: 'workspace-2', opaqueReference: receipt.opaqueReference })).status).toBe(404);
    expect((await post(handler, '/v1/reclaim-proofs/resolve', 'r'.repeat(32), { version: 'reclaim-proof-resolve-v2', workspaceId: 'workspace-1', opaqueReference: receipt.opaqueReference })).status).toBe(200);
    expect((await post(handler, '/v1/reclaim-proofs/erase', 'r'.repeat(32), { version: 'reclaim-proof-erase-v1', workspaceId: 'workspace-1', opaqueReference: receipt.opaqueReference, reason: 'request' })).status).toBe(401);
  });
});

const NOW = '2026-07-11T12:00:00.000Z';
function policy() { return { version: 'reclaim-retention-policy-v1', policyId: 'tax-evidence-v1', policyVersion: '1', retentionDays: 30, allowedPurposes: ['arca_taxpayer_readiness'], deletionMode: 'crypto_erasure', replacePolicyHash: null }; }
function request(): CustodyRequest { const proofPayload = [{ proof: 'raw' }]; return { version: 'reclaim-proof-custody-request-v1', runId: '60000000-0000-4000-8000-000000000001', workspaceId: 'workspace-1', sessionId: 'session-1', purpose: 'arca_taxpayer_readiness', providerId: 'provider', providerVersion: '1', proofHash: hashCanonical(proofPayload), retentionPolicyId: 'tax-evidence-v1', verifiedAt: NOW, proofPayload }; }
function post(handler: (request: Request) => Promise<Response>, path: string, token: string, body: unknown) { return handler(new Request(`https://vault.test${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })); }
