import { createHash, createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import {
  requiredTaxTenantPrincipalCapability,
  taxTenantPrincipalSecretForCapability,
  verifyBoundTaxTenantPrincipal,
  verifyTaxTenantPrincipal,
  type TaxTenantCapability,
} from './tenant-principal';

describe('tax tenant principal', () => {
  test('accepts the exact Desk evidence and consent publisher vectors', () => {
    const cases = [
      {
        encoded: 'eyJ2ZXJzaW9uIjoidGF4LXRlbmFudC1wcmluY2lwYWwtdjIiLCJ3b3Jrc3BhY2VJZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSIsImFjdG9ySWQiOiJkZXNrOnRheC1ldmlkZW5jZS1wdWJsaXNoZXIiLCJjYXBhYmlsaXR5IjoiZXZpZGVuY2U6cHVibGlzaCIsImV4cGlyZXNBdCI6IjIwMjYtMDctMTVUMTY6MDQ6MDAuMDAwWiJ9',
        signature: '84cb60d38d4187c03a5469b66d0cf9c176f2475c8ca1ef415e5ca907433fae2e',
        secret: 'desk-evidence-principal-secret-at-least-sixteen',
        capability: 'evidence:publish' as const,
        actorId: 'desk:tax-evidence-publisher',
      },
      {
        encoded: 'eyJ2ZXJzaW9uIjoidGF4LXRlbmFudC1wcmluY2lwYWwtdjIiLCJ3b3Jrc3BhY2VJZCI6IjExMTExMTExLTExMTEtNDExMS04MTExLTExMTExMTExMTExMSIsImFjdG9ySWQiOiJkZXNrOnRheC1jb25zZW50LWF1dGhvcml0eSIsImNhcGFiaWxpdHkiOiJjb25zZW50OnB1Ymxpc2giLCJleHBpcmVzQXQiOiIyMDI2LTA3LTE1VDE2OjA0OjAwLjAwMFoifQ',
        signature: '6a07f6b40dddbabbc55b30f45b62d5bac466555a2c2a2f47d5d35f1ce32090ff',
        secret: 'desk-consent-principal-secret-at-least-sixteen',
        capability: 'consent:publish' as const,
        actorId: 'desk:tax-consent-authority',
      },
    ];

    for (const vector of cases) {
      const request = new Request('http://tax.test/v1/evidence', { headers: {
        'x-tax-tenant-principal': vector.encoded,
        'x-tax-tenant-signature': vector.signature,
      } });
      expect(verifyTaxTenantPrincipal(
        request,
        vector.secret,
        vector.capability,
        new Date('2026-07-15T16:00:00.000Z'),
      )).toMatchObject({
        workspaceId: '11111111-1111-4111-8111-111111111111',
        actorId: vector.actorId,
        capability: vector.capability,
      });
    }
  });

  test('locks the cross-repository snapshot-read principal vector', () => {
    const encoded = 'eyJ2ZXJzaW9uIjoidGF4LXRlbmFudC1wcmluY2lwYWwtdjIiLCJ3b3Jrc3BhY2VJZCI6IndvcmtzcGFjZTpsZWdhY3ktMSIsImFjdG9ySWQiOiJ1c2VyOmdvbGRlbiIsImNhcGFiaWxpdHkiOiJzbmFwc2hvdDpyZWFkIiwiZXhwaXJlc0F0IjoiMjAyNi0wNy0xMFQwMDowNTowMC4wMDBaIn0';
    const request = new Request('http://tax.test/v1/snapshots/workspace:legacy-1', { headers: {
      'x-tax-tenant-principal': encoded,
      'x-tax-tenant-signature': '024941b683fcac0e8fa9f49b7ef4456af521bf71bb8f87cf714ad402439f4761',
    } });
    expect(verifyTaxTenantPrincipal(
      request,
      'tax-principal-golden-secret',
      'snapshot:read',
      new Date('2026-07-10T00:00:00.000Z'),
    )).toEqual({
      version: 'tax-tenant-principal-v2',
      workspaceId: 'workspace:legacy-1',
      actorId: 'user:golden',
      capability: 'snapshot:read',
      expiresAt: '2026-07-10T00:05:00.000Z',
    });
  });

  test('verifies a canonical signed workspace and actor assertion', () => {
    const request = signedRequest('workspace:1', 'user:1', 'snapshot:read', '2026-07-10T00:05:00.000Z');
    expect(verifyTaxTenantPrincipal(request, 'principal-secret', 'snapshot:read', new Date('2026-07-10T00:00:00.000Z')))
      .toMatchObject({ workspaceId: 'workspace:1', actorId: 'user:1', capability: 'snapshot:read' });
  });

  test('requires the V3 onboarding principal to bind method, path, query, and body', async () => {
    const url = 'http://tax.test/v1/arca-onboarding/runs?workspaceId=workspace%3A1';
    const body = JSON.stringify({ actorId: 'user:1', idempotencyKey: 'create-run-1' });
    const valid = boundSignedRequest(url, 'POST', body, '2026-07-10T00:01:00.000Z');
    await expect(verifyBoundTaxTenantPrincipal(
      valid,
      'principal-secret',
      'arca:onboard',
      new Date('2026-07-10T00:00:00.000Z'),
    )).resolves.toMatchObject({
      version: 'tax-tenant-principal-v3',
      workspaceId: 'workspace:1',
      actorId: 'user:1',
      capability: 'arca:onboard',
      method: 'POST',
      path: '/v1/arca-onboarding/runs?workspaceId=workspace%3A1',
    });

    const headers = valid.headers;
    const changedBody = new Request(url, { method: 'POST', headers, body: `${body} ` });
    const changedPath = new Request('http://tax.test/v1/arca-onboarding/runs?workspaceId=workspace%3A2', {
      method: 'POST', headers, body,
    });
    const changedMethod = new Request(url, { method: 'PUT', headers, body });
    for (const replay of [changedBody, changedPath, changedMethod]) {
      await expect(verifyBoundTaxTenantPrincipal(
        replay,
        'principal-secret',
        'arca:onboard',
        new Date('2026-07-10T00:00:00.000Z'),
      )).rejects.toThrow('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    }
  });

  test('does not accept a legacy V2 principal on the onboarding corridor', async () => {
    const legacy = signedRequest('workspace:1', 'user:1', 'arca:onboard', '2026-07-10T00:01:00.000Z');
    await expect(verifyBoundTaxTenantPrincipal(
      legacy,
      'principal-secret',
      'arca:onboard',
      new Date('2026-07-10T00:00:00.000Z'),
    )).rejects.toThrow('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  });

  test('rejects tampering and expiry without trusting caller headers', () => {
    const valid = signedRequest('workspace:1', 'user:1', 'snapshot:read', '2026-07-10T00:05:00.000Z');
    const tampered = new Request(valid.url, {
      headers: {
        'x-tax-tenant-principal': Buffer.from(JSON.stringify({
          version: 'tax-tenant-principal-v2',
          workspaceId: 'workspace:2',
          actorId: 'user:1',
          capability: 'snapshot:read',
          expiresAt: '2026-07-10T00:05:00.000Z',
        })).toString('base64url'),
        'x-tax-tenant-signature': valid.headers.get('x-tax-tenant-signature')!,
      },
    });
    expect(() => verifyTaxTenantPrincipal(tampered, 'principal-secret', 'snapshot:read', new Date('2026-07-10T00:00:00.000Z')))
      .toThrow('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
    expect(() => verifyTaxTenantPrincipal(valid, 'principal-secret', 'snapshot:read', new Date('2026-07-10T00:05:00.000Z')))
      .toThrow('TAX_TENANT_PRINCIPAL_EXPIRED');
    const tooLong = signedRequest('workspace:1', 'user:1', 'snapshot:read', '2026-07-10T00:05:00.001Z');
    expect(() => verifyTaxTenantPrincipal(tooLong, 'principal-secret', 'snapshot:read', new Date('2026-07-10T00:00:00.000Z')))
      .toThrow('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  });

  test('binds assertions to one route capability', () => {
    const read = signedRequest('workspace:1', 'user:1', 'snapshot:read', '2026-07-10T00:05:00.000Z');
    expect(() => verifyTaxTenantPrincipal(read, 'principal-secret', 'snapshot:configure', new Date('2026-07-10T00:00:00.000Z')))
      .toThrow('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/evidence/batches')).toBe('evidence:publish');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/evidence/consent-events')).toBe('consent:publish');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/snapshots')).toBe('snapshot:project');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/snapshot-projections/workspace:1')).toBe('snapshot:project');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/snapshot-projections/workspace:1/annual:2026')).toBe('snapshot:project');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/snapshots/workspace:1')).toBe('snapshot:read');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/snapshots/workspace:1/annual:2026')).toBe('snapshot:read');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/browser/snapshots/workspace:1')).toBe('snapshot:read');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/browser/snapshots/workspace:1/annual:2026')).toBe('snapshot:read');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/browser/factoring-projections/workspace:1/annual:2026')).toBe('snapshot:project');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/browser/factoring-projections/workspace:1/annual:2026')).toBe('tax.factoring.read');
    expect(requiredTaxTenantPrincipalCapability('PUT', '/v1/snapshot-configurations/workspace:1')).toBe('snapshot:configure');
    expect(requiredTaxTenantPrincipalCapability('PUT', '/v1/snapshot-configurations/workspace:1/annual:2026')).toBe('snapshot:configure');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/profiles/workspace:1')).toBe('profile:read');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/profiles/confirm')).toBe('profile:confirm');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/arca-onboarding/runs')).toBe('arca:onboard');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/arca-onboarding/runs/run-1/point-of-sale-selection')).toBe('arca:onboard');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/accountant-mandates')).toBe('accountant:mandate');
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/accountant-mandates/mandate-1/revoke')).toBe('accountant:mandate');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/accountant-portfolio')).toBe('accountant:portfolio');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/accountant-review-queue'))
      .toBe('accountant:review-queue');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/snapshots/demo')).toBeNull();
  });

  test('requires configure authority for both snapshot-configuration reads and writes', () => {
    expect(requiredTaxTenantPrincipalCapability(
      'GET',
      '/v1/snapshot-configurations/00000000-0000-4000-8000-000000000001/widget:annual',
    )).toBe('snapshot:configure');
    expect(requiredTaxTenantPrincipalCapability(
      'PUT',
      '/v1/snapshot-configurations/00000000-0000-4000-8000-000000000001/widget:annual',
    )).toBe('snapshot:configure');
  });

  test('routes unattended projection to a secret isolated from user read/configure', () => {
    const secrets = { user: 'user-secret', snapshotProjector: 'projector-secret' };
    expect(taxTenantPrincipalSecretForCapability('snapshot:project', secrets)).toBe(
      'projector-secret',
    );
    expect(taxTenantPrincipalSecretForCapability('snapshot:read', secrets)).toBe('user-secret');
    expect(taxTenantPrincipalSecretForCapability('tax.factoring.read', secrets)).toBe('user-secret');
    expect(taxTenantPrincipalSecretForCapability('snapshot:configure', secrets)).toBe(
      'user-secret',
    );
    expect(taxTenantPrincipalSecretForCapability('profile:confirm', secrets)).toBe('user-secret');
  });

  test('reserves external accountant decisions for their dedicated capability', () => {
    expect(requiredTaxTenantPrincipalCapability('POST', '/v1/accountant-decisions'))
      .toBe('accountant:decision');
    expect(requiredTaxTenantPrincipalCapability('GET', '/v1/accountant-decisions'))
      .toBeNull();
  });
});

function signedRequest(workspaceId: string, actorId: string, capability: TaxTenantCapability, expiresAt: string): Request {
  const encoded = Buffer.from(JSON.stringify({
    version: 'tax-tenant-principal-v2',
    workspaceId,
    actorId,
    capability,
    expiresAt,
  })).toString('base64url');
  return new Request('http://tax.test/v1/snapshots', { headers: {
    'x-tax-tenant-principal': encoded,
    'x-tax-tenant-signature': createHmac('sha256', 'principal-secret').update(encoded, 'utf8').digest('hex'),
  } });
}

function boundSignedRequest(url: string, method: 'GET' | 'POST', body: string, expiresAt: string): Request {
  const target = new URL(url);
  const encoded = Buffer.from(JSON.stringify({
    version: 'tax-tenant-principal-v3',
    workspaceId: 'workspace:1',
    actorId: 'user:1',
    capability: 'arca:onboard',
    method,
    path: `${target.pathname}${target.search}`,
    bodyHash: createHash('sha256').update(body).digest('hex'),
    expiresAt,
  })).toString('base64url');
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tax-tenant-principal': encoded,
      'x-tax-tenant-signature': createHmac('sha256', 'principal-secret').update(encoded, 'utf8').digest('hex'),
    },
    ...(method === 'POST' ? { body } : {}),
  });
}
