import {
  applyArcaOnboardingCommand,
  arcaOnboardingNextActions,
  createArcaOnboardingRun,
  hashCanonical,
  type ArcaOnboardingCommand,
  type ArcaOnboardingEnvironment,
  type ArcaOnboardingEventV1,
  type ArcaOnboardingRunV1,
  type ArcaWebService,
} from '@tax-engine/core';
import { pointOfSaleReadbackSchema } from '@tax-engine/wsfex-signer/contracts';
import { pointOfSaleReadbackSchema as wsfePointOfSaleReadbackSchema } from '@tax-engine/wsfe-signer/contracts';

import type { ArcaOnboardingReclaimGateway, ArcaOnboardingReclaimRequest } from './arca-onboarding-reclaim';
import type { HttpArcaBoundaryStatusReader } from './arca-connection-projection';
import type { ReclaimProofVault } from './proof-vault';
import type { TaxProfileStore } from './store';
import type { WsfexPointOfSaleGateway } from './wsfex';
import type { WsfePointOfSaleGateway } from './wsfe';

export type ArcaOnboardingMutationResult<T = undefined> = Readonly<{
  run: ArcaOnboardingRunV1;
  replayed: boolean;
  output: T;
  nextActions: readonly string[];
}>;

export type ManualArcaOnboardingCommand = Exclude<ArcaOnboardingCommand,
  Readonly<{ kind: 'start_zk_evidence' }> | Readonly<{ kind: 'record_zk_evidence' }>>;

export class ArcaOnboardingService {
  constructor(
    private readonly store: TaxProfileStore,
    private readonly reclaim: ArcaOnboardingReclaimGateway | null,
    private readonly proofVault: ReclaimProofVault | null,
    private readonly proofCustodyRequired: boolean,
    private readonly wsfexPointOfSale: WsfexPointOfSaleGateway | null = null,
    private readonly wsfePointOfSale: WsfePointOfSaleGateway | null = null,
  ) {}

  capabilities(): Readonly<Record<string, unknown>> {
    return {
      version: 'arca-onboarding-capabilities-v1',
      deterministicSteps: [
        'login_handoff',
        'human_auth',
        'service_adherence',
        'point_of_sale_discovery',
        'point_of_sale_creation',
        'ws_delegation',
        'api_verification',
        'zk_evidence',
        'ready',
      ],
      reclaimWitness: this.reclaim ? 'available' : 'configuration_required',
      reclaimProofCustody: this.proofVault
        ? 'available'
        : this.proofCustodyRequired ? 'configuration_required' : 'not_required',
      pointOfSaleAuthorityDiscovery: this.wsfexPointOfSale
        ? 'available'
        : 'configuration_required',
      domesticPointOfSaleAuthorityDiscovery: this.wsfePointOfSale ? 'available' : 'configuration_required',
      invariants: [
        'credentials_and_browser_cookies_are_never_collected',
        'user_confirms_account_and_permission_changes_at_action_time',
        'reclaim_proves_outcomes_but_does_not_create_arca_permissions',
        'ready_requires_authoritative_wsfex_wsfe_verification_and_zk_evidence',
      ],
    };
  }

  createRun(input: Readonly<{
    onboardingId: string;
    workspaceId: string;
    taxpayerReferenceHash: string;
    environment: ArcaOnboardingEnvironment;
    requestedServices: readonly ArcaWebService[];
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): ArcaOnboardingMutationResult {
    const replay = this.store.getArcaOnboardingRunByIdempotency(input.onboardingId, input.idempotencyKey);
    if (replay) return result(replay, true, undefined);
    if (this.store.getArcaOnboardingRun(input.onboardingId)) throw new Error('ARCA_ONBOARDING_ALREADY_EXISTS');
    const created = createArcaOnboardingRun(input);
    return result(this.persist(created.run, created.event, input.occurredAt), false, undefined);
  }

  getRun(onboardingId: string): ArcaOnboardingRunV1 {
    const run = this.store.getArcaOnboardingRun(onboardingId);
    if (!run) throw new Error('ARCA_ONBOARDING_NOT_FOUND');
    return run;
  }

  listRuns(workspaceId: string): readonly ArcaOnboardingRunV1[] {
    return this.store.listArcaOnboardingRuns(workspaceId);
  }

  listEvents(onboardingId: string): readonly ArcaOnboardingEventV1[] {
    return this.store.listArcaOnboardingEvents(onboardingId);
  }

  nextActions(run: ArcaOnboardingRunV1): readonly string[] {
    return arcaOnboardingNextActions(run);
  }

  applyManualCommand(input: Readonly<{
    onboardingId: string;
    command: ManualArcaOnboardingCommand;
    actorId: string;
    occurredAt: string;
  }>): ArcaOnboardingMutationResult {
    const replay = this.store.getArcaOnboardingRunByIdempotency(input.onboardingId, input.command.idempotencyKey);
    if (replay) return result(replay, true, undefined);
    const current = this.getRun(input.onboardingId);
    const applied = applyArcaOnboardingCommand(current, input.command, input.actorId, input.occurredAt);
    if (!applied.event) return result(applied.run, true, undefined);
    return result(this.persist(applied.run, applied.event, input.occurredAt), false, undefined);
  }

  /** Import an already configured issuer only after live certificate and official point checks. */
  async importExistingIssuer(input: Readonly<{
    onboardingId: string;
    issuerProfileRef: string;
    exportPointOfSale: number | null;
    domesticPointOfSale: number | null;
    confirmedExistingSetup: true;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
    boundaryReader: HttpArcaBoundaryStatusReader | null;
  }>): Promise<ArcaOnboardingMutationResult> {
    const current = this.getRun(input.onboardingId);
    if (current.environment !== 'homologation' || !input.boundaryReader)
      throw new Error('ARCA_EXISTING_ISSUER_HOMOLOGATION_CONFIGURATION_REQUIRED');
    const boundary = await input.boundaryReader.read(current.workspaceId, input.issuerProfileRef);
    if (boundary.workspaceId !== current.workspaceId || boundary.issuerProfileRef !== input.issuerProfileRef
      || boundary.environment !== 'homologation' || !boundary.configured || !boundary.active
      || !boundary.delegationConfirmed || !boundary.certificate.current
      || !boundary.certificateFingerprint || !boundary.representedCuitCommitment
      || boundary.taxpayerReferenceHash !== current.taxpayerReferenceHash
      || !boundary.certificate.validFrom || !boundary.certificate.validUntil
      || Date.parse(boundary.certificate.validFrom) > Date.parse(input.occurredAt)
      || Date.parse(boundary.certificate.validUntil) <= Date.parse(input.occurredAt) + 60_000)
      throw new Error('ARCA_EXISTING_ISSUER_CERTIFICATE_NOT_VERIFIED');
    const alreadyImported = current.processedCommandKeys.includes(input.idempotencyKey);
    if (alreadyImported && (
      current.authorityBinding?.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
      || current.authorityBinding.representedCuitCommitment !== boundary.representedCuitCommitment
      || current.steps.find(step => step.step === 'ws_delegation')?.evidenceHashes[1]
        !== hashCanonical(boundary.certificateFingerprint)
      || current.pointOfSale.number !== (current.requestedServices.includes('wsfex')
        ? input.exportPointOfSale : input.domesticPointOfSale)
      || current.domesticPointOfSale?.number !== input.domesticPointOfSale
    )) throw new Error('ARCA_EXISTING_ISSUER_RETRY_MISMATCH');
    if (!alreadyImported) {
      this.applyManualCommand({
        onboardingId: input.onboardingId, actorId: input.actorId, occurredAt: input.occurredAt,
        command: {
          kind: 'record_existing_issuer_setup', confirmedExistingSetup: input.confirmedExistingSetup,
          taxpayerReferenceHash: boundary.taxpayerReferenceHash,
          issuerProfileReferenceHash: hashCanonical(input.issuerProfileRef),
          representedCuitCommitment: boundary.representedCuitCommitment,
          boundaryReceiptHash: hashCanonical(boundary),
          certificateFingerprintHash: hashCanonical(boundary.certificateFingerprint),
          exportPointOfSale: input.exportPointOfSale,
          domesticPointOfSale: input.domesticPointOfSale,
          idempotencyKey: input.idempotencyKey,
        },
      });
    }
    let verifiedNow = false;
    let run = this.getRun(input.onboardingId);
    if (run.currentStep === 'api_verification' && run.requestedServices.includes('wsfex')
      && !run.apiVerification.wsfex) {
      await this.verifyWsfexApi({ onboardingId: input.onboardingId,
        issuerProfileRef: input.issuerProfileRef, actorId: input.actorId,
        idempotencyKey: `${input.idempotencyKey}:wsfex`, occurredAt: input.occurredAt });
      verifiedNow = true;
      run = this.getRun(input.onboardingId);
    }
    if (run.currentStep === 'api_verification' && run.requestedServices.includes('wsfe')
      && !run.apiVerification.wsfe) {
      await this.verifyWsfeApi({ onboardingId: input.onboardingId,
        issuerProfileRef: input.issuerProfileRef,
        ...(input.domesticPointOfSale === null ? {} : { pointOfSale: input.domesticPointOfSale }),
        actorId: input.actorId, idempotencyKey: `${input.idempotencyKey}:wsfe`,
        occurredAt: input.occurredAt });
      verifiedNow = true;
      run = this.getRun(input.onboardingId);
    }
    if (!run.requestedServices.every(service => run.apiVerification[service]))
      throw new Error('ARCA_EXISTING_ISSUER_API_VERIFICATION_INCOMPLETE');
    return result(run, alreadyImported && !verifiedNow, undefined);
  }

  async verifyWsfexApi(input: Readonly<{
    onboardingId: string;
    issuerProfileRef: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<ArcaOnboardingMutationResult<Readonly<{
    state: 'recorded' | 'wsfe_verification_required';
    activePoints: readonly number[];
    evidenceHash: string;
    verificationSource: 'point_of_sale_discovery' | 'accepted_voucher_readback';
  }> | null>> {
    if (!this.wsfexPointOfSale) throw new Error('ARCA_POINT_OF_SALE_DISCOVERY_CONFIGURATION_REQUIRED');
    const replay = this.store.getArcaOnboardingRunByIdempotency(input.onboardingId, input.idempotencyKey);
    if (replay) return result(replay, true, null);
    const current = this.getRun(input.onboardingId);
    if (current.currentStep !== 'api_verification') {
      throw new Error('ARCA_ONBOARDING_STEP_OUT_OF_ORDER');
    }
    if (!current.requestedServices.includes('wsfex')) {
      throw new Error('ARCA_WSFEX_NOT_REQUESTED');
    }
    const receipt = await this.wsfexPointOfSale.discoverPointsOfSale({
      workspaceId: current.workspaceId,
      issuerProfileRef: input.issuerProfileRef,
    });
    if (receipt.environment !== current.environment) {
      throw new Error('ARCA_POINT_OF_SALE_ENVIRONMENT_MISMATCH');
    }
    if (
      receipt.issuerProfileReferenceHash !== current.authorityBinding?.issuerProfileReferenceHash
      || receipt.representedCuitCommitment !== current.authorityBinding?.representedCuitCommitment
    ) {
      throw new Error('ARCA_POINT_OF_SALE_AUTHORITY_BINDING_MISMATCH');
    }
    const selected = current.pointOfSale.number;
    if (selected === null || !current.pointOfSale.active) {
      throw new Error('ARCA_POINT_OF_SALE_REQUIRED');
    }
    let evidenceHash = receipt.evidenceHash;
    let observedAt = receipt.observedAt;
    let verificationSource: 'point_of_sale_discovery' | 'accepted_voucher_readback' = 'point_of_sale_discovery';
    if (!receipt.activePoints.includes(selected)) {
      if (current.environment !== 'homologation' || receipt.activePoints.length !== 0 || selected !== 2)
        throw new Error('ARCA_POINT_OF_SALE_NOT_ACTIVE');
      const readback = pointOfSaleReadbackSchema.parse(await this.wsfexPointOfSale.verifyPointOfSaleReadback({
        workspaceId: current.workspaceId, issuerProfileRef: input.issuerProfileRef, pointOfSale: selected,
      }));
      if (readback.workspaceId !== current.workspaceId
        || readback.issuerProfileReferenceHash !== current.authorityBinding?.issuerProfileReferenceHash
        || readback.representedCuitCommitment !== current.authorityBinding?.representedCuitCommitment
        || readback.pointOfSale !== selected)
        throw new Error('ARCA_POINT_OF_SALE_AUTHORITY_BINDING_MISMATCH');
      evidenceHash = readback.evidenceHash;
      observedAt = readback.observedAt;
      verificationSource = 'accepted_voucher_readback';
    }
    const applied = this.applyManualCommand({
      onboardingId: current.onboardingId,
      actorId: input.actorId,
      occurredAt: input.occurredAt,
      command: {
        kind: 'record_service_api_verification',
        service: 'wsfex',
        activePointOfSale: selected,
        observedAt,
        receiptHash: evidenceHash,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return {
      ...applied,
      output: {
        state: applied.run.currentStep === 'api_verification' ? 'wsfe_verification_required' : 'recorded',
        activePoints: receipt.activePoints,
        evidenceHash,
        verificationSource,
      },
    };
  }

  async verifyWsfeApi(input: Readonly<{
    onboardingId: string;
    issuerProfileRef: string;
    pointOfSale?: number;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<ArcaOnboardingMutationResult<Readonly<{
    state: 'recorded' | 'wsfex_verification_required';
    activePoints: readonly number[];
    evidenceHash: string;
    verificationSource: 'point_of_sale_discovery' | 'accepted_voucher_readback';
  }> | null>> {
    if (!this.wsfePointOfSale) throw new Error('ARCA_WSFE_POINT_OF_SALE_DISCOVERY_CONFIGURATION_REQUIRED');
    const replay = this.store.getArcaOnboardingRunByIdempotency(input.onboardingId, input.idempotencyKey);
    if (replay) return result(replay, true, null);
    const current = this.getRun(input.onboardingId);
    if (current.currentStep !== 'api_verification') throw new Error('ARCA_ONBOARDING_STEP_OUT_OF_ORDER');
    if (!current.requestedServices.includes('wsfe')) throw new Error('ARCA_WSFE_NOT_REQUESTED');
    const selected = input.pointOfSale ?? 1;
    if (!Number.isInteger(selected) || selected < 1 || selected > 99998) throw new Error('ARCA_WSFE_POINT_OF_SALE_INVALID');
    const receipt = await this.wsfePointOfSale.discoverPointsOfSale({
      workspaceId: current.workspaceId, issuerProfileRef: input.issuerProfileRef,
    });
    if (receipt.environment !== current.environment) throw new Error('ARCA_WSFE_POINT_OF_SALE_ENVIRONMENT_MISMATCH');
    if (receipt.issuerProfileReferenceHash !== current.authorityBinding?.issuerProfileReferenceHash
      || receipt.representedCuitCommitment !== current.authorityBinding?.representedCuitCommitment)
      throw new Error('ARCA_WSFE_POINT_OF_SALE_AUTHORITY_BINDING_MISMATCH');
    if (!current.pointOfSale.active || current.pointOfSale.number === null) throw new Error('ARCA_POINT_OF_SALE_REQUIRED');
    if (!current.requestedServices.includes('wsfex') && current.pointOfSale.number !== selected)
      throw new Error('ARCA_WSFE_POINT_OF_SALE_MISMATCH');
    let evidenceHash = receipt.evidenceHash;
    let observedAt = receipt.observedAt;
    let verificationSource: 'point_of_sale_discovery' | 'accepted_voucher_readback' = 'point_of_sale_discovery';
    if (!receipt.activePoints.includes(selected)) {
      if (current.environment !== 'homologation' || selected !== 1 || receipt.listedCount !== 0 || receipt.activePoints.length !== 0)
        throw new Error('ARCA_WSFE_POINT_OF_SALE_NOT_ACTIVE');
      const readback = wsfePointOfSaleReadbackSchema.parse(await this.wsfePointOfSale.verifyPointOfSaleReadback({
        workspaceId: current.workspaceId, issuerProfileRef: input.issuerProfileRef, pointOfSale: 1,
      }));
      if (readback.workspaceId !== current.workspaceId
        || readback.issuerProfileReferenceHash !== current.authorityBinding?.issuerProfileReferenceHash
        || readback.representedCuitCommitment !== current.authorityBinding?.representedCuitCommitment
        || readback.pointOfSale !== selected) throw new Error('ARCA_WSFE_POINT_OF_SALE_AUTHORITY_BINDING_MISMATCH');
      evidenceHash = readback.evidenceHash;
      observedAt = readback.observedAt;
      verificationSource = 'accepted_voucher_readback';
    }
    const applied = this.applyManualCommand({
      onboardingId: current.onboardingId, actorId: input.actorId, occurredAt: input.occurredAt,
      command: {
        kind: 'record_service_api_verification',
        service: 'wsfe',
        activePointOfSale: selected,
        observedAt,
        receiptHash: evidenceHash,
        idempotencyKey: input.idempotencyKey,
      },
    });
    return { ...applied, output: { state: applied.run.currentStep === 'api_verification' ? 'wsfex_verification_required' : 'recorded', activePoints: receipt.activePoints, evidenceHash, verificationSource } };
  }

  async startReclaim(input: Readonly<{
    onboardingId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<ArcaOnboardingMutationResult<ArcaOnboardingReclaimRequest>> {
    if (!this.reclaim) throw new Error('RECLAIM_ARCA_ONBOARDING_CONFIGURATION_REQUIRED');
    const replay = this.store.getArcaOnboardingRunByIdempotency(input.onboardingId, input.idempotencyKey);
    if (replay) {
      const session = replay.reclaimSession?.state === 'pending' ? replay.reclaimSession : null;
      if (!session) throw new Error('RECLAIM_REPLAY_SESSION_MISSING');
      const artifact = this.store.getReclaimRequestArtifact(session.sessionId);
      if (!artifact) throw new Error('RECLAIM_REPLAY_ARTIFACT_MISSING');
      return result(replay, true, { session, ...artifact });
    }

    const current = this.getRun(input.onboardingId);
    const request = await this.reclaim.createRequest(current, input.occurredAt);
    const applied = applyArcaOnboardingCommand(current, {
      kind: 'start_zk_evidence',
      session: request.session,
      idempotencyKey: input.idempotencyKey,
    }, input.actorId, input.occurredAt);
    if (!applied.event) throw new Error('RECLAIM_SESSION_EVENT_REQUIRED');
    const run = this.persist(applied.run, applied.event, input.occurredAt);
    this.store.bindArcaOnboardingReclaimSession(run.onboardingId, request.session, input.occurredAt);
    this.store.saveReclaimRequestArtifact({
      sessionId: request.session.sessionId,
      requestUrl: request.requestUrl,
      requestConfig: request.requestConfig,
      statusUrl: request.statusUrl,
      storedAt: input.occurredAt,
    });
    return result(run, false, request);
  }

  async ingestReclaimCallback(sessionId: string, proofPayload: unknown, occurredAt: string): Promise<ArcaOnboardingMutationResult> {
    if (!this.reclaim) throw new Error('RECLAIM_ARCA_ONBOARDING_CONFIGURATION_REQUIRED');
    const onboardingId = this.store.getArcaOnboardingIdForReclaimSession(sessionId);
    if (!onboardingId) throw new Error('RECLAIM_SESSION_NOT_FOUND');
    const current = this.getRun(onboardingId);
    const session = current.reclaimSession;
    if (!session || session.sessionId !== sessionId) throw new Error('RECLAIM_SESSION_NOT_FOUND');
    const proof = await this.reclaim.verifyCallback(current, session, proofPayload, occurredAt);
    const idempotencyKey = `reclaim-onboarding-proof:${proof.proofHash}`;
    const replay = this.store.getArcaOnboardingRunByIdempotency(onboardingId, idempotencyKey);
    if (replay) return result(replay, true, undefined);

    if (this.proofCustodyRequired && (!this.proofVault || !this.proofVault.storeVerifiedArcaOnboardingProof)) {
      throw new Error('RECLAIM_PROOF_VAULT_CONFIGURATION_REQUIRED');
    }
    const custodyReceipt = this.proofVault?.storeVerifiedArcaOnboardingProof
      ? await this.proofVault.storeVerifiedArcaOnboardingProof({ run: current, session, proof, proofPayload })
      : null;
    const applied = applyArcaOnboardingCommand(current, {
      kind: 'record_zk_evidence',
      sessionId: proof.sessionId,
      providerId: proof.providerId,
      providerVersion: proof.providerVersion,
      proofHash: proof.proofHash,
      claimsHash: proof.claimsHash,
      verifiedAt: proof.verifiedAt,
      teeVerified: proof.teeVerified,
      custodyReceipt,
      idempotencyKey,
    }, 'reclaim:verified-callback', occurredAt);
    if (!applied.event) return result(applied.run, true, undefined);
    return result(this.persist(applied.run, applied.event, occurredAt), false, undefined);
  }

  private persist(run: ArcaOnboardingRunV1, event: ArcaOnboardingEventV1, appendedAt: string): ArcaOnboardingRunV1 {
    return this.store.appendArcaOnboardingRevision({ run, event, stateHash: hashCanonical(run), appendedAt });
  }
}

function result<T>(run: ArcaOnboardingRunV1, replayed: boolean, output: T): ArcaOnboardingMutationResult<T> {
  return { run, replayed, output, nextActions: arcaOnboardingNextActions(run) };
}
