import { describe, expect, test } from 'bun:test';

import { hashCanonical, type ArcaOnboardingRunV1 } from '@tax-engine/core';

import { ArcaOnboardingService } from './arca-onboarding';
import type {
  ArcaOnboardingReclaimGateway,
  ArcaOnboardingReclaimRequest,
  VerifiedArcaOnboardingProof,
} from './arca-onboarding-reclaim';
import type { ReclaimProofVault } from './proof-vault';
import { TaxProfileStore } from './store';

const now = '2026-07-14T12:00:00.000Z';
const onboardingId = '60000000-0000-4000-8000-000000000010';
const hash = (value: string) => hashCanonical(value);

describe('ARCA onboarding API service', () => {
  test('persists the deterministic flow, verifies Reclaim, and retains only custody metadata', async () => {
    const store = new TaxProfileStore(':memory:');
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
    const completed = await service.ingestReclaimCallback('reclaim-onboarding-session', { rawProofMarker: 'vault-only' }, now);
    expect(completed.run.status).toBe('ready');
    expect(completed.run.zkEvidence?.custodyReceipt?.opaqueReference).toBe('vault://reclaim/60000000-0000-4000-8000-000000000099');
    expect(JSON.stringify(completed.run)).not.toContain('vault-only');
    expect(vault.storedPayload).toEqual({ rawProofMarker: 'vault-only' });
    expect(service.listEvents(onboardingId).map(event => event.action)).toContain('record_zk_evidence');

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

function advanceToApiVerification(service: ArcaOnboardingService): ArcaOnboardingRunV1 {
  const apply = (command: Parameters<ArcaOnboardingService['applyManualCommand']>[0]['command']) => service.applyManualCommand({
    onboardingId, command, actorId: 'user:owner', occurredAt: now,
  }).run;
  apply({ kind: 'complete_login_handoff', browserSessionReferenceHash: hash('browser'), idempotencyKey: 'login-handoff' });
  apply({
    kind: 'record_service_adherence', pointOfSaleAdministrationActive: true, relationshipManagerActive: true,
    evidenceHash: hash('services'), idempotencyKey: 'service-adherence',
  });
  apply({ kind: 'record_point_of_sale_discovery', exportPointOfSale: 4, evidenceHash: hash('pos'), idempotencyKey: 'pos-discovery' });
  apply({
    kind: 'record_ws_delegation', delegatedServices: { wsfex: true, wsfe: true },
    evidenceHash: hash('delegation'), idempotencyKey: 'delegation',
  });
  return apply({
    kind: 'record_api_verification', verifiedServices: { wsfex: true, wsfe: true }, activeExportPointOfSale: 4,
    observedAt: now, wsfexReceiptHash: hash('wsfex'), wsfeReceiptHash: hash('wsfe'), idempotencyKey: 'api-verification',
  });
}

class FakeOnboardingReclaimGateway implements ArcaOnboardingReclaimGateway {
  async createRequest(_run: ArcaOnboardingRunV1, _occurredAt: string): Promise<ArcaOnboardingReclaimRequest> {
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
