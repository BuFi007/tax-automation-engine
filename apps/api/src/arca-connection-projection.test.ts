import { describe, expect, test } from 'bun:test';
import { createArcaOnboardingRun, hashCanonical } from '@tax-engine/core';

import { HttpArcaBoundaryStatusReader, issuerAcceptanceForPrincipal, latestArcaConnectionProjectionForPrincipal, latestPrivateArcaConnectionProjection, privateArcaConnectionProjection, revokeArcaConnectionForPrincipal } from './arca-connection-projection';
import type { TaxTenantPrincipalV3 } from './tenant-principal';

const NOW = new Date('2026-09-23T12:00:00.000Z');
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const REF = 'issuer://personal/tomas';
const COMMITMENT = 'a'.repeat(64);
const EVIDENCE = 'b'.repeat(64);
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const ROUTE_URL = `https://tax.test/v1/arca-onboarding/runs/${RUN_ID}/private-connection-projection?issuerProfileRef=${encodeURIComponent(REF)}`;
const principal: TaxTenantPrincipalV3 = {
  version: 'tax-tenant-principal-v3', workspaceId: WORKSPACE, actorId: 'desk:projection', capability: 'arca:onboard',
  method: 'GET', path: new URL(ROUTE_URL).pathname + new URL(ROUTE_URL).search,
  bodyHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  expiresAt: '2026-09-23T12:01:00.000Z',
};
const run = {
  ...createArcaOnboardingRun({ onboardingId: RUN_ID, workspaceId: WORKSPACE, taxpayerReferenceHash: 'c'.repeat(64),
    environment: 'homologation', requestedServices: ['wsfe', 'wsfex'], actorId: 'user-1',
    occurredAt: NOW.toISOString(), idempotencyKey: 'projection-test-1' }).run,
  pointOfSale: { number: 2, source: 'created' as const, active: true },
  domesticPointOfSale: { number: 1, active: true },
  delegation: { wsfe: true, wsfex: true },
  authorityBinding: { issuerProfileReferenceHash: hashCanonical(REF), representedCuitCommitment: COMMITMENT },
  apiVerification: { wsfe: true, wsfex: true, observedAt: NOW.toISOString() },
  apiVerificationReceipts: { wsfe: EVIDENCE, wsfex: 'd'.repeat(64) },
};

function boundary(overrides: Record<string, unknown> = {}) {
  return {
    version: 'wsaa-issuer-status-v1', workspaceId: WORKSPACE, issuerProfileRef: REF, environment: 'homologation',
    configured: true, active: true, delegationConfirmed: true, certificateFingerprint: 'e'.repeat(64),
    representedCuitCommitment: COMMITMENT, taxpayerReferenceHash: 'c'.repeat(64), representedCuitLast4: '4039',
    certificate: { validFrom: '2026-09-01T00:00:00.000Z', validUntil: '2026-10-01T00:00:00.000Z', current: true },
    ...overrides,
  };
}

const request = new Request(ROUTE_URL);
const getRun = () => run;
const profiles = new Map([[WORKSPACE, REF]]);
function reader(status: Record<string, unknown>) {
  return new HttpArcaBoundaryStatusReader('read-only-token', 'https://boundary.test', async () => Response.json(status));
}

describe('private ARCA connection projection', () => {
  test('reports operator acceptance separately without treating it as service readiness', async () => {
    const unbound = await issuerAcceptanceForPrincipal(principal, RUN_ID, { getRun }, new Map(), reader(boundary()));
    expect(unbound.data.operatorAccepted).toBe(false);
    const accepted = await issuerAcceptanceForPrincipal(principal, RUN_ID, { getRun }, profiles, reader(boundary()));
    expect(accepted.data.operatorAccepted).toBe(true);
    const wrongCuit = await issuerAcceptanceForPrincipal(principal, RUN_ID, { getRun }, profiles,
      reader(boundary({ taxpayerReferenceHash: 'f'.repeat(64) })));
    expect(wrongCuit.data.operatorAccepted).toBe(false);
    const revoked = await issuerAcceptanceForPrincipal(principal, RUN_ID, { getRun }, profiles,
      reader(boundary({ active: false })));
    expect(revoked.data.operatorAccepted).toBe(false);
    await expect(issuerAcceptanceForPrincipal({ ...principal, workspaceId: 'other' }, RUN_ID,
      { getRun }, profiles, reader(boundary()))).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
  });
  test('revokes only the scope-bound certificate and confirms the boundary receipt', async () => {
    const calls: string[] = [];
    const statusReader = new HttpArcaBoundaryStatusReader(
      'status-token', 'https://boundary.test', async (input, init) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname.endsWith('/status')) return Response.json(boundary());
        expect(init?.method).toBe('POST');
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${'z'.repeat(32)}`);
        expect(JSON.parse(String(init?.body))).toEqual({
          version: 'wsaa-issuer-revoke-v1', issuerProfileRef: REF,
          certificateFingerprint: 'e'.repeat(64),
        });
        return Response.json({ revoked: true });
      },
    );
    const expected = { issuerProfileRef: REF, certificateFingerprint: 'e'.repeat(64) };
    expect(await revokeArcaConnectionForPrincipal(principal, expected, profiles, statusReader, 'z'.repeat(32)))
      .toEqual({ revoked: true });
    expect(calls).toEqual(['/v1/wsaa/issuers/status', '/v1/wsaa/issuers/revoke']);
    await expect(revokeArcaConnectionForPrincipal(
      { ...principal, workspaceId: 'other' }, expected, profiles, statusReader, 'z'.repeat(32),
    )).rejects.toThrow('ARCA_CONNECTION_PROJECTION_ISSUER_CONFIGURATION_REQUIRED');
    const mismatch = reader(boundary({ workspaceId: 'other' }));
    await expect(revokeArcaConnectionForPrincipal(principal, expected, profiles, mismatch, 'z'.repeat(32)))
      .rejects.toThrow('ARCA_CONNECTION_PROJECTION_BOUNDARY_MISMATCH');
  });
  test('finds the latest Tax-bound homologation run without accepting an issuer or workspace query', async () => {
    const latestUrl = 'https://tax.test/v1/arca-onboarding/private-connection-projection';
    const response = await latestPrivateArcaConnectionProjection(new Request(latestUrl), new URL(latestUrl),
      { ...principal, path: new URL(latestUrl).pathname },
      { listRuns: () => [{ ...run, updatedAt: '2026-09-20T00:00:00.000Z' }, { ...run, updatedAt: '2026-09-22T00:00:00.000Z' }] },
      profiles, reader(boundary()), NOW);
    expect(response.data.onboardingId).toBe(RUN_ID);
    expect(response.data.wsfe.status).toBe('ready');
    const issuing = await latestArcaConnectionProjectionForPrincipal(
      { ...principal, capability: 'arca:issue', method: 'POST', path: '/v1/personal-wsfe/attempts/issue' },
      { listRuns: () => [run] }, profiles, reader(boundary()), NOW,
    );
    expect(issuing.data.wsfe).toEqual(response.data.wsfe);
    await expect(latestPrivateArcaConnectionProjection(new Request(`${latestUrl}?workspaceId=other`), new URL(`${latestUrl}?workspaceId=other`),
      principal, { listRuns: () => [run] }, profiles, reader(boundary()), NOW))
      .rejects.toThrow('ARCA_CONNECTION_PROJECTION_INVALID_REQUEST');
  });

  test('projects independently verified C/E receipts, closes revoked authority, and rejects mismatched scope or CUIT commitment', async () => {
    const ready = await privateArcaConnectionProjection(request, new URL(ROUTE_URL), principal, { getRun }, profiles, reader(boundary()), NOW);
    expect(ready.data.wsfe).toEqual({ status: 'ready', pointOfSale: 1, verifiedAt: NOW.toISOString(), evidenceHash: EVIDENCE });
    expect(ready.data.taxpayerReferenceHash).toBe(run.taxpayerReferenceHash);
    expect(ready.data.wsfex.status).toBe('ready');
    expect(JSON.stringify(ready)).not.toContain('20965240390');

    const revoked = await privateArcaConnectionProjection(request, new URL(ROUTE_URL), principal, { getRun }, profiles,
      reader(boundary({ active: false, delegationConfirmed: false })), NOW);
    expect(revoked.data.wsfe).toEqual({ status: 'reconnect', pointOfSale: null, verifiedAt: null, evidenceHash: null });
    expect(revoked.data.wsfex.status).toBe('reconnect');

    await expect(privateArcaConnectionProjection(request, new URL(ROUTE_URL), principal, { getRun }, profiles,
      reader(boundary({ representedCuitCommitment: 'f'.repeat(64) })), NOW))
      .rejects.toThrow('ARCA_CONNECTION_PROJECTION_BOUNDARY_MISMATCH');
    await expect(privateArcaConnectionProjection(request, new URL(ROUTE_URL), principal, { getRun }, profiles,
      reader(boundary({ taxpayerReferenceHash: 'f'.repeat(64) })), NOW))
      .rejects.toThrow('ARCA_CONNECTION_PROJECTION_TAXPAYER_MISMATCH');
    await expect(privateArcaConnectionProjection(request, new URL(ROUTE_URL), { ...principal, workspaceId: 'other' },
      { getRun }, profiles, reader(boundary()), NOW)).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
    await expect(privateArcaConnectionProjection(request, new URL(ROUTE_URL), principal, { getRun },
      new Map([[WORKSPACE, 'issuer://wrong']]), reader(boundary()), NOW))
      .rejects.toThrow('ARCA_CONNECTION_PROJECTION_ISSUER_MISMATCH');
  });

  test('blocks issuance after an imported issuer certificate rotates', async () => {
    const imported = { ...run, steps: run.steps.map(step => step.step === 'ws_delegation'
      ? { ...step, state: 'completed' as const,
        evidenceHashes: [EVIDENCE, hashCanonical('e'.repeat(64))],
        safeMetadata: { source: 'live_certificate_boundary' } }
      : step) };
    const current = await latestArcaConnectionProjectionForPrincipal(
      { ...principal, capability: 'arca:issue', method: 'POST', path: '/v1/personal-wsfe/attempts/issue' },
      { listRuns: () => [imported] }, profiles, reader(boundary()), NOW);
    expect(current.data.wsfe.status).toBe('ready');
    const rotated = await latestArcaConnectionProjectionForPrincipal(
      { ...principal, capability: 'arca:issue', method: 'POST', path: '/v1/personal-wsfe/attempts/issue' },
      { listRuns: () => [imported] }, profiles,
      reader(boundary({ certificateFingerprint: 'f'.repeat(64) })), NOW);
    expect(rotated.data.wsfe.status).toBe('reconnect');
    expect(rotated.data.wsfex.status).toBe('reconnect');
    expect(rotated.data.wsfe.pointOfSale).toBeNull();
  });
});
