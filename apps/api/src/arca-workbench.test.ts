import { describe, expect, test } from 'bun:test';

import {
  applyArcaOnboardingCommand,
  createArcaOnboardingRun,
  hashCanonical,
  HUMAN_AUTH_CAPTURE_POLICY_HASH,
  type ArcaOnboardingRunV1,
} from '@tax-engine/core';

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

  test('omits point-of-sale, delegation, receipt, and proof material from a ready run', async () => {
    const requests: RequestInit[] = [];
    const publisher = new HttpArcaWorkbenchPublisher(
      new URL('https://workbench.example/api/orchestrations/ingest'),
      secret,
      async (_input, init) => {
        requests.push(init ?? {});
        return new Response(null, { status: 202 });
      }
    );
    const privateMaterial = {
      workspaceId: 'workspace-private-ready',
      taxpayerCuit: '20-87654321-9',
      taxpayerReferenceHash: hashCanonical('20-87654321-9'),
      pointOfSale: 87654,
      browserSessionHash: hashCanonical('private-browser-session'),
      humanAuthReceiptHash: hashCanonical('private-human-auth-receipt'),
      issuerProfileHash: hashCanonical('private-issuer-profile'),
      representedCuitCommitment: hashCanonical('private-represented-cuit'),
      serviceEvidenceHash: hashCanonical('private-service-evidence'),
      pointEvidenceHash: hashCanonical('private-point-evidence'),
      creationEvidenceHash: hashCanonical('private-creation-evidence'),
      delegationEvidenceHash: hashCanonical('private-delegation-evidence'),
      wsfexReceiptHash: hashCanonical('private-wsfex-receipt'),
      wsfeReceiptHash: hashCanonical('private-wsfe-receipt'),
      reclaimContextHash: hashCanonical('private-reclaim-context'),
      proofHash: hashCanonical('private-proof-contents'),
      claimsHash: hashCanonical('private-proof-claims'),
    };

    let run = createArcaOnboardingRun({
      onboardingId: '60000000-0000-4000-8000-000000000011',
      workspaceId: privateMaterial.workspaceId,
      taxpayerReferenceHash: privateMaterial.taxpayerReferenceHash,
      environment: 'homologation',
      requestedServices: ['wsfex', 'wsfe'],
      actorId: 'user:private-ready-owner',
      idempotencyKey: 'private-ready-create',
      occurredAt: '2026-07-19T18:00:00.000Z',
    }).run;

    run = apply(run, {
      kind: 'complete_login_handoff',
      browserSessionReferenceHash: privateMaterial.browserSessionHash,
      idempotencyKey: 'private-ready-login',
    });
    run = apply(run, {
      kind: 'record_human_auth_completion',
      completion: {
        version: 'human-auth-completion-v1',
        completionReceiptHash: privateMaterial.humanAuthReceiptHash,
        capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH,
        completedAt: '2026-07-19T18:00:00.000Z',
        signatureVerified: true,
      },
      idempotencyKey: 'private-ready-human-auth',
    });
    run = apply(run, {
      kind: 'record_service_adherence',
      pointOfSaleAdministrationActive: true,
      relationshipManagerActive: true,
      evidenceHash: privateMaterial.serviceEvidenceHash,
      idempotencyKey: 'private-ready-services',
    });
    run = apply(run, {
      kind: 'record_point_of_sale_discovery',
      exportPointOfSale: null,
      evidenceHash: privateMaterial.pointEvidenceHash,
      idempotencyKey: 'private-ready-discovery',
    });
    run = apply(run, {
      kind: 'record_point_of_sale_creation',
      exportPointOfSale: privateMaterial.pointOfSale,
      evidenceHash: privateMaterial.creationEvidenceHash,
      idempotencyKey: 'private-ready-point',
    });
    run = apply(run, {
      kind: 'record_ws_delegation',
      delegatedServices: { wsfex: true, wsfe: true },
      issuerProfileReferenceHash: privateMaterial.issuerProfileHash,
      representedCuitCommitment: privateMaterial.representedCuitCommitment,
      evidenceHash: privateMaterial.delegationEvidenceHash,
      idempotencyKey: 'private-ready-delegation',
    });
    run = apply(run, {
      kind: 'record_api_verification',
      verifiedServices: { wsfex: true, wsfe: true },
      activeExportPointOfSale: privateMaterial.pointOfSale,
      activeDomesticPointOfSale: 1,
      observedAt: '2026-07-19T18:00:00.000Z',
      wsfexReceiptHash: privateMaterial.wsfexReceiptHash,
      wsfeReceiptHash: privateMaterial.wsfeReceiptHash,
      idempotencyKey: 'private-ready-api',
    });
    run = apply(run, {
      kind: 'start_zk_evidence',
      session: {
        sessionId: 'private-reclaim-session',
        providerId: 'private-reclaim-provider',
        providerVersion: 'private-reclaim-version',
        contextHash: privateMaterial.reclaimContextHash,
        requestedAt: '2026-07-19T18:00:00.000Z',
        expiresAt: '2026-07-19T18:10:00.000Z',
        state: 'pending',
      },
      idempotencyKey: 'private-ready-proof-start',
    });
    run = apply(run, {
      kind: 'record_zk_evidence',
      sessionId: 'private-reclaim-session',
      providerId: 'private-reclaim-provider',
      providerVersion: 'private-reclaim-version',
      proofHash: privateMaterial.proofHash,
      claimsHash: privateMaterial.claimsHash,
      verifiedAt: '2026-07-19T18:00:00.000Z',
      teeVerified: false,
      custodyReceipt: null,
      idempotencyKey: 'private-ready-proof',
    });

    expect(run.status).toBe('ready');
    await publisher.publish(run);
    expect(requests).toHaveLength(9);

    const serialized = JSON.stringify(
      requests.map(request => JSON.parse(String(request.body)) as Record<string, unknown>)
    );
    for (const forbidden of [
      privateMaterial.workspaceId,
      privateMaterial.taxpayerCuit,
      String(privateMaterial.pointOfSale),
      ...Object.values(privateMaterial).filter(value => typeof value === 'string'),
      'user:private-ready-owner',
      'private-ready-create',
      'private-reclaim-session',
      'private-reclaim-provider',
      'private-reclaim-version',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test('fails closed on partial configuration or non-TLS remote endpoints', () => {
    expect(() =>
      HttpArcaWorkbenchPublisher.fromEnvironment({
        TAX_WORKBENCH_INGEST_URL: 'https://workbench.example/ingest',
      })
    ).toThrow('TAX_WORKBENCH_INGEST_CONFIGURATION_REQUIRED');
    expect(
      () => new HttpArcaWorkbenchPublisher(new URL('http://workbench.example/ingest'), secret)
    ).toThrow('TAX_WORKBENCH_INGEST_HTTPS_REQUIRED');
    expect(
      HttpArcaWorkbenchPublisher.fromEnvironment({
        TAX_WORKBENCH_INGEST_URL: 'http://127.0.0.1:4300/api/orchestrations/ingest',
        TAX_WORKBENCH_INGEST_SECRET: secret,
      })
    ).toBeInstanceOf(HttpArcaWorkbenchPublisher);
  });
});

function apply(
  run: ArcaOnboardingRunV1,
  command: Parameters<typeof applyArcaOnboardingCommand>[1]
): ArcaOnboardingRunV1 {
  return applyArcaOnboardingCommand(
    run,
    command,
    'user:private-ready-owner',
    '2026-07-19T18:00:00.000Z'
  ).run;
}
