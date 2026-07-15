import { describe, expect, test } from 'bun:test';

import {
  ARCA_ONBOARDING_STEPS,
  applyArcaOnboardingCommand,
  arcaOnboardingNextActions,
  createArcaOnboardingRun,
  hashCanonical,
  type ArcaOnboardingRunV1,
} from './index';

const now = '2026-07-14T12:00:00.000Z';
const hash = (value: string) => hashCanonical(value);

describe('ARCA onboarding step engine', () => {
  test('reaches ready only through the ordered API plus zk evidence path', () => {
    let run = createRun();
    expect(run.currentStep).toBe('login_handoff');
    expect(arcaOnboardingNextActions(run)).toEqual(['USER_LOG_IN_DIRECTLY_WITH_ARCA']);

    run = apply(run, {
      kind: 'complete_login_handoff', browserSessionReferenceHash: hash('local-browser-session'), idempotencyKey: 'login-1',
    });
    run = apply(run, {
      kind: 'record_service_adherence', pointOfSaleAdministrationActive: true, relationshipManagerActive: true,
      evidenceHash: hash('services'), idempotencyKey: 'services-1',
    });
    run = apply(run, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: null, evidenceHash: hash('pos-none'), idempotencyKey: 'discover-1',
    });
    expect(run.currentStep).toBe('point_of_sale_creation');
    run = apply(run, {
      kind: 'record_point_of_sale_creation', exportPointOfSale: 4, evidenceHash: hash('pos-created'), idempotencyKey: 'create-pos-1',
    });
    run = apply(run, {
      kind: 'record_ws_delegation', delegatedServices: { wsfex: true, wsfe: true },
      issuerProfileReferenceHash: hash('issuer-profile'), representedCuitCommitment: hash('represented-cuit'),
      evidenceHash: hash('delegation'), idempotencyKey: 'delegate-1',
    });
    run = apply(run, {
      kind: 'record_api_verification', verifiedServices: { wsfex: true, wsfe: true }, activeExportPointOfSale: 4,
      observedAt: now, wsfexReceiptHash: hash('wsfex'), wsfeReceiptHash: hash('wsfe'), idempotencyKey: 'api-1',
    });
    expect(run.status).toBe('active');
    expect(run.currentStep).toBe('zk_evidence');
    run = apply(run, {
      kind: 'start_zk_evidence', session: reclaimSession(), idempotencyKey: 'zk-session-1',
    });
    run = apply(run, {
      kind: 'record_zk_evidence', sessionId: 'reclaim-session-1', providerId: 'arca-onboarding-provider', providerVersion: '1.0.0',
      proofHash: hash('proof'), claimsHash: hash('claims'), verifiedAt: now, teeVerified: false, custodyReceipt: null, idempotencyKey: 'zk-1',
    });

    expect(run.status).toBe('ready');
    expect(run.currentStep).toBe('ready');
    expect(run.steps.map(step => step.step)).toEqual([...ARCA_ONBOARDING_STEPS]);
    expect(run.steps.every(step => step.state === 'completed')).toBe(true);
    expect(arcaOnboardingNextActions(run)).toEqual([]);
  });

  test('skips point-of-sale creation when discovery finds an active export point', () => {
    let run = advanceToDiscovery(createRun());
    run = apply(run, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: 7, evidenceHash: hash('pos-seven'), idempotencyKey: 'discover-seven',
    });
    expect(run.currentStep).toBe('ws_delegation');
    expect(run.pointOfSale).toEqual({ number: 7, source: 'discovered', active: true });
    expect(run.steps.find(step => step.step === 'point_of_sale_creation')?.state).toBe('skipped');
  });

  test('requires the user to select one candidate when discovery returns multiple active points', () => {
    let run = advanceToDiscovery(createRun());
    run = apply(run, {
      kind: 'record_point_of_sale_discovery',
      exportPointOfSale: null,
      activeExportPoints: [9, 4, 9],
      evidenceHash: hash('pos-candidates'),
      idempotencyKey: 'discover-candidates',
    });
    expect(run.currentStep).toBe('point_of_sale_discovery');
    expect(run.pointOfSale.candidates).toEqual([4, 9]);
    expect(arcaOnboardingNextActions(run)).toEqual(['USER_SELECT_EXPORT_POINT_OF_SALE']);
    expect(() => apply(run, {
      kind: 'select_discovered_point_of_sale', exportPointOfSale: 7, idempotencyKey: 'select-invalid',
    })).toThrow('ARCA_POINT_OF_SALE_SELECTION_INVALID');

    run = apply(run, {
      kind: 'select_discovered_point_of_sale', exportPointOfSale: 9, idempotencyKey: 'select-nine',
    });
    expect(run.currentStep).toBe('ws_delegation');
    expect(run.pointOfSale).toEqual({ number: 9, source: 'discovered', active: true, candidates: [4, 9] });
    expect(run.steps.find(step => step.step === 'point_of_sale_creation')?.state).toBe('skipped');
  });

  test('supports an export-only WSFEX scope without inventing WSFE evidence', () => {
    let run = advanceToDiscovery(createRun(['wsfex']));
    run = apply(run, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: 8, evidenceHash: hash('pos-eight'), idempotencyKey: 'discover-eight',
    });
    run = apply(run, {
      kind: 'record_ws_delegation', delegatedServices: { wsfex: true, wsfe: false },
      issuerProfileReferenceHash: hash('issuer-profile'), representedCuitCommitment: hash('represented-cuit'),
      evidenceHash: hash('wsfex-only'), idempotencyKey: 'delegate-wsfex',
    });
    run = apply(run, {
      kind: 'record_api_verification', verifiedServices: { wsfex: true, wsfe: false }, activeExportPointOfSale: 8,
      observedAt: now, wsfexReceiptHash: hash('wsfex-eight'), wsfeReceiptHash: null, idempotencyKey: 'verify-wsfex',
    });
    expect(run.currentStep).toBe('zk_evidence');
    expect(run.apiVerification).toEqual({ wsfex: true, wsfe: false, observedAt: now });
  });

  test('rejects out-of-order transitions and cannot become ready from zk evidence alone', () => {
    const run = createRun();
    expect(() => apply(run, {
      kind: 'record_zk_evidence', sessionId: 'session', providerId: 'provider', providerVersion: '1.0.0',
      proofHash: hash('proof'), claimsHash: hash('claims'), verifiedAt: now, teeVerified: false, custodyReceipt: null, idempotencyKey: 'zk-early',
    })).toThrow('ARCA_ONBOARDING_EXPECTED_LOGIN_HANDOFF');
    expect(run.status).toBe('active');
  });

  test('requires every requested delegation and idempotently ignores replayed commands', () => {
    let run = advanceToDiscovery(createRun());
    run = apply(run, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: 3, evidenceHash: hash('pos-three'), idempotencyKey: 'discover-three',
    });
    expect(() => apply(run, {
      kind: 'record_ws_delegation', delegatedServices: { wsfex: true, wsfe: false },
      issuerProfileReferenceHash: hash('issuer-profile'), representedCuitCommitment: hash('represented-cuit'),
      evidenceHash: hash('partial'), idempotencyKey: 'partial-delegation',
    })).toThrow('ARCA_WSFE_DELEGATION_REQUIRED');

    const command = {
      kind: 'record_ws_delegation' as const,
      delegatedServices: { wsfex: true, wsfe: true },
      issuerProfileReferenceHash: hash('issuer-profile'), representedCuitCommitment: hash('represented-cuit'),
      evidenceHash: hash('all'), idempotencyKey: 'all-delegation',
    };
    const first = applyArcaOnboardingCommand(run, command, 'user:owner', now);
    const replay = applyArcaOnboardingCommand(first.run, command, 'user:owner', now);
    expect(replay.event).toBeNull();
    expect(replay.run).toBe(first.run);
  });

  test('rejects credential-like fields even when an untyped caller attempts to smuggle them', () => {
    expect(() => createArcaOnboardingRun({
      workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer'), environment: 'homologation', actorId: 'user:owner',
      occurredAt: now, idempotencyKey: 'create-sensitive', claveFiscal: 'never-store-me',
    } as never)).toThrow('ARCA_SENSITIVE_MATERIAL_FORBIDDEN');
  });

  test('fails closed for legacy delegation state without an authority binding', () => {
    let run = advanceToDiscovery(createRun(['wsfex']));
    run = apply(run, {
      kind: 'record_point_of_sale_discovery', exportPointOfSale: 4,
      evidenceHash: hash('pos-four'), idempotencyKey: 'discover-four',
    });
    run = apply(run, {
      kind: 'record_ws_delegation', delegatedServices: { wsfex: true, wsfe: false },
      issuerProfileReferenceHash: hash('issuer-profile'), representedCuitCommitment: hash('represented-cuit'),
      evidenceHash: hash('delegation'), idempotencyKey: 'delegate-four',
    });
    const { authorityBinding: _authorityBinding, ...legacy } = run;
    expect(() => apply(legacy, {
      kind: 'record_api_verification', verifiedServices: { wsfex: true, wsfe: false }, activeExportPointOfSale: 4,
      observedAt: now, wsfexReceiptHash: hash('wsfex-four'), wsfeReceiptHash: null, idempotencyKey: 'verify-four',
    })).toThrow('ARCA_WSFEX_AUTHORITY_BINDING_REQUIRED');
  });
});

function createRun(requestedServices: readonly ('wsfex' | 'wsfe')[] = ['wsfex', 'wsfe']): ArcaOnboardingRunV1 {
  return createArcaOnboardingRun({
    onboardingId: 'onboarding-1', workspaceId: 'workspace-1', taxpayerReferenceHash: hash('taxpayer-1'),
    environment: 'homologation', requestedServices, actorId: 'user:owner', occurredAt: now, idempotencyKey: 'create-1',
  }).run;
}

function advanceToDiscovery(run: ArcaOnboardingRunV1): ArcaOnboardingRunV1 {
  run = apply(run, { kind: 'complete_login_handoff', browserSessionReferenceHash: hash('browser'), idempotencyKey: 'login-discovery' });
  return apply(run, {
    kind: 'record_service_adherence', pointOfSaleAdministrationActive: true, relationshipManagerActive: true,
    evidenceHash: hash('service-evidence'), idempotencyKey: 'services-discovery',
  });
}

function apply(run: ArcaOnboardingRunV1, command: Parameters<typeof applyArcaOnboardingCommand>[1]): ArcaOnboardingRunV1 {
  return applyArcaOnboardingCommand(run, command, 'user:owner', now).run;
}

function reclaimSession() {
  return {
    sessionId: 'reclaim-session-1', providerId: 'arca-onboarding-provider', providerVersion: '1.0.0',
    contextHash: hash('context'), requestedAt: now, expiresAt: '2026-07-14T12:10:00.000Z', state: 'pending' as const,
  };
}
