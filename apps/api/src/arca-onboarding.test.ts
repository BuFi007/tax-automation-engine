import { describe, expect, test } from 'bun:test';

import {
  HUMAN_AUTH_CAPTURE_POLICY_HASH,
  hashCanonical,
  hashTaxEvidenceConsentScope,
  type ArcaOnboardingRunV1,
} from '@tax-engine/core';

import { ArcaOnboardingService } from './arca-onboarding';
import type { ArcaWorkbenchPublisher } from './arca-workbench';
import type {
  ArcaOnboardingReclaimGateway,
  ArcaOnboardingReclaimRequest,
  VerifiedArcaOnboardingProof,
} from './arca-onboarding-reclaim';
import type { ReclaimProofVault } from './proof-vault';
import { TaxProfileStore } from './store';
import type { WsfexPointOfSaleGateway } from './wsfex';

const now = '2026-07-14T12:00:00.000Z';
const onboardingId = '60000000-0000-4000-8000-000000000010';
const hash = (value: string) => hashCanonical(value);

describe('ARCA onboarding API service', () => {
  test('retains canonical state when Workbench delivery fails', async () => {
    const store = new TaxProfileStore(':memory:');
    const failingPublisher: ArcaWorkbenchPublisher = {
      publish: async () => {
        throw new Error('workbench unavailable');
      },
    };
    const service = new ArcaOnboardingService(
      store,
      null,
      null,
      false,
      null,
      failingPublisher
    );

    const created = service.createRun({
      onboardingId,
      workspaceId: 'workspace-1',
      taxpayerReferenceHash: hash('taxpayer'),
      environment: 'homologation',
      requestedServices: ['wsfex'],
      actorId: 'user:owner',
      idempotencyKey: 'create-onboarding',
      occurredAt: now,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(created.run.revision).toBe(1);
    expect(service.getRun(onboardingId)).toEqual(created.run);
  });

  test('completes WSFEX API verification only with an active, authority-bound FEEWS point', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const service = new ArcaOnboardingService(store, null, null, false, new FakePointOfSaleGateway([4]));
    service.createRun({
      onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now,
    });
    advanceToApiVerificationStep(service);
    const result = await service.verifyWsfexApi({
      onboardingId, issuerProfileRef: 'vault://issuer/profile-1',
      actorId: 'system:arca-authority', idempotencyKey: 'official-api-verification', occurredAt: now,
    });
    expect(result.output).toEqual(expect.objectContaining({ state: 'recorded', activePoints: [4] }));
    expect(result.run.currentStep).toBe('zk_evidence');
    expect(result.run.apiVerification.wsfex).toBe(true);
    expect(store.listPendingTaxDomainEvents()).toEqual([
      expect.objectContaining({
        kind: 'arca.api_verification_completed',
        workspaceId: 'workspace-1',
      }),
    ]);
  });

  test('rejects WSFEX API evidence from a different represented taxpayer binding', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const service = new ArcaOnboardingService(store, null, null, false, new FakePointOfSaleGateway([4], hash('other-cuit')));
    service.createRun({
      onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now,
    });
    advanceToApiVerificationStep(service);
    await expect(service.verifyWsfexApi({
      onboardingId, issuerProfileRef: 'vault://issuer/profile-1',
      actorId: 'system:arca-authority', idempotencyKey: 'official-api-verification', occurredAt: now,
    })).rejects.toThrow('ARCA_POINT_OF_SALE_AUTHORITY_BINDING_MISMATCH');
  });

  test('persists the deterministic flow, verifies Reclaim, and retains only custody metadata', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const gateway = new FakeOnboardingReclaimGateway();
    const vault = new FakeOnboardingProofVault();
    const service = new ArcaOnboardingService(store, gateway, vault, true);
    service.createRun({
      onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex', 'wsfe'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now,
    });
    advanceToApiVerification(service);

    const request = await service.startReclaim({
      onboardingId, actorId: 'user:owner', idempotencyKey: 'start-reclaim', occurredAt: now,
    });
    expect(request.output.requestUrl).toBe('https://reclaim.example/request');
    const requestReplay = await service.startReclaim({
      onboardingId, actorId: 'user:owner', idempotencyKey: 'start-reclaim', occurredAt: '2026-07-14T12:01:00.000Z',
    });
    expect(requestReplay.replayed).toBe(true);
    expect(requestReplay.output).toEqual(request.output);
    expect(gateway.createRequestCalls).toBe(1);
    const completed = await service.ingestReclaimCallback('reclaim-onboarding-session', { rawProofMarker: 'vault-only' }, now);
    expect(completed.run.status).toBe('ready');
    expect(completed.run.zkEvidence?.custodyReceipt?.opaqueReference).toBe('vault://reclaim/60000000-0000-4000-8000-000000000099');
    expect(JSON.stringify(completed.run)).not.toContain('vault-only');
    expect(vault.storedPayload).toEqual({ rawProofMarker: 'vault-only' });
    expect(service.listEvents(onboardingId).map(event => event.action)).toContain('record_zk_evidence');
    expect(store.listPendingTaxDomainEvents().map(event => event.kind).sort().join(','))
      .toBe('arca.api_verification_completed,reclaim.proof_verified');

    const replay = await service.ingestReclaimCallback('reclaim-onboarding-session', { rawProofMarker: 'vault-only' }, now);
    expect(replay.replayed).toBe(true);
    expect(replay.run.revision).toBe(completed.run.revision);
  });

  test('fails closed when proof custody is required but not configured', async () => {
    const service = new ArcaOnboardingService(new TaxProfileStore(':memory:'), new FakeOnboardingReclaimGateway(), null, true);
    service.createRun({
      onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex', 'wsfe'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now,
    });
    advanceToApiVerification(service);
    await service.startReclaim({ onboardingId, actorId: 'user:owner', idempotencyKey: 'start-reclaim', occurredAt: now });
    expect(service.ingestReclaimCallback('reclaim-onboarding-session', {}, now)).rejects.toThrow('RECLAIM_PROOF_VAULT_CONFIGURATION_REQUIRED');
  });
});

function grantTaxWorkspaceConsent(store: TaxProfileStore): void {
  const sourceIds = ['arca-onboarding'];
  store.appendEvidenceConsentEvent({
    version: 'tax-evidence-consent-event-v1',
    eventId: '70000000-0000-4000-8000-000000000001',
    workspaceId: 'workspace-1',
    sequence: 1,
    action: 'grant',
    authoritySource: 'desk_subscription',
    actorReferenceHash: hash('user:owner'),
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    occurredAt: now,
  });
}

function advanceToApiVerification(service: ArcaOnboardingService): ArcaOnboardingRunV1 {
  advanceToApiVerificationStep(service);
  const apply = (command: Parameters<ArcaOnboardingService['applyManualCommand']>[0]['command']) => service.applyManualCommand({
    onboardingId, command, actorId: 'user:owner', occurredAt: now,
  }).run;
  return apply({
    kind: 'record_api_verification', verifiedServices: { wsfex: true, wsfe: true }, activeExportPointOfSale: 4,
    observedAt: now, wsfexReceiptHash: hash('wsfex'), wsfeReceiptHash: hash('wsfe'), idempotencyKey: 'api-verification',
  });
}

function advanceToApiVerificationStep(service: ArcaOnboardingService): ArcaOnboardingRunV1 {
  const apply = (command: Parameters<ArcaOnboardingService['applyManualCommand']>[0]['command']) => service.applyManualCommand({
    onboardingId, command, actorId: 'user:owner', occurredAt: now,
  }).run;
  apply({ kind: 'complete_login_handoff', browserSessionReferenceHash: hash('browser'), idempotencyKey: 'login-handoff' });
  apply({
    kind: 'record_human_auth_completion',
    completion: {
      version: 'human-auth-completion-v1', completionReceiptHash: hash('human-auth'),
      capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH, completedAt: now, signatureVerified: true,
    },
    idempotencyKey: 'human-auth-completion',
  });
  apply({
    kind: 'record_service_adherence', pointOfSaleAdministrationActive: true, relationshipManagerActive: true,
    evidenceHash: hash('services'), idempotencyKey: 'service-adherence',
  });
  apply({ kind: 'record_point_of_sale_discovery', exportPointOfSale: 4, evidenceHash: hash('pos'), idempotencyKey: 'pos-discovery' });
  const run = service.getRun(onboardingId);
  apply({
    kind: 'record_ws_delegation', delegatedServices: { wsfex: true, wsfe: run.requestedServices.includes('wsfe') },
    issuerProfileReferenceHash: hash('vault://issuer/profile-1'), representedCuitCommitment: hash('represented-cuit'),
    evidenceHash: hash('delegation'), idempotencyKey: 'delegation',
  });
  return service.getRun(onboardingId);
}

class FakeOnboardingReclaimGateway implements ArcaOnboardingReclaimGateway {
  createRequestCalls = 0;

  async createRequest(_run: ArcaOnboardingRunV1, _occurredAt: string): Promise<ArcaOnboardingReclaimRequest> {
    this.createRequestCalls += 1;
    return {
      session: {
        sessionId: 'reclaim-onboarding-session', providerId: 'arca-onboarding-provider', providerVersion: '1.0.0',
        contextHash: hash('context'), requestedAt: now, expiresAt: '2026-07-14T12:10:00.000Z', state: 'pending',
      },
      requestUrl: 'https://reclaim.example/request',
      requestConfig: '{"safe":true}',
      statusUrl: 'https://reclaim.example/status',
    };
  }

  async verifyCallback(_run: ArcaOnboardingRunV1, _session: ArcaOnboardingRunV1['reclaimSession'], _payload: unknown, _occurredAt: string): Promise<VerifiedArcaOnboardingProof> {
    return {
      sessionId: 'reclaim-onboarding-session', providerId: 'arca-onboarding-provider', providerVersion: '1.0.0',
      proofHash: hash('proof'), claimsHash: hash('claims'), verifiedAt: now, teeVerified: false,
      claims: {
        pointOfSaleAdministrationActive: true, relationshipManagerActive: true, exportPointOfSaleActive: true,
        exportPointOfSale: 4, wsfexDelegated: true, wsfeDelegated: true,
      },
    };
  }
}

class FakeOnboardingProofVault implements ReclaimProofVault {
  storedPayload: unknown;

  async storeVerifiedProof(): Promise<never> {
    throw new Error('not-used');
  }

  async storeVerifiedArcaOnboardingProof(input: Parameters<NonNullable<ReclaimProofVault['storeVerifiedArcaOnboardingProof']>>[0]) {
    this.storedPayload = input.proofPayload;
    return {
      version: 'reclaim-proof-custody-receipt-v1' as const,
      opaqueReference: 'vault://reclaim/60000000-0000-4000-8000-000000000099',
      artifactHash: input.proof.proofHash,
      encryptionVersion: 'aes-256-gcm+hkdf-sha256+wrapped-dek-v1' as const,
      retentionPolicyId: 'tax-evidence-v1',
      storedAt: now,
    };
  }
}

class FakePointOfSaleGateway implements WsfexPointOfSaleGateway {
  constructor(
    private readonly activePoints: readonly number[],
    private readonly representedCuitCommitment = hash('represented-cuit')
  ) {}
  async discoverPointsOfSale(input: Readonly<{ workspaceId: string; issuerProfileRef: string }>) {
    const receipt = {
      version: 'arca-wsfex-point-of-sale-discovery-v1' as const,
      environment: 'homologation' as const,
      workspaceId: input.workspaceId,
      issuerProfileReferenceHash: hash(input.issuerProfileRef),
      representedCuitCommitment: this.representedCuitCommitment,
      activePoints: [...this.activePoints],
      authorityResponseHash: hash('authority-response'),
      observedAt: now,
    };
    return { ...receipt, evidenceHash: hashCanonical(receipt) };
  }
}
