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

import type { ArcaOnboardingReclaimGateway, ArcaOnboardingReclaimRequest } from './arca-onboarding-reclaim';
import type { ReclaimProofVault } from './proof-vault';
import type { TaxProfileStore } from './store';

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
  ) {}

  capabilities(): Readonly<Record<string, unknown>> {
    return {
      version: 'arca-onboarding-capabilities-v1',
      deterministicSteps: [
        'login_handoff',
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

  async startReclaim(input: Readonly<{
    onboardingId: string;
    actorId: string;
    idempotencyKey: string;
    occurredAt: string;
  }>): Promise<ArcaOnboardingMutationResult<ArcaOnboardingReclaimRequest>> {
    if (!this.reclaim) throw new Error('RECLAIM_ARCA_ONBOARDING_CONFIGURATION_REQUIRED');
    const replay = this.store.getArcaOnboardingRunByIdempotency(input.onboardingId, input.idempotencyKey);
    if (replay) {
      const replayEvent = this.store.getArcaOnboardingEventByIdempotency(input.onboardingId, input.idempotencyKey);
      const sessionId = replayEvent?.safeMetadata.sessionId;
      const session = typeof sessionId === 'string' && replay.reclaimSession?.sessionId === sessionId ? replay.reclaimSession : null;
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
