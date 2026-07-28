import { describe, expect, test } from 'bun:test';

import { createArcaOnboardingRun, hashCanonical } from '@tax-engine/core';

import { HttpArcaWorkbenchPublisher } from './arca-workbench';

const secret = 'workbench-secret-that-is-at-least-32-bytes';

describe('ARCA Workbench publisher', () => {
  test('publishes only an opaque commitment-level canonical projection', async () => {
    const requests: RequestInit[] = [];
    const created = createArcaOnboardingRun({
      onboardingId: '60000000-0000-4000-8000-000000000010',
      workspaceId: 'workspace-private-1',
      taxpayerReferenceHash: hashCanonical('20-96524039-0'),
      environment: 'homologation',
      requestedServices: ['wsfex', 'wsfe'],
      actorId: 'user:private-owner',
      idempotencyKey: 'private-command-key',
      occurredAt: '2026-07-19T17:00:00.000Z',
    });
    const publisher = new HttpArcaWorkbenchPublisher(
      new URL('https://workbench.example/api/orchestrations/ingest'),
      secret,
      async (_input, init) => {
        requests.push(init ?? {});
        return new Response(null, { status: 202 });
      }
    );

    await publisher.publish(created.run);

    expect(requests).toHaveLength(1);
    const body = JSON.parse(String(requests[0]?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      version: 1,
      source: 'tax_engine',
      product: 'tax',
      environment: 'testnet',
      workflow: 'arca-credentialless-onboarding',
      privacyLevel: 'commitment_only',
      state: 'awaiting_input',
    });
    expect(String(body.runId)).toMatch(/^arca-onboarding:[a-f0-9]{64}$/);
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      created.run.onboardingId,
      created.run.workspaceId,
      created.run.taxpayerReferenceHash,
      '20-96524039-0',
      'user:private-owner',
      'private-command-key',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(new Headers(requests[0]?.headers).get('authorization')).toBe(`Bearer ${secret}`);
  });

  test('fails closed on partial configuration or non-TLS remote endpoints', () => {
    expect(() =>
      HttpArcaWorkbenchPublisher.fromEnvironment({
        TAX_WORKBENCH_INGEST_URL: 'https://workbench.example/ingest',
        TAX_WORKBENCH_INGEST_SECRET: secret,
      })
    ).toThrow('TAX_WORKBENCH_COMMITMENT_PUBLISHING_GATE_REQUIRED');
    expect(() =>
      HttpArcaWorkbenchPublisher.fromEnvironment({
        TAX_WORKBENCH_COMMITMENT_PUBLISHING_ENABLED: 'true',
        TAX_WORKBENCH_INGEST_URL: 'https://workbench.example/ingest',
      })
    ).toThrow('TAX_WORKBENCH_INGEST_CONFIGURATION_REQUIRED');
    expect(
      HttpArcaWorkbenchPublisher.fromEnvironment({
        TAX_WORKBENCH_COMMITMENT_PUBLISHING_ENABLED: 'false',
      })
    ).toBeNull();
    expect(
      () => new HttpArcaWorkbenchPublisher(new URL('http://workbench.example/ingest'), secret)
    ).toThrow('TAX_WORKBENCH_INGEST_HTTPS_REQUIRED');
    expect(
      HttpArcaWorkbenchPublisher.fromEnvironment({
        TAX_WORKBENCH_COMMITMENT_PUBLISHING_ENABLED: 'true',
        TAX_WORKBENCH_INGEST_URL: 'http://127.0.0.1:4300/api/orchestrations/ingest',
        TAX_WORKBENCH_INGEST_SECRET: secret,
      })
    ).toBeInstanceOf(HttpArcaWorkbenchPublisher);
  });
});
