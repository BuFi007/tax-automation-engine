import { describe, expect, test } from 'bun:test';
import { HUMAN_AUTH_CAPTURE_POLICY_HASH } from '@tax-engine/core';

import { ArcaOnboardingService } from './arca-onboarding';
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
        version: 'tax-tenant-principal-v2',
        workspaceId: 'workspace-1',
        actorId: 'user:owner',
        capability: 'arca:onboard',
        expiresAt: '2099-01-01T00:00:00.000Z',
      },
    });
    expect(response?.status).toBe(201);
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
        version: 'tax-tenant-principal-v2',
        workspaceId: 'workspace-1',
        actorId: 'user:owner',
        capability: 'arca:onboard',
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
  });

  test('requires a trusted evidence channel for authoritative WSFEX verification', async () => {
    const request = jsonRequest(
      '/v1/arca-onboarding/runs/60000000-0000-4000-8000-000000000010/api-verification/wsfex',
      {}
    );
    expect(handle(request)).rejects.toThrow('EVIDENCE_INGEST_CONFIGURATION_REQUIRED');
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
      version: 'tax-tenant-principal-v2' as const,
      workspaceId: 'workspace-1', actorId: 'user:owner', capability: 'arca:onboard' as const,
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
