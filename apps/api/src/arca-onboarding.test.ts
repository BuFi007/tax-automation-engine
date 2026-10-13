import { describe, expect, test } from 'bun:test';
import { projectArcaOnboardingBrowserMutationV1 } from '@tax-engine/browser-contracts';

import {
  HUMAN_AUTH_CAPTURE_POLICY_HASH,
  hashCanonical,
  hashTaxEvidenceConsentScope,
  type ArcaOnboardingRunV1,
} from '@tax-engine/core';

import { ArcaOnboardingService } from './arca-onboarding';
import { HttpArcaBoundaryStatusReader } from './arca-connection-projection';
import type {
  ArcaOnboardingReclaimGateway,
  ArcaOnboardingReclaimRequest,
  VerifiedArcaOnboardingProof,
} from './arca-onboarding-reclaim';
import type { ReclaimProofVault } from './proof-vault';
import { TaxProfileStore } from './store';
import type { WsfexPointOfSaleGateway } from './wsfex';
import type { WsfePointOfSaleGateway } from './wsfe';

const now = '2026-07-14T12:00:00.000Z';
const onboardingId = '60000000-0000-4000-8000-000000000010';
const hash = (value: string) => hashCanonical(value);

describe('ARCA onboarding API service', () => {
  test('imports an existing issuer only after live certificate and both official point readbacks', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const exportGateway = new FakePointOfSaleGateway([]);
    const domesticGateway = new FakeWsfePointOfSaleGateway([]);
    const service = new ArcaOnboardingService(store, null, null, false, exportGateway, domesticGateway);
    let certificateFingerprint = hash('certificate');
    service.createRun({ onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'),
      environment: 'homologation', requestedServices: ['wsfex', 'wsfe'],
      actorId: 'user:owner', idempotencyKey: 'create-existing', occurredAt: now });
    const boundaryReader = new HttpArcaBoundaryStatusReader('status-token', 'https://boundary.test',
      async () => Response.json({ version: 'wsaa-issuer-status-v1', workspaceId: 'workspace-1',
        issuerProfileRef: 'vault://issuer/profile-1', environment: 'homologation',
        configured: true, active: true, delegationConfirmed: true,
        certificateFingerprint, representedCuitCommitment: hash('represented-cuit'),
        taxpayerReferenceHash: hash('taxpayer'), representedCuitLast4: '4039',
        certificate: { validFrom: '2026-07-01T00:00:00.000Z', validUntil: '2026-08-01T00:00:00.000Z', current: true } }));
    const input = { onboardingId, issuerProfileRef: 'vault://issuer/profile-1',
      exportPointOfSale: 2, domesticPointOfSale: 1, confirmedExistingSetup: true as const,
      actorId: 'user:owner', idempotencyKey: 'import-existing', occurredAt: now, boundaryReader };
    const imported = await service.importExistingIssuer(input);
    expect(imported.run.currentStep).toBe('zk_evidence');
    expect(imported.run.apiVerification).toEqual({ wsfex: true, wsfe: true, observedAt: now });
    expect(imported.run.steps.find(step => step.step === 'human_auth')?.state).toBe('skipped');
    expect(projectArcaOnboardingBrowserMutationV1(imported).run.currentStep).toBe('zk_evidence');
    expect(exportGateway.readbackCalls).toBe(1);
    expect(domesticGateway.readbackCalls).toBe(1);
    expect((await service.importExistingIssuer(input)).replayed).toBe(true);
    await expect(service.importExistingIssuer({ ...input, domesticPointOfSale: 4 }))
      .rejects.toThrow('ARCA_EXISTING_ISSUER_RETRY_MISMATCH');
    certificateFingerprint = hash('rotated-certificate');
    await expect(service.importExistingIssuer(input))
      .rejects.toThrow('ARCA_EXISTING_ISSUER_RETRY_MISMATCH');
  });

  test('records export and domestic points independently, completing only after both official checks', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const exportGateway = new FakePointOfSaleGateway([]);
    const domesticGateway = new FakeWsfePointOfSaleGateway([]);
    const service = new ArcaOnboardingService(store, null, null, false, exportGateway, domesticGateway);
    service.createRun({ onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex', 'wsfe'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now });
    advanceToApiVerificationStep(service, 2);
    const exportResult = await service.verifyWsfexApi({ onboardingId, issuerProfileRef: 'vault://issuer/profile-1', actorId: 'system:arca-authority', idempotencyKey: 'verify-export', occurredAt: now });
    expect(exportResult.output?.state).toBe('wsfe_verification_required');
    expect(exportResult.run.currentStep).toBe('api_verification');
    expect(exportResult.run.apiVerification).toEqual({ wsfex: true, wsfe: false, observedAt: now });
    expect(exportResult.run.pointOfSale.number).toBe(2);
    expect(store.listPendingTaxDomainEvents()).toEqual([]);
    const domesticResult = await service.verifyWsfeApi({ onboardingId, issuerProfileRef: 'vault://issuer/profile-1', actorId: 'system:arca-authority', idempotencyKey: 'verify-domestic', occurredAt: now });
    expect(domesticResult.output).toEqual(expect.objectContaining({ state: 'recorded', verificationSource: 'accepted_voucher_readback' }));
    expect(domesticResult.run.currentStep).toBe('zk_evidence');
    expect(domesticResult.run.pointOfSale.number).toBe(2);
    expect(domesticResult.run.domesticPointOfSale).toEqual({ number: 1, active: true });
    expect(domesticResult.run.apiVerification).toEqual({ wsfex: true, wsfe: true, observedAt: now });
    expect(store.listPendingTaxDomainEvents().map(event => event.kind)).toEqual(['arca.api_verification_completed']);
  });

  test('rejects domestic proof for a different CUIT without marking C verified', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const service = new ArcaOnboardingService(store, null, null, false, null, new FakeWsfePointOfSaleGateway([], hash('other-cuit')));
    service.createRun({ onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfe'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now });
    advanceToApiVerificationStep(service, 1);
    await expect(service.verifyWsfeApi({ onboardingId, issuerProfileRef: 'vault://issuer/profile-1', actorId: 'system:arca-authority', idempotencyKey: 'verify-domestic', occurredAt: now }))
      .rejects.toThrow('ARCA_WSFE_POINT_OF_SALE_AUTHORITY_BINDING_MISMATCH');
    expect(service.getRun(onboardingId).apiVerification.wsfe).toBe(false);
  });

  test('completes a C-only run at domestic POS 1 without inventing export verification', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const service = new ArcaOnboardingService(store, null, null, false, null, new FakeWsfePointOfSaleGateway([1]));
    service.createRun({ onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfe'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now });
    advanceToApiVerificationStep(service, 1);
    const result = await service.verifyWsfeApi({ onboardingId, issuerProfileRef: 'vault://issuer/profile-1', actorId: 'system:arca-authority', idempotencyKey: 'verify-domestic', occurredAt: now });
    expect(result.output?.verificationSource).toBe('point_of_sale_discovery');
    expect(result.run.currentStep).toBe('zk_evidence');
    expect(result.run.apiVerification).toEqual({ wsfex: false, wsfe: true, observedAt: now });
    expect(result.run.domesticPointOfSale).toEqual({ number: 1, active: true });
    expect(result.run.apiVerificationReceipts?.wsfex).toBeNull();
  });

  test('accepts another domestic POS only when official WSFE discovery lists it active', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const service = new ArcaOnboardingService(store, null, null, false, null, new FakeWsfePointOfSaleGateway([4]));
    service.createRun({ onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfe'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now });
    advanceToApiVerificationStep(service, 4);
    const result = await service.verifyWsfeApi({ onboardingId, issuerProfileRef: 'vault://issuer/profile-1', pointOfSale: 4,
      actorId: 'system:arca-authority', idempotencyKey: 'verify-domestic', occurredAt: now });
    expect(result.run.domesticPointOfSale).toEqual({ number: 4, active: true });
    expect(result.output?.verificationSource).toBe('point_of_sale_discovery');
  });
  test('completes WSFEX API verification only with an active, authority-bound FEEWS point', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const gateway = new FakePointOfSaleGateway([4]);
    const service = new ArcaOnboardingService(store, null, null, false, gateway);
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
    expect(gateway.readbackCalls).toBe(0);
    expect(store.listPendingTaxDomainEvents()).toEqual([
      expect.objectContaining({
        kind: 'arca.api_verification_completed',
        workspaceId: 'workspace-1',
      }),
    ]);
  });

  test('accepts an empty homologation listing only with a signer-verified, issuer-bound voucher readback', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const gateway = new FakePointOfSaleGateway([]);
    const service = new ArcaOnboardingService(store, null, null, false, gateway);
    service.createRun({
      onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now,
    });
    advanceToApiVerificationStep(service, 2);
    const result = await service.verifyWsfexApi({
      onboardingId, issuerProfileRef: 'vault://issuer/profile-1', actorId: 'system:arca-authority',
      idempotencyKey: 'official-api-verification', occurredAt: now,
    });
    expect(result.output).toEqual(expect.objectContaining({
      state: 'recorded', activePoints: [], verificationSource: 'accepted_voucher_readback',
    }));
    expect(result.run.apiVerification.wsfex).toBe(true);
    expect(gateway.readbackCalls).toBe(1);
  });

  test('rejects an empty-list readback bound to another taxpayer', async () => {
    const store = new TaxProfileStore(':memory:');
    grantTaxWorkspaceConsent(store);
    const gateway = new FakePointOfSaleGateway([], hash('represented-cuit'), hash('other-cuit'));
    const service = new ArcaOnboardingService(store, null, null, false, gateway);
    service.createRun({
      onboardingId, workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation',
      requestedServices: ['wsfex'], actorId: 'user:owner', idempotencyKey: 'create-onboarding', occurredAt: now,
    });
    advanceToApiVerificationStep(service, 2);
    await expect(service.verifyWsfexApi({
      onboardingId, issuerProfileRef: 'vault://issuer/profile-1', actorId: 'system:arca-authority',
      idempotencyKey: 'official-api-verification', occurredAt: now,
    })).rejects.toThrow('ARCA_POINT_OF_SALE_AUTHORITY_BINDING_MISMATCH');
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
    kind: 'record_api_verification', verifiedServices: { wsfex: true, wsfe: true }, activeExportPointOfSale: 4, activeDomesticPointOfSale: 1,
    observedAt: now, wsfexReceiptHash: hash('wsfex'), wsfeReceiptHash: hash('wsfe'), idempotencyKey: 'api-verification',
  });
}

function advanceToApiVerificationStep(service: ArcaOnboardingService, pointOfSale = 4): ArcaOnboardingRunV1 {
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
  apply({ kind: 'record_point_of_sale_discovery', exportPointOfSale: pointOfSale, evidenceHash: hash('pos'), idempotencyKey: 'pos-discovery' });
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
  readbackCalls = 0;
  constructor(
    private readonly activePoints: readonly number[],
    private readonly representedCuitCommitment = hash('represented-cuit'),
    private readonly readbackCommitment = representedCuitCommitment,
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
  async verifyPointOfSaleReadback(input: Readonly<{ workspaceId: string; issuerProfileRef: string; pointOfSale: 2 }>) {
    this.readbackCalls++;
    const receipt = {
      version: 'arca-wsfex-point-of-sale-readback-v1' as const,
      environment: 'homologation' as const,
      workspaceId: input.workspaceId,
      issuerProfileReferenceHash: hash(input.issuerProfileRef),
      representedCuitCommitment: this.readbackCommitment,
      pointOfSale: 2 as const,
      documentType: 19 as const,
      invoiceNumber: '1' as const,
      caeHash: hash('sandbox-cae'),
      discoveryResponseHash: hash('empty-list'),
      authorityResponseHash: hash('official-readback'),
      observedAt: now,
    };
    return { ...receipt, evidenceHash: hashCanonical(receipt) };
  }
}

class FakeWsfePointOfSaleGateway implements WsfePointOfSaleGateway {
  readbackCalls = 0;
  constructor(private readonly activePoints: readonly number[], private readonly representedCuitCommitment = hash('represented-cuit')) {}
  async discoverPointsOfSale(input: Readonly<{ workspaceId: string; issuerProfileRef: string }>) {
    const material = {
      version: 'arca-wsfe-point-of-sale-discovery-v1' as const, environment: 'homologation' as const,
      workspaceId: input.workspaceId, issuerProfileReferenceHash: hash(input.issuerProfileRef), representedCuitCommitment: this.representedCuitCommitment,
      activePoints: [...this.activePoints], listedCount: this.activePoints.length, authorityResponseHash: hash('wsfe-discovery'), observedAt: now,
    };
    return { ...material, evidenceHash: hashCanonical(material) };
  }
  async verifyPointOfSaleReadback(input: Readonly<{ workspaceId: string; issuerProfileRef: string; pointOfSale: 1 }>) {
    this.readbackCalls++;
    const material = {
      version: 'arca-wsfe-point-of-sale-readback-v1' as const, environment: 'homologation' as const,
      workspaceId: input.workspaceId, issuerProfileReferenceHash: hash(input.issuerProfileRef), representedCuitCommitment: this.representedCuitCommitment,
      pointOfSale: 1 as const, documentType: 11 as const, invoiceNumber: '1' as const,
      caeHash: hash('wsfe-cae'), discoveryResponseHash: hash('wsfe-discovery'), authorityResponseHash: hash('wsfe-readback'), observedAt: now,
    };
    return { ...material, evidenceHash: hashCanonical(material) };
  }
}
