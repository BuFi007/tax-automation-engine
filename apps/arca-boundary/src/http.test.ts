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
  });
});

function post(path: string, token: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://boundary${path}`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}
