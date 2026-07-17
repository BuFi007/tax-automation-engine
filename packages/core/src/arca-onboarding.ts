import { createHash, randomUUID } from 'node:crypto';

import type { IsoDateTime } from './types';
import type { ReclaimProofCustodyReceiptV1 } from './factura-e-agent';
import {
  HUMAN_AUTH_CAPTURE_POLICY,
  HUMAN_AUTH_CAPTURE_POLICY_HASH,
  assertHumanAuthCompletion,
  type HumanAuthCapturePolicyV1,
  type HumanAuthCompletionV1,
} from './human-auth';

export const ARCA_ONBOARDING_STEPS = [
  'login_handoff',
  'human_auth',
  'service_adherence',
  'point_of_sale_discovery',
  'point_of_sale_creation',
  'ws_delegation',
  'api_verification',
  'zk_evidence',
  'ready',
] as const;

export type ArcaOnboardingStep = (typeof ARCA_ONBOARDING_STEPS)[number];
export type ArcaWebService = 'wsfex' | 'wsfe';
export type ArcaOnboardingEnvironment = 'homologation' | 'production';
export type ArcaOnboardingStepState = 'pending' | 'action_required' | 'completed' | 'skipped' | 'failed';

export type ArcaOnboardingStepRecordV1 = Readonly<{
  step: ArcaOnboardingStep;
  state: ArcaOnboardingStepState;
  requiresUserAction: boolean;
  requiresExplicitConfirmation: boolean;
  completedAt: IsoDateTime | null;
  evidenceHashes: readonly string[];
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ArcaOnboardingEventV1 = Readonly<{
  version: 'arca-onboarding-event-v1';
  eventId: string;
  onboardingId: string;
  workspaceId: string;
  actorId: string;
  action: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ArcaOnboardingRunV1 = Readonly<{
  version: 'arca-onboarding-run-v1';
  onboardingId: string;
  workspaceId: string;
  taxpayerReferenceHash: string;
  environment: ArcaOnboardingEnvironment;
  requestedServices: readonly ArcaWebService[];
  revision: number;
  status: 'active' | 'ready' | 'failed';
  currentStep: ArcaOnboardingStep;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  steps: readonly ArcaOnboardingStepRecordV1[];
  pointOfSale: Readonly<{
    number: number | null;
    source: 'discovered' | 'created' | null;
    active: boolean;
    candidates?: readonly number[];
  }>;
  delegation: Readonly<Record<ArcaWebService, boolean>>;
  authorityBinding?: Readonly<{
    issuerProfileReferenceHash: string | null;
    representedCuitCommitment: string | null;
  }>;
  apiVerification: Readonly<{
    wsfex: boolean;
    wsfe: boolean;
    observedAt: IsoDateTime | null;
  }>;
  reclaimSession: ArcaOnboardingReclaimSessionV1 | null;
  humanAuth: Readonly<{
    capturePolicy: HumanAuthCapturePolicyV1;
    capturePolicyHash: string;
    startedAt: IsoDateTime | null;
    expiresAt: IsoDateTime | null;
    completionReceiptHash: string | null;
    completedAt: IsoDateTime | null;
  }>;
  zkEvidence: Readonly<{
    sessionId: string;
    providerId: string;
    providerVersion: string;
    proofHash: string;
    claimsHash: string;
    verifiedAt: IsoDateTime;
    teeVerified: boolean;
    custodyReceipt: ReclaimProofCustodyReceiptV1 | null;
  }> | null;
  processedCommandKeys: readonly string[];
  eventIds: readonly string[];
}>;

export type ArcaOnboardingReclaimSessionV1 = Readonly<{
  sessionId: string;
  providerId: string;
  providerVersion: string;
  contextHash: string;
  requestedAt: IsoDateTime;
  expiresAt: IsoDateTime;
  state: 'pending' | 'verified' | 'failed' | 'expired' | 'cancelled';
}>;

export type ArcaOnboardingCommand =
  | Readonly<{
      kind: 'complete_login_handoff';
      browserSessionReferenceHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_human_auth_completion';
      completion: HumanAuthCompletionV1;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_service_adherence';
      pointOfSaleAdministrationActive: true;
      relationshipManagerActive: true;
      evidenceHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_point_of_sale_discovery';
      exportPointOfSale: number | null;
      activeExportPoints?: readonly number[];
      evidenceHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'select_discovered_point_of_sale';
      exportPointOfSale: number;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_point_of_sale_creation';
      exportPointOfSale: number;
      evidenceHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_ws_delegation';
      delegatedServices: Readonly<Record<ArcaWebService, boolean>>;
      issuerProfileReferenceHash: string;
      representedCuitCommitment: string;
      evidenceHash: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_api_verification';
      verifiedServices: Readonly<Record<ArcaWebService, boolean>>;
      activeExportPointOfSale: number;
      observedAt: IsoDateTime;
      wsfexReceiptHash: string | null;
      wsfeReceiptHash: string | null;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'start_zk_evidence';
      session: ArcaOnboardingReclaimSessionV1;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_zk_evidence';
      sessionId: string;
      providerId: string;
      providerVersion: string;
      proofHash: string;
      claimsHash: string;
      verifiedAt: IsoDateTime;
      teeVerified: boolean;
      custodyReceipt: ReclaimProofCustodyReceiptV1 | null;
      idempotencyKey: string;
    }>;

export function createArcaOnboardingRun(input: Readonly<{
  onboardingId?: string;
  workspaceId: string;
  taxpayerReferenceHash: string;
  environment: ArcaOnboardingEnvironment;
  requestedServices?: readonly ArcaWebService[];
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ run: ArcaOnboardingRunV1; event: ArcaOnboardingEventV1 }> {
  assertNoSensitiveMaterial(input);
  assertHash(input.taxpayerReferenceHash, 'TAXPAYER_REFERENCE_HASH_INVALID');
  const onboardingId = input.onboardingId ?? randomUUID();
  const requestedServices = uniqueServices(input.requestedServices ?? ['wsfex', 'wsfe']);
  if (requestedServices.length === 0) throw new Error('ARCA_SERVICE_REQUIRED');
  const event = eventFor(onboardingId, input.workspaceId, input.actorId, 'arca_onboarding_created', input.occurredAt, input.idempotencyKey, {
    environment: input.environment,
    requestedServiceCount: requestedServices.length,
  });

  return {
    run: {
      version: 'arca-onboarding-run-v1',
      onboardingId,
      workspaceId: input.workspaceId,
      taxpayerReferenceHash: input.taxpayerReferenceHash,
      environment: input.environment,
      requestedServices,
      revision: 1,
      status: 'active',
      currentStep: 'login_handoff',
      createdAt: input.occurredAt,
      updatedAt: input.occurredAt,
      steps: ARCA_ONBOARDING_STEPS.map(step => initialStep(step)),
      pointOfSale: { number: null, source: null, active: false },
      delegation: { wsfex: false, wsfe: false },
      authorityBinding: {
        issuerProfileReferenceHash: null,
        representedCuitCommitment: null,
      },
      apiVerification: { wsfex: false, wsfe: false, observedAt: null },
      reclaimSession: null,
      humanAuth: {
        capturePolicy: HUMAN_AUTH_CAPTURE_POLICY,
        capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH,
        startedAt: null,
        expiresAt: null,
        completionReceiptHash: null,
        completedAt: null,
      },
      zkEvidence: null,
      processedCommandKeys: [input.idempotencyKey],
      eventIds: [event.eventId],
    },
    event,
  };
}

export function applyArcaOnboardingCommand(
  run: ArcaOnboardingRunV1,
  command: ArcaOnboardingCommand,
  actorId: string,
  occurredAt: IsoDateTime,
): Readonly<{ run: ArcaOnboardingRunV1; event: ArcaOnboardingEventV1 | null }> {
  assertNoSensitiveMaterial(command);
  if (run.processedCommandKeys.includes(command.idempotencyKey)) return { run, event: null };
  if (run.status !== 'active') throw new Error('ARCA_ONBOARDING_NOT_ACTIVE');

  let next = run;
  let safeMetadata: Readonly<Record<string, string | number | boolean | null>> = {};

  switch (command.kind) {
    case 'complete_login_handoff':
      requireCurrentStep(run, 'login_handoff');
      assertHash(command.browserSessionReferenceHash, 'BROWSER_SESSION_REFERENCE_HASH_INVALID');
      next = completeStep(run, 'login_handoff', occurredAt, [command.browserSessionReferenceHash], {});
      next = {
        ...next,
        humanAuth: {
          ...run.humanAuth,
          startedAt: occurredAt,
          expiresAt: new Date(Date.parse(occurredAt) + 10 * 60 * 1000).toISOString(),
        },
      };
      safeMetadata = { handoffRecorded: true };
      break;
    case 'record_human_auth_completion':
      requireCurrentStep(run, 'human_auth');
      assertHumanAuthCompletion(command.completion);
      if (!run.humanAuth.startedAt || !run.humanAuth.expiresAt) throw new Error('HUMAN_AUTH_HANDOFF_REQUIRED');
      if (Date.parse(occurredAt) > Date.parse(run.humanAuth.expiresAt)) throw new Error('HUMAN_AUTH_HANDOFF_EXPIRED');
      if (Date.parse(command.completion.completedAt) < Date.parse(run.humanAuth.startedAt)) {
        throw new Error('HUMAN_AUTH_COMPLETION_BEFORE_HANDOFF');
      }
      if (Date.parse(command.completion.completedAt) > Date.parse(occurredAt)) {
        throw new Error('HUMAN_AUTH_COMPLETION_IN_FUTURE');
      }
      next = completeStep(run, 'human_auth', occurredAt, [command.completion.completionReceiptHash], {
        capturePolicyEnforced: true,
        signedCompletionRecorded: true,
      });
      next = {
        ...next,
        humanAuth: {
          ...run.humanAuth,
          completionReceiptHash: command.completion.completionReceiptHash,
          completedAt: command.completion.completedAt,
        },
      };
      safeMetadata = { capturePolicyEnforced: true, signedCompletionRecorded: true };
      break;
    case 'record_service_adherence':
      requireCurrentStep(run, 'service_adherence');
      assertHash(command.evidenceHash, 'SERVICE_ADHERENCE_EVIDENCE_HASH_INVALID');
      next = completeStep(run, 'service_adherence', occurredAt, [command.evidenceHash], {
        pointOfSaleAdministrationActive: true,
        relationshipManagerActive: true,
      });
      safeMetadata = { serviceAdherenceVerified: true };
      break;
    case 'record_point_of_sale_discovery': {
      requireCurrentStep(run, 'point_of_sale_discovery');
      assertHash(command.evidenceHash, 'POINT_OF_SALE_DISCOVERY_EVIDENCE_HASH_INVALID');
      assertPointOfSale(command.exportPointOfSale, true);
      const candidates = uniquePoints(command.activeExportPoints
        ?? (command.exportPointOfSale === null ? [] : [command.exportPointOfSale]));
      if (command.exportPointOfSale !== null && !candidates.includes(command.exportPointOfSale)) {
        throw new Error('ARCA_POINT_OF_SALE_DISCOVERY_SELECTION_INVALID');
      }
      if (candidates.length > 1) {
        next = {
          ...run,
          pointOfSale: { number: null, source: null, active: false, candidates },
          steps: updateStep(run.steps, 'point_of_sale_discovery', {
            state: 'action_required',
            evidenceHashes: [command.evidenceHash],
            safeMetadata: { activeExportPointCount: candidates.length },
          }),
        };
        safeMetadata = { existingExportPointOfSaleFound: true, activeExportPointCount: candidates.length };
        break;
      }
      next = completeStep(run, 'point_of_sale_discovery', occurredAt, [command.evidenceHash], {
        existingExportPointOfSaleFound: command.exportPointOfSale !== null,
      });
      if (command.exportPointOfSale !== null) {
        next = {
          ...next,
          pointOfSale: { number: command.exportPointOfSale, source: 'discovered', active: true },
          steps: updateStep(next.steps, 'point_of_sale_creation', {
            state: 'skipped',
            completedAt: occurredAt,
            safeMetadata: { reason: 'active_export_point_of_sale_discovered' },
          }),
        };
        next = activateStep(next, 'ws_delegation');
      }
      safeMetadata = { existingExportPointOfSaleFound: command.exportPointOfSale !== null };
      break;
    }
    case 'select_discovered_point_of_sale': {
      requireCurrentStep(run, 'point_of_sale_discovery');
      assertPointOfSale(command.exportPointOfSale, false);
      const candidates = run.pointOfSale.candidates ?? [];
      if (candidates.length < 2 || !candidates.includes(command.exportPointOfSale)) {
        throw new Error('ARCA_POINT_OF_SALE_SELECTION_INVALID');
      }
      const discoveryEvidence = run.steps.find(step => step.step === 'point_of_sale_discovery')?.evidenceHashes ?? [];
      next = completeStep(run, 'point_of_sale_discovery', occurredAt, discoveryEvidence, {
        existingExportPointOfSaleFound: true,
        activeExportPointCount: candidates.length,
        selectedExportPointOfSale: command.exportPointOfSale,
      });
      next = {
        ...next,
        pointOfSale: { number: command.exportPointOfSale, source: 'discovered', active: true, candidates },
        steps: updateStep(next.steps, 'point_of_sale_creation', {
          state: 'skipped',
          completedAt: occurredAt,
          safeMetadata: { reason: 'active_export_point_of_sale_selected' },
        }),
      };
      next = activateStep(next, 'ws_delegation');
      safeMetadata = { selectedExportPointOfSale: command.exportPointOfSale };
      break;
    }
    case 'record_point_of_sale_creation':
      requireCurrentStep(run, 'point_of_sale_creation');
      assertPointOfSale(command.exportPointOfSale, false);
      assertHash(command.evidenceHash, 'POINT_OF_SALE_CREATION_EVIDENCE_HASH_INVALID');
      next = completeStep(run, 'point_of_sale_creation', occurredAt, [command.evidenceHash], {
        exportPointOfSale: command.exportPointOfSale,
      });
      next = { ...next, pointOfSale: { number: command.exportPointOfSale, source: 'created', active: true } };
      safeMetadata = { exportPointOfSale: command.exportPointOfSale };
      break;
    case 'record_ws_delegation':
      requireCurrentStep(run, 'ws_delegation');
      assertHash(command.evidenceHash, 'WS_DELEGATION_EVIDENCE_HASH_INVALID');
      assertHash(command.issuerProfileReferenceHash, 'WS_DELEGATION_ISSUER_PROFILE_HASH_INVALID');
      assertHash(command.representedCuitCommitment, 'WS_DELEGATION_REPRESENTED_CUIT_COMMITMENT_INVALID');
      for (const service of run.requestedServices) {
        if (!command.delegatedServices[service]) throw new Error(`ARCA_${service.toUpperCase()}_DELEGATION_REQUIRED`);
      }
      next = completeStep(run, 'ws_delegation', occurredAt, [command.evidenceHash], {
        wsfexDelegated: command.delegatedServices.wsfex,
        wsfeDelegated: command.delegatedServices.wsfe,
      });
      next = {
        ...next,
        delegation: { ...command.delegatedServices },
        authorityBinding: {
          issuerProfileReferenceHash: command.issuerProfileReferenceHash,
          representedCuitCommitment: command.representedCuitCommitment,
        },
      };
      safeMetadata = { delegatedServiceCount: run.requestedServices.length };
      break;
    case 'record_api_verification':
      requireCurrentStep(run, 'api_verification');
      if (run.requestedServices.includes('wsfex') && (
        !run.authorityBinding?.issuerProfileReferenceHash
        || !run.authorityBinding?.representedCuitCommitment
      )) throw new Error('ARCA_WSFEX_AUTHORITY_BINDING_REQUIRED');
      assertPointOfSale(command.activeExportPointOfSale, false);
      assertRequestedReceiptHash(run.requestedServices, 'wsfex', command.wsfexReceiptHash, 'WSFEX_RECEIPT_HASH_INVALID');
      assertRequestedReceiptHash(run.requestedServices, 'wsfe', command.wsfeReceiptHash, 'WSFE_RECEIPT_HASH_INVALID');
      if (command.activeExportPointOfSale !== run.pointOfSale.number || !run.pointOfSale.active) {
        throw new Error('ARCA_POINT_OF_SALE_VERIFICATION_MISMATCH');
      }
      for (const service of run.requestedServices) {
        if (!command.verifiedServices[service]) throw new Error(`ARCA_${service.toUpperCase()}_API_VERIFICATION_REQUIRED`);
      }
      next = completeStep(run, 'api_verification', occurredAt, [command.wsfexReceiptHash, command.wsfeReceiptHash].filter((value): value is string => value !== null), {
        exportPointOfSale: command.activeExportPointOfSale,
        wsfexVerified: command.verifiedServices.wsfex,
        wsfeVerified: command.verifiedServices.wsfe,
      });
      next = {
        ...next,
        apiVerification: { ...command.verifiedServices, observedAt: command.observedAt },
      };
      safeMetadata = { authoritativeApiVerification: true };
      break;
    case 'start_zk_evidence':
      requireCurrentStep(run, 'zk_evidence');
      if (run.reclaimSession?.state === 'pending') throw new Error('RECLAIM_SESSION_ALREADY_PENDING');
      assertHash(command.session.contextHash, 'RECLAIM_CONTEXT_HASH_INVALID');
      if (Date.parse(command.session.expiresAt) <= Date.parse(command.session.requestedAt)) throw new Error('RECLAIM_SESSION_EXPIRY_INVALID');
      next = { ...run, reclaimSession: command.session };
      safeMetadata = {
        sessionReferenceHash: hashOpaque(command.session.sessionId),
        providerReferenceHash: hashOpaque(command.session.providerId),
        providerVersion: command.session.providerVersion,
      };
      break;
    case 'record_zk_evidence':
      requireCurrentStep(run, 'zk_evidence');
      assertHash(command.proofHash, 'RECLAIM_PROOF_HASH_INVALID');
      assertHash(command.claimsHash, 'RECLAIM_CLAIMS_HASH_INVALID');
      if (!run.reclaimSession || run.reclaimSession.state !== 'pending') throw new Error('RECLAIM_SESSION_REQUIRED');
      if (run.reclaimSession.sessionId !== command.sessionId) throw new Error('RECLAIM_PROOF_SESSION_MISMATCH');
      if (run.reclaimSession.providerId !== command.providerId || run.reclaimSession.providerVersion !== command.providerVersion) {
        throw new Error('RECLAIM_PROOF_PROVIDER_MISMATCH');
      }
      if (!requestedServicesSatisfied(run.requestedServices, run.apiVerification)) {
        throw new Error('ARCA_API_VERIFICATION_REQUIRED_BEFORE_ZK_EVIDENCE');
      }
      next = completeStep(run, 'zk_evidence', occurredAt, [command.proofHash, command.claimsHash], {
        providerReferenceHash: hashOpaque(command.providerId),
        providerVersion: command.providerVersion,
        teeVerified: command.teeVerified,
      });
      next = {
        ...next,
        zkEvidence: {
          sessionId: command.sessionId,
          providerId: command.providerId,
          providerVersion: command.providerVersion,
          proofHash: command.proofHash,
          claimsHash: command.claimsHash,
          verifiedAt: command.verifiedAt,
          teeVerified: command.teeVerified,
          custodyReceipt: command.custodyReceipt,
        },
        reclaimSession: { ...run.reclaimSession, state: 'verified' },
        status: 'ready',
        currentStep: 'ready',
        steps: updateStep(next.steps, 'ready', {
          state: 'completed',
          completedAt: occurredAt,
          safeMetadata: { apiAndZkEvidenceVerified: true },
        }),
      };
      safeMetadata = { providerReferenceHash: hashOpaque(command.providerId), onboardingReady: true };
      break;
  }

  const event = eventFor(run.onboardingId, run.workspaceId, actorId, command.kind, occurredAt, command.idempotencyKey, safeMetadata);
  return {
    run: {
      ...next,
      revision: run.revision + 1,
      updatedAt: occurredAt,
      processedCommandKeys: [...run.processedCommandKeys, command.idempotencyKey],
      eventIds: [...run.eventIds, event.eventId],
    },
    event,
  };
}

export function arcaOnboardingNextActions(run: ArcaOnboardingRunV1): readonly string[] {
  if (run.status === 'ready') return [];
  switch (run.currentStep) {
    case 'login_handoff': return ['USER_LOG_IN_DIRECTLY_WITH_ARCA'];
    case 'human_auth': return ['USER_COMPLETE_PRIVATE_ARCA_AUTHENTICATION'];
    case 'service_adherence': return ['USER_CONFIRM_SERVICE_ADHERENCE'];
    case 'point_of_sale_discovery': return (run.pointOfSale.candidates?.length ?? 0) > 1
      ? ['USER_SELECT_EXPORT_POINT_OF_SALE']
      : ['DISCOVER_EXPORT_POINT_OF_SALE'];
    case 'point_of_sale_creation': return ['USER_CONFIRM_POINT_OF_SALE_CREATION'];
    case 'ws_delegation': return ['USER_CONFIRM_WEB_SERVICE_DELEGATION'];
    case 'api_verification': return ['VERIFY_WSFEX_AND_WSFE'];
    case 'zk_evidence': return ['CAPTURE_RECLAIM_WITNESS_PROOF'];
    case 'ready': return [];
  }
}

function initialStep(step: ArcaOnboardingStep): ArcaOnboardingStepRecordV1 {
  const userSteps: readonly ArcaOnboardingStep[] = ['login_handoff', 'human_auth', 'service_adherence', 'point_of_sale_creation', 'ws_delegation'];
  return {
    step,
    state: step === 'login_handoff' ? 'action_required' : 'pending',
    requiresUserAction: userSteps.includes(step),
    requiresExplicitConfirmation: step === 'human_auth' || step === 'service_adherence' || step === 'point_of_sale_creation' || step === 'ws_delegation',
    completedAt: null,
    evidenceHashes: [],
    safeMetadata: {},
  };
}

function completeStep(
  run: ArcaOnboardingRunV1,
  step: ArcaOnboardingStep,
  occurredAt: IsoDateTime,
  evidenceHashes: readonly string[],
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>,
): ArcaOnboardingRunV1 {
  const index = ARCA_ONBOARDING_STEPS.indexOf(step);
  const nextStep = ARCA_ONBOARDING_STEPS[index + 1];
  let steps = updateStep(run.steps, step, { state: 'completed', completedAt: occurredAt, evidenceHashes, safeMetadata });
  if (nextStep) steps = updateStep(steps, nextStep, { state: 'action_required' });
  return { ...run, currentStep: nextStep ?? 'ready', steps };
}

function activateStep(run: ArcaOnboardingRunV1, step: ArcaOnboardingStep): ArcaOnboardingRunV1 {
  return { ...run, currentStep: step, steps: updateStep(run.steps, step, { state: 'action_required' }) };
}

function updateStep(
  steps: readonly ArcaOnboardingStepRecordV1[],
  step: ArcaOnboardingStep,
  patch: Partial<ArcaOnboardingStepRecordV1>,
): readonly ArcaOnboardingStepRecordV1[] {
  return steps.map(record => record.step === step ? { ...record, ...patch } : record);
}

function requireCurrentStep(run: ArcaOnboardingRunV1, step: ArcaOnboardingStep): void {
  if (run.currentStep !== step) throw new Error(`ARCA_ONBOARDING_EXPECTED_${run.currentStep.toUpperCase()}`);
}

function requestedServicesSatisfied(
  services: readonly ArcaWebService[],
  state: Readonly<Record<ArcaWebService, boolean>>,
): boolean {
  return services.every(service => state[service]);
}

function uniqueServices(services: readonly ArcaWebService[]): readonly ArcaWebService[] {
  return [...new Set(services)];
}

function uniquePoints(points: readonly number[]): readonly number[] {
  for (const point of points) assertPointOfSale(point, false);
  return [...new Set(points)].sort((left, right) => left - right);
}

function assertPointOfSale(value: number | null, nullable: boolean): void {
  if (value === null && nullable) return;
  if (!Number.isInteger(value) || (value ?? 0) <= 0 || (value ?? 0) > 99_999) throw new Error('ARCA_POINT_OF_SALE_INVALID');
}

function assertHash(value: string, code: string): void {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(code);
}

function assertRequestedReceiptHash(
  requestedServices: readonly ArcaWebService[],
  service: ArcaWebService,
  value: string | null,
  code: string,
): void {
  if (!requestedServices.includes(service)) {
    if (value !== null) assertHash(value, code);
    return;
  }
  if (value === null) throw new Error(code);
  assertHash(value, code);
}

function assertNoSensitiveMaterial(value: unknown): void {
  const forbidden = /(password|passwd|passphrase|clave|pin|otp|totp|cookie|sessiontoken|access_token|refresh_token|authorization|clipboard|localstorage|sessionstorage|rawtrace|networklog|rawcuit|raw_cuit)/i;
  const forbiddenValue = /(?:BEGIN (?:RSA |EC )?PRIVATE KEY|bearer\s+[a-z0-9._~+/=-]{12,}|(?:clave\s+fiscal|password|otp|pin)\s*[:=])/i;
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      if (forbiddenValue.test(candidate)) throw new Error('ARCA_SENSITIVE_MATERIAL_FORBIDDEN');
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const [key, nested] of Object.entries(candidate as Record<string, unknown>)) {
      if (forbidden.test(key)) throw new Error('ARCA_SENSITIVE_MATERIAL_FORBIDDEN');
      visit(nested);
    }
  };
  visit(value);
}

function hashOpaque(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function eventFor(
  onboardingId: string,
  workspaceId: string,
  actorId: string,
  action: string,
  occurredAt: IsoDateTime,
  idempotencyKey: string,
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>,
): ArcaOnboardingEventV1 {
  return {
    version: 'arca-onboarding-event-v1',
    eventId: randomUUID(),
    onboardingId,
    workspaceId,
    actorId,
    action,
    occurredAt,
    idempotencyKey,
    safeMetadata,
  };
}
