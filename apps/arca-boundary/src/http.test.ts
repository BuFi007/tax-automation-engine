import { describe, expect, test } from 'bun:test';

import { createBoundaryHandler } from './http';
import { ArcaBoundaryService } from './service';
import { ArcaBoundaryStore } from './store';
import { authorityPayload, certificateBundle, CUIT, NOW, WSFE_RECEPTOR_CUIT } from './test-fixtures';

const tokens = { payloadWriter: 'writer-token', payloadResolver: 'resolver-token', wsaa: 'wsaa-token', status: 'status-token', admin: 'admin-token', issuerRevoke: 'revoke-token', padron: 'padron-token' };

describe('ARCA boundary HTTP scopes', () => {
  test('reports only tenant-scoped issuer status without claiming authority readiness', async () => {
    const store = new ArcaBoundaryStore(Buffer.alloc(32, 9), ':memory:');
    const service = new ArcaBoundaryService(store, {
      async login() {
        return { token: 'secret-token', sign: 'secret-sign', expiresAt: '2026-07-11T20:00:00.000Z', safeReceiptHash: 'a'.repeat(64) };
      },
    }, undefined, Buffer.alloc(32, 7));
    const handler = createBoundaryHandler(service, tokens, 'homologation', () => NOW);
    const url = 'http://boundary/v1/wsaa/issuers/status?workspaceId=workspace-1&issuerProfileRef=issuer-1&environment=homologation';
    const request = (token: string, target = url) => new Request(target, { headers: { authorization: `Bearer ${token}` } });
    expect((await handler(request(tokens.wsaa))).status).toBe(401);
    expect((await handler(request(tokens.admin))).status).toBe(401);
    expect((await handler(request(tokens.status, url.replace('homologation', 'production')))).status).toBe(400);
    expect((await handler(request(tokens.status, `${url}&workspaceId=workspace-other`))).status).toBe(400);
    const empty = await handler(request(tokens.status));
    expect(await empty.json()).toEqual(expect.objectContaining({ configured: false, active: false }));

    const bundle = certificateBundle();
    const provisioned = service.provisionIssuer({
      version: 'wsaa-issuer-provision-v1', workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1', environment: 'homologation',
      certificateHolderCuit: CUIT, representedCuit: CUIT, ...bundle, delegationConfirmed: true, replaceCertificateFingerprint: null,
    }, NOW.toISOString());
    const first = await handler(request(tokens.status));
    const firstStatus = await first.json() as any;
    expect(firstStatus).toEqual(expect.objectContaining({ configured: true, active: true, delegationConfirmed: true, certificateFingerprint: provisioned.certificateFingerprint }));
    expect(firstStatus.certificate.current).toBe(true);
    expect(firstStatus.representedCuitMasked).toBe(`${CUIT.slice(0, 2)}******${CUIT.slice(-3)}`);
    expect(firstStatus.representedCuitLast4).toBe(CUIT.slice(-4));
    expect(firstStatus.representedCuitCommitment).toBe(provisioned.representedCuitCommitment);
    expect(firstStatus.taxpayerReferenceHash).toBe('376ec16044bd66fceca7ddd3d1499a7867b643bdab2f74ead3fe0627d4a8784b');
    expect(firstStatus.services.wsfe).toEqual({ wsaaTicketCached: false, authorityStatus: 'not_checked' });
    const delegation = {
      version: 'wsaa-issuer-delegation-v1', templateWorkspaceId: 'workspace-1',
      templateIssuerProfileRef: 'issuer-1', workspaceId: 'personal:other',
      issuerProfileRef: 'issuer://other', environment: 'homologation',
      representedCuit: WSFE_RECEPTOR_CUIT,
    };
    expect((await handler(post('/v1/wsaa/issuers/delegations', tokens.status, delegation))).status).toBe(401);
    expect((await handler(post('/v1/wsaa/issuers/delegations', tokens.admin, delegation))).status).toBe(201);
    expect((await handler(post('/v1/padron/issuer-prefill', tokens.status, {
      version: 'arca-issuer-padron-request-v1', templateWorkspaceId: 'workspace-1',
      templateIssuerProfileRef: 'issuer-1', cuit: CUIT,
    }))).status).toBe(401);
    await service.getTicket({ version: 'wsaa-ticket-request-v1', service: 'wsfe', environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1' }, NOW.toISOString());
    const second = await handler(request(tokens.status));
    const secondStatus = await second.json() as any;
    expect(secondStatus.services.wsfe).toEqual({ wsaaTicketCached: true, authorityStatus: 'not_checked' });
    expect(secondStatus.services.wsfex.wsaaTicketCached).toBe(false);
    const body = JSON.stringify(secondStatus);
    for (const secret of [CUIT, bundle.certificatePem, bundle.privateKeyPem, 'secret-token', 'secret-sign']) expect(body).not.toContain(secret);
    const wrongTenant = await handler(request(tokens.status, url.replace('workspace-1', 'workspace-other')));
    expect(await wrongTenant.json()).toEqual(expect.objectContaining({ configured: false, representedCuitMasked: null, taxpayerReferenceHash: null }));
    const revokeBody = {
      version: 'wsaa-issuer-revoke-v1', issuerProfileRef: 'issuer-1',
      certificateFingerprint: provisioned.certificateFingerprint,
    };
    expect((await handler(post('/v1/wsaa/issuers/revoke', tokens.admin, revokeBody))).status).toBe(401);
    expect((await handler(post('/v1/wsaa/issuers', tokens.issuerRevoke, revokeBody))).status).toBe(401);
    expect((await handler(post('/v1/wsaa/issuers/revoke', tokens.issuerRevoke, revokeBody))).status).toBe(200);
    const revoked = await handler(request(tokens.status));
    expect(await revoked.json()).toEqual(expect.objectContaining({ configured: true, active: false, delegationConfirmed: false }));
  });

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
