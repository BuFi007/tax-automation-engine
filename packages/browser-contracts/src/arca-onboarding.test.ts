import { describe, expect, test } from 'bun:test';

import {
  arcaOnboardingBrowserHistoryV1Schema,
  arcaOnboardingBrowserMutationV1Schema,
  arcaOnboardingBrowserReclaimRequestV1Schema,
  projectArcaOnboardingBrowserHistoryV1,
  projectArcaOnboardingBrowserMutationV1,
  projectArcaOnboardingBrowserReclaimRequestV1,
  projectArcaOnboardingBrowserRunV1,
} from './arca-onboarding';

const hash = (value: string) => value.repeat(64).slice(0, 64);

describe('browser-safe ARCA onboarding contract', () => {
  test('projects the deterministic step engine without internal evidence or authority material', () => {
    const projected = projectArcaOnboardingBrowserMutationV1({
      run: internalRun(),
      replayed: false,
      nextActions: ['OPEN_ARCA_LOGIN_HANDOFF'],
    });

    expect(arcaOnboardingBrowserMutationV1Schema.parse(projected)).toEqual(projected);
    expect(projected.run.currentStep).toBe('login_handoff');
    expect(projected.run.steps.map(step => step.step)).toEqual([
      'login_handoff',
      'human_auth',
      'service_adherence',
      'point_of_sale_discovery',
      'point_of_sale_creation',
      'ws_delegation',
      'api_verification',
      'zk_evidence',
      'ready',
    ]);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toMatch(
      /taxpayerReferenceHash|issuerProfileReferenceHash|representedCuitCommitment|evidenceHashes|processedCommandKeys|eventIds|completionReceiptHash|proofHash|claimsHash|contextHash/
    );
  });

  test('fails closed on non-canonical steps and inconsistent completion state', () => {
    const input = internalRun();
    expect(() =>
      projectArcaOnboardingBrowserRunV1({ ...input, steps: [...input.steps].reverse() })
    ).toThrow();
    expect(() =>
      projectArcaOnboardingBrowserRunV1({
        ...input,
        humanAuth: { ...input.humanAuth, completedAt: new Date().toISOString() },
      })
    ).toThrow();
  });

  test('returns only browser capability URLs for a Reclaim handoff', () => {
    const run = {
      ...internalRun(),
      currentStep: 'zk_evidence',
      reclaimSession: {
        sessionId: 'reclaim-session-1',
        providerId: 'arca-provider',
        providerVersion: '1.0.0',
        contextHash: hash('e'),
        requestedAt: '2026-07-16T12:00:00.000Z',
        expiresAt: '2026-07-16T12:10:00.000Z',
        state: 'pending',
      },
    };
    const internalRequest = {
      run,
      replayed: false,
      nextActions: ['COMPLETE_RECLAIM_PROOF'],
      output: {
        session: run.reclaimSession,
        requestUrl: 'https://reclaim.example.test/request/session-1',
        requestConfig: 'must-not-be-projected',
        statusUrl: 'https://reclaim.example.test/status/session-1',
      },
    };
    const receipt = projectArcaOnboardingBrowserReclaimRequestV1(internalRequest);

    expect(arcaOnboardingBrowserReclaimRequestV1Schema.parse(receipt)).toEqual(receipt);
    expect(JSON.stringify(receipt)).not.toContain('requestConfig');
    expect(JSON.stringify(receipt)).not.toContain('contextHash');
  });

  test('projects safe history without event, actor, or idempotency identifiers', () => {
    const history = projectArcaOnboardingBrowserHistoryV1({
      run: internalRun(),
      nextActions: ['OPEN_ARCA_LOGIN_HANDOFF'],
      events: [{
        version: 'arca-onboarding-event-v1',
        eventId: 'event-secret',
        onboardingId: '60000000-0000-4000-8000-000000000010',
        workspaceId: 'workspace-1',
        actorId: 'user:owner',
        action: 'arca_onboarding_created',
        occurredAt: '2026-07-16T12:00:00.000Z',
        idempotencyKey: 'secret-idempotency-key',
        safeMetadata: { environment: 'homologation' },
      }],
    });

    expect(arcaOnboardingBrowserHistoryV1Schema.parse(history)).toEqual(history);
    expect(JSON.stringify(history)).not.toMatch(/event-secret|user:owner|secret-idempotency-key/);
  });
});

function internalRun() {
  const now = '2026-07-16T12:00:00.000Z';
  const steps = [
    'login_handoff',
    'human_auth',
    'service_adherence',
    'point_of_sale_discovery',
    'point_of_sale_creation',
    'ws_delegation',
    'api_verification',
    'zk_evidence',
    'ready',
  ].map((step, index) => ({
    step,
    state: index === 0 ? 'action_required' : 'pending',
    requiresUserAction: index < 6,
    requiresExplicitConfirmation: index < 6,
    completedAt: null,
    evidenceHashes: [hash(String(index + 1))],
    safeMetadata: {},
  }));
  return {
    version: 'arca-onboarding-run-v1',
    onboardingId: '60000000-0000-4000-8000-000000000010',
    workspaceId: 'workspace-1',
    taxpayerReferenceHash: hash('a'),
    environment: 'homologation',
    requestedServices: ['wsfex'],
    revision: 1,
    status: 'active',
    currentStep: 'login_handoff',
    createdAt: now,
    updatedAt: now,
    steps,
    pointOfSale: { number: null, source: null, active: false },
    delegation: { wsfex: false, wsfe: false },
    authorityBinding: {
      issuerProfileReferenceHash: hash('b'),
      representedCuitCommitment: hash('c'),
    },
    apiVerification: { wsfex: false, wsfe: false, observedAt: null },
    reclaimSession: null,
    humanAuth: {
      capturePolicy: {
        inspectCredentialDom: false,
        screenshots: false,
        clipboard: false,
        cookies: false,
        browserStorage: false,
        networkBodies: false,
        rawTraces: false,
      },
      capturePolicyHash: hash('d'),
      startedAt: null,
      expiresAt: null,
      completionReceiptHash: null,
      completedAt: null,
    },
    zkEvidence: null,
    processedCommandKeys: ['create-run'],
    eventIds: ['event-1'],
  };
}
