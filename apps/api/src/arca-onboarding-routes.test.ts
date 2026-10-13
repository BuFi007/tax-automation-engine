import { describe, expect, test } from 'bun:test';
import { HUMAN_AUTH_CAPTURE_POLICY_HASH, hashCanonical, hashTaxEvidenceConsentScope } from '@tax-engine/core';

import { ArcaOnboardingService } from './arca-onboarding';
import { HttpArcaBoundaryStatusReader } from './arca-connection-projection';
import { handleArcaOnboardingRoute } from './arca-onboarding-routes';
import { TaxProfileStore } from './store';

describe('ARCA onboarding HTTP boundary', () => {
  test('accepts a short-lived tenant-scoped user authority without exposing the static approval token', async () => {
    const request = jsonRequest('/v1/arca-onboarding/runs', {
      onboardingId: '60000000-0000-4000-8000-000000000011',
      workspaceId: 'workspace-1',
      taxpayerReferenceHash: 'a'.repeat(64),
      environment: 'homologation',
      requestedServices: ['wsfex'],
      actorId: 'user:owner',
      idempotencyKey: 'create-scoped-onboarding',
    });
    const response = await handle(request, {
      userApprovalToken: null,
      evidenceIngestToken: null,
      tenantPrincipal: {
        version: 'tax-tenant-principal-v3',
        workspaceId: 'workspace-1',
        actorId: 'user:owner',
        capability: 'arca:onboard',
        method: 'POST',
        path: '/v1/arca-onboarding/runs',
        bodyHash: '0'.repeat(64),
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(response?.status).toBe(201);
    const payload = await response?.json();
    expect(payload.data.version).toBe('arca-onboarding-browser-mutation-v1');
    expect(JSON.stringify(payload)).not.toMatch(
      /taxpayerReferenceHash|processedCommandKeys|eventIds|completionReceiptHash|contextHash|representedCuitCommitment/,
    );
  });

  test('rejects a tenant principal that attempts to create another workspace run', async () => {
    const request = jsonRequest('/v1/arca-onboarding/runs', {
      onboardingId: '60000000-0000-4000-8000-000000000012',
      workspaceId: 'workspace-2',
      taxpayerReferenceHash: 'b'.repeat(64),
      environment: 'homologation',
      requestedServices: ['wsfex'],
      actorId: 'user:owner',
      idempotencyKey: 'create-cross-tenant',
    });
    expect(handle(request, {
      userApprovalToken: null,
      evidenceIngestToken: null,
      tenantPrincipal: {
        version: 'tax-tenant-principal-v3',
        workspaceId: 'workspace-1',
        actorId: 'user:owner',
        capability: 'arca:onboard',
        method: 'POST',
        path: '/v1/arca-onboarding/runs',
        bodyHash: '0'.repeat(64),
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    })).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');
  });

  test('strictly rejects credential material in run creation', async () => {
    const request = jsonRequest('/v1/arca-onboarding/runs', {
      onboardingId: '60000000-0000-4000-8000-000000000010',
      workspaceId: 'workspace-1',
      taxpayerReferenceHash: 'a'.repeat(64),
      environment: 'homologation',
      requestedServices: ['wsfex', 'wsfe'],
      actorId: 'user:owner',
      idempotencyKey: 'create-onboarding',
      claveFiscal: 'must-not-cross-boundary',
    });
    expect(handle(request)).rejects.toThrow();
  });

  test('does not expose zk evidence as a caller-controlled step', async () => {
    const request = jsonRequest('/v1/arca-onboarding/runs/60000000-0000-4000-8000-000000000010/steps/zk_evidence', {
      actorId: 'user:owner', idempotencyKey: 'attempt-forged-zk',
    }, { 'x-tax-user-approval-token': 'user-token' });
    expect(handle(request, { userApprovalToken: 'user-token', evidenceIngestToken: 'evidence-token' }))
      .rejects.toThrow('ARCA_ONBOARDING_INTERNAL_COMMAND_REQUIRED');
  });

  test('requires a trusted evidence channel for authoritative API verification', async () => {
    const request = jsonRequest('/v1/arca-onboarding/runs/60000000-0000-4000-8000-000000000010/steps/api_verification', {});
    expect(handle(request)).rejects.toThrow('EVIDENCE_INGEST_CONFIGURATION_REQUIRED');
    const forged = jsonRequest('/v1/arca-onboarding/runs/60000000-0000-4000-8000-000000000010/steps/api_verification', {
      actorId: 'system:authority', idempotencyKey: 'forged-manual-receipts',
      verifiedServices: { wsfex: true, wsfe: true }, activeExportPointOfSale: 2, activeDomesticPointOfSale: 1,
      observedAt: new Date().toISOString(), wsfexReceiptHash: 'a'.repeat(64), wsfeReceiptHash: 'b'.repeat(64),
    }, { 'x-tax-evidence-ingest-token': 'trusted-token' });
    expect(handle(forged, { userApprovalToken: null, evidenceIngestToken: 'trusted-token' }))
      .rejects.toThrow('ARCA_API_VERIFICATION_PROVIDER_REQUIRED');
  });

  test('requires a trusted evidence channel for authoritative WSFEX verification', async () => {
    const request = jsonRequest(
      '/v1/arca-onboarding/runs/60000000-0000-4000-8000-000000000010/api-verification/wsfex',
      {}
    );
    expect(handle(request)).rejects.toThrow('EVIDENCE_INGEST_CONFIGURATION_REQUIRED');
  });

  test('requires a trusted evidence channel for authoritative WSFE verification', async () => {
    const request = jsonRequest(
      '/v1/arca-onboarding/runs/60000000-0000-4000-8000-000000000010/api-verification/wsfe',
      {},
    );
    expect(handle(request)).rejects.toThrow('EVIDENCE_INGEST_CONFIGURATION_REQUIRED');
  });

  test('never imports an existing issuer from an unscoped browser request', async () => {
    const service = new ArcaOnboardingService(new TaxProfileStore(':memory:'), null, null, false);
    const id = '60000000-0000-4000-8000-000000000017';
    service.createRun({ onboardingId: id, workspaceId: 'workspace-1', taxpayerReferenceHash: 'a'.repeat(64),
      environment: 'homologation', requestedServices: ['wsfex'], actorId: 'user:owner',
      idempotencyKey: 'create-existing-run', occurredAt: '2026-09-23T12:00:00.000Z' });
    const path = `/v1/arca-onboarding/runs/${id}/existing-issuer`;
    const request = jsonRequest(path, { actorId: 'user:owner',
      idempotencyKey: 'import-existing-run', confirmedExistingSetup: true,
      exportPointOfSale: 2, domesticPointOfSale: null });
    await expect(handleArcaOnboardingRoute(request, new URL(request.url), service,
      { userApprovalToken: 'user-token', evidenceIngestToken: null }))
      .rejects.toThrow('ARCA_EXISTING_ISSUER_SCOPED_PRINCIPAL_REQUIRED');
    expect(service.getRun(id).currentStep).toBe('login_handoff');
  });

  test('imports a tenant-bound issuer through the browser route without exposing private evidence', async () => {
    const store = new TaxProfileStore(':memory:');
    const now = new Date().toISOString();
    const hash = hashCanonical;
    store.appendEvidenceConsentEvent({ version: 'tax-evidence-consent-event-v1',
      eventId: '70000000-0000-4000-8000-000000000099', workspaceId: 'workspace-1',
      sequence: 1, action: 'grant', authoritySource: 'desk_subscription',
      actorReferenceHash: hash('user:owner'), consent: { purpose: 'tax_workspace_processing',
        version: 'consent-v1', sourceIds: ['arca-onboarding'],
        scopeHash: hashTaxEvidenceConsentScope('consent-v1', ['arca-onboarding']) }, occurredAt: now });
    const gateway = {
      async discoverPointsOfSale() {
        const receipt = { version: 'arca-wsfex-point-of-sale-discovery-v1' as const,
          environment: 'homologation' as const, workspaceId: 'workspace-1',
          issuerProfileReferenceHash: hash('vault://issuer/1'),
          representedCuitCommitment: hash('represented-cuit'), activePoints: [2],
          authorityResponseHash: hash('official-points'), observedAt: now };
        return { ...receipt, evidenceHash: hash(receipt) };
      },
      async verifyPointOfSaleReadback(): Promise<never> { throw new Error('unexpected readback'); },
    };
    const service = new ArcaOnboardingService(store, null, null, false, gateway, null);
    const id = '60000000-0000-4000-8000-000000000018';
    service.createRun({ onboardingId: id, workspaceId: 'workspace-1',
      taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex'], actorId: 'user:owner', idempotencyKey: 'create-route-import',
      occurredAt: now });
    const boundaryReader = new HttpArcaBoundaryStatusReader('status-token', 'https://boundary.test',
      async () => Response.json({ version: 'wsaa-issuer-status-v1', workspaceId: 'workspace-1',
        issuerProfileRef: 'vault://issuer/1', environment: 'homologation', configured: true,
        active: true, delegationConfirmed: true, certificateFingerprint: hash('certificate'),
        representedCuitCommitment: hash('represented-cuit'), taxpayerReferenceHash: hash('taxpayer'),
        representedCuitLast4: '4039', certificate: { current: true,
          validFrom: new Date(Date.now() - 86_400_000).toISOString(),
          validUntil: new Date(Date.now() + 86_400_000).toISOString() } }));
    const path = `/v1/arca-onboarding/runs/${id}/existing-issuer`;
    const request = jsonRequest(path, { actorId: 'user:owner',
      idempotencyKey: 'route-import', confirmedExistingSetup: true,
      exportPointOfSale: 2, domesticPointOfSale: null });
    const response = await handleArcaOnboardingRoute(request, new URL(request.url), service, {
      userApprovalToken: null, evidenceIngestToken: null,
      tenantPrincipal: { version: 'tax-tenant-principal-v3', workspaceId: 'workspace-1',
        actorId: 'user:owner', capability: 'arca:onboard', method: 'POST', path,
        bodyHash: '0'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString() },
      issuerProfiles: new Map([['workspace-1', 'vault://issuer/1']]), boundaryReader,
    });
    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload.data.run.apiVerification.wsfex).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/certificateFingerprint|taxpayerReferenceHash|representedCuitCommitment|boundaryReceiptHash/);
  });

  test('rejects a Reclaim callback without its bound session header', async () => {
    const request = jsonRequest('/v1/reclaim/arca-onboarding/callback', {});
    const response = await handle(request);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'RECLAIM_SESSION_HEADER_REQUIRED' });
  });

  test('advances through human_auth only on the tenant-signed, strict no-capture receipt', async () => {
    const service = new ArcaOnboardingService(new TaxProfileStore(':memory:'), null, null, false);
    const onboardingId = '60000000-0000-4000-8000-000000000013';
    const tenantPrincipal = {
      version: 'tax-tenant-principal-v3' as const,
      workspaceId: 'workspace-1', actorId: 'user:owner', capability: 'arca:onboard' as const,
      method: 'POST' as const, path: '/v1/arca-onboarding/runs', bodyHash: '0'.repeat(64),
      expiresAt: '2099-01-01T00:00:00.000Z',
    };
    const options = { userApprovalToken: null, evidenceIngestToken: null, tenantPrincipal };
    await handleArcaOnboardingRoute(jsonRequest('/v1/arca-onboarding/runs', {
      onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: 'c'.repeat(64), environment: 'homologation',
      requestedServices: ['wsfex'], actorId: 'user:owner', idempotencyKey: 'create-human-auth-run',
    }), new URL('https://tax.example.test/v1/arca-onboarding/runs'), service, options);
    const loginPath = `/v1/arca-onboarding/runs/${onboardingId}/steps/login_handoff`;
    await handleArcaOnboardingRoute(jsonRequest(loginPath, {
      actorId: 'user:owner', idempotencyKey: 'complete-login-handoff', browserSessionReferenceHash: 'd'.repeat(64),
    }), new URL(`https://tax.example.test${loginPath}`), service, options);
    expect(service.getRun(onboardingId).currentStep).toBe('human_auth');

    const humanPath = `/v1/arca-onboarding/runs/${onboardingId}/steps/human_auth`;
    await expect(handleArcaOnboardingRoute(jsonRequest(humanPath, {
      actorId: 'user:owner', idempotencyKey: 'credential-canary-attempt', completionReceiptHash: 'e'.repeat(64),
      capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH, completedAt: new Date().toISOString(), cookies: 'spooky-canary',
    }), new URL(`https://tax.example.test${humanPath}`), service, options)).rejects.toThrow();
    expect(service.getRun(onboardingId).currentStep).toBe('human_auth');

    const response = await handleArcaOnboardingRoute(jsonRequest(humanPath, {
      actorId: 'user:owner', idempotencyKey: 'complete-private-human-auth', completionReceiptHash: 'e'.repeat(64),
      capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH, completedAt: new Date().toISOString(),
    }), new URL(`https://tax.example.test${humanPath}`), service, options);
    expect(response?.status).toBe(200);
    const payload = await response?.json();
    expect(payload.data.run.humanAuth.completionRecorded).toBe(true);
    expect(JSON.stringify(payload)).not.toMatch(/completionReceiptHash|processedCommandKeys|eventIds/);
    expect(service.getRun(onboardingId).currentStep).toBe('service_adherence');
  });
});

function handle(
  request: Request,
  options: Parameters<typeof handleArcaOnboardingRoute>[3] = { userApprovalToken: null, evidenceIngestToken: null },
) {
  const service = new ArcaOnboardingService(new TaxProfileStore(':memory:'), null, null, false);
  return handleArcaOnboardingRoute(request, new URL(request.url), service, options);
}

function jsonRequest(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://tax.example.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
