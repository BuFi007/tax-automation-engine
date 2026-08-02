import { describe, expect, test } from 'bun:test';

import { createUaeEinvoicingOnboardingRun } from '@tax-engine/core';

import { HttpUaeWorkbenchPublisher } from './uae-workbench';

describe('UAE Workbench publisher privacy boundary', () => {
  test('publishes only the closed commitment envelope', async () => {
    const requests: RequestInit[] = [];
    const privateOnboardingId = 'private-uae-onboarding-id';
    const privateWorkspaceId = 'private-uae-workspace-id';
    const privateTaxpayerHash = 'a'.repeat(64);
    const privateLegalEntityHash = 'b'.repeat(64);
    const { run } = createUaeEinvoicingOnboardingRun({
      onboardingId: privateOnboardingId,
      workspaceId: privateWorkspaceId,
      taxpayerReferenceHash: privateTaxpayerHash,
      legalEntityReferenceHash: privateLegalEntityHash,
      environment: 'pilot',
      revenueBand: 'below_aed_50m',
      actorId: 'private-user',
      occurredAt: '2026-07-28T04:00:00.000Z',
      idempotencyKey: 'private-create-command',
    });
    const publisher = new HttpUaeWorkbenchPublisher(
      new URL('https://workbench.example.test/api/orchestrations/ingest'),
      'uae-workbench-secret-that-is-at-least-32-bytes',
      async (_input, init) => {
        requests.push(init ?? {});
        return new Response(null, { status: 202 });
      }
    );

    await publisher.publish(run);
    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0]?.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        'entity',
        'environment',
        'eventId',
        'kind',
        'mode',
        'occurredAt',
        'privacyLevel',
        'product',
        'runId',
        'source',
        'state',
        'step',
        'summary',
        'teamHash',
        'traceId',
        'version',
        'workflow',
      ].sort()
    );
    expect(body).toMatchObject({
      source: 'tax_engine',
      product: 'tax',
      privacyLevel: 'commitment_only',
      workflow: 'uae-peppol-einvoicing-onboarding',
      state: 'awaiting_input',
    });
    const serialized = JSON.stringify(body);
    for (const privateValue of [
      privateOnboardingId,
      privateWorkspaceId,
      privateTaxpayerHash,
      privateLegalEntityHash,
      'private-user',
      'private-create-command',
    ]) {
      expect(serialized).not.toContain(privateValue);
    }
  });
});
