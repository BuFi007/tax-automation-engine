import {
  HUMAN_AUTH_CAPTURE_POLICY_HASH,
  HOSTED_HUMAN_AUTH_POLICY_V2_HASH,
  applyArcaSetupCommand,
  arcaSetupPendingDecision,
  arcaSetupPermittedOperations,
  connectArcaSetupExecution,
  createArcaSetupExecution,
  hashCanonical,
  planArcaSetup,
  projectArcaSetupProgress,
  type ArcaOnboardingRunV1,
  type ArcaSetupAuthorizationV1,
  type ArcaSetupCommand,
  type ArcaSetupDecisionKind,
  type ArcaSetupExecutionV1,
  type ArcaSetupMode,
  type ArcaSetupOperation,
  type ArcaSetupOrderV1,
  type ArcaSetupProgressV1,
  type ArcaSetupReceiptV1,
  type ArcaWebService,
} from '@tax-engine/core';
import {
  arcaSetupReceiptSchema,
  canonicalHash,
  mintArcaSetupHandoffTicket,
  verifyArcaSetupMessage,
  type ArcaSetupWireOrder,
} from '@tax-engine/arca-setup-contract';

import { arcaSetupControlV1Schema, type ArcaSetupControlV1 } from '@tax-engine/browser-contracts/arca-onboarding';

import type { ArcaOnboardingService } from './arca-onboarding';
import type { ArcaSetupBoundaryGateway, ArcaSetupExecutorGateway } from './arca-setup-clients';
import { ArcaSetupStore, type ArcaSetupControlSnapshot } from './arca-setup-store';
import { createHash, randomUUID } from 'node:crypto';

/**
 * Automated ARCA connection service.
 *
 * Small surface for both entry points (the customer's UI and the agent):
 * start, status, authorize, decide, retry, handoff ticket, cancel, plus the
 * executor's receipt intake and the scheduler tick. Everything else — order
 * construction, onboarding commands, boundary provisioning, API verification,
 * propagation backoff, session cleanup — happens inside `advance`, under a
 * taxpayer-scoped lease, from the last durable revision.
 */

const LEASE_TTL_MS = 2 * 60_000;
const ORDER_TTL_MS = 30 * 60_000;
const ORDER_REDISPATCH_MS = 2 * 60_000;
const AUTHORIZATION_TTL_MS = 24 * 60 * 60_000;
const PROPAGATION_MAX_ATTEMPTS = 14;
const MAX_STEPS_PER_ADVANCE = 12;
/** Verification failures that ARCA typically resolves on its own after a relationship change. */
const PROPAGATION_CODES = /POINT_OF_SALE_NOT_ACTIVE|DISCOVERY_UNAVAILABLE|WSFE_READ_UNAVAILABLE|WSAA|NOT_AUTHORIZED|UPSTREAM_UNAVAILABLE/;

export type ArcaSetupConsent = Readonly<{
  allowPointOfSaleCreation: boolean;
  allowCertificateReplacement: boolean;
  billingReferenceHash: string | null;
  consentTextHash: string;
}>;

export class ArcaSetupAutomationService {
  readonly #holder = ArcaSetupStore.newLeaseHolder();

  constructor(private readonly deps: Readonly<{
    store: ArcaSetupStore;
    onboarding: ArcaOnboardingService;
    executor: ArcaSetupExecutorGateway | null;
    boundary: ArcaSetupBoundaryGateway | null;
    handoffSecret: string | null;
    receiptSecret: string | null;
    providerDelegationAvailable: boolean;
    reclaimAvailable: boolean;
    clock?: () => Date;
  }>) {}

  capabilities(): Readonly<Record<string, unknown>> {
    return {
      version: 'arca-setup-capabilities-v1',
      executor: this.deps.executor ? 'available' : 'configuration_required',
      boundarySetup: this.deps.boundary ? 'available' : 'configuration_required',
      modes: this.deps.providerDelegationAvailable ? ['provider_delegation', 'customer_certificate'] : ['customer_certificate'],
      hostedAuthPolicyHash: HOSTED_HUMAN_AUTH_POLICY_V2_HASH,
      reclaimWitness: this.deps.reclaimAvailable ? 'available' : 'configuration_required',
      invariants: [
        'customer_authorizes_scope_once_through_the_trusted_ui',
        'customer_authenticates_inside_the_same_hosted_session',
        'automation_and_observation_pause_during_credential_entry',
        'private_keys_and_raw_cuits_stay_in_the_boundary',
        'connected_requires_api_verification_and_reclaim_proof',
      ],
    };
  }

  /** Create or resume the one automation for this onboarding run. */
  async start(input: Readonly<{
    onboardingId: string;
    workspaceId: string;
    startedBy: Readonly<{ kind: 'agent' | 'user'; actorId: string }>;
    mode?: ArcaSetupMode;
    idempotencyKey: string;
  }>): Promise<ArcaSetupProgressV1> {
    this.requireConfigured();
    const run = this.deps.onboarding.getRun(input.onboardingId);
    if (run.workspaceId !== input.workspaceId) throw new Error('ARCA_SETUP_WORKSPACE_MISMATCH');
    if (run.status === 'failed') throw new Error('ARCA_ONBOARDING_NOT_ACTIVE');
    const scopeKey = ArcaSetupStore.scopeKey(run);
    const active = this.deps.store.activeForScope(scopeKey);
    if (active) {
      if (active.onboardingId !== run.onboardingId) throw new Error('ARCA_SETUP_ANOTHER_RUN_ACTIVE_FOR_TAXPAYER');
      await this.advance(active.executionId);
      return this.status(active.executionId);
    }
    const mode = input.mode ?? (this.deps.providerDelegationAvailable ? 'provider_delegation' : 'customer_certificate');
    if (mode === 'provider_delegation' && !this.deps.providerDelegationAvailable) throw new Error('ARCA_SETUP_PROVIDER_DELEGATION_UNAVAILABLE');
    const executionId = uuidFrom(`${run.onboardingId}:${input.idempotencyKey}`);
    const existing = this.deps.store.get(executionId);
    if (existing) return projectArcaSetupProgress(existing);
    const now = this.now();
    const created = createArcaSetupExecution({
      executionId,
      onboardingId: run.onboardingId,
      workspaceId: run.workspaceId,
      environment: run.environment,
      taxpayerReferenceHash: run.taxpayerReferenceHash,
      requestedServices: run.requestedServices,
      mode,
      startedBy: input.startedBy,
      occurredAt: now,
      idempotencyKey: input.idempotencyKey,
    });
    const stored = this.deps.store.append(created.execution, created.event, input.idempotencyKey, now);
    // The boundary session exists before any browser step so identity can be checked at login.
    const session = await this.deps.boundary!.createSession({
      executionId: stored.executionId,
      onboardingId: stored.onboardingId,
      workspaceId: stored.workspaceId,
      environment: stored.environment,
      taxpayerReferenceHash: stored.taxpayerReferenceHash,
      issuerProfileRef: stored.issuerProfileRef,
      mode: stored.mode,
    });
    this.deps.store.setPrivate(stored.executionId, { setupRef: session.setupRef }, now);
    await this.advance(stored.executionId);
    return this.status(stored.executionId);
  }

  status(executionId: string): ArcaSetupProgressV1 {
    return projectArcaSetupProgress(this.get(executionId));
  }

  statusForOnboarding(onboardingId: string): ArcaSetupProgressV1 | null {
    const execution = this.deps.store.latestForOnboarding(onboardingId);
    return execution ? projectArcaSetupProgress(execution) : null;
  }

  get(executionId: string): ArcaSetupExecutionV1 {
    const execution = this.deps.store.get(executionId);
    if (!execution) throw new Error('ARCA_SETUP_NOT_FOUND');
    return execution;
  }

  /** The customer's one-time scoped consent. Only reachable through a user principal. */
  async authorize(input: Readonly<{
    executionId: string;
    actorId: string;
    consent: ArcaSetupConsent;
    idempotencyKey: string;
  }>): Promise<ArcaSetupProgressV1> {
    if (input.actorId.startsWith('agent:')) throw new Error('ARCA_SETUP_AUTHORIZATION_REQUIRES_USER');
    const execution = this.get(input.executionId);
    const now = this.now();
    const authorization: ArcaSetupAuthorizationV1 = {
      version: 'arca-setup-authorization-v1',
      authorizationId: uuidFrom(`${execution.executionId}:authorization:${input.idempotencyKey}`),
      executionId: execution.executionId,
      onboardingId: execution.onboardingId,
      workspaceId: execution.workspaceId,
      actorId: input.actorId,
      taxpayerReferenceHash: execution.taxpayerReferenceHash,
      environment: execution.environment,
      requestedServices: execution.requestedServices,
      mode: execution.mode,
      permittedOperations: arcaSetupPermittedOperations(execution.mode),
      allowPointOfSaleCreation: input.consent.allowPointOfSaleCreation,
      allowCertificateReplacement: input.consent.allowCertificateReplacement,
      billingReferenceHash: input.consent.billingReferenceHash,
      consentTextHash: input.consent.consentTextHash,
      grantedAt: now,
      expiresAt: new Date(Date.parse(now) + AUTHORIZATION_TTL_MS).toISOString(),
    };
    this.apply(execution, { kind: 'grant_authorization', grant: authorization, idempotencyKey: input.idempotencyKey }, input.actorId);
    await this.advance(execution.executionId);
    return this.status(execution.executionId);
  }

  async decide(input: Readonly<{
    executionId: string;
    actorId: string;
    decision: ArcaSetupDecisionKind;
    value: number | 'replace' | 'keep';
    expectedRevision: number;
    idempotencyKey: string;
  }>): Promise<ArcaSetupProgressV1> {
    if (input.actorId.startsWith('agent:')) throw new Error('ARCA_SETUP_DECISION_REQUIRES_USER');
    const execution = this.get(input.executionId);
    this.apply(execution, {
      kind: 'record_decision', decision: input.decision, value: input.value,
      expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey,
    }, input.actorId);
    await this.advance(execution.executionId);
    return this.status(execution.executionId);
  }

  /** Resume after the customer fixed a recoverable blocker (signed in again, waited for ARCA). */
  async retry(input: Readonly<{ executionId: string; actorId: string; idempotencyKey: string }>): Promise<ArcaSetupProgressV1> {
    const execution = this.get(input.executionId);
    if (execution.phase === 'recoverable_action_required' || execution.phase === 'waiting_for_propagation') {
      this.apply(execution, { kind: 'set_phase', phase: 'running', blocker: null, idempotencyKey: input.idempotencyKey }, input.actorId);
    }
    await this.advance(execution.executionId);
    return this.status(execution.executionId);
  }

  /**
   * A single-use, two-minute link to the hosted ARCA tab, for the authenticated
   * caller only. Returned to the UI channel; never to the agent.
   */
  async handoffLink(input: Readonly<{
    executionId: string;
    actorId: string;
    purpose: 'customer_authentication' | 'provider_authentication' | 'customer_view' | 'customer_control';
  }>): Promise<Readonly<{ url: string; expiresAt: string }>> {
    this.requireConfigured();
    if (!this.deps.handoffSecret) throw new Error('ARCA_SETUP_HANDOFF_CONFIGURATION_REQUIRED');
    const execution = this.get(input.executionId);
    const operation = execution.currentOrder?.operation;
    const expected = input.purpose === 'provider_authentication' ? 'provider_accept' : undefined;
    const terminal = execution.phase === 'connected' || execution.phase === 'cancelled' || execution.phase === 'failed';
    if (
      (input.purpose === 'customer_authentication' && execution.phase !== 'awaiting_user_authentication')
      || (input.purpose === 'provider_authentication' && operation !== expected)
      || ((input.purpose === 'customer_view' || input.purpose === 'customer_control') && terminal)
    ) throw new Error('ARCA_SETUP_HANDOFF_NOT_PENDING');
    // The customer-facing tickets carry the opaque actor ref the executor's control state uses.
    const ticketActor = input.purpose === 'customer_view' || input.purpose === 'customer_control'
      ? actorRefFor(execution.executionId, input.actorId)
      : input.actorId;
    if (input.purpose === 'customer_control') {
      const control = this.deps.store.control(execution.executionId);
      if (control?.mode !== 'human' || control.controllerRef !== ticketActor) throw new Error('ARCA_CONTROL_NOT_HOLDER');
    }
    const minted = await mintArcaSetupHandoffTicket(this.deps.handoffSecret, {
      executionId: execution.executionId, actorId: ticketActor, purpose: input.purpose,
    }, this.clock());
    this.deps.store.setPrivate(execution.executionId, { lastHandoffTicketHash: minted.ticketHash }, this.now());
    return { url: this.deps.executor!.handoffUrl(execution.executionId, minted.ticket), expiresAt: minted.expiresAt };
  }

  /**
   * Pause, resume, take or return control. The executor applies it at a safe
   * point and enforces it; this relays its signed answer, so a "paused" here
   * means the session transport acknowledged it, not that a button was hit.
   */
  async control(input: Readonly<{
    executionId: string;
    actorId: string;
    action: 'pause' | 'resume' | 'take_control' | 'return_control';
    requestId?: string;
  }>): Promise<ArcaSetupControlV1> {
    this.requireConfigured();
    const execution = this.get(input.executionId);
    if (execution.phase === 'connected' || execution.phase === 'cancelled' || execution.phase === 'failed')
      throw new Error('ARCA_SETUP_TERMINAL');
    const actorRef = actorRefFor(execution.executionId, input.actorId);
    const { state, conflict } = await this.deps.executor!.control({
      version: 'arca-setup-control-v1',
      executionId: execution.executionId,
      action: input.action,
      actorRef,
      requestId: input.requestId ?? randomUUID(),
      requestedAt: this.now(),
    });
    this.recordControl(execution.executionId, state);
    if (conflict) throw new Error(conflict);
    return projectControl(execution.executionId, state, actorRef);
  }

  async controlStatus(input: Readonly<{ executionId: string; actorId: string }>): Promise<ArcaSetupControlV1> {
    this.requireConfigured();
    const execution = this.get(input.executionId);
    const state = await this.deps.executor!.controlState(execution.executionId);
    this.recordControl(execution.executionId, state);
    return projectControl(execution.executionId, state, actorRefFor(execution.executionId, input.actorId));
  }

  private recordControl(executionId: string, state: ArcaSetupControlSnapshot): void {
    const before = this.deps.store.control(executionId);
    this.deps.store.setControl(executionId, {
      mode: state.mode,
      controllerRef: state.controllerRef,
      requestId: state.requestId,
      acknowledgedAt: state.acknowledgedAt,
      handoff: state.handoff,
      rejection: state.rejection,
      generation: state.generation,
      observedAt: state.observedAt,
    });
    // Automation is back: let the scheduler move the run on.
    if (before && before.mode !== 'automation' && state.mode === 'automation') void this.advance(executionId).catch(() => undefined);
  }

  async cancel(input: Readonly<{
    executionId: string;
    actorId: string;
    reason: 'customer_cancelled' | 'agent_cancelled';
    idempotencyKey: string;
  }>): Promise<Readonly<{ progress: ArcaSetupProgressV1; sessionClosed: boolean; sessionVerifiedGone: boolean }>> {
    const execution = this.get(input.executionId);
    if (execution.phase !== 'cancelled') this.apply(execution, { kind: 'cancel', idempotencyKey: input.idempotencyKey }, input.actorId);
    const closure = await this.closeSessions(execution.executionId, input.reason);
    return { progress: this.status(execution.executionId), sessionClosed: closure.sessionClosed, sessionVerifiedGone: closure.sessionVerifiedGone };
  }

  /** Signed executor receipt: verify, bind to the outstanding order, apply, advance. */
  async ingestReceipt(rawBody: string, headers: Headers): Promise<Readonly<{ applied: boolean; replayed: boolean }>> {
    if (!this.deps.receiptSecret) throw new Error('ARCA_SETUP_RECEIPT_CONFIGURATION_REQUIRED');
    await verifyArcaSetupMessage(this.deps.receiptSecret, 'receipt', headers, rawBody, this.clock());
    const receipt = arcaSetupReceiptSchema.parse(JSON.parse(rawBody)) as ArcaSetupReceiptV1;
    const seen = this.deps.store.recordReceipt(receipt.receiptId, receipt.executionId, await canonicalHash(receipt), this.now());
    if (seen === 'conflict') throw new Error('ARCA_SETUP_RECEIPT_CONFLICT');
    if (seen === 'duplicate') return { applied: false, replayed: true };
    const execution = this.get(receipt.executionId);
    if (execution.phase === 'cancelled' || execution.phase === 'connected' || execution.phase === 'failed')
      return { applied: false, replayed: false };
    const next = this.apply(execution, { kind: 'record_receipt', receipt, idempotencyKey: `receipt:${receipt.receiptId}` }, 'executor:arca-setup');
    if (receipt.operation === 'provider_accept' && receipt.outcome === 'completed')
      this.deps.store.setPrivate(next.executionId, { providerAcceptanceEvidenceHash: receipt.evidenceHash }, this.now());
    await this.advance(next.executionId);
    return { applied: true, replayed: false };
  }

  /** BUFI operators: executions waiting for BUFI to accept the customer's designation. */
  providerQueue(): readonly ArcaSetupProgressV1[] {
    return this.deps.store.listOpen(200)
      .filter(execution => execution.phase === 'awaiting_provider_acceptance' && execution.mode === 'provider_delegation')
      .map(projectArcaSetupProgress);
  }

  /** Dispatch the provider-side acceptance under BUFI's own authority, then hand off to the operator. */
  async dispatchProviderAcceptance(input: Readonly<{ executionId: string; operatorId: string; idempotencyKey: string }>): Promise<ArcaSetupProgressV1> {
    const execution = this.get(input.executionId);
    if (execution.phase !== 'awaiting_provider_acceptance' || execution.currentOrder)
      throw new Error('ARCA_SETUP_PROVIDER_ACCEPTANCE_NOT_PENDING');
    await this.dispatch(execution, 'provider_accept', { services: [...execution.requestedServices] });
    return this.status(execution.executionId);
  }

  /** Scheduler: resend lost orders, retry propagation, keep runs moving after restarts. */
  async tick(limit = 50): Promise<void> {
    for (const executionId of this.deps.store.listCleanupPending(limit)) {
      const execution = this.deps.store.get(executionId);
      if (execution) await this.closeSessions(executionId, execution.phase === 'connected' ? 'completed' : 'customer_cancelled');
    }
    for (const execution of this.deps.store.listOpen(limit)) {
      try {
        await this.advance(execution.executionId);
      } catch {
        // One broken run must not stop the others; its state stays as recorded.
      }
    }
  }

  /** Drive one execution as far as it can go without a human. */
  async advance(executionId: string): Promise<void> {
    const initial = this.get(executionId);
    const scopeKey = ArcaSetupStore.scopeKey(initial);
    if (!this.deps.store.acquireLease(scopeKey, this.#holder, LEASE_TTL_MS, this.clock())) return;
    try {
      for (let step = 0; step < MAX_STEPS_PER_ADVANCE; step += 1) {
        const execution = this.get(executionId);
        const run = this.deps.onboarding.getRun(execution.onboardingId);
        const progressed = await this.step(execution, run);
        if (!progressed) return;
      }
    } finally {
      this.deps.store.releaseLease(scopeKey, this.#holder);
    }
  }

  private async step(execution: ArcaSetupExecutionV1, run: ArcaOnboardingRunV1): Promise<boolean> {
    const now = this.now();
    if (execution.currentOrder) {
      // Redeliver an order the executor may not have received; it dedupes by order id.
      if (Date.parse(execution.currentOrder.issuedAt) + ORDER_REDISPATCH_MS < Date.parse(now)
        && Date.parse(execution.currentOrder.expiresAt) > Date.parse(now)) {
        await this.deps.executor!.dispatch(execution.currentOrder as ArcaSetupWireOrder).catch(() => undefined);
      }
      if (Date.parse(execution.currentOrder.expiresAt) <= Date.parse(now)) {
        this.apply(execution, { kind: 'record_receipt', receipt: expiredReceipt(execution, now), idempotencyKey: `expired:${execution.currentOrder.orderId}` }, 'tax:arca-setup');
        return true;
      }
      return false;
    }
    if (!execution.decision) {
      const decision = arcaSetupPendingDecision(execution, run, now);
      if (decision) {
        this.apply(execution, { kind: 'request_decision', decision, idempotencyKey: `decision:${decision.kind}:${execution.revision}` }, 'tax:arca-setup');
        return false;
      }
    }
    const plan = planArcaSetup(execution, run, now);
    switch (plan.kind) {
      case 'dispatch':
        // Paused or human-held: no new order. The executor refuses it too.
        if ((this.deps.store.control(execution.executionId)?.mode ?? 'automation') !== 'automation') return false;
        await this.dispatch(execution, plan.operation, plan.parameters);
        return false;
      case 'await_order':
        return false;
      case 'await_user':
        if (plan.phase !== execution.phase && plan.phase !== 'awaiting_user_decision') {
          this.apply(execution, {
            kind: 'set_phase',
            phase: plan.phase,
            blocker: plan.phase === 'recoverable_action_required' && !execution.blocker
              ? { code: 'ARCA_SETUP_CONSENT_REQUIRED', retryable: true, userAction: 'retry', observedAt: now }
              : execution.blocker,
            idempotencyKey: `phase:${plan.phase}:${execution.revision}`,
          }, 'tax:arca-setup');
        }
        return false;
      case 'apply_onboarding':
        this.applyOnboarding(execution, run, plan.command, now);
        return true;
      case 'provision_boundary':
        await this.provision(execution);
        return true;
      case 'verify_api':
        return this.verify(execution, run, plan.service);
      case 'request_proof':
        return this.awaitProof(execution);
      case 'connected':
        this.connect(execution, run);
        return false;
      case 'stop':
        return false;
    }
  }

  private async dispatch(
    execution: ArcaSetupExecutionV1,
    operation: ArcaSetupOperation,
    parameters: ArcaSetupOrderV1['parameters'],
  ): Promise<void> {
    const references = this.deps.store.private(execution.executionId);
    if (!references.setupRef) throw new Error('ARCA_SETUP_BOUNDARY_SESSION_MISSING');
    let enrollmentRef = references.enrollmentRef;
    if (operation === 'enroll_certificate' && !enrollmentRef) {
      enrollmentRef = (await this.deps.boundary!.createEnrollment({ setupRef: references.setupRef, alias: execution.intendedAlias })).enrollmentRef;
      this.deps.store.setPrivate(execution.executionId, { enrollmentRef }, this.now());
    }
    const issuedAt = this.now();
    const order: ArcaSetupOrderV1 = {
      version: 'arca-setup-order-v1',
      orderId: `${execution.executionId}:${execution.revision}:${operation}`,
      executionId: execution.executionId,
      onboardingId: execution.onboardingId,
      workspaceId: execution.workspaceId,
      environment: execution.environment,
      operation,
      authorizationId: execution.authorization!.authorizationId,
      expectedRevision: execution.revision,
      attempt: 1,
      parameters: {
        ...parameters,
        setupRef: references.setupRef,
        intendedAlias: execution.intendedAlias,
        services: [...execution.requestedServices],
        ...(enrollmentRef && operation === 'enroll_certificate' ? { enrollmentRef } : {}),
      },
      issuedAt,
      expiresAt: new Date(Date.parse(issuedAt) + ORDER_TTL_MS).toISOString(),
    };
    const dispatched = this.apply(execution, { kind: 'dispatch_order', order, idempotencyKey: `dispatch:${order.orderId}` }, 'tax:arca-setup');
    try {
      const outcome = await this.deps.executor!.dispatch(order as ArcaSetupWireOrder);
      if (outcome === 'busy') throw new Error('ARCA_SETUP_EXECUTOR_BUSY');
    } catch {
      // Recorded as outstanding; the tick resends the same order id until it lands or expires.
      void dispatched;
    }
  }

  private applyOnboarding(execution: ArcaSetupExecutionV1, run: ArcaOnboardingRunV1, command: 'login' | 'service_adherence' | 'point_of_sale' | 'ws_delegation', now: string): void {
    const inventory = execution.inventory;
    const key = (suffix: string) => `arca-setup:${execution.executionId}:${suffix}`;
    const apply = (onboardingCommand: Parameters<ArcaOnboardingService['applyManualCommand']>[0]['command'], at = now) =>
      this.deps.onboarding.applyManualCommand({ onboardingId: run.onboardingId, actorId: 'executor:arca-setup', occurredAt: at, command: onboardingCommand });
    switch (command) {
      case 'login': {
        const authenticated = this.deps.store.events(execution.executionId).filter(event =>
          event.action === 'record_receipt' && event.safeMetadata.operation === 'authenticate' && event.safeMetadata.outcome === 'completed').at(-1);
        const completedAt = authenticated?.occurredAt ?? now;
        const evidence = hashCanonical({ executionId: execution.executionId, authenticatedAt: completedAt, policy: HOSTED_HUMAN_AUTH_POLICY_V2_HASH });
        if (run.currentStep === 'login_handoff') {
          apply({ kind: 'complete_login_handoff', browserSessionReferenceHash: hashCanonical({ executionId: execution.executionId, hostedSession: true }), idempotencyKey: key('login-handoff') }, completedAt);
        }
        apply({
          kind: 'record_human_auth_completion',
          completion: {
            version: 'human-auth-completion-v1',
            completionReceiptHash: evidence,
            // The v1 capture prohibitions held throughout; v2 adds only the private human display.
            capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH,
            completedAt,
            signatureVerified: true,
          },
          idempotencyKey: key('human-auth'),
        }, completedAt);
        return;
      }
      case 'service_adherence':
        apply({
          kind: 'record_service_adherence', pointOfSaleAdministrationActive: true, relationshipManagerActive: true,
          evidenceHash: inventory!.evidenceHash, idempotencyKey: key(`adherence:${inventory!.evidenceHash.slice(0, 16)}`),
        });
        return;
      case 'point_of_sale': {
        const exportOnly = run.requestedServices.includes('wsfex');
        const points = exportOnly ? inventory!.pointsOfSale.exportWebServices : inventory!.pointsOfSale.domesticWebServices;
        const chosen = exportOnly ? execution.decisions.export_point_of_sale : execution.decisions.domestic_point_of_sale;
        if (run.currentStep === 'point_of_sale_discovery') {
          if (points.length > 1 && typeof chosen === 'number') {
            apply({ kind: 'record_point_of_sale_discovery', exportPointOfSale: chosen, activeExportPoints: points, evidenceHash: inventory!.evidenceHash, idempotencyKey: key('discovery') });
            const after = this.deps.onboarding.getRun(run.onboardingId);
            if (after.currentStep === 'point_of_sale_discovery')
              apply({ kind: 'select_discovered_point_of_sale', exportPointOfSale: chosen, idempotencyKey: key('selection') });
          } else {
            apply({ kind: 'record_point_of_sale_discovery', exportPointOfSale: points[0] ?? null, evidenceHash: inventory!.evidenceHash, idempotencyKey: key('discovery') });
          }
        } else {
          const created = points.at(-1);
          if (!created) throw new Error('ARCA_POINT_OF_SALE_REQUIRED');
          apply({ kind: 'record_point_of_sale_creation', exportPointOfSale: created, evidenceHash: inventory!.evidenceHash, idempotencyKey: key('creation') });
        }
        return;
      }
      case 'ws_delegation': {
        const services = Object.fromEntries((['wsfex', 'wsfe'] as const).map(service => [service, execution.requestedServices.includes(service)])) as Record<ArcaWebService, boolean>;
        apply({
          kind: 'record_ws_delegation',
          delegatedServices: services,
          issuerProfileReferenceHash: hashCanonical(execution.issuerProfileRef),
          representedCuitCommitment: execution.boundary.representedCuitCommitment!,
          evidenceHash: hashCanonical({ inventory: inventory!.evidenceHash, boundary: execution.boundary.certificateFingerprintHash }),
          idempotencyKey: key('ws-delegation'),
        });
        return;
      }
    }
  }

  private async provision(execution: ArcaSetupExecutionV1): Promise<void> {
    const references = this.deps.store.private(execution.executionId);
    if (!references.setupRef) throw new Error('ARCA_SETUP_BOUNDARY_SESSION_MISSING');
    const receipt = await this.deps.boundary!.provision({
      setupRef: references.setupRef,
      relationshipEvidenceHash: execution.inventory!.evidenceHash,
      providerAcceptanceEvidenceHash: execution.mode === 'provider_delegation' ? references.providerAcceptanceEvidenceHash : null,
    });
    if (!receipt.delegationConfirmed) throw new Error('ARCA_SETUP_BOUNDARY_DELEGATION_NOT_CONFIRMED');
    this.apply(execution, {
      kind: 'record_boundary_provision',
      setupReferenceHash: hashCanonical(references.setupRef),
      certificateFingerprintHash: hashCanonical(receipt.certificateFingerprint),
      representedCuitCommitment: receipt.representedCuitCommitment,
      idempotencyKey: `provision:${receipt.certificateFingerprint.slice(0, 16)}`,
    }, 'tax:arca-setup');
  }

  /** Non-issuing provider checks through the existing signers; WSFEX never stands in for WSFE. */
  private async verify(execution: ArcaSetupExecutionV1, run: ArcaOnboardingRunV1, service: ArcaWebService): Promise<boolean> {
    const now = this.now();
    const attempt = execution.verification.attempts + 1;
    try {
      if (service === 'wsfex') {
        await this.deps.onboarding.verifyWsfexApi({
          onboardingId: run.onboardingId, issuerProfileRef: execution.issuerProfileRef,
          actorId: 'tax:arca-setup', idempotencyKey: `arca-setup:${execution.executionId}:verify-wsfex:${attempt}`, occurredAt: now,
        });
      } else {
        const domestic = execution.chosenDomesticPointOfSale
          ?? execution.inventory?.pointsOfSale.domesticWebServices[0]
          ?? undefined;
        await this.deps.onboarding.verifyWsfeApi({
          onboardingId: run.onboardingId, issuerProfileRef: execution.issuerProfileRef,
          ...(domestic === undefined ? {} : { pointOfSale: domestic }),
          actorId: 'tax:arca-setup', idempotencyKey: `arca-setup:${execution.executionId}:verify-wsfe:${attempt}`, occurredAt: now,
        });
      }
      this.apply(execution, { kind: 'record_verification_attempt', outcome: 'verified', code: null, nextAttemptAt: null, idempotencyKey: `verify:${service}:${attempt}` }, 'tax:arca-setup');
      return true;
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : 'ARCA_API_VERIFICATION_FAILED';
      // About 24 hours of exponential backoff (5, 10, 20, 40, 80, then every 2 hours).
      const propagating = PROPAGATION_CODES.test(code) && execution.verification.attempts < PROPAGATION_MAX_ATTEMPTS;
      const backoff = Math.min(5 * 60_000 * 2 ** Math.min(execution.verification.attempts, 5), 2 * 60 * 60_000);
      this.apply(execution, {
        kind: 'record_verification_attempt',
        outcome: propagating ? 'propagating' : 'blocked',
        code,
        nextAttemptAt: propagating ? new Date(Date.parse(now) + backoff).toISOString() : null,
        idempotencyKey: `verify:${service}:${attempt}:failed`,
      }, 'tax:arca-setup');
      return false;
    }
  }

  /**
   * The Reclaim WITNESS proof is captured by the customer on their own device
   * (ARCA binds sessions to the prover's network). The hosted browser is not
   * needed any more, so it is closed now.
   */
  private async awaitProof(execution: ArcaSetupExecutionV1): Promise<boolean> {
    if (execution.phase === 'waiting_for_proof') return false;
    this.apply(execution, {
      kind: 'set_phase',
      phase: 'waiting_for_proof',
      blocker: this.deps.reclaimAvailable
        ? null
        : { code: 'RECLAIM_ARCA_ONBOARDING_CONFIGURATION_REQUIRED', retryable: false, userAction: 'contact_support', observedAt: this.now() },
      idempotencyKey: `phase:waiting_for_proof:${execution.revision}`,
    }, 'tax:arca-setup');
    await this.closeSessions(execution.executionId, 'completed');
    return false;
  }

  private connect(execution: ArcaSetupExecutionV1, run: ArcaOnboardingRunV1): void {
    const connected = connectArcaSetupExecution(execution, run, this.now());
    if (connected.event) this.deps.store.append(connected.execution, connected.event, `connected:${run.revision}`, this.now());
    void this.closeSessions(execution.executionId, 'completed');
  }

  /**
   * End the remote browser sessions. Disconnecting is not closing, so the
   * executor closes them through Cloudflare and verifies they are gone. If it
   * cannot be reached, the tick retries until it confirms.
   */
  private async closeSessions(
    executionId: string,
    reason: 'customer_cancelled' | 'agent_cancelled' | 'completed',
  ): Promise<Readonly<{ sessionClosed: boolean; sessionVerifiedGone: boolean }>> {
    if (!this.deps.executor) return { sessionClosed: false, sessionVerifiedGone: false };
    try {
      const receipt = await this.deps.executor.cancel(executionId, reason);
      this.deps.store.setPrivate(executionId, { cleanupPending: !receipt.sessionVerifiedGone }, this.now());
      return receipt;
    } catch {
      this.deps.store.setPrivate(executionId, { cleanupPending: true }, this.now());
      return { sessionClosed: false, sessionVerifiedGone: false };
    }
  }

  private apply(execution: ArcaSetupExecutionV1, command: ArcaSetupCommand, actorId: string): ArcaSetupExecutionV1 {
    const now = this.now();
    const applied = applyArcaSetupCommand(execution, command, actorId, now);
    if (!applied.event && applied.execution === execution) return execution;
    return this.deps.store.append(applied.execution, applied.event, command.idempotencyKey, now);
  }

  private requireConfigured(): void {
    if (!this.deps.executor || !this.deps.boundary) throw new Error('ARCA_SETUP_AUTOMATION_CONFIGURATION_REQUIRED');
  }

  private clock(): Date {
    return this.deps.clock ? this.deps.clock() : new Date();
  }

  private now(): string {
    return this.clock().toISOString();
  }
}

function expiredReceipt(execution: ArcaSetupExecutionV1, now: string): ArcaSetupReceiptV1 {
  const order = execution.currentOrder!;
  return {
    version: 'arca-setup-receipt-v1',
    receiptId: `expired:${order.orderId}`,
    orderId: order.orderId,
    executionId: execution.executionId,
    onboardingId: execution.onboardingId,
    workspaceId: execution.workspaceId,
    operation: order.operation,
    expectedRevision: order.expectedRevision,
    // An order that produced no receipt may still have changed ARCA: inspect before acting.
    outcome: order.operation === 'authenticate' ? 'blocked' : 'uncertain',
    code: order.operation === 'authenticate' ? 'ARCA_AUTHENTICATION_NOT_COMPLETED' : 'ARCA_SETUP_ORDER_EXPIRED',
    observedAt: now,
    evidenceHash: hashCanonical({ expired: order.orderId, now }),
    inventory: null,
    result: {},
  };
}

function uuidFrom(seed: string): string {
  const hex = hashCanonical(seed);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Opaque per-execution actor reference: the executor never learns a member id. */
export function actorRefFor(executionId: string, actorId: string): string {
  return `actor:${createHash('sha256').update(`arca-setup-actor-v1\u0000${executionId}\u0000${actorId}`).digest('hex')}`;
}

function projectControl(executionId: string, state: ArcaSetupControlSnapshot, actorRef: string): ArcaSetupControlV1 {
  const pendingAction = state.mode === 'pause_requested' ? 'pause'
    : state.mode === 'control_requested' ? 'take_control'
      : state.mode === 'return_requested' ? 'return_control'
        : null;
  return arcaSetupControlV1Schema.parse({
    version: 'arca-setup-control-v1',
    executionId,
    mode: state.mode,
    heldBy: state.controllerRef === null ? null : state.controllerRef === actorRef ? 'you' : 'another_member',
    pendingAction,
    acknowledgedAt: state.acknowledgedAt,
    handoff: state.handoff,
    rejection: state.rejection,
    generation: state.generation,
    observedAt: state.observedAt,
  });
}
