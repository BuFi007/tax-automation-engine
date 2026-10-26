import { randomUUID } from 'node:crypto';

import type { ArcaOnboardingEnvironment, ArcaOnboardingRunV1, ArcaWebService } from './arca-onboarding';
import { hashCanonical } from './factura-e-agent';
import { HOSTED_HUMAN_AUTH_POLICY_V2_HASH, assertSafeHumanAuthValue } from './human-auth';
import type { IsoDateTime } from './types';

/**
 * Automated ARCA connection.
 *
 * One execution drives one onboarding run through a hosted browser. The
 * onboarding run stays the authority for ARCA facts; this aggregate holds what
 * the automation needs on top: the customer's scoped authorization, the lease
 * that prevents two jobs from touching the same taxpayer, the order currently
 * handed to the executor, the last ARCA inventory, and the reason it is waiting.
 *
 * Everything here is safe to persist. Live View links, cookies, passwords,
 * private keys and raw CUITs are structurally absent; `assertSafe` refuses them.
 */

export const ARCA_SETUP_OPERATIONS = [
  'authenticate',
  'inspect',
  'adhere_services',
  'create_point_of_sale',
  'enroll_certificate',
  'authorize_web_services',
  'delegate_to_provider',
  'provider_accept',
  'close_session',
] as const;
export type ArcaSetupOperation = (typeof ARCA_SETUP_OPERATIONS)[number];

/** Operations that change ARCA state. Each one is preceded by a fresh inspection. */
export const ARCA_SETUP_MUTATING_OPERATIONS: readonly ArcaSetupOperation[] = [
  'adhere_services',
  'create_point_of_sale',
  'enroll_certificate',
  'authorize_web_services',
  'delegate_to_provider',
  'provider_accept',
];

export type ArcaSetupMode = 'provider_delegation' | 'customer_certificate';

export type ArcaSetupPhase =
  | 'awaiting_user_authorization'
  | 'awaiting_user_authentication'
  | 'running'
  | 'awaiting_user_decision'
  | 'awaiting_provider_acceptance'
  | 'waiting_for_propagation'
  | 'waiting_for_verification'
  | 'waiting_for_proof'
  | 'recoverable_action_required'
  | 'connected'
  | 'cancelled'
  | 'failed';

export const ARCA_SETUP_TERMINAL_PHASES: readonly ArcaSetupPhase[] = ['connected', 'cancelled', 'failed'];

export type ArcaSetupDecisionKind =
  | 'export_point_of_sale'
  | 'domestic_point_of_sale'
  | 'certificate_replacement';

export type ArcaSetupDecisionV1 = Readonly<{
  kind: ArcaSetupDecisionKind;
  /** Public point-of-sale numbers, or `replace`/`keep` for a certificate. */
  options: readonly (number | 'replace' | 'keep')[];
  requestedAt: IsoDateTime;
}>;

export type ArcaSetupBlockerV1 = Readonly<{
  code: string;
  retryable: boolean;
  /** What the customer can do. Never free text from ARCA. */
  userAction:
    | 'retry'
    | 'sign_in_again'
    | 'sign_in_with_the_right_taxpayer'
    | 'wait_and_retry'
    | 'contact_support'
    | 'complete_proof_on_device'
    | 'none';
  observedAt: IsoDateTime;
}>;

/** What the customer approved, exactly once, through the trusted UI channel. */
export type ArcaSetupAuthorizationV1 = Readonly<{
  version: 'arca-setup-authorization-v1';
  authorizationId: string;
  executionId: string;
  onboardingId: string;
  workspaceId: string;
  /** The BUFI user who approved. Never an agent. */
  actorId: string;
  taxpayerReferenceHash: string;
  environment: ArcaOnboardingEnvironment;
  requestedServices: readonly ArcaWebService[];
  mode: ArcaSetupMode;
  permittedOperations: readonly ArcaSetupOperation[];
  allowPointOfSaleCreation: boolean;
  allowCertificateReplacement: boolean;
  /** Opaque reference to the AI-credit charge that paid for this run, if any. */
  billingReferenceHash: string | null;
  consentTextHash: string;
  grantedAt: IsoDateTime;
  expiresAt: IsoDateTime;
}>;

export type ArcaSetupOrderV1 = Readonly<{
  version: 'arca-setup-order-v1';
  orderId: string;
  executionId: string;
  onboardingId: string;
  workspaceId: string;
  environment: ArcaOnboardingEnvironment;
  operation: ArcaSetupOperation;
  authorizationId: string;
  /** Execution revision the order was computed from. Receipts must echo it. */
  expectedRevision: number;
  attempt: number;
  /** Safe, operation-specific parameters (point-of-sale numbers, aliases, services). */
  parameters: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
  issuedAt: IsoDateTime;
  expiresAt: IsoDateTime;
}>;

export type ArcaSetupInventoryV1 = Readonly<{
  version: 'arca-setup-inventory-v1';
  observedAt: IsoDateTime;
  evidenceHash: string;
  identity: Readonly<{
    loginIdentityHash: string;
    representedCuitCommitment: string;
    representedMatches: boolean;
  }>;
  services: Readonly<{
    relationshipManager: boolean;
    pointOfSaleAdministration: boolean;
    certificateAdministration: boolean;
  }>;
  certificates: Readonly<{
    intendedAliasExists: boolean;
    intendedAliasCertificateValidUntil: IsoDateTime | null;
    otherAliasCount: number;
  }>;
  relationships: Readonly<Record<ArcaWebService, 'none' | 'customer_alias' | 'provider_pending' | 'provider_active'>>;
  pointsOfSale: Readonly<{
    exportWebServices: readonly number[];
    domesticWebServices: readonly number[];
    usedNumbers: readonly number[];
    domicileCount: number;
  }>;
}>;

export type ArcaSetupReceiptOutcome =
  | 'completed'
  | 'handoff_required'
  | 'blocked'
  | 'uncertain'
  | 'failed';

export type ArcaSetupReceiptV1 = Readonly<{
  version: 'arca-setup-receipt-v1';
  receiptId: string;
  orderId: string;
  executionId: string;
  onboardingId: string;
  workspaceId: string;
  operation: ArcaSetupOperation;
  expectedRevision: number;
  outcome: ArcaSetupReceiptOutcome;
  /** Code for blocked/failed/uncertain outcomes. */
  code: string | null;
  observedAt: IsoDateTime;
  evidenceHash: string;
  inventory: ArcaSetupInventoryV1 | null;
  /** Operation result facts, all safe. */
  result: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ArcaSetupExecutionV1 = Readonly<{
  version: 'arca-setup-execution-v1';
  executionId: string;
  onboardingId: string;
  workspaceId: string;
  environment: ArcaOnboardingEnvironment;
  taxpayerReferenceHash: string;
  requestedServices: readonly ArcaWebService[];
  mode: ArcaSetupMode;
  /** Opaque issuer profile used for boundary provisioning and API checks. */
  issuerProfileRef: string;
  /** Alias the automation creates or reuses in ARCA. Not secret. */
  intendedAlias: string;
  hostedAuthPolicyHash: typeof HOSTED_HUMAN_AUTH_POLICY_V2_HASH;
  revision: number;
  phase: ArcaSetupPhase;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  startedBy: Readonly<{ kind: 'agent' | 'user'; actorId: string }>;
  authorization: ArcaSetupAuthorizationV1 | null;
  currentOrder: ArcaSetupOrderV1 | null;
  completedOperations: readonly ArcaSetupOperation[];
  inventory: ArcaSetupInventoryV1 | null;
  /** Set once the boundary has an issuer for this run. */
  boundary: Readonly<{
    setupReferenceHash: string | null;
    certificateFingerprintHash: string | null;
    representedCuitCommitment: string | null;
    provisioned: boolean;
  }>;
  decision: ArcaSetupDecisionV1 | null;
  decisions: Readonly<Partial<Record<ArcaSetupDecisionKind, number | 'replace' | 'keep'>>>;
  chosenDomesticPointOfSale: number | null;
  blocker: ArcaSetupBlockerV1 | null;
  verification: Readonly<{ attempts: number; nextAttemptAt: IsoDateTime | null }>;
  processedKeys: readonly string[];
}>;

export type ArcaSetupEventV1 = Readonly<{
  version: 'arca-setup-event-v1';
  eventId: string;
  executionId: string;
  workspaceId: string;
  action: string;
  actorId: string;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type ArcaSetupCommand =
  | Readonly<{
      kind: 'grant_authorization';
      grant: ArcaSetupAuthorizationV1;
      idempotencyKey: string;
    }>
  | Readonly<{ kind: 'dispatch_order'; order: ArcaSetupOrderV1; idempotencyKey: string }>
  | Readonly<{ kind: 'record_receipt'; receipt: ArcaSetupReceiptV1; idempotencyKey: string }>
  | Readonly<{
      kind: 'record_decision';
      decision: ArcaSetupDecisionKind;
      value: number | 'replace' | 'keep';
      expectedRevision: number;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_boundary_provision';
      setupReferenceHash: string;
      certificateFingerprintHash: string;
      representedCuitCommitment: string;
      idempotencyKey: string;
    }>
  | Readonly<{
      kind: 'record_verification_attempt';
      outcome: 'verified' | 'propagating' | 'blocked';
      code: string | null;
      nextAttemptAt: IsoDateTime | null;
      idempotencyKey: string;
    }>
  | Readonly<{ kind: 'set_phase'; phase: ArcaSetupPhase; blocker: ArcaSetupBlockerV1 | null; idempotencyKey: string }>
  | Readonly<{ kind: 'request_decision'; decision: ArcaSetupDecisionV1; idempotencyKey: string }>
  | Readonly<{ kind: 'cancel'; idempotencyKey: string }>;

export type ArcaSetupNextStep =
  | Readonly<{ kind: 'dispatch'; operation: ArcaSetupOperation; parameters: ArcaSetupOrderV1['parameters'] }>
  | Readonly<{ kind: 'await_order' }>
  | Readonly<{ kind: 'await_user'; phase: ArcaSetupPhase }>
  | Readonly<{ kind: 'provision_boundary' }>
  | Readonly<{ kind: 'apply_onboarding'; command: 'login' | 'service_adherence' | 'point_of_sale' | 'ws_delegation' }>
  | Readonly<{ kind: 'verify_api'; service: ArcaWebService }>
  | Readonly<{ kind: 'request_proof' }>
  | Readonly<{ kind: 'connected' }>
  | Readonly<{ kind: 'stop'; phase: ArcaSetupPhase }>;

const SHA256 = /^[a-f0-9]{64}$/;
const AUTHORIZATION_MAX_TTL_MS = 24 * 60 * 60_000;
export const ARCA_SETUP_ORDER_TTL_MS = 30 * 60_000;
export const ARCA_SETUP_PROPAGATION_DEADLINE_MS = 24 * 60 * 60_000;

export function createArcaSetupExecution(input: Readonly<{
  executionId?: string;
  onboardingId: string;
  workspaceId: string;
  environment: ArcaOnboardingEnvironment;
  taxpayerReferenceHash: string;
  requestedServices: readonly ArcaWebService[];
  mode: ArcaSetupMode;
  startedBy: Readonly<{ kind: 'agent' | 'user'; actorId: string }>;
  occurredAt: IsoDateTime;
  idempotencyKey: string;
}>): Readonly<{ execution: ArcaSetupExecutionV1; event: ArcaSetupEventV1 }> {
  assertSafe(input);
  assertHash(input.taxpayerReferenceHash, 'ARCA_SETUP_TAXPAYER_REFERENCE_INVALID');
  const services = [...new Set(input.requestedServices)].sort() as ArcaWebService[];
  if (services.length === 0) throw new Error('ARCA_SETUP_SERVICE_REQUIRED');
  const executionId = input.executionId ?? randomUUID();
  const execution: ArcaSetupExecutionV1 = {
    version: 'arca-setup-execution-v1',
    executionId,
    onboardingId: input.onboardingId,
    workspaceId: input.workspaceId,
    environment: input.environment,
    taxpayerReferenceHash: input.taxpayerReferenceHash,
    requestedServices: services,
    mode: input.mode,
    issuerProfileRef: `arca-setup/${executionId}`,
    intendedAlias: input.environment === 'production' ? 'bufi-arca' : 'bufi-arca-homo',
    hostedAuthPolicyHash: HOSTED_HUMAN_AUTH_POLICY_V2_HASH,
    revision: 1,
    phase: 'awaiting_user_authorization',
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt,
    startedBy: input.startedBy,
    authorization: null,
    currentOrder: null,
    completedOperations: [],
    inventory: null,
    boundary: {
      setupReferenceHash: null,
      certificateFingerprintHash: null,
      representedCuitCommitment: null,
      provisioned: false,
    },
    decision: null,
    decisions: {},
    chosenDomesticPointOfSale: null,
    blocker: null,
    verification: { attempts: 0, nextAttemptAt: null },
    processedKeys: [input.idempotencyKey],
  };
  return {
    execution,
    event: eventFor(execution, 'arca_setup_created', input.startedBy.actorId, input.occurredAt, input.idempotencyKey, {
      mode: input.mode,
      startedByAgent: input.startedBy.kind === 'agent',
      requestedServiceCount: services.length,
    }),
  };
}

/** Operations the customer authorizes for a mode. Provider acceptance is BUFI's, not theirs. */
export function arcaSetupPermittedOperations(mode: ArcaSetupMode): readonly ArcaSetupOperation[] {
  const common: ArcaSetupOperation[] = ['authenticate', 'inspect', 'adhere_services', 'create_point_of_sale', 'close_session'];
  return mode === 'provider_delegation'
    ? [...common, 'delegate_to_provider']
    : [...common, 'enroll_certificate', 'authorize_web_services'];
}

export function applyArcaSetupCommand(
  execution: ArcaSetupExecutionV1,
  command: ArcaSetupCommand,
  actorId: string,
  occurredAt: IsoDateTime,
): Readonly<{ execution: ArcaSetupExecutionV1; event: ArcaSetupEventV1 | null }> {
  assertSafe(command);
  if (execution.processedKeys.includes(command.idempotencyKey)) return { execution, event: null };
  const terminal = ARCA_SETUP_TERMINAL_PHASES.includes(execution.phase);
  if (terminal) throw new Error('ARCA_SETUP_EXECUTION_TERMINAL');

  let next: ArcaSetupExecutionV1 = execution;
  let metadata: Readonly<Record<string, string | number | boolean | null>> = {};

  switch (command.kind) {
    case 'grant_authorization': {
      const authorization = command.grant;
      if (execution.phase !== 'awaiting_user_authorization' && execution.phase !== 'recoverable_action_required')
        throw new Error('ARCA_SETUP_AUTHORIZATION_NOT_EXPECTED');
      if (authorization.actorId.startsWith('agent:')) throw new Error('ARCA_SETUP_AUTHORIZATION_REQUIRES_USER');
      if (
        authorization.executionId !== execution.executionId
        || authorization.onboardingId !== execution.onboardingId
        || authorization.workspaceId !== execution.workspaceId
        || authorization.taxpayerReferenceHash !== execution.taxpayerReferenceHash
        || authorization.environment !== execution.environment
        || authorization.mode !== execution.mode
        || !sameServices(authorization.requestedServices, execution.requestedServices)
      ) throw new Error('ARCA_SETUP_AUTHORIZATION_SCOPE_MISMATCH');
      const allowed = new Set(arcaSetupPermittedOperations(execution.mode));
      if (authorization.permittedOperations.some(operation => !allowed.has(operation)))
        throw new Error('ARCA_SETUP_AUTHORIZATION_OPERATION_NOT_ALLOWED');
      assertHash(authorization.consentTextHash, 'ARCA_SETUP_CONSENT_HASH_INVALID');
      if (authorization.billingReferenceHash !== null)
        assertHash(authorization.billingReferenceHash, 'ARCA_SETUP_BILLING_REFERENCE_INVALID');
      const granted = Date.parse(authorization.grantedAt);
      const expires = Date.parse(authorization.expiresAt);
      if (!(expires > granted) || expires - granted > AUTHORIZATION_MAX_TTL_MS)
        throw new Error('ARCA_SETUP_AUTHORIZATION_LIFETIME_INVALID');
      next = { ...execution, authorization, phase: 'running', blocker: null };
      metadata = {
        permittedOperationCount: authorization.permittedOperations.length,
        allowPointOfSaleCreation: authorization.allowPointOfSaleCreation,
        allowCertificateReplacement: authorization.allowCertificateReplacement,
        paid: authorization.billingReferenceHash !== null,
      };
      break;
    }
    case 'dispatch_order': {
      const order = command.order;
      requireAuthorized(execution, order.operation, occurredAt);
      if (execution.currentOrder && execution.currentOrder.orderId !== order.orderId)
        throw new Error('ARCA_SETUP_ORDER_ALREADY_OUTSTANDING');
      if (
        order.executionId !== execution.executionId
        || order.onboardingId !== execution.onboardingId
        || order.workspaceId !== execution.workspaceId
        || order.environment !== execution.environment
        || order.authorizationId !== execution.authorization!.authorizationId
        || order.expectedRevision !== execution.revision
      ) throw new Error('ARCA_SETUP_ORDER_SCOPE_MISMATCH');
      if (!(Date.parse(order.expiresAt) > Date.parse(order.issuedAt))
        || Date.parse(order.expiresAt) - Date.parse(order.issuedAt) > ARCA_SETUP_ORDER_TTL_MS)
        throw new Error('ARCA_SETUP_ORDER_LIFETIME_INVALID');
      next = {
        ...execution,
        currentOrder: order,
        phase: order.operation === 'authenticate' || order.operation === 'provider_accept'
          ? (order.operation === 'authenticate' ? 'awaiting_user_authentication' : 'awaiting_provider_acceptance')
          : 'running',
        blocker: null,
      };
      metadata = { operation: order.operation, attempt: order.attempt };
      break;
    }
    case 'record_receipt': {
      const receipt = command.receipt;
      const order = execution.currentOrder;
      if (!order || order.orderId !== receipt.orderId) throw new Error('ARCA_SETUP_RECEIPT_ORDER_MISMATCH');
      if (
        receipt.executionId !== execution.executionId
        || receipt.onboardingId !== execution.onboardingId
        || receipt.workspaceId !== execution.workspaceId
        || receipt.operation !== order.operation
        || receipt.expectedRevision !== order.expectedRevision
      ) throw new Error('ARCA_SETUP_RECEIPT_SCOPE_MISMATCH');
      assertHash(receipt.evidenceHash, 'ARCA_SETUP_RECEIPT_EVIDENCE_INVALID');
      if (Date.parse(receipt.observedAt) < Date.parse(order.issuedAt) - 60_000)
        throw new Error('ARCA_SETUP_RECEIPT_BEFORE_ORDER');
      if (receipt.inventory) assertInventory(receipt.inventory);
      if (receipt.inventory && !receipt.inventory.identity.representedMatches)
        return finish(execution, {
          ...execution,
          currentOrder: null,
          inventory: receipt.inventory,
          phase: 'recoverable_action_required',
          blocker: blocker('ARCA_SETUP_WRONG_TAXPAYER', true, 'sign_in_with_the_right_taxpayer', receipt.observedAt),
        }, command, actorId, occurredAt, { operation: receipt.operation, outcome: 'wrong_taxpayer' });
      const inventory = receipt.inventory ?? execution.inventory;
      switch (receipt.outcome) {
        case 'completed':
          next = {
            ...execution,
            currentOrder: null,
            inventory: receipt.operation === 'provider_accept' ? withProviderAcceptance(inventory, receipt.result.acceptedServices) : inventory,
            phase: 'running',
            blocker: null,
            completedOperations: execution.completedOperations.includes(receipt.operation)
              ? execution.completedOperations
              : [...execution.completedOperations, receipt.operation],
          };
          break;
        case 'handoff_required':
          // The executor paused for the human (login, MFA, a domicile picked in ARCA).
          next = {
            ...execution,
            inventory,
            phase: receipt.operation === 'provider_accept' ? 'awaiting_provider_acceptance' : 'awaiting_user_authentication',
            blocker: null,
          };
          break;
        case 'uncertain':
          // Never resubmit blindly: the next order is an inspection.
          next = {
            ...execution,
            currentOrder: null,
            inventory,
            phase: 'running',
            completedOperations: execution.completedOperations.filter(operation => operation !== 'inspect'),
            blocker: blocker(receipt.code ?? 'ARCA_SETUP_RESULT_UNCERTAIN', true, 'none', receipt.observedAt),
          };
          break;
        case 'blocked':
          next = {
            ...execution,
            currentOrder: null,
            inventory,
            phase: 'recoverable_action_required',
            blocker: blocker(receipt.code ?? 'ARCA_SETUP_BLOCKED', true, userActionFor(receipt.code), receipt.observedAt),
            completedOperations: receipt.code === 'ARCA_SESSION_EXPIRED' || receipt.code === 'BROWSER_SESSION_GONE'
              || receipt.code === 'ARCA_SETUP_WRONG_TAXPAYER' || receipt.code === 'ARCA_AUTHENTICATION_NOT_COMPLETED'
              ? execution.completedOperations.filter(operation => operation !== 'authenticate' && operation !== 'inspect')
              : execution.completedOperations,
          };
          break;
        case 'failed':
          next = {
            ...execution,
            currentOrder: null,
            inventory,
            phase: 'failed',
            blocker: blocker(receipt.code ?? 'ARCA_SETUP_FAILED', false, 'contact_support', receipt.observedAt),
          };
          break;
      }
      metadata = { operation: receipt.operation, outcome: receipt.outcome, code: receipt.code };
      break;
    }
    case 'record_decision': {
      if (command.expectedRevision !== execution.revision) throw new Error('ARCA_SETUP_REVISION_CONFLICT');
      const pending = execution.decision;
      if (!pending || pending.kind !== command.decision) throw new Error('ARCA_SETUP_DECISION_NOT_REQUESTED');
      if (!pending.options.includes(command.value)) throw new Error('ARCA_SETUP_DECISION_OPTION_INVALID');
      next = {
        ...execution,
        decision: null,
        decisions: { ...execution.decisions, [command.decision]: command.value },
        ...(command.decision === 'domestic_point_of_sale' && typeof command.value === 'number'
          ? { chosenDomesticPointOfSale: command.value }
          : {}),
        phase: 'running',
        blocker: null,
      };
      metadata = { decision: command.decision };
      break;
    }
    case 'record_boundary_provision':
      assertHash(command.setupReferenceHash, 'ARCA_SETUP_BOUNDARY_REFERENCE_INVALID');
      assertHash(command.certificateFingerprintHash, 'ARCA_SETUP_CERTIFICATE_HASH_INVALID');
      assertHash(command.representedCuitCommitment, 'ARCA_SETUP_COMMITMENT_INVALID');
      if (
        execution.inventory
        && execution.inventory.identity.representedCuitCommitment !== command.representedCuitCommitment
      ) throw new Error('ARCA_SETUP_BOUNDARY_COMMITMENT_MISMATCH');
      next = {
        ...execution,
        boundary: {
          setupReferenceHash: command.setupReferenceHash,
          certificateFingerprintHash: command.certificateFingerprintHash,
          representedCuitCommitment: command.representedCuitCommitment,
          provisioned: true,
        },
      };
      metadata = { boundaryProvisioned: true };
      break;
    case 'record_verification_attempt': {
      const attempts = execution.verification.attempts + 1;
      next = {
        ...execution,
        verification: { attempts, nextAttemptAt: command.nextAttemptAt },
        phase: command.outcome === 'verified'
          ? 'running'
          : command.outcome === 'propagating' ? 'waiting_for_propagation' : 'recoverable_action_required',
        blocker: command.outcome === 'blocked'
          ? blocker(command.code ?? 'ARCA_API_VERIFICATION_BLOCKED', true, 'retry', occurredAt)
          : command.outcome === 'propagating'
            ? blocker(command.code ?? 'ARCA_PROPAGATION_PENDING', true, 'wait_and_retry', occurredAt)
            : null,
      };
      metadata = { outcome: command.outcome, attempts };
      break;
    }
    case 'set_phase':
      if (command.phase === 'connected' || command.phase === 'cancelled')
        throw new Error('ARCA_SETUP_PHASE_REQUIRES_DEDICATED_COMMAND');
      next = { ...execution, phase: command.phase, blocker: command.blocker };
      metadata = { phase: command.phase, code: command.blocker?.code ?? null };
      break;
    case 'request_decision':
      if (command.decision.options.length < 2 && command.decision.kind !== 'certificate_replacement')
        throw new Error('ARCA_SETUP_DECISION_OPTIONS_INVALID');
      next = { ...execution, decision: command.decision, phase: 'awaiting_user_decision' };
      metadata = { decision: command.decision.kind, optionCount: command.decision.options.length };
      break;
    case 'cancel':
      next = { ...execution, phase: 'cancelled', currentOrder: null, decision: null, blocker: null };
      metadata = { cancelledWithOutstandingOrder: execution.currentOrder !== null };
      break;
  }
  return finish(execution, next, command, actorId, occurredAt, metadata);
}

/** Mark an execution connected only from a ready onboarding run. */
export function connectArcaSetupExecution(
  execution: ArcaSetupExecutionV1,
  run: ArcaOnboardingRunV1,
  occurredAt: IsoDateTime,
): Readonly<{ execution: ArcaSetupExecutionV1; event: ArcaSetupEventV1 | null }> {
  if (run.onboardingId !== execution.onboardingId || run.workspaceId !== execution.workspaceId)
    throw new Error('ARCA_SETUP_RUN_MISMATCH');
  if (run.status !== 'ready' || !run.zkEvidence || !execution.requestedServices.every(service => run.apiVerification[service]))
    throw new Error('ARCA_SETUP_NOT_VERIFIED');
  const key = `connected:${run.revision}`;
  if (execution.processedKeys.includes(key)) return { execution, event: null };
  return finish(execution, { ...execution, phase: 'connected', blocker: null, decision: null, currentOrder: null }, {
    kind: 'cancel', idempotencyKey: key,
  }, 'tax:arca-setup', occurredAt, { connected: true }, true, 'arca_setup_connected');
}

/**
 * Decide what happens next. Pure: the service performs the effect and records
 * it with a command. Discovery always precedes creation; ARCA facts recorded on
 * the onboarding run are never re-derived from the inventory.
 */
export function planArcaSetup(
  execution: ArcaSetupExecutionV1,
  run: ArcaOnboardingRunV1,
  occurredAt: IsoDateTime,
): ArcaSetupNextStep {
  const step = planArcaSetupStep(execution, run, occurredAt);
  // Browser work needs a live customer grant; API-side steps finish what was already authorized.
  if (step.kind === 'dispatch' && execution.authorization && Date.parse(execution.authorization.expiresAt) <= Date.parse(occurredAt))
    return { kind: 'await_user', phase: 'awaiting_user_authorization' };
  return step;
}

function planArcaSetupStep(
  execution: ArcaSetupExecutionV1,
  run: ArcaOnboardingRunV1,
  occurredAt: IsoDateTime,
): ArcaSetupNextStep {
  if (ARCA_SETUP_TERMINAL_PHASES.includes(execution.phase)) return { kind: 'stop', phase: execution.phase };
  if (run.status === 'failed') return { kind: 'stop', phase: 'failed' };
  if (run.status === 'ready') return { kind: 'connected' };
  if (!execution.authorization) return { kind: 'await_user', phase: 'awaiting_user_authorization' };
  if (execution.currentOrder) return { kind: 'await_order' };
  if (execution.decision) return { kind: 'await_user', phase: 'awaiting_user_decision' };
  if (execution.phase === 'recoverable_action_required') return { kind: 'await_user', phase: 'recoverable_action_required' };

  const done = new Set(execution.completedOperations);
  const inventory = execution.inventory;
  const dispatch = (operation: ArcaSetupOperation, parameters: ArcaSetupOrderV1['parameters'] = {}): ArcaSetupNextStep =>
    ({ kind: 'dispatch', operation, parameters });

  // Steps after ws_delegation are API-side; they need no browser.
  if (run.currentStep === 'api_verification') {
    if (execution.phase === 'waiting_for_propagation' && execution.verification.nextAttemptAt
      && Date.parse(execution.verification.nextAttemptAt) > Date.parse(occurredAt))
      return { kind: 'await_user', phase: 'waiting_for_propagation' };
    const service = execution.requestedServices.find(candidate => !run.apiVerification[candidate]);
    return service ? { kind: 'verify_api', service } : { kind: 'await_order' };
  }
  if (run.currentStep === 'zk_evidence') return { kind: 'request_proof' };

  if (!done.has('authenticate')) return dispatch('authenticate', { intendedAlias: execution.intendedAlias });
  if (run.currentStep === 'login_handoff' || run.currentStep === 'human_auth')
    return { kind: 'apply_onboarding', command: 'login' };
  if (!done.has('inspect') || !inventory) return dispatch('inspect', { intendedAlias: execution.intendedAlias });

  if (run.currentStep === 'service_adherence') {
    const needed = !inventory.services.pointOfSaleAdministration
      || (execution.mode === 'customer_certificate' && !inventory.services.certificateAdministration);
    if (needed) {
      if (done.has('adhere_services')) return inspectAgain(execution);
      return dispatch('adhere_services', {
        pointOfSaleAdministration: !inventory.services.pointOfSaleAdministration,
        certificateAdministration: execution.mode === 'customer_certificate' && !inventory.services.certificateAdministration,
      });
    }
    return { kind: 'apply_onboarding', command: 'service_adherence' };
  }

  if (run.currentStep === 'point_of_sale_discovery' || run.currentStep === 'point_of_sale_creation') {
    const exportPoints = inventory.pointsOfSale.exportWebServices;
    if (run.requestedServices.includes('wsfex')) {
      if (run.currentStep === 'point_of_sale_discovery') {
        if (exportPoints.length > 1 && execution.decisions.export_point_of_sale === undefined)
          return { kind: 'await_user', phase: 'awaiting_user_decision' };
        return { kind: 'apply_onboarding', command: 'point_of_sale' };
      }
      // point_of_sale_creation: discovery found nothing.
      if (exportPoints.length > 0) return { kind: 'apply_onboarding', command: 'point_of_sale' };
      if (!execution.authorization.allowPointOfSaleCreation)
        return { kind: 'await_user', phase: 'recoverable_action_required' };
      if (done.has('create_point_of_sale')) return inspectAgain(execution);
      return dispatch('create_point_of_sale', {
        system: 'export_web_services',
        number: nextFreePointOfSale(inventory.pointsOfSale.usedNumbers),
        domicileCount: inventory.pointsOfSale.domicileCount,
      });
    }
    // WSFE only: the onboarding run tracks the domestic point as its point of sale.
    const domestic = inventory.pointsOfSale.domesticWebServices;
    if (domestic.length > 1 && execution.decisions.domestic_point_of_sale === undefined)
      return { kind: 'await_user', phase: 'awaiting_user_decision' };
    if (domestic.length === 0) {
      if (!execution.authorization.allowPointOfSaleCreation)
        return { kind: 'await_user', phase: 'recoverable_action_required' };
      if (done.has('create_point_of_sale')) return inspectAgain(execution);
      return dispatch('create_point_of_sale', {
        system: 'domestic_web_services',
        number: nextFreePointOfSale(inventory.pointsOfSale.usedNumbers),
        domicileCount: inventory.pointsOfSale.domicileCount,
      });
    }
    return { kind: 'apply_onboarding', command: 'point_of_sale' };
  }

  if (run.currentStep === 'ws_delegation') {
    if (run.requestedServices.includes('wsfe') && run.requestedServices.includes('wsfex')
      && execution.chosenDomesticPointOfSale === null) {
      const domestic = inventory.pointsOfSale.domesticWebServices;
      if (domestic.length > 1 && execution.decisions.domestic_point_of_sale === undefined)
        return { kind: 'await_user', phase: 'awaiting_user_decision' };
      if (domestic.length === 0) {
        if (!execution.authorization.allowPointOfSaleCreation)
          return { kind: 'await_user', phase: 'recoverable_action_required' };
        if (done.has('create_point_of_sale')) return inspectAgain(execution);
        return dispatch('create_point_of_sale', {
          system: 'domestic_web_services',
          number: nextFreePointOfSale(inventory.pointsOfSale.usedNumbers),
          domicileCount: inventory.pointsOfSale.domicileCount,
        });
      }
    }
    return planDelegation(execution, inventory, done);
  }
  return { kind: 'await_order' };
}

function planDelegation(
  execution: ArcaSetupExecutionV1,
  inventory: ArcaSetupInventoryV1,
  done: ReadonlySet<ArcaSetupOperation>,
): ArcaSetupNextStep {
  const services = execution.requestedServices;
  if (execution.mode === 'provider_delegation') {
    const delegated = services.every(service =>
      inventory.relationships[service] === 'provider_pending' || inventory.relationships[service] === 'provider_active');
    if (!delegated) {
      if (done.has('delegate_to_provider')) return inspectAgain(execution);
      return { kind: 'dispatch', operation: 'delegate_to_provider', parameters: { services: [...services] } };
    }
    // Seen as active from the customer side or not, BUFI's own session must confirm the
    // acceptance and the computer-alias binding before the boundary provisions anything.
    const accepted = services.every(service => inventory.relationships[service] === 'provider_active')
      && done.has('provider_accept');
    if (!accepted) return { kind: 'await_user', phase: 'awaiting_provider_acceptance' };
    if (!execution.boundary.provisioned) return { kind: 'provision_boundary' };
    return { kind: 'apply_onboarding', command: 'ws_delegation' };
  }
  // Customer certificate: the alias must hold a certificate whose key lives in the boundary,
  // and be related to every requested service, before the boundary provisions the issuer.
  if (!execution.boundary.provisioned && !done.has('enroll_certificate')) {
    if (
      inventory.certificates.intendedAliasExists
      && execution.decisions.certificate_replacement === undefined
      && !execution.authorization!.allowCertificateReplacement
    ) return { kind: 'await_user', phase: 'awaiting_user_decision' };
    if (execution.decisions.certificate_replacement === 'keep')
      return { kind: 'await_user', phase: 'recoverable_action_required' };
    return { kind: 'dispatch', operation: 'enroll_certificate', parameters: {
      alias: execution.intendedAlias,
      aliasExists: inventory.certificates.intendedAliasExists,
    } };
  }
  const related = services.every(service => inventory.relationships[service] === 'customer_alias');
  if (!related) {
    if (done.has('authorize_web_services')) return inspectAgain(execution);
    return { kind: 'dispatch', operation: 'authorize_web_services', parameters: {
      alias: execution.intendedAlias,
      services: [...services],
    } };
  }
  if (!execution.boundary.provisioned) return { kind: 'provision_boundary' };
  return { kind: 'apply_onboarding', command: 'ws_delegation' };
}

/** BUFI's provider session cannot see the customer's portal; its receipt is the evidence of acceptance. */
function withProviderAcceptance(
  inventory: ArcaSetupInventoryV1 | null,
  accepted: string | number | boolean | null | undefined,
): ArcaSetupInventoryV1 | null {
  if (!inventory || typeof accepted !== 'string') return inventory;
  const services = accepted.split(',').filter((value): value is ArcaWebService => value === 'wsfex' || value === 'wsfe');
  const relationships = { ...inventory.relationships };
  for (const service of services) if (relationships[service] === 'provider_pending') relationships[service] = 'provider_active';
  return { ...inventory, relationships };
}

function inspectAgain(execution: ArcaSetupExecutionV1): ArcaSetupNextStep {
  return { kind: 'dispatch', operation: 'inspect', parameters: { intendedAlias: execution.intendedAlias, recheck: true } };
}

/** The decision the planner is waiting on, with options taken from the inventory. */
export function arcaSetupPendingDecision(
  execution: ArcaSetupExecutionV1,
  run: ArcaOnboardingRunV1,
  occurredAt: IsoDateTime,
): ArcaSetupDecisionV1 | null {
  const inventory = execution.inventory;
  if (!inventory) return null;
  if (run.currentStep === 'point_of_sale_discovery' && run.requestedServices.includes('wsfex')
    && inventory.pointsOfSale.exportWebServices.length > 1 && execution.decisions.export_point_of_sale === undefined)
    return { kind: 'export_point_of_sale', options: [...inventory.pointsOfSale.exportWebServices], requestedAt: occurredAt };
  if (run.requestedServices.includes('wsfe') && inventory.pointsOfSale.domesticWebServices.length > 1
    && execution.decisions.domestic_point_of_sale === undefined
    && (run.currentStep === 'ws_delegation' || (!run.requestedServices.includes('wsfex') && run.currentStep === 'point_of_sale_discovery')))
    return { kind: 'domestic_point_of_sale', options: [...inventory.pointsOfSale.domesticWebServices], requestedAt: occurredAt };
  if (execution.mode === 'customer_certificate' && run.currentStep === 'ws_delegation'
    && inventory.certificates.intendedAliasExists && !execution.boundary.provisioned
    && !execution.completedOperations.includes('enroll_certificate')
    && execution.decisions.certificate_replacement === undefined
    && !execution.authorization?.allowCertificateReplacement)
    return { kind: 'certificate_replacement', options: ['replace', 'keep'], requestedAt: occurredAt };
  return null;
}

export function nextFreePointOfSale(used: readonly number[]): number {
  const taken = new Set(used);
  for (let candidate = 1; candidate <= 99_998; candidate += 1) if (!taken.has(candidate)) return candidate;
  throw new Error('ARCA_POINT_OF_SALE_EXHAUSTED');
}

/** The browser-safe and agent-safe view. No capability, order parameter or evidence detail. */
export type ArcaSetupProgressV1 = Readonly<{
  version: 'arca-setup-progress-v1';
  executionId: string;
  onboardingId: string;
  workspaceId: string;
  environment: ArcaOnboardingEnvironment;
  mode: ArcaSetupMode;
  phase: ArcaSetupPhase;
  revision: number;
  updatedAt: IsoDateTime;
  completedOperations: readonly ArcaSetupOperation[];
  currentOperation: ArcaSetupOperation | null;
  userAction:
    | Readonly<{ kind: 'authorize_setup' }>
    | Readonly<{ kind: 'sign_in_to_arca'; channel: 'bufi_app' }>
    | Readonly<{ kind: 'choose'; decision: ArcaSetupDecisionKind; options: readonly (number | 'replace' | 'keep')[] }>
    | Readonly<{ kind: 'complete_proof_on_device'; channel: 'bufi_app' }>
    | Readonly<{ kind: 'retry'; code: string }>
    | Readonly<{ kind: 'none' }>;
  blocker: Readonly<{ code: string; retryable: boolean }> | null;
  waitingOn: 'customer' | 'bufi' | 'arca' | 'nobody';
}>;

export function projectArcaSetupProgress(execution: ArcaSetupExecutionV1): ArcaSetupProgressV1 {
  return {
    version: 'arca-setup-progress-v1',
    executionId: execution.executionId,
    onboardingId: execution.onboardingId,
    workspaceId: execution.workspaceId,
    environment: execution.environment,
    mode: execution.mode,
    phase: execution.phase,
    revision: execution.revision,
    updatedAt: execution.updatedAt,
    completedOperations: execution.completedOperations,
    currentOperation: execution.currentOrder?.operation ?? null,
    userAction: userActionFor(execution),
    blocker: execution.blocker ? { code: execution.blocker.code, retryable: execution.blocker.retryable } : null,
    waitingOn: waitingOn(execution.phase),
  };
}

function userActionFor(execution: ArcaSetupExecutionV1): ArcaSetupProgressV1['userAction'];
function userActionFor(code: string | null): ArcaSetupBlockerV1['userAction'];
function userActionFor(input: ArcaSetupExecutionV1 | string | null): ArcaSetupProgressV1['userAction'] | ArcaSetupBlockerV1['userAction'] {
  if (input === null || typeof input === 'string') {
    if (input === 'ARCA_SESSION_EXPIRED' || input === 'BROWSER_SESSION_GONE' || input === 'ARCA_AUTHENTICATION_NOT_COMPLETED')
      return 'sign_in_again';
    if (input === 'ARCA_SETUP_WRONG_TAXPAYER') return 'sign_in_with_the_right_taxpayer';
    if (input === 'ARCA_UNAVAILABLE' || input === 'ARCA_AUTOMATION_BLOCKED' || input === 'ARCA_PAGE_UNRECOGNIZED')
      return 'wait_and_retry';
    return 'retry';
  }
  const execution = input;
  switch (execution.phase) {
    case 'awaiting_user_authorization': return { kind: 'authorize_setup' };
    case 'awaiting_user_authentication': return { kind: 'sign_in_to_arca', channel: 'bufi_app' };
    case 'awaiting_user_decision':
      return execution.decision
        ? { kind: 'choose', decision: execution.decision.kind, options: execution.decision.options }
        : { kind: 'none' };
    case 'waiting_for_proof': return { kind: 'complete_proof_on_device', channel: 'bufi_app' };
    case 'recoverable_action_required':
      return { kind: 'retry', code: execution.blocker?.code ?? 'ARCA_SETUP_ACTION_REQUIRED' };
    default: return { kind: 'none' };
  }
}

function waitingOn(phase: ArcaSetupPhase): ArcaSetupProgressV1['waitingOn'] {
  switch (phase) {
    case 'awaiting_user_authorization':
    case 'awaiting_user_authentication':
    case 'awaiting_user_decision':
    case 'waiting_for_proof':
    case 'recoverable_action_required':
      return 'customer';
    case 'awaiting_provider_acceptance':
    case 'running':
    case 'waiting_for_verification':
      return 'bufi';
    case 'waiting_for_propagation':
      return 'arca';
    default:
      return 'nobody';
  }
}

function requireAuthorized(execution: ArcaSetupExecutionV1, operation: ArcaSetupOperation, occurredAt: IsoDateTime): void {
  const authorization = execution.authorization;
  if (!authorization) throw new Error('ARCA_SETUP_AUTHORIZATION_REQUIRED');
  // Provider acceptance runs under BUFI's own provider authority, never the customer's grant.
  if (operation === 'provider_accept') return;
  if (Date.parse(authorization.expiresAt) <= Date.parse(occurredAt)) throw new Error('ARCA_SETUP_AUTHORIZATION_EXPIRED');
  if (!authorization.permittedOperations.includes(operation)) throw new Error('ARCA_SETUP_OPERATION_NOT_AUTHORIZED');
}

function finish(
  previous: ArcaSetupExecutionV1,
  next: ArcaSetupExecutionV1,
  command: ArcaSetupCommand,
  actorId: string,
  occurredAt: IsoDateTime,
  metadata: Readonly<Record<string, string | number | boolean | null>>,
  emitEvent = true,
  action: string = command.kind,
): Readonly<{ execution: ArcaSetupExecutionV1; event: ArcaSetupEventV1 | null }> {
  const execution: ArcaSetupExecutionV1 = {
    ...next,
    revision: previous.revision + 1,
    updatedAt: occurredAt,
    processedKeys: [...previous.processedKeys, command.idempotencyKey].slice(-500),
  };
  return {
    execution,
    event: emitEvent ? eventFor(execution, action, actorId, occurredAt, command.idempotencyKey, metadata) : null,
  };
}

function eventFor(
  execution: ArcaSetupExecutionV1,
  action: string,
  actorId: string,
  occurredAt: IsoDateTime,
  idempotencyKey: string,
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>,
): ArcaSetupEventV1 {
  return {
    version: 'arca-setup-event-v1',
    eventId: randomUUID(),
    executionId: execution.executionId,
    workspaceId: execution.workspaceId,
    action,
    actorId,
    occurredAt,
    idempotencyKey,
    safeMetadata,
  };
}

function blocker(
  code: string,
  retryable: boolean,
  userAction: ArcaSetupBlockerV1['userAction'],
  observedAt: IsoDateTime,
): ArcaSetupBlockerV1 {
  if (!/^[A-Z0-9_]{3,120}$/.test(code)) throw new Error('ARCA_SETUP_CODE_INVALID');
  return { code, retryable, userAction, observedAt };
}

function assertInventory(inventory: ArcaSetupInventoryV1): void {
  if (inventory.version !== 'arca-setup-inventory-v1') throw new Error('ARCA_SETUP_INVENTORY_VERSION_INVALID');
  assertHash(inventory.evidenceHash, 'ARCA_SETUP_INVENTORY_EVIDENCE_INVALID');
  assertHash(inventory.identity.loginIdentityHash, 'ARCA_SETUP_LOGIN_IDENTITY_INVALID');
  assertHash(inventory.identity.representedCuitCommitment, 'ARCA_SETUP_COMMITMENT_INVALID');
  const points = [
    ...inventory.pointsOfSale.exportWebServices,
    ...inventory.pointsOfSale.domesticWebServices,
    ...inventory.pointsOfSale.usedNumbers,
  ];
  if (points.some(point => !Number.isInteger(point) || point < 1 || point > 99_999))
    throw new Error('ARCA_POINT_OF_SALE_INVALID');
}

function sameServices(left: readonly ArcaWebService[], right: readonly ArcaWebService[]): boolean {
  return [...new Set(left)].sort().join(',') === [...new Set(right)].sort().join(',');
}

function assertHash(value: string, code: string): void {
  if (!SHA256.test(value)) throw new Error(code);
}

/** Live View links and Cloudflare capabilities are credentials. They never enter this aggregate. */
const FORBIDDEN_VALUE = /(?:live\.browser\.run|devtools:\/\/|[?&]jwt=|wss:\/\/|BEGIN (?:RSA |EC )?PRIVATE KEY|BEGIN CERTIFICATE REQUEST)/i;

function assertSafe(value: unknown): void {
  assertSafeHumanAuthValue(value);
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      if (FORBIDDEN_VALUE.test(candidate)) throw new Error('ARCA_SETUP_SENSITIVE_MATERIAL_FORBIDDEN');
      if (/^\d{11}$/.test(candidate)) throw new Error('ARCA_SETUP_RAW_TAX_ID_FORBIDDEN');
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    for (const nested of Object.values(candidate as Record<string, unknown>)) visit(nested);
  };
  visit(value);
}

/** Stable hash for a canonical value; re-exported so callers bind evidence the same way. */
export function arcaSetupEvidenceHash(value: unknown): string {
  return hashCanonical(value);
}
