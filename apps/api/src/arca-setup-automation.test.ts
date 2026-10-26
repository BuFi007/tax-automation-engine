import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  signArcaSetupMessage,
  type ArcaSetupWireCancelReceipt,
  type ArcaSetupWireInventory,
  type ArcaSetupWireOrder,
} from '@tax-engine/arca-setup-contract';
import { arcaSetupHandoffLinkV1Schema, arcaSetupProgressV1Schema } from '@tax-engine/browser-contracts/arca-onboarding';
import { hashCanonical, type ArcaOnboardingRunV1 } from '@tax-engine/core';

import { invokeArcaConnectionAgentTool } from './arca-connection-agent-tools';
import { ArcaOnboardingService } from './arca-onboarding';
import type { ArcaOnboardingReclaimGateway } from './arca-onboarding-reclaim';
import { ArcaSetupAutomationService } from './arca-setup-automation';
import type { ArcaSetupBoundaryGateway, ArcaSetupExecutorGateway } from './arca-setup-clients';
import { ArcaSetupStore } from './arca-setup-store';
import { TaxProfileStore } from './store';
import type { WsfexPointOfSaleGateway } from './wsfex';
import type { WsfePointOfSaleGateway } from './wsfe';

const RECEIPT_SECRET = 'r'.repeat(40);
const HANDOFF_SECRET = 'h'.repeat(40);
const ONBOARDING_ID = '70000000-0000-4000-8000-000000000001';
const WORKSPACE = 'workspace-arca-1';
const COMMITMENT = hashCanonical('represented-commitment');
const h = (value: string) => hashCanonical(value);

class Clock {
  constructor(public value = Date.now()) {}
  now = () => new Date(this.value);
  advance(ms: number) { this.value += ms; }
}

class FakeExecutor implements ArcaSetupExecutorGateway {
  orders: ArcaSetupWireOrder[] = [];
  cancellations: string[] = [];
  async dispatch(order: ArcaSetupWireOrder) {
    if (this.orders.some(existing => existing.orderId === order.orderId)) return 'duplicate' as const;
    this.orders.push(order);
    return 'accepted' as const;
  }
  async cancel(executionId: string): Promise<ArcaSetupWireCancelReceipt> {
    this.cancellations.push(executionId);
    return { version: 'arca-setup-cancel-receipt-v1', executionId, sessionClosed: true, sessionVerifiedGone: true, closedAt: new Date().toISOString() };
  }
  handoffUrl(executionId: string, ticket: string) {
    return `https://executor.example/handoff/${executionId}?ticket=${encodeURIComponent(ticket)}`;
  }
  get last() { return this.orders.at(-1)!; }
}

class FakeBoundary implements ArcaSetupBoundaryGateway {
  sessions = 0;
  enrollments = 0;
  provisions: { providerAcceptanceEvidenceHash: string | null }[] = [];
  async createSession() { this.sessions += 1; return { setupRef: 'setup://80000000-0000-4000-8000-000000000001' }; }
  async createEnrollment() { this.enrollments += 1; return { enrollmentRef: 'enrollment://80000000-0000-4000-8000-000000000002', csrHash: h('csr') }; }
  async provision(input: { providerAcceptanceEvidenceHash: string | null }) {
    this.provisions.push(input);
    return { certificateFingerprint: h('certificate'), representedCuitCommitment: COMMITMENT, delegationConfirmed: true };
  }
  async status() { return { state: 'provisioned', representedCuitCommitment: COMMITMENT, certificateFingerprint: h('certificate') }; }
}

class FakeWsfex implements WsfexPointOfSaleGateway {
  failures = 0;
  constructor(public activePoints: number[]) {}
  async discoverPointsOfSale(input: { workspaceId: string; issuerProfileRef: string }) {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error('ARCA_POINT_OF_SALE_DISCOVERY_UNAVAILABLE');
    }
    const evidence = {
      version: 'arca-wsfex-point-of-sale-discovery-v1' as const,
      environment: 'homologation' as const,
      workspaceId: input.workspaceId,
      issuerProfileReferenceHash: h(input.issuerProfileRef),
      representedCuitCommitment: COMMITMENT,
      activePoints: [...this.activePoints],
      authorityResponseHash: h('wsfex-response'),
      observedAt: '2026-10-26T12:00:00.000Z',
    };
    return { ...evidence, evidenceHash: hashCanonical(evidence) };
  }
  async verifyPointOfSaleReadback(): Promise<never> { throw new Error('not used'); }
}

class FakeWsfe implements WsfePointOfSaleGateway {
  calls = 0;
  constructor(public activePoints: number[]) {}
  async discoverPointsOfSale(input: { workspaceId: string; issuerProfileRef: string }) {
    this.calls += 1;
    const evidence = {
      version: 'arca-wsfe-point-of-sale-discovery-v1' as const,
      environment: 'homologation' as const,
      workspaceId: input.workspaceId,
      issuerProfileReferenceHash: h(input.issuerProfileRef),
      representedCuitCommitment: COMMITMENT,
      activePoints: [...this.activePoints],
      listedCount: this.activePoints.length,
      authorityResponseHash: h('wsfe-response'),
      observedAt: '2026-10-26T12:00:00.000Z',
    };
    return { ...evidence, evidenceHash: hashCanonical(evidence) } as never;
  }
  async verifyPointOfSaleReadback(): Promise<never> { throw new Error('not used'); }
}

class FakeReclaim implements ArcaOnboardingReclaimGateway {
  async createRequest(_run: ArcaOnboardingRunV1, occurredAt: string) {
    return {
      session: {
        sessionId: 'reclaim-session-1', providerId: 'arca-onboarding', providerVersion: '1.0.0',
        contextHash: h('context'), requestedAt: occurredAt,
        expiresAt: new Date(Date.parse(occurredAt) + 600_000).toISOString(), state: 'pending' as const,
      },
      requestUrl: 'https://reclaim.example/request', requestConfig: '{}', statusUrl: 'https://reclaim.example/status',
    };
  }
  async verifyCallback(_run: ArcaOnboardingRunV1, _session: unknown, _payload: unknown, occurredAt: string) {
    return {
      sessionId: 'reclaim-session-1', providerId: 'arca-onboarding', providerVersion: '1.0.0',
      proofHash: h('proof'), claimsHash: h('claims'), verifiedAt: occurredAt, teeVerified: false,
      claims: { pointOfSaleAdministrationActive: true as const, relationshipManagerActive: true as const, exportPointOfSaleActive: true as const, exportPointOfSale: 2, wsfexDelegated: true, wsfeDelegated: false },
    };
  }
}

function inventory(overrides: Partial<ArcaSetupWireInventory> = {}): ArcaSetupWireInventory {
  return {
    version: 'arca-setup-inventory-v1',
    observedAt: '2026-10-26T12:00:00.000Z',
    evidenceHash: h(JSON.stringify(overrides)),
    identity: { loginIdentityHash: h('login'), representedCuitCommitment: COMMITMENT, representedMatches: true },
    services: { relationshipManager: true, pointOfSaleAdministration: true, certificateAdministration: true },
    certificates: { intendedAliasExists: false, intendedAliasCertificateValidUntil: null, otherAliasCount: 0 },
    relationships: { wsfex: 'none', wsfe: 'none' },
    pointsOfSale: { exportWebServices: [], domesticWebServices: [], usedNumbers: [1], domicileCount: 1 },
    ...overrides,
  };
}

function harness(options: Partial<{ services: ('wsfex' | 'wsfe')[]; provider: boolean; path: string; reclaim: boolean }> = {}) {
  const clock = new Clock();
  const path = options.path ?? join(mkdtempSync(join(tmpdir(), 'arca-setup-')), 'tax.sqlite');
  const taxStore = new TaxProfileStore(path);
  const wsfex = new FakeWsfex([2]);
  const wsfe = new FakeWsfe([1]);
  const reclaim = options.reclaim === false ? null : new FakeReclaim();
  const onboarding = new ArcaOnboardingService(taxStore, reclaim, null, false, wsfex, wsfe);
  const executor = new FakeExecutor();
  const boundary = new FakeBoundary();
  const build = () => new ArcaSetupAutomationService({
    store: new ArcaSetupStore(path),
    onboarding,
    executor,
    boundary,
    handoffSecret: HANDOFF_SECRET,
    receiptSecret: RECEIPT_SECRET,
    providerDelegationAvailable: options.provider ?? true,
    reclaimAvailable: reclaim !== null,
    clock: clock.now,
  });
  if (!taxStore.getArcaOnboardingRun(ONBOARDING_ID)) {
    onboarding.createRun({
      onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, taxpayerReferenceHash: h('taxpayer'),
      environment: 'homologation', requestedServices: options.services ?? ['wsfex'],
      actorId: 'user-1', idempotencyKey: 'create-run-1', occurredAt: clock.now().toISOString(),
    });
  }
  return { clock, onboarding, executor, boundary, wsfex, wsfe, service: build(), rebuild: build, path };
}

async function send(
  service: ArcaSetupAutomationService,
  order: ArcaSetupWireOrder,
  outcome: 'completed' | 'handoff_required' | 'blocked' | 'uncertain',
  extra: Partial<{ inventory: ArcaSetupWireInventory | null; result: Record<string, string | number | boolean | null>; code: string | null }> = {},
  now = new Date(),
) {
  const receipt = {
    version: 'arca-setup-receipt-v1',
    receiptId: `${order.orderId}:${outcome}:${Math.random().toString(16).slice(2)}`,
    orderId: order.orderId,
    executionId: order.executionId,
    onboardingId: order.onboardingId,
    workspaceId: order.workspaceId,
    operation: order.operation,
    expectedRevision: order.expectedRevision,
    outcome,
    code: extra.code ?? (outcome === 'completed' || outcome === 'handoff_required' ? null : 'ARCA_UNAVAILABLE'),
    observedAt: new Date(Date.parse(order.issuedAt) + 1_000).toISOString(),
    evidenceHash: h(`${order.orderId}:${outcome}`),
    inventory: extra.inventory ?? null,
    result: extra.result ?? {},
  };
  const body = JSON.stringify(receipt);
  return service.ingestReceipt(body, new Headers(await signArcaSetupMessage(RECEIPT_SECRET, 'receipt', body, now)));
}

const userConsent = {
  allowPointOfSaleCreation: true,
  allowCertificateReplacement: false,
  billingReferenceHash: h('credit-charge-1'),
  consentTextHash: h('consent-text-v1'),
};

describe('automated ARCA connection', () => {
  test('provider delegation from "Connect my ARCA" to connected, with ARCA verified before ready', async () => {
    const { service, executor, boundary, onboarding, clock, wsfex } = harness();
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'agent', actorId: 'agent:tax' }, idempotencyKey: 'agent-start-1' });
    expect(started.phase).toBe('awaiting_user_authorization');
    expect(started.mode).toBe('provider_delegation');
    expect(boundary.sessions).toBe(1);
    expect(executor.orders).toHaveLength(0);

    await expect(service.authorize({ executionId: started.executionId, actorId: 'agent:tax', consent: userConsent, idempotencyKey: 'grant-agent' }))
      .rejects.toThrow('ARCA_SETUP_AUTHORIZATION_REQUIRES_USER');
    const authorized = await service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    expect(authorized.phase).toBe('awaiting_user_authentication');
    expect(executor.last.operation).toBe('authenticate');
    expect(executor.last.parameters.setupRef).toBe('setup://80000000-0000-4000-8000-000000000001');

    const link = await service.handoffLink({ executionId: started.executionId, actorId: 'user-1', purpose: 'customer_authentication' });
    expect(arcaSetupHandoffLinkV1Schema.parse(link)).toEqual(link);
    // The browser contract Desk and Motora parse is the same view the service produces.
    const progress: unknown = service.status(started.executionId);
    expect(arcaSetupProgressV1Schema.parse(progress)).toEqual(progress as never);
    expect(link.url).toStartWith(`https://executor.example/handoff/${started.executionId}?ticket=`);
    expect(JSON.stringify(service.status(started.executionId))).not.toContain('ticket');

    await send(service, executor.last, 'handoff_required');
    expect(service.status(started.executionId).phase).toBe('awaiting_user_authentication');
    await send(service, executor.last, 'completed');
    expect(onboarding.getRun(ONBOARDING_ID).currentStep).toBe('service_adherence');
    expect(executor.last.operation).toBe('inspect');

    await send(service, executor.last, 'completed', { inventory: inventory() });
    expect(onboarding.getRun(ONBOARDING_ID).currentStep).toBe('point_of_sale_creation');
    expect(executor.last).toMatchObject({ operation: 'create_point_of_sale', parameters: { number: 2, system: 'export_web_services' } });

    await send(service, executor.last, 'completed', { inventory: inventory({ pointsOfSale: { exportWebServices: [2], domesticWebServices: [], usedNumbers: [1, 2], domicileCount: 1 } }) });
    expect(onboarding.getRun(ONBOARDING_ID).currentStep).toBe('ws_delegation');
    expect(onboarding.getRun(ONBOARDING_ID).pointOfSale).toMatchObject({ number: 2, source: 'created' });
    expect(executor.last.operation).toBe('delegate_to_provider');

    await send(service, executor.last, 'completed', { inventory: inventory({
      relationships: { wsfex: 'provider_pending', wsfe: 'none' },
      pointsOfSale: { exportWebServices: [2], domesticWebServices: [], usedNumbers: [1, 2], domicileCount: 1 },
    }) });
    expect(service.status(started.executionId).phase).toBe('awaiting_provider_acceptance');
    expect(service.providerQueue().map(item => item.executionId)).toEqual([started.executionId]);

    await service.dispatchProviderAcceptance({ executionId: started.executionId, operatorId: 'ops-1', idempotencyKey: 'ops-accept-1' });
    expect(executor.last.operation).toBe('provider_accept');
    wsfex.failures = 1;
    await send(service, executor.last, 'completed', { result: { acceptedServices: 'wsfex' } });
    expect(boundary.provisions[0]!.providerAcceptanceEvidenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(onboarding.getRun(ONBOARDING_ID).currentStep).toBe('api_verification');
    // ARCA had not propagated the relationship yet: wait, do not report connected.
    expect(service.status(started.executionId)).toMatchObject({ phase: 'waiting_for_propagation', waitingOn: 'arca' });

    clock.advance(6 * 60_000);
    await service.tick();
    expect(onboarding.getRun(ONBOARDING_ID).currentStep).toBe('zk_evidence');
    expect(service.status(started.executionId).phase).toBe('waiting_for_proof');
    // The hosted browser is no longer needed once API verification passed.
    expect(executor.cancellations).toContain(started.executionId);

    await onboarding.startReclaim({ onboardingId: ONBOARDING_ID, actorId: 'user-1', idempotencyKey: 'reclaim-start-1', occurredAt: clock.now().toISOString() });
    await onboarding.ingestReclaimCallback('reclaim-session-1', { proofs: [] }, clock.now().toISOString());
    await service.tick();
    expect(service.status(started.executionId).phase).toBe('connected');
    expect(arcaSetupProgressV1Schema.parse(service.status(started.executionId)).waitingOn).toBe('nobody');
  });

  test('a run can be resumed by a new process after the app was closed', async () => {
    const first = harness();
    const started = await first.service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    await first.service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    await send(first.service, first.executor.last, 'completed');
    const restarted = first.rebuild();
    expect(restarted.status(started.executionId).currentOperation).toBe('inspect');
    // Starting again resumes the same execution instead of opening a second one.
    const again = await restarted.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'agent', actorId: 'agent:tax' }, idempotencyKey: 'start-2' });
    expect(again.executionId).toBe(started.executionId);
    await send(restarted, first.executor.last, 'completed', { inventory: inventory() });
    expect(first.onboarding.getRun(ONBOARDING_ID).currentStep).toBe('point_of_sale_creation');
  });

  test('customer certificate path enrolls through the boundary and verifies WSFEX and WSFE separately', async () => {
    const { service, executor, boundary, onboarding, wsfe } = harness({ services: ['wsfex', 'wsfe'], provider: false });
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    expect(started.mode).toBe('customer_certificate');
    await service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    await send(service, executor.last, 'completed');
    const points = { exportWebServices: [2], domesticWebServices: [1], usedNumbers: [1, 2], domicileCount: 1 };
    await send(service, executor.last, 'completed', { inventory: inventory({ pointsOfSale: points }) });
    expect(onboarding.getRun(ONBOARDING_ID).currentStep).toBe('ws_delegation');
    expect(executor.last).toMatchObject({ operation: 'enroll_certificate', parameters: { enrollmentRef: 'enrollment://80000000-0000-4000-8000-000000000002' } });
    expect(boundary.enrollments).toBe(1);
    await send(service, executor.last, 'completed', { inventory: inventory({ pointsOfSale: points, certificates: { intendedAliasExists: true, intendedAliasCertificateValidUntil: null, otherAliasCount: 0 } }) });
    expect(executor.last.operation).toBe('authorize_web_services');
    await send(service, executor.last, 'completed', { inventory: inventory({ pointsOfSale: points, relationships: { wsfex: 'customer_alias', wsfe: 'customer_alias' } }) });
    const run = onboarding.getRun(ONBOARDING_ID);
    expect(run.apiVerification).toMatchObject({ wsfex: true, wsfe: true });
    expect(run.currentStep).toBe('zk_evidence');
    expect(wsfe.calls).toBe(1);
    expect(run.domesticPointOfSale).toMatchObject({ number: 1, active: true });
  });

  test('several export points ask the customer, and only the customer can answer', async () => {
    const { service, executor, onboarding } = harness();
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    await service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    await send(service, executor.last, 'completed');
    await send(service, executor.last, 'completed', { inventory: inventory({ pointsOfSale: { exportWebServices: [3, 8], domesticWebServices: [], usedNumbers: [3, 8], domicileCount: 1 } }) });
    const waiting = service.status(started.executionId);
    expect(waiting.userAction).toEqual({ kind: 'choose', decision: 'export_point_of_sale', options: [3, 8] });
    await expect(service.decide({ executionId: started.executionId, actorId: 'agent:tax', decision: 'export_point_of_sale', value: 8, expectedRevision: waiting.revision, idempotencyKey: 'agent-decides' }))
      .rejects.toThrow('ARCA_SETUP_DECISION_REQUIRES_USER');
    await service.decide({ executionId: started.executionId, actorId: 'user-1', decision: 'export_point_of_sale', value: 8, expectedRevision: waiting.revision, idempotencyKey: 'decide-1' });
    expect(onboarding.getRun(ONBOARDING_ID).pointOfSale).toMatchObject({ number: 8, source: 'discovered' });
  });

  test('receipts must be signed and bound to the outstanding order; replays are idempotent', async () => {
    const { service, executor } = harness();
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    await service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    const order = executor.last;
    await expect(service.ingestReceipt('{}', new Headers())).rejects.toThrow('ARCA_SETUP_SIGNATURE_INVALID');
    await expect(send(service, { ...order, orderId: `${order.orderId}-forged` }, 'completed')).rejects.toThrow('ARCA_SETUP_RECEIPT_ORDER_MISMATCH');
    const receipt = {
      version: 'arca-setup-receipt-v1', receiptId: 'receipt-dup-1', orderId: order.orderId, executionId: order.executionId,
      onboardingId: order.onboardingId, workspaceId: order.workspaceId, operation: order.operation,
      expectedRevision: order.expectedRevision, outcome: 'completed', code: null, observedAt: order.issuedAt,
      evidenceHash: h('dup'), inventory: null, result: {},
    };
    const body = JSON.stringify(receipt);
    const headers = new Headers(await signArcaSetupMessage(RECEIPT_SECRET, 'receipt', body));
    expect(await service.ingestReceipt(body, headers)).toEqual({ applied: true, replayed: false });
    expect(await service.ingestReceipt(body, headers)).toEqual({ applied: false, replayed: true });
  });

  test('cancellation closes the hosted session and ignores late receipts', async () => {
    const { service, executor } = harness();
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    await service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    const order = executor.last;
    const cancelled = await service.cancel({ executionId: started.executionId, actorId: 'user-1', reason: 'customer_cancelled', idempotencyKey: 'cancel-1' });
    expect(cancelled).toMatchObject({ sessionClosed: true, sessionVerifiedGone: true, progress: { phase: 'cancelled' } });
    expect(executor.cancellations).toEqual([started.executionId]);
    expect(await send(service, order, 'completed')).toEqual({ applied: false, replayed: false });
  });

  test('an expired session blocks recoverably and a retry reopens authentication', async () => {
    const { service, executor } = harness();
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    await service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    await send(service, executor.last, 'completed');
    await send(service, executor.last, 'blocked', { code: 'BROWSER_SESSION_GONE' });
    expect(service.status(started.executionId)).toMatchObject({ phase: 'recoverable_action_required', blocker: { code: 'BROWSER_SESSION_GONE' } });
    await service.retry({ executionId: started.executionId, actorId: 'user-1', idempotencyKey: 'retry-1' });
    expect(executor.last.operation).toBe('authenticate');
  });

  test('a second taxpayer job cannot run concurrently, and agent tools stay inside their workspace', async () => {
    const { service, onboarding } = harness();
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    onboarding.createRun({
      onboardingId: '70000000-0000-4000-8000-000000000002', workspaceId: WORKSPACE, taxpayerReferenceHash: h('taxpayer'),
      environment: 'homologation', requestedServices: ['wsfex'], actorId: 'user-1', idempotencyKey: 'create-run-2', occurredAt: new Date().toISOString(),
    });
    await expect(service.start({ onboardingId: '70000000-0000-4000-8000-000000000002', workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-x' }))
      .rejects.toThrow('ARCA_SETUP_ANOTHER_RUN_ACTIVE_FOR_TAXPAYER');
    await expect(invokeArcaConnectionAgentTool('tax_ar_arca_connection_get_status', { workspaceId: 'other-workspace', executionId: started.executionId },
      { actorId: 'agent:tax', idempotencyKey: 'status-1', principalWorkspaceId: 'other-workspace' }, service)).rejects.toThrow('TAX_AGENT_PRINCIPAL_WORKSPACE_UNAUTHORIZED');
    const status = await invokeArcaConnectionAgentTool('tax_ar_arca_connection_get_status', { workspaceId: WORKSPACE, executionId: started.executionId },
      { actorId: 'agent:tax', idempotencyKey: 'status-2', principalWorkspaceId: WORKSPACE }, service);
    expect(status.customerNextStep).toBe('authorize_in_bufi');
    expect(JSON.stringify(status)).not.toMatch(/ticket|live\.browser\.run|setup:\/\//);
  });

  test('an existing delegation is reused and still waits for BUFI acceptance', async () => {
    const { service, executor } = harness({ reclaim: false });
    const started = await service.start({ onboardingId: ONBOARDING_ID, workspaceId: WORKSPACE, startedBy: { kind: 'user', actorId: 'user-1' }, idempotencyKey: 'start-1' });
    await service.authorize({ executionId: started.executionId, actorId: 'user-1', consent: userConsent, idempotencyKey: 'grant-1' });
    await send(service, executor.last, 'completed');
    await send(service, executor.last, 'completed', { inventory: inventory({ relationships: { wsfex: 'provider_active', wsfe: 'none' }, pointsOfSale: { exportWebServices: [2], domesticWebServices: [], usedNumbers: [2], domicileCount: 1 } }) });
    // Existing active delegation: no new relationship, but BUFI's own acceptance receipt is still required.
    expect(service.status(started.executionId).phase).toBe('awaiting_provider_acceptance');
    expect(executor.orders.some(order => order.operation === 'delegate_to_provider')).toBe(false);
  });
});
