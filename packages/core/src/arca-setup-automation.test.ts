import { describe, expect, test } from 'bun:test';

import {
  HOSTED_HUMAN_AUTH_POLICY_V2,
  HOSTED_HUMAN_AUTH_POLICY_V2_HASH,
  HUMAN_AUTH_CAPTURE_POLICY,
  applyArcaOnboardingCommand,
  applyArcaSetupCommand,
  arcaSetupPendingDecision,
  arcaSetupPermittedOperations,
  connectArcaSetupExecution,
  createArcaOnboardingRun,
  createArcaSetupExecution,
  hashCanonical,
  nextFreePointOfSale,
  planArcaSetup,
  projectArcaSetupProgress,
  type ArcaOnboardingRunV1,
  type ArcaSetupAuthorizationV1,
  type ArcaSetupExecutionV1,
  type ArcaSetupInventoryV1,
  type ArcaSetupMode,
  type ArcaSetupOperation,
  type ArcaSetupOrderV1,
  type ArcaSetupReceiptV1,
} from './index';

const now = '2026-10-26T12:00:00.000Z';
const later = (minutes: number) => new Date(Date.parse(now) + minutes * 60_000).toISOString();
const h = (value: string) => hashCanonical(value);

function run(services: ('wsfex' | 'wsfe')[] = ['wsfex']): ArcaOnboardingRunV1 {
  return createArcaOnboardingRun({
    onboardingId: '11111111-1111-4111-8111-111111111111',
    workspaceId: 'workspace-1',
    taxpayerReferenceHash: h('taxpayer'),
    environment: 'homologation',
    requestedServices: services,
    actorId: 'user-1',
    occurredAt: now,
    idempotencyKey: 'run-create-1',
  }).run;
}

function execution(mode: ArcaSetupMode = 'provider_delegation', services: ('wsfex' | 'wsfe')[] = ['wsfex']) {
  return createArcaSetupExecution({
    executionId: '22222222-2222-4222-8222-222222222222',
    onboardingId: '11111111-1111-4111-8111-111111111111',
    workspaceId: 'workspace-1',
    environment: 'homologation',
    taxpayerReferenceHash: h('taxpayer'),
    requestedServices: services,
    mode,
    startedBy: { kind: 'agent', actorId: 'agent:tax' },
    occurredAt: now,
    idempotencyKey: 'exec-create-1',
  }).execution;
}

function authorization(current: ArcaSetupExecutionV1, overrides: Partial<ArcaSetupAuthorizationV1> = {}): ArcaSetupAuthorizationV1 {
  return {
    version: 'arca-setup-authorization-v1',
    authorizationId: 'auth-1',
    executionId: current.executionId,
    onboardingId: current.onboardingId,
    workspaceId: current.workspaceId,
    actorId: 'user-1',
    taxpayerReferenceHash: current.taxpayerReferenceHash,
    environment: current.environment,
    requestedServices: current.requestedServices,
    mode: current.mode,
    permittedOperations: arcaSetupPermittedOperations(current.mode),
    allowPointOfSaleCreation: true,
    allowCertificateReplacement: false,
    billingReferenceHash: h('credit-charge'),
    consentTextHash: h('consent-v1'),
    grantedAt: now,
    expiresAt: later(60 * 12),
    ...overrides,
  };
}

const apply = (current: ArcaSetupExecutionV1, command: Parameters<typeof applyArcaSetupCommand>[1], actor = 'tax', at = now) =>
  applyArcaSetupCommand(current, command, actor, at).execution;

function authorized(mode: ArcaSetupMode = 'provider_delegation', services: ('wsfex' | 'wsfe')[] = ['wsfex']) {
  const current = execution(mode, services);
  return apply(current, { kind: 'grant_authorization', grant: authorization(current), idempotencyKey: 'grant-1' }, 'user-1');
}

function order(current: ArcaSetupExecutionV1, operation: ArcaSetupOperation, attempt = 1): ArcaSetupOrderV1 {
  return {
    version: 'arca-setup-order-v1',
    orderId: `order-${operation}-${current.revision}`,
    executionId: current.executionId,
    onboardingId: current.onboardingId,
    workspaceId: current.workspaceId,
    environment: current.environment,
    operation,
    authorizationId: current.authorization!.authorizationId,
    expectedRevision: current.revision,
    attempt,
    parameters: {},
    issuedAt: now,
    expiresAt: later(10),
  };
}

function inventory(overrides: Partial<ArcaSetupInventoryV1> = {}): ArcaSetupInventoryV1 {
  return {
    version: 'arca-setup-inventory-v1',
    observedAt: now,
    evidenceHash: h('inventory'),
    identity: { loginIdentityHash: h('login'), representedCuitCommitment: h('commitment'), representedMatches: true },
    services: { relationshipManager: true, pointOfSaleAdministration: true, certificateAdministration: true },
    certificates: { intendedAliasExists: false, intendedAliasCertificateValidUntil: null, otherAliasCount: 0 },
    relationships: { wsfex: 'none', wsfe: 'none' },
    pointsOfSale: { exportWebServices: [], domesticWebServices: [], usedNumbers: [], domicileCount: 1 },
    ...overrides,
  };
}

function receipt(
  current: ArcaSetupExecutionV1,
  outcome: ArcaSetupReceiptV1['outcome'] = 'completed',
  extra: Partial<ArcaSetupReceiptV1> = {},
): ArcaSetupReceiptV1 {
  const pending = current.currentOrder!;
  return {
    version: 'arca-setup-receipt-v1',
    receiptId: `receipt-${pending.orderId}-${outcome}`,
    orderId: pending.orderId,
    executionId: current.executionId,
    onboardingId: current.onboardingId,
    workspaceId: current.workspaceId,
    operation: pending.operation,
    expectedRevision: pending.expectedRevision,
    outcome,
    code: outcome === 'completed' || outcome === 'handoff_required' ? null : 'ARCA_UNAVAILABLE',
    observedAt: later(1),
    evidenceHash: h(`evidence-${pending.orderId}`),
    inventory: null,
    result: {},
    ...extra,
  };
}

function complete(current: ArcaSetupExecutionV1, operation: ArcaSetupOperation, inv: ArcaSetupInventoryV1 | null = null) {
  const dispatched = apply(current, { kind: 'dispatch_order', order: order(current, operation), idempotencyKey: `dispatch-${operation}-${current.revision}` });
  return apply(dispatched, {
    kind: 'record_receipt',
    receipt: receipt(dispatched, 'completed', { inventory: inv }),
    idempotencyKey: `receipt-${operation}-${dispatched.revision}`,
  });
}

function loggedIn(onboarding: ArcaOnboardingRunV1): ArcaOnboardingRunV1 {
  let next = applyArcaOnboardingCommand(onboarding, {
    kind: 'complete_login_handoff', browserSessionReferenceHash: h('browser'), idempotencyKey: 'login-1',
  }, 'tax', now).run;
  next = applyArcaOnboardingCommand(next, {
    kind: 'record_human_auth_completion',
    completion: {
      version: 'human-auth-completion-v1',
      completionReceiptHash: h('auth-receipt'),
      capturePolicyHash: '033c36138debd63d88a9e7fbb0e61aed31bd2515dbd1e02f4cfb32ecb05764ef',
      completedAt: later(1),
      signatureVerified: true,
    },
    idempotencyKey: 'auth-1',
  }, 'tax', later(1)).run;
  return applyArcaOnboardingCommand(next, {
    kind: 'record_service_adherence', pointOfSaleAdministrationActive: true, relationshipManagerActive: true,
    evidenceHash: h('adherence'), idempotencyKey: 'adherence-1',
  }, 'tax', later(2)).run;
}

describe('hosted authentication policy v2', () => {
  test('keeps every v1 capture prohibition and pins its own hash', () => {
    expect(HOSTED_HUMAN_AUTH_POLICY_V2.agentCapture).toEqual(HUMAN_AUTH_CAPTURE_POLICY);
    expect(Object.values(HOSTED_HUMAN_AUTH_POLICY_V2.agentCapture).every(value => value === false)).toBe(true);
    expect(HOSTED_HUMAN_AUTH_POLICY_V2.humanDisplay.audience).toBe('authenticated_customer_only');
    expect(HOSTED_HUMAN_AUTH_POLICY_V2.forbiddenSinks).toContain('model_context');
    expect(hashCanonical(HOSTED_HUMAN_AUTH_POLICY_V2)).toBe(HOSTED_HUMAN_AUTH_POLICY_V2_HASH);
  });
});

describe('ARCA setup authorization', () => {
  test('an agent can start a setup but cannot authorize it', () => {
    const current = execution();
    expect(current.phase).toBe('awaiting_user_authorization');
    expect(projectArcaSetupProgress(current).userAction).toEqual({ kind: 'authorize_setup' });
    expect(() => apply(current, {
      kind: 'grant_authorization',
      grant: authorization(current, { actorId: 'agent:tax' }),
      idempotencyKey: 'grant-agent',
    })).toThrow('ARCA_SETUP_AUTHORIZATION_REQUIRES_USER');
  });

  test('binds the grant to the exact taxpayer, environment, services and mode', () => {
    const current = execution();
    for (const overrides of [
      { taxpayerReferenceHash: h('other') },
      { environment: 'production' as const },
      { requestedServices: ['wsfex', 'wsfe'] as const },
      { workspaceId: 'workspace-2' },
      { mode: 'customer_certificate' as const },
    ]) {
      expect(() => apply(current, {
        kind: 'grant_authorization',
        grant: authorization(current, overrides as Partial<ArcaSetupAuthorizationV1>),
        idempotencyKey: `grant-${JSON.stringify(overrides)}`,
      })).toThrow('ARCA_SETUP_AUTHORIZATION_SCOPE_MISMATCH');
    }
    expect(() => apply(current, {
      kind: 'grant_authorization',
      grant: authorization(current, { permittedOperations: ['provider_accept'] }),
      idempotencyKey: 'grant-provider',
    })).toThrow('ARCA_SETUP_AUTHORIZATION_OPERATION_NOT_ALLOWED');
    expect(() => apply(current, {
      kind: 'grant_authorization',
      grant: authorization(current, { expiresAt: later(60 * 25) }),
      idempotencyKey: 'grant-long',
    })).toThrow('ARCA_SETUP_AUTHORIZATION_LIFETIME_INVALID');
  });

  test('refuses an order the customer did not authorize or that expired', () => {
    const current = authorized();
    const enroll = { ...order(current, 'enroll_certificate') };
    expect(() => apply(current, { kind: 'dispatch_order', order: enroll, idempotencyKey: 'd-enroll' }))
      .toThrow('ARCA_SETUP_OPERATION_NOT_AUTHORIZED');
    expect(() => applyArcaSetupCommand(current, { kind: 'dispatch_order', order: order(current, 'inspect'), idempotencyKey: 'd-late' }, 'tax', later(60 * 13)))
      .toThrow('ARCA_SETUP_AUTHORIZATION_EXPIRED');
  });
});

describe('ARCA setup orders and receipts', () => {
  test('an order must be computed from the current revision', () => {
    const current = authorized();
    expect(() => apply(current, {
      kind: 'dispatch_order', order: { ...order(current, 'inspect'), expectedRevision: current.revision - 1 }, idempotencyKey: 'd-stale',
    })).toThrow('ARCA_SETUP_ORDER_SCOPE_MISMATCH');
  });

  test('only one order is outstanding, and redelivery of the same order is idempotent', () => {
    const current = authorized();
    const first = order(current, 'authenticate');
    const dispatched = apply(current, { kind: 'dispatch_order', order: first, idempotencyKey: 'd-1' });
    expect(dispatched.phase).toBe('awaiting_user_authentication');
    expect(apply(dispatched, { kind: 'dispatch_order', order: first, idempotencyKey: 'd-1' })).toEqual(dispatched);
    expect(() => apply(dispatched, {
      kind: 'dispatch_order', order: { ...order(dispatched, 'inspect'), orderId: 'other' }, idempotencyKey: 'd-2',
    })).toThrow('ARCA_SETUP_ORDER_ALREADY_OUTSTANDING');
  });

  test('a receipt bound to another order, tenant or revision is refused', () => {
    const current = authorized();
    const dispatched = apply(current, { kind: 'dispatch_order', order: order(current, 'inspect'), idempotencyKey: 'd-1' });
    const good = receipt(dispatched);
    for (const bad of [
      { ...good, orderId: 'forged' },
      { ...good, workspaceId: 'workspace-2' },
      { ...good, expectedRevision: good.expectedRevision + 1 },
      { ...good, operation: 'delegate_to_provider' as const },
    ]) {
      expect(() => apply(dispatched, { kind: 'record_receipt', receipt: bad, idempotencyKey: `r-${bad.orderId}-${bad.workspaceId}-${bad.expectedRevision}-${bad.operation}` }))
        .toThrow(/ARCA_SETUP_RECEIPT_(ORDER|SCOPE)_MISMATCH/);
    }
  });

  test('an uncertain mutation result forces a fresh inspection before any resubmission', () => {
    let current = authorized();
    current = complete(current, 'authenticate');
    current = complete(current, 'inspect', inventory());
    const dispatched = apply(current, { kind: 'dispatch_order', order: order(current, 'delegate_to_provider'), idempotencyKey: 'd-delegate' });
    const uncertain = apply(dispatched, {
      kind: 'record_receipt', receipt: receipt(dispatched, 'uncertain', { code: 'ARCA_SUBMISSION_UNCONFIRMED' }), idempotencyKey: 'r-uncertain',
    });
    expect(uncertain.completedOperations).not.toContain('inspect');
    expect(uncertain.currentOrder).toBeNull();
  });

  test('a login for the wrong taxpayer stops and asks the customer to sign in again', () => {
    let current = authorized();
    current = complete(current, 'authenticate');
    const dispatched = apply(current, { kind: 'dispatch_order', order: order(current, 'inspect'), idempotencyKey: 'd-inspect' });
    const wrong = apply(dispatched, {
      kind: 'record_receipt',
      receipt: receipt(dispatched, 'completed', {
        inventory: inventory({ identity: { loginIdentityHash: h('login'), representedCuitCommitment: h('other'), representedMatches: false } }),
      }),
      idempotencyKey: 'r-wrong',
    });
    expect(wrong.phase).toBe('recoverable_action_required');
    expect(wrong.blocker?.userAction).toBe('sign_in_with_the_right_taxpayer');
  });

  test('an expired ARCA session reopens authentication instead of continuing blind', () => {
    let current = authorized();
    current = complete(current, 'authenticate');
    current = complete(current, 'inspect', inventory());
    const dispatched = apply(current, { kind: 'dispatch_order', order: order(current, 'delegate_to_provider'), idempotencyKey: 'd-delegate' });
    const expired = apply(dispatched, {
      kind: 'record_receipt', receipt: receipt(dispatched, 'blocked', { code: 'ARCA_SESSION_EXPIRED' }), idempotencyKey: 'r-expired',
    });
    expect(expired.completedOperations).not.toContain('authenticate');
    expect(expired.blocker?.userAction).toBe('sign_in_again');
  });
});

describe('ARCA setup planner', () => {
  test('provider delegation: discover, create a point, delegate, wait for BUFI acceptance, provision, verify', () => {
    let onboarding = run();
    let current = authorized();
    expect(planArcaSetup(current, onboarding, now)).toMatchObject({ kind: 'dispatch', operation: 'authenticate' });
    current = complete(current, 'authenticate');
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'apply_onboarding', command: 'login' });
    onboarding = loggedIn(onboarding);
    expect(planArcaSetup(current, onboarding, now)).toMatchObject({ kind: 'dispatch', operation: 'inspect' });
    current = complete(current, 'inspect', inventory({ pointsOfSale: { exportWebServices: [], domesticWebServices: [], usedNumbers: [1, 2], domicileCount: 1 } }));
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'apply_onboarding', command: 'point_of_sale' });
    onboarding = applyArcaOnboardingCommand(onboarding, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: null, evidenceHash: h('discovery'), idempotencyKey: 'disc-1',
    }, 'tax', now).run;
    expect(planArcaSetup(current, onboarding, now)).toEqual({
      kind: 'dispatch', operation: 'create_point_of_sale', parameters: { system: 'export_web_services', number: 3, domicileCount: 1 },
    });
    current = complete(current, 'create_point_of_sale', inventory({ pointsOfSale: { exportWebServices: [3], domesticWebServices: [], usedNumbers: [1, 2, 3], domicileCount: 1 } }));
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'apply_onboarding', command: 'point_of_sale' });
    onboarding = applyArcaOnboardingCommand(onboarding, {
      kind: 'record_point_of_sale_creation', exportPointOfSale: 3, evidenceHash: h('created'), idempotencyKey: 'created-1',
    }, 'tax', now).run;
    expect(onboarding.currentStep).toBe('ws_delegation');
    expect(planArcaSetup(current, onboarding, now)).toMatchObject({ kind: 'dispatch', operation: 'delegate_to_provider' });
    current = complete(current, 'delegate_to_provider', inventory({ relationships: { wsfex: 'provider_pending', wsfe: 'none' } }));
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'await_user', phase: 'awaiting_provider_acceptance' });
    current = { ...current, inventory: inventory({ relationships: { wsfex: 'provider_active', wsfe: 'none' } }) };
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'await_user', phase: 'awaiting_provider_acceptance' });
    current = { ...current, completedOperations: [...current.completedOperations, 'provider_accept'] };
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'provision_boundary' });
    current = apply(current, {
      kind: 'record_boundary_provision', setupReferenceHash: h('setup'), certificateFingerprintHash: h('cert'),
      representedCuitCommitment: h('commitment'), idempotencyKey: 'prov-1',
    });
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'apply_onboarding', command: 'ws_delegation' });
    onboarding = applyArcaOnboardingCommand(onboarding, {
      kind: 'record_ws_delegation', delegatedServices: { wsfex: true, wsfe: false },
      issuerProfileReferenceHash: h(current.issuerProfileRef), representedCuitCommitment: h('commitment'),
      evidenceHash: h('delegation'), idempotencyKey: 'deleg-1',
    }, 'tax', now).run;
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'verify_api', service: 'wsfex' });
  });

  test('several active export points require the customer to choose', () => {
    let onboarding = loggedIn(run());
    let current = authorized();
    current = complete(current, 'authenticate');
    current = complete(current, 'inspect', inventory({ pointsOfSale: { exportWebServices: [4, 7], domesticWebServices: [], usedNumbers: [4, 7], domicileCount: 1 } }));
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'await_user', phase: 'awaiting_user_decision' });
    const decision = arcaSetupPendingDecision(current, onboarding, now);
    expect(decision).toMatchObject({ kind: 'export_point_of_sale', options: [4, 7] });
    const requested = apply(current, { kind: 'request_decision', decision: decision!, idempotencyKey: 'req-1' });
    expect(projectArcaSetupProgress(requested).userAction).toEqual({ kind: 'choose', decision: 'export_point_of_sale', options: [4, 7] });
    expect(() => apply(requested, {
      kind: 'record_decision', decision: 'export_point_of_sale', value: 9, expectedRevision: requested.revision, idempotencyKey: 'dec-bad',
    })).toThrow('ARCA_SETUP_DECISION_OPTION_INVALID');
    expect(() => apply(requested, {
      kind: 'record_decision', decision: 'export_point_of_sale', value: 7, expectedRevision: requested.revision - 1, idempotencyKey: 'dec-stale',
    })).toThrow('ARCA_SETUP_REVISION_CONFLICT');
    current = apply(requested, {
      kind: 'record_decision', decision: 'export_point_of_sale', value: 7, expectedRevision: requested.revision, idempotencyKey: 'dec-1',
    }, 'user-1');
    expect(current.decisions.export_point_of_sale).toBe(7);
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'apply_onboarding', command: 'point_of_sale' });
    expect(onboarding.currentStep).toBe('point_of_sale_discovery');
  });

  test('without creation consent the run stops instead of creating a point', () => {
    let onboarding = loggedIn(run());
    onboarding = applyArcaOnboardingCommand(onboarding, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: null, evidenceHash: h('discovery'), idempotencyKey: 'disc-1',
    }, 'tax', now).run;
    const base = execution();
    let current = apply(base, {
      kind: 'grant_authorization', grant: authorization(base, { allowPointOfSaleCreation: false }), idempotencyKey: 'grant-1',
    }, 'user-1');
    current = complete(current, 'authenticate');
    current = complete(current, 'inspect', inventory());
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'await_user', phase: 'recoverable_action_required' });
  });

  test('customer certificate: enroll, relate the alias, then provision; never replace silently', () => {
    let onboarding = loggedIn(run());
    onboarding = applyArcaOnboardingCommand(onboarding, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: 5, evidenceHash: h('discovery'), idempotencyKey: 'disc-1',
    }, 'tax', now).run;
    let current = authorized('customer_certificate');
    current = complete(current, 'authenticate');
    current = complete(current, 'inspect', inventory({
      certificates: { intendedAliasExists: true, intendedAliasCertificateValidUntil: later(1000), otherAliasCount: 0 },
      pointsOfSale: { exportWebServices: [5], domesticWebServices: [], usedNumbers: [5], domicileCount: 1 },
    }));
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'await_user', phase: 'awaiting_user_decision' });
    expect(arcaSetupPendingDecision(current, onboarding, now)).toMatchObject({ kind: 'certificate_replacement' });
    current = apply({ ...current, decision: arcaSetupPendingDecision(current, onboarding, now) }, {
      kind: 'record_decision', decision: 'certificate_replacement', value: 'replace', expectedRevision: current.revision, idempotencyKey: 'dec-cert',
    }, 'user-1');
    expect(planArcaSetup(current, onboarding, now)).toMatchObject({ kind: 'dispatch', operation: 'enroll_certificate', parameters: { aliasExists: true } });
    current = complete(current, 'enroll_certificate');
    expect(planArcaSetup(current, onboarding, now)).toMatchObject({ kind: 'dispatch', operation: 'authorize_web_services' });
    current = complete(current, 'authorize_web_services', inventory({ relationships: { wsfex: 'customer_alias', wsfe: 'none' } }));
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'provision_boundary' });
    current = apply(current, {
      kind: 'record_boundary_provision', setupReferenceHash: h('setup'), certificateFingerprintHash: h('cert'),
      representedCuitCommitment: h('commitment'), idempotencyKey: 'prov-1',
    });
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'apply_onboarding', command: 'ws_delegation' });
  });

  test('existing delegation is reused instead of creating another relationship', () => {
    let onboarding = loggedIn(run());
    onboarding = applyArcaOnboardingCommand(onboarding, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: 5, evidenceHash: h('discovery'), idempotencyKey: 'disc-1',
    }, 'tax', now).run;
    let current = authorized();
    current = complete(current, 'authenticate');
    current = complete(current, 'inspect', inventory({
      relationships: { wsfex: 'provider_active', wsfe: 'none' },
      pointsOfSale: { exportWebServices: [5], domesticWebServices: [], usedNumbers: [5], domicileCount: 1 },
    }));
    // No second delegation; BUFI confirms acceptance and alias binding from its own session.
    expect(planArcaSetup(current, onboarding, now)).toEqual({ kind: 'await_user', phase: 'awaiting_provider_acceptance' });
  });

  test('connected requires a ready onboarding run', () => {
    const current = authorized();
    expect(() => connectArcaSetupExecution(current, run(), now)).toThrow('ARCA_SETUP_NOT_VERIFIED');
  });

  test('cancellation is terminal', () => {
    const cancelled = apply(authorized(), { kind: 'cancel', idempotencyKey: 'cancel-1' });
    expect(cancelled.phase).toBe('cancelled');
    expect(planArcaSetup(cancelled, run(), now)).toEqual({ kind: 'stop', phase: 'cancelled' });
    expect(() => apply(cancelled, { kind: 'dispatch_order', order: order(cancelled, 'inspect'), idempotencyKey: 'd-after' }))
      .toThrow('ARCA_SETUP_EXECUTION_TERMINAL');
  });
});

describe('ARCA setup safety', () => {
  test('refuses raw tax IDs, Live View links and key material anywhere in a command', () => {
    const current = authorized();
    const dispatched = apply(current, { kind: 'dispatch_order', order: order(current, 'inspect'), idempotencyKey: 'd-1' });
    for (const leak of [
      '20123456786',
      'https://live.browser.run/ui/view?mode=tab&wss=x',
      '-----BEGIN PRIVATE KEY-----',
    ]) {
      expect(() => apply(dispatched, {
        kind: 'record_receipt', receipt: receipt(dispatched, 'completed', { result: { leak } }), idempotencyKey: `r-${leak.length}`,
      })).toThrow(/SENSITIVE_MATERIAL_FORBIDDEN|SECRET_MATERIAL_FORBIDDEN|RAW_TAX_ID_FORBIDDEN/);
    }
  });

  test('the progress view carries no order parameters or evidence', () => {
    const current = authorized();
    const view = projectArcaSetupProgress(current);
    expect(JSON.stringify(view)).not.toContain('authorizationId');
    expect(view.waitingOn).toBe('bufi');
  });

  test('chooses the lowest free point-of-sale number', () => {
    expect(nextFreePointOfSale([1, 2, 4])).toBe(3);
    expect(nextFreePointOfSale([])).toBe(1);
  });
});
