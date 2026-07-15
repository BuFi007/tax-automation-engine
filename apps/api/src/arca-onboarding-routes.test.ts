import { describe, expect, test } from 'bun:test';

import { ArcaOnboardingService } from './arca-onboarding';
import { handleArcaOnboardingRoute } from './arca-onboarding-routes';
import { TaxProfileStore } from './store';

describe('ARCA onboarding HTTP boundary', () => {
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

  test('rejects a Reclaim callback without its bound session header', async () => {
    const request = jsonRequest('/v1/reclaim/arca-onboarding/callback', {});
    const response = await handle(request);
    expect(response?.status).toBe(400);
    expect(await response?.json()).toEqual({ error: 'RECLAIM_SESSION_HEADER_REQUIRED' });
  });
});

function handle(
  request: Request,
  options: Readonly<{ userApprovalToken: string | null; evidenceIngestToken: string | null }> = { userApprovalToken: null, evidenceIngestToken: null },
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
