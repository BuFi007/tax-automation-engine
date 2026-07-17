import { describe, expect, test } from 'bun:test';

import { createBoundaryHandler } from './http';
import { ArcaBoundaryService } from './service';
import { ArcaBoundaryStore } from './store';
import { authorityPayload, NOW } from './test-fixtures';

const tokens = { payloadWriter: 'writer-token', payloadResolver: 'resolver-token', wsaa: 'wsaa-token', admin: 'admin-token' };

describe('ARCA boundary HTTP scopes', () => {
  test('keeps payload write, payload resolve, and WSAA health credentials separate', async () => {
    const handler = createBoundaryHandler(
      new ArcaBoundaryService(new ArcaBoundaryStore(Buffer.alloc(32, 3), ':memory:')),
      tokens,
      'homologation',
      () => NOW
    );
    const storeResponse = await handler(post('/v1/authority-payloads', tokens.payloadWriter, {
      version: 'authority-payload-store-v1', workspaceId: 'workspace-1', payload: authorityPayload(), expiresAt: '2026-07-12T12:00:00.000Z',
    }, { 'idempotency-key': 'payload-http-1' }));
    expect(storeResponse.status).toBe(201);
    const receipt = await storeResponse.json() as any;

    const wrongScope = await handler(post('/v1/authority-payloads/resolve', tokens.payloadWriter, {
      version: 'authority-payload-resolve-v1', reference: receipt.reference,
    }));
    expect(wrongScope.status).toBe(401);
    const resolved = await handler(post('/v1/authority-payloads/resolve', tokens.payloadResolver, {
      version: 'authority-payload-resolve-v1', reference: receipt.reference,
    }));
    expect(resolved.status).toBe(200);
    expect((await resolved.json() as any).payload.customer.foreignTaxId).toBe('FOREIGN-TAX-SECRET');

    const wrongHealthScope = await handler(new Request('http://boundary/health?service=wsfex&environment=homologation', { headers: { authorization: `Bearer ${tokens.payloadResolver}` } }));
    expect(wrongHealthScope.status).toBe(401);
    const health = await handler(new Request('http://boundary/health?service=wsfex&environment=homologation', { headers: { authorization: `Bearer ${tokens.wsaa}` } }));
    expect(await health.json()).toEqual({ version: 'wsaa-broker-health-v1', service: 'wsfex', environment: 'homologation', certificateDelegationConfigured: false, wsaaReady: false });
  });

  test('rejects oversized and malformed bodies without reflecting their content', async () => {
    const handler = createBoundaryHandler(new ArcaBoundaryService(new ArcaBoundaryStore(Buffer.alloc(32, 4), ':memory:')), tokens, 'homologation', () => NOW);
    const oversized = await handler(new Request('http://boundary/v1/authority-payloads', {
      method: 'POST', headers: { authorization: `Bearer ${tokens.payloadWriter}`, 'content-length': '2000000' }, body: '{}',
    }));
    expect(oversized.status).toBe(413);
    const malformed = await handler(new Request('http://boundary/v1/authority-payloads', {
      method: 'POST', headers: { authorization: `Bearer ${tokens.payloadWriter}` }, body: '{raw-secret',
    }));
    expect(await malformed.json()).toEqual({ error: 'INVALID_REQUEST' });

    let cancelled = false;
    const chunked = await handler(new Request('http://boundary/v1/authority-payloads', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokens.payloadWriter}`, 'content-type': 'application/json' },
      body: new ReadableStream({
        pull(controller) { controller.enqueue(new Uint8Array(600_000)); },
        cancel() { cancelled = true; },
      }),
    }));
    expect(chunked.status).toBe(413);
    expect(cancelled).toBe(true);
  });

  test('separates terminal evidence submission from admin-only retirement', async () => {
    let now = NOW;
    const service = new ArcaBoundaryService(
      new ArcaBoundaryStore(Buffer.alloc(32, 5), ':memory:'),
      undefined,
      { retentionPolicyId: 'http-terminal-policy-v1', terminalRetentionMs: 24 * 60 * 60_000 }
    );
    const handler = createBoundaryHandler(service, tokens, 'homologation', () => now);
    const stored = await handler(post('/v1/authority-payloads', tokens.payloadWriter, {
      version: 'authority-payload-store-v1', workspaceId: 'workspace-1', payload: authorityPayload(), expiresAt: '2026-07-12T12:00:00.000Z',
    }, { 'idempotency-key': 'payload-http-terminal-1' }));
    const receipt = await stored.json() as any;
    const terminalEvidenceHash = 'b'.repeat(64);
    const terminal = await handler(post('/v1/authority-payloads/terminal', tokens.payloadWriter, {
      version: 'authority-payload-terminal-v1', workspaceId: 'workspace-1', reference: receipt.reference,
      payloadHash: receipt.payloadHash, terminalState: 'officially_reconciled', authorityIdentityHash: 'a'.repeat(64), terminalEvidenceHash,
    }));
    expect(terminal.status).toBe(200);
    expect(await terminal.json()).toEqual(expect.objectContaining({
      payloadHash: receipt.payloadHash, authorityIdentityHash: 'a'.repeat(64),
      terminalState: 'officially_reconciled', retentionPolicyId: 'http-terminal-policy-v1',
      retireAfter: '2026-07-12T12:00:00.000Z', terminalEvidenceHash,
    }));

    now = new Date('2026-07-12T12:00:00.000Z');
    const wrongScope = await handler(post('/v1/authority-payloads/retire-eligible', tokens.payloadWriter, {
      version: 'authority-payload-retire-eligible-v1',
    }));
    expect(wrongScope.status).toBe(401);
    const retired = await handler(post('/v1/authority-payloads/retire-eligible', tokens.admin, {
      version: 'authority-payload-retire-eligible-v1',
    }));
    expect(await retired.json()).toEqual({
      version: 'authority-payload-retire-eligible-receipt-v1', retired: 1,
      retentionPolicyId: 'http-terminal-policy-v1', occurredAt: '2026-07-12T12:00:00.000Z',
    });
    const resolved = await handler(post('/v1/authority-payloads/resolve', tokens.payloadResolver, {
      version: 'authority-payload-resolve-v1', reference: receipt.reference,
    }));
    expect(resolved.status).toBe(404);
  });
});

function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://boundary${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}
