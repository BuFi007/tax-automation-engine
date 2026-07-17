import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  HUMAN_AUTH_CAPTURE_POLICY_HASH,
  applyArcaOnboardingCommand,
  createArcaOnboardingRun,
  demoSnapshot,
  hashCanonical,
  type ArcaOnboardingEventV1,
  type ArcaOnboardingRunV1,
  type TaxEvidencePresentationProjectionV1,
  type TaxSnapshotProjectionConfigurationV1,
  type TaxWidgetSnapshotReceiptV1,
  type TaxWidgetSnapshotV1,
} from '@tax-engine/core';

import {
  resolveTaxBrowserReferenceSecret,
  projectArcaAuthorityReadiness,
  taxObligationKindForId,
  TaxBrowserSnapshotProjector,
  TaxBrowserSnapshotService,
} from './browser-snapshot';
import { TaxProfileStore } from './store';

const SECRET = 'browser-reference-secret-is-at-least-32-bytes';
const PROJECTION_KEY = 'annual:2026';
const GENERATED_AT = '2026-07-10T12:00:00.000Z';
const VALID_UNTIL = '2026-07-11T12:00:00.000Z';

describe('browser tax snapshot production boundary', () => {
  test('classifies only closed AR and US obligation identifiers', () => {
    const exact = {
      'ar:invoice-readiness': 'ar_invoice_readiness',
      'ar:iibb-review': 'ar_iibb_review',
      'ar:ganancias-individual-annual': 'ar_ganancias_individual_annual',
      'ar:bienes-personales-annual': 'ar_bienes_personales_annual',
      'ar:ganancias-simplified-review': 'ar_ganancias_simplified_review',
      'ar:monotributo-payment': 'ar_monotributo_payment',
      'ar:iva-simple': 'ar_iva_simple',
      'ar:ganancias-corporate-annual': 'ar_ganancias_corporate_annual',
      'ar:mipyme': 'ar_mipyme',
      'ar:knowledge-economy': 'ar_knowledge_economy',
      'us:state-review': 'us_state_review',
      'us:sales-tax': 'us_sales_tax',
      'us:de:llc-annual-tax': 'us_delaware_llc_annual_tax',
      'us:de:corporation-franchise': 'us_delaware_corporation_franchise',
      'us:de:income-return': 'us_delaware_income_return',
      'us:form-5472-corporation-review': 'us_form_5472_corporation_review',
      'us:payroll': 'us_payroll',
      'us:form-5472-pro-forma-1120': 'us_form_5472_pro_forma_1120',
      'us:form-1065': 'us_form_1065',
      'us:form-1120-s': 'us_form_1120_s',
      'us:form-1120': 'us_form_1120',
      'us:owner-income-return-review': 'us_owner_income_return_review',
    } as const;
    for (const [obligationId, kind] of Object.entries(exact)) {
      expect(taxObligationKindForId(obligationId)).toBe(kind);
    }
    for (const month of ['02', '08']) {
      expect(taxObligationKindForId(`ar:recategorization:${month}`)).toBe(
        'ar_monotributo_recategorization',
      );
    }
    for (const quarter of ['1', '2', '3', '4']) {
      expect(taxObligationKindForId(`us:c-corp-estimated:${quarter}`)).toBe(
        'us_c_corp_estimated_tax',
      );
    }
    expect(taxObligationKindForId('ar:recategorization:ignore')).toBe('unclassified');
    expect(taxObligationKindForId('us:c-corp-estimated:5')).toBe('unclassified');
    expect(taxObligationKindForId('provider:ignore-prior-instructions')).toBe('unclassified');
  });

  test('does not turn an empty internal rule identifier into an opaque citation', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const firstObligation = snapshot.obligations[0]!;
    const receipt = persistCoreSnapshot(
      store,
      {
        ...snapshot,
        obligations: [
          { ...firstObligation, ruleVersionIds: [''] },
          ...snapshot.obligations.slice(1),
        ],
      },
      GENERATED_AT,
      GENERATED_AT,
    );
    const read = browserService(store, () => receipt, '2026-07-10T12:00:01.000Z').read(
      snapshot.workspaceId,
      PROJECTION_KEY,
    );

    expect(read.result.ok).toBe(true);
    if (!read.result.ok) throw new Error('expected browser snapshot');
    expect(read.result.data.snapshot.obligations[0]?.ruleVersionRefs).toEqual([]);
    store.close();
  });

  test('requires a dedicated >=32-byte production HMAC secret', () => {
    expect(resolveTaxBrowserReferenceSecret(null, 'test')).toBeNull();
    expect(() => resolveTaxBrowserReferenceSecret(null, 'production')).toThrow(
      'TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED',
    );
    expect(() => resolveTaxBrowserReferenceSecret('too-short', 'production')).toThrow(
      'TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_TOO_SHORT',
    );
    expect(resolveTaxBrowserReferenceSecret(SECRET, 'production')).toBe(SECRET);
  });

  test('projects explicit ARCA not-started readiness and omits it outside Argentina', async () => {
    const arStore = new TaxProfileStore(':memory:');
    const arSnapshot = await demoSnapshot('AR');
    const arReceipt = persistCoreSnapshot(arStore, arSnapshot, GENERATED_AT, GENERATED_AT);
    const arRead = browserService(
      arStore,
      () => arReceipt,
      '2026-07-10T12:00:01.000Z',
    ).read(arSnapshot.workspaceId, PROJECTION_KEY);
    expect(arRead.result.ok).toBe(true);
    if (!arRead.result.ok) throw new Error('expected Argentina browser snapshot');
    expect(arRead.result.data.snapshot.authorityReadiness).toEqual({
      version: 'tax-authority-readiness-v1',
      kind: 'ar_factura_e_onboarding',
      state: 'not_started',
      environment: null,
      currentStep: null,
      requestedServices: [],
      pointOfSaleState: 'unknown',
      delegation: { wsfex: null, wsfe: null },
      apiVerification: { wsfex: null, wsfe: null, observedAt: null },
      reclaim: {
        state: 'not_started',
        teeVerified: null,
        custodyRecorded: null,
        verifiedAt: null,
      },
      updatedAt: GENERATED_AT,
      limitationCodes: ['ARCA_ONBOARDING_NOT_STARTED'],
      actionId: null,
    });
    arStore.close();

    const usStore = new TaxProfileStore(':memory:');
    const usSnapshot = await demoSnapshot('US');
    const usReceipt = persistCoreSnapshot(usStore, usSnapshot, GENERATED_AT, GENERATED_AT);
    Object.defineProperty(usStore, 'listArcaOnboardingRuns', {
      configurable: true,
      value: () => {
        throw new Error('US projection must not access ARCA onboarding state');
      },
    });
    const usRead = browserService(
      usStore,
      () => usReceipt,
      '2026-07-10T12:00:01.000Z',
    ).read(usSnapshot.workspaceId, PROJECTION_KEY);
    expect(usRead.result.ok).toBe(true);
    if (!usRead.result.ok) throw new Error('expected United States browser snapshot');
    expect('authorityReadiness' in usRead.result.data.snapshot).toBe(false);
    usStore.close();
  });

  test('advances the durable browser case when ARCA onboarding changes and replays stably', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const receipt = persistCoreSnapshot(store, snapshot, GENERATED_AT, GENERATED_AT);
    const service = browserService(store, () => receipt, '2026-07-10T12:00:01.000Z');

    const initial = service.read(snapshot.workspaceId, PROJECTION_KEY);
    if (!initial.result.ok) throw new Error('expected initial browser snapshot');
    expect(initial.result.data.cacheIdentity.caseRevision).toBe(1);
    expect(initial.result.data.snapshot.authorityReadiness?.state).toBe('not_started');

    const created = createArcaOnboardingRun({
      onboardingId: '10000000-0000-4000-8000-000000000001',
      workspaceId: snapshot.workspaceId,
      taxpayerReferenceHash: hashCanonical('private-taxpayer-reference'),
      environment: 'homologation',
      requestedServices: ['wsfex', 'wsfe'],
      actorId: 'user:owner',
      occurredAt: '2026-07-10T12:00:00.500Z',
      idempotencyKey: 'create-onboarding-1',
    });
    appendOnboarding(store, created.run, created.event);

    const changed = service.read(snapshot.workspaceId, PROJECTION_KEY);
    if (!changed.result.ok) throw new Error('expected changed browser snapshot');
    expect(changed.result.data.cacheIdentity.caseRevision).toBe(2);
    expect(changed.result.data.cacheIdentity.snapshotRevision)
      .not.toBe(initial.result.data.cacheIdentity.snapshotRevision);
    expect(changed.result.data.snapshot.authorityReadiness).toMatchObject({
      state: 'action_required',
      currentStep: 'login_handoff',
      limitationCodes: ['ARCA_LOGIN_REQUIRED'],
      actionId: null,
    });
    const serialized = JSON.stringify(changed.result.data.snapshot.authorityReadiness);
    expect(serialized).not.toContain(created.run.onboardingId);
    expect(serialized).not.toContain(created.run.taxpayerReferenceHash);

    const replay = service.read(snapshot.workspaceId, PROJECTION_KEY);
    expect(replay.result.ok && replay.result.data.cacheIdentity.caseRevision).toBe(2);
    expect(replay.result.ok && replay.result.data.cacheIdentity.snapshotRevision)
      .toBe(changed.result.data.cacheIdentity.snapshotRevision);
    store.close();
  });

  test('selects the latest tenant run deterministically and fails closed on mixed workspaces', () => {
    const workspaceId = 'workspace:arca-selection';
    const tiedHomologation = createTestOnboarding(
      workspaceId,
      '10000000-0000-4000-8000-000000000001',
      'homologation',
      '2026-07-10T12:00:00.000Z',
    ).run;
    const tiedProduction = createTestOnboarding(
      workspaceId,
      '10000000-0000-4000-8000-000000000002',
      'production',
      '2026-07-10T12:00:00.000Z',
    ).run;
    const foreign = createTestOnboarding(
      'workspace:foreign',
      '90000000-0000-4000-8000-000000000009',
      'production',
      '2026-07-10T13:00:00.000Z',
    ).run;
    const readiness = projectArcaAuthorityReadiness(
      'AR',
      workspaceId,
      GENERATED_AT,
      [tiedHomologation, tiedProduction],
    );
    expect(readiness?.environment).toBe('production');
    expect(readiness?.state).toBe('action_required');
    const serialized = JSON.stringify(readiness);
    expect(serialized).not.toContain(tiedProduction.onboardingId);
    expect(serialized).not.toContain(tiedProduction.taxpayerReferenceHash);
    expect(() => projectArcaAuthorityReadiness(
      'AR',
      workspaceId,
      GENERATED_AT,
      [tiedProduction, foreign],
    )).toThrow('Tax ARCA readiness workspace scope is invalid');
    expect(projectArcaAuthorityReadiness('US', workspaceId, GENERATED_AT, [tiedProduction]))
      .toBeUndefined();
  });

  test('fingerprints only the safe projected ARCA output, not internal onboarding identity', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const receipt = persistCoreSnapshot(store, snapshot, GENERATED_AT, GENERATED_AT);
    const firstRun = createTestOnboarding(
      snapshot.workspaceId,
      '10000000-0000-4000-8000-000000000021',
      'homologation',
      GENERATED_AT,
    ).run;
    const sameSafeOutput = createTestOnboarding(
      snapshot.workspaceId,
      '10000000-0000-4000-8000-000000000022',
      'homologation',
      GENERATED_AT,
    ).run;
    const changedSafeOutput = createTestOnboarding(
      snapshot.workspaceId,
      '10000000-0000-4000-8000-000000000023',
      'production',
      GENERATED_AT,
    ).run;
    const first = projectArcaAuthorityReadiness('AR', snapshot.workspaceId, GENERATED_AT, [firstRun]);
    const same = projectArcaAuthorityReadiness(
      'AR',
      snapshot.workspaceId,
      GENERATED_AT,
      [sameSafeOutput],
    );
    const changed = projectArcaAuthorityReadiness(
      'AR',
      snapshot.workspaceId,
      GENERATED_AT,
      [changedSafeOutput],
    );
    const projector = new TaxBrowserSnapshotProjector(SECRET);
    expect(projector.sourceFingerprint(receipt, first))
      .toBe(projector.sourceFingerprint(receipt, same));
    expect(projector.sourceFingerprint(receipt, changed))
      .not.toBe(projector.sourceFingerprint(receipt, first));
    store.close();
  });

  test('projects API-verified proof-pending state and externally completed ready state', () => {
    const pending = createProofPendingOnboarding('workspace:proof-pending');
    const pendingReadiness = projectArcaAuthorityReadiness(
      'AR',
      pending.workspaceId,
      GENERATED_AT,
      [pending],
    );
    expect(pendingReadiness).toMatchObject({
      state: 'verified',
      currentStep: 'zk_evidence',
      pointOfSaleState: 'active',
      delegation: { wsfex: true, wsfe: true },
      apiVerification: { wsfex: true, wsfe: true, observedAt: GENERATED_AT },
      reclaim: { state: 'pending', teeVerified: null, custodyRecorded: null },
      limitationCodes: [],
      actionId: null,
    });

    const ready = applyOnboarding(pending, {
      kind: 'record_zk_evidence',
      sessionId: pending.reclaimSession!.sessionId,
      providerId: pending.reclaimSession!.providerId,
      providerVersion: pending.reclaimSession!.providerVersion,
      proofHash: hashCanonical('private-proof'),
      claimsHash: hashCanonical('private-claims'),
      verifiedAt: GENERATED_AT,
      teeVerified: true,
      custodyReceipt: null,
      idempotencyKey: 'record-proof',
    });
    const readyReadiness = projectArcaAuthorityReadiness(
      'AR',
      ready.workspaceId,
      GENERATED_AT,
      [ready],
    );
    expect(readyReadiness).toMatchObject({
      state: 'ready',
      currentStep: 'ready',
      pointOfSaleState: 'active',
      reclaim: { state: 'verified', teeVerified: true, custodyRecorded: false },
      limitationCodes: [],
      actionId: null,
    });
    const serialized = JSON.stringify(readyReadiness);
    expect(serialized).not.toContain(pending.reclaimSession!.sessionId);
    expect(serialized).not.toContain(pending.reclaimSession!.providerId);
    expect(serialized).not.toContain(hashCanonical('private-proof'));
    expect(serialized).not.toContain('pointOfSaleNumber');
    expect(serialized).not.toContain('"number"');
  });

  test('does not invent WSFE state for an export-only WSFEX onboarding', () => {
    const pending = createProofPendingOnboarding('workspace:wsfex-only');
    const wsfexOnly = {
      ...pending,
      requestedServices: ['wsfex'] as const,
      delegation: { wsfex: true, wsfe: false },
      apiVerification: { wsfex: true, wsfe: false, observedAt: GENERATED_AT },
    };
    const readiness = projectArcaAuthorityReadiness(
      'AR',
      pending.workspaceId,
      GENERATED_AT,
      [wsfexOnly],
    );
    expect(readiness).toMatchObject({
      state: 'verified',
      requestedServices: ['wsfex'],
      delegation: { wsfex: true, wsfe: null },
      apiVerification: { wsfex: true, wsfe: null, observedAt: GENERATED_AT },
    });
  });

  test('preserves bounded negative external checks without inventing provider evidence', () => {
    const pending = createProofPendingOnboarding('workspace:negative-checks');
    const negative = {
      ...pending,
      status: 'active' as const,
      currentStep: 'api_verification' as const,
      apiVerification: { wsfex: false, wsfe: false, observedAt: GENERATED_AT },
      reclaimSession: { ...pending.reclaimSession!, state: 'failed' as const },
      zkEvidence: null,
    };
    const readiness = projectArcaAuthorityReadiness(
      'AR',
      negative.workspaceId,
      GENERATED_AT,
      [negative],
    );
    expect(readiness).toMatchObject({
      state: 'in_progress',
      currentStep: 'api_verification',
      apiVerification: { wsfex: false, wsfe: false, observedAt: GENERATED_AT },
      reclaim: {
        state: 'failed',
        teeVerified: null,
        custodyRecorded: null,
        verifiedAt: null,
      },
      limitationCodes: ['ARCA_API_VERIFICATION_REQUIRED'],
    });

    const failed = projectArcaAuthorityReadiness(
      'AR',
      negative.workspaceId,
      GENERATED_AT,
      [{ ...negative, status: 'failed' as const }],
    );
    expect(failed).toMatchObject({
      state: 'failed',
      limitationCodes: ['ARCA_ONBOARDING_FAILED'],
      actionId: null,
    });
  });

  test('rejects an ARCA source change inside the atomic browser stamping transaction', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const receipt = persistCoreSnapshot(store, snapshot, GENERATED_AT, GENERATED_AT);
    const created = createTestOnboarding(
      snapshot.workspaceId,
      '10000000-0000-4000-8000-000000000099',
      'homologation',
      '2026-07-10T12:00:00.500Z',
    ).run;
    let reads = 0;
    Object.defineProperty(store, 'listArcaOnboardingRuns', {
      configurable: true,
      value: () => (reads++ === 0 ? [] : [created]),
    });

    const read = browserService(store, () => receipt, '2026-07-10T12:00:01.000Z')
      .read(snapshot.workspaceId, PROJECTION_KEY);
    expect(read).toEqual({
      status: 409,
      result: {
        ok: false,
        problem: {
          version: 'tax-browser-problem-v1',
          code: 'TAX_EVIDENCE_GENERATION_CONFLICT',
          status: 409,
          state: 'syncing',
          retryable: true,
          traceRef: null,
        },
      },
    });
    store.close();
  });

  test('persists one stable case, advances its revision monotonically, and rejects a stale OCC source', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-browser-snapshot-'));
    const databasePath = join(directory, 'tax.sqlite');
    try {
      const initialStore = new TaxProfileStore(databasePath);
      const initialSnapshot = await demoSnapshot('AR');
      const firstCoreReceipt = persistCoreSnapshot(initialStore, initialSnapshot, GENERATED_AT, GENERATED_AT);
      const firstService = browserService(initialStore, () => firstCoreReceipt, '2026-07-10T12:00:01.000Z');

      const first = firstService.read(initialSnapshot.workspaceId, PROJECTION_KEY);
      expect(first.status).toBe(200);
      expect(first.result.ok).toBe(true);
      if (!first.result.ok) throw new Error('expected browser snapshot');
      expect(first.result.data.snapshot.cacheIdentity.caseRevision).toBe(1);
      expect(first.result.data.snapshot.taxPosition).toEqual({
        state: 'unavailable',
        taxCollected: null,
        taxPaid: null,
        netTaxPosition: null,
        limitationCodes: ['TAX_LIABILITY_RULES_NOT_PROJECTED'],
      });
      expect(first.result.data.snapshot.activity).toEqual({
        grossIncome: initialSnapshot.metrics.grossIncome,
        supportedExpenses: initialSnapshot.metrics.supportedExpenses,
      });
      expect(first.result.data.snapshot.authorizedNextActions).toEqual([]);
      expect(first.result.data.snapshot.obligations.length).toBeGreaterThan(0);
      expect(
        first.result.data.snapshot.obligations.every(
          obligation => obligation.kind?.startsWith('ar_') && obligation.ruleVersionRefs?.length,
        ),
      ).toBe(true);
      expect(first.result.data.snapshot.filingReadiness?.asOf).toBe(GENERATED_AT);
      expect(
        first.result.data.snapshot.evidenceTasks?.every(task => task.actionId === null),
      ).toBe(true);
      expect(first.result.data.snapshot.accountantPacket).toMatchObject({
        state: 'unavailable',
        packetRef: null,
        actionId: null,
        limitationCodes: ['ACCOUNTANT_PACKET_NOT_PROJECTED'],
      });
      expect(first.result.data.snapshot.planningForecast).toMatchObject({
        state: 'unavailable',
        lowerBound: null,
        upperBound: null,
        planningOnly: true,
      });
      expect(first.result.data.snapshot.supplementalEvidenceQuality).toMatchObject({
        state: 'not_consented',
        use: 'tax_evidence_only',
        affectsCredit: false,
        affectsFactoring: false,
      });
      expect(first.result.data.snapshot.capabilityManifest.approvalAwareActions.every(action => (
        action.state === 'policy_blocked' && action.actionId === null
      ))).toBe(true);
      const caseId = first.result.data.snapshot.caseId;
      const firstSnapshotRevision = first.result.data.cacheIdentity.snapshotRevision;

      const replay = firstService.read(initialSnapshot.workspaceId, PROJECTION_KEY);
      expect(replay.result.ok && replay.result.data.snapshot.caseId).toBe(caseId);
      expect(replay.result.ok && replay.result.data.cacheIdentity.caseRevision).toBe(1);
      initialStore.close();

      const restartedStore = new TaxProfileStore(databasePath);
      const restartedCoreReceipt = restartedStore.getLatestTaxWidgetSnapshot(
        initialSnapshot.workspaceId,
        '2026-07-10T12:00:02.000Z',
        PROJECTION_KEY,
      );
      if (!restartedCoreReceipt) throw new Error('missing durable core snapshot');
      const restarted = browserService(
        restartedStore,
        () => restartedCoreReceipt,
        '2026-07-10T12:00:02.000Z',
      ).read(initialSnapshot.workspaceId, PROJECTION_KEY);
      expect(restarted.result.ok && restarted.result.data.snapshot.caseId).toBe(caseId);
      expect(restarted.result.ok && restarted.result.data.cacheIdentity.caseRevision).toBe(1);

      const changedSnapshot: TaxWidgetSnapshotV1 = {
        ...initialSnapshot,
        warnings: [...initialSnapshot.warnings, 'A newly persisted safe warning.'],
      };
      const secondCoreReceipt = persistCoreSnapshot(
        restartedStore,
        changedSnapshot,
        '2026-07-10T12:05:00.000Z',
        '2026-07-10T12:05:00.000Z',
        true,
      );
      const second = browserService(
        restartedStore,
        () => secondCoreReceipt,
        '2026-07-10T12:05:01.000Z',
      ).read(initialSnapshot.workspaceId, PROJECTION_KEY);
      expect(second.result.ok && second.result.data.snapshot.caseId).toBe(caseId);
      expect(second.result.ok && second.result.data.cacheIdentity.caseRevision).toBe(2);
      expect(second.result.ok && second.result.data.cacheIdentity.snapshotRevision).not.toBe(firstSnapshotRevision);

      const stale = browserService(
        restartedStore,
        () => firstCoreReceipt,
        '2026-07-10T12:05:02.000Z',
      ).read(initialSnapshot.workspaceId, PROJECTION_KEY);
      expect(stale).toEqual({
        status: 409,
        result: {
          ok: false,
          problem: {
            version: 'tax-browser-problem-v1',
            code: 'TAX_SNAPSHOT_STALE',
            status: 409,
            state: 'syncing',
            retryable: true,
            traceRef: null,
          },
        },
      });
      restartedStore.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('preserves append-only revisions when a prior snapshot identity becomes current again', async () => {
    const store = new TaxProfileStore(':memory:');
    const initialSnapshot = await demoSnapshot('AR');
    persistCoreSnapshot(store, initialSnapshot, GENERATED_AT, GENERATED_AT);
    const projector = new TaxBrowserSnapshotProjector(SECRET);
    const service = new TaxBrowserSnapshotService(
      store,
      {
        latestSnapshot(workspaceId, projectionKey) {
          const receipt = store.getLatestTaxWidgetSnapshot(
            workspaceId,
            '2026-07-10T12:10:00.000Z',
            projectionKey,
          );
          if (!receipt) throw new Error('TAX_SNAPSHOT_NOT_FOUND');
          return receipt;
        },
      },
      projector,
      () => new Date('2026-07-10T12:10:00.000Z'),
    );

    const first = service.read(initialSnapshot.workspaceId, PROJECTION_KEY);
    expect(first.result.ok).toBe(true);
    if (!first.result.ok) throw new Error('expected first browser snapshot');
    expect(first.result.data.cacheIdentity.caseRevision).toBe(1);
    const firstCaseId = first.result.data.snapshot.caseId;
    const firstSnapshotRevision = first.result.data.cacheIdentity.snapshotRevision;
    const firstConfiguration = store.getSnapshotProjectionConfiguration(
      initialSnapshot.workspaceId,
      PROJECTION_KEY,
    );
    if (!firstConfiguration) throw new Error('missing first projection configuration');

    const secondPeriod = { start: '2026-02-01', end: '2026-02-28' } as const;
    const secondConfiguration: TaxSnapshotProjectionConfigurationV1 = {
      ...firstConfiguration.configuration,
      period: secondPeriod,
    };
    const configuredSecond = store.configureSnapshotProjection({
      configuration: secondConfiguration,
      projectionKey: PROJECTION_KEY,
      expectedConfigHash: firstConfiguration.configHash,
      actorId: 'user:test',
      configuredAt: '2026-07-10T12:05:00.000Z',
    });
    const secondSnapshot: TaxWidgetSnapshotV1 = {
      ...initialSnapshot,
      period: secondPeriod,
      inputHash: hashCanonical({ inputHash: initialSnapshot.inputHash, period: secondPeriod }),
    };
    const secondProjection = {
      version: 'tax-evidence-presentation-v1',
      upstreamBundleHash: hashCanonical({ snapshot: secondSnapshot.inputHash }),
      period: secondPeriod,
      resolvedScope: { mode: 'all_connected' },
      displayCurrency: secondSnapshot.displayCurrency,
      asOf: '2026-07-10T12:05:00.000Z',
      validUntil: VALID_UNTIL,
      capabilityManifest: secondSnapshot.capabilityManifest,
      sources: secondSnapshot.sourceCoverage,
      safeFacts: secondSnapshot.facts,
      evidenceCoverage: secondSnapshot.evidenceCoverage,
      limitations: secondSnapshot.warnings,
    } as TaxEvidencePresentationProjectionV1;
    store.saveTaxWidgetSnapshot({
      snapshot: secondSnapshot,
      projection: secondProjection,
      projectionKey: PROJECTION_KEY,
      expectedEvidenceGeneration: store.getEvidenceGeneration(secondSnapshot.workspaceId),
      expectedProjectionConfigHash: configuredSecond.configHash,
      generatedAt: '2026-07-10T12:05:00.000Z',
    });

    const second = service.read(initialSnapshot.workspaceId, PROJECTION_KEY);
    expect(second.result.ok).toBe(true);
    if (!second.result.ok) throw new Error('expected second browser snapshot');
    expect(second.result.data.cacheIdentity.caseRevision).toBe(2);

    store.configureSnapshotProjection({
      configuration: firstConfiguration.configuration,
      projectionKey: PROJECTION_KEY,
      expectedConfigHash: configuredSecond.configHash,
      actorId: 'user:test',
      configuredAt: '2026-07-10T12:06:00.000Z',
    });
    const returned = service.read(initialSnapshot.workspaceId, PROJECTION_KEY);
    expect(returned.result.ok).toBe(true);
    if (!returned.result.ok) throw new Error('expected returned browser snapshot');
    expect(returned.result.data.cacheIdentity.caseRevision).toBe(3);
    expect(returned.result.data.snapshot.caseId).toBe(firstCaseId);
    expect(returned.result.data.cacheIdentity.snapshotRevision).not.toBe(firstSnapshotRevision);
    store.close();
  });

  test('keeps the durable case stable when the browser-reference HMAC secret rotates', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const coreReceipt = persistCoreSnapshot(store, snapshot, GENERATED_AT, GENERATED_AT);
    const first = new TaxBrowserSnapshotService(
      store,
      { latestSnapshot: () => coreReceipt },
      new TaxBrowserSnapshotProjector(SECRET),
      () => new Date('2026-07-10T12:00:01.000Z'),
    ).read(snapshot.workspaceId, PROJECTION_KEY);
    expect(first.result.ok).toBe(true);
    if (!first.result.ok) throw new Error('expected pre-rotation browser snapshot');

    const rotated = new TaxBrowserSnapshotService(
      store,
      { latestSnapshot: () => coreReceipt },
      new TaxBrowserSnapshotProjector('rotated-browser-reference-secret-is-32-bytes'),
      () => new Date('2026-07-10T12:00:02.000Z'),
    ).read(snapshot.workspaceId, PROJECTION_KEY);
    expect(rotated.result.ok).toBe(true);
    if (!rotated.result.ok) throw new Error('expected post-rotation browser snapshot');
    expect(rotated.result.data.snapshot.caseId).toBe(first.result.data.snapshot.caseId);
    expect(rotated.result.data.cacheIdentity.caseRevision).toBe(2);
    expect(rotated.result.data.cacheIdentity.snapshotRevision)
      .not.toBe(first.result.data.cacheIdentity.snapshotRevision);
    store.close();
  });

  test('HMAC-scopes browser references and never emits raw core IDs or hashes', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const coreReceipt = persistCoreSnapshot(store, snapshot, GENERATED_AT, GENERATED_AT);
    const read = browserService(store, () => coreReceipt, '2026-07-10T12:00:01.000Z')
      .read(snapshot.workspaceId, PROJECTION_KEY);
    expect(read.result.ok).toBe(true);
    if (!read.result.ok) throw new Error('expected browser snapshot');
    const serialized = JSON.stringify(read.result);
    for (const unsafe of [
      snapshot.workspaceId,
      snapshot.profile.profileId,
      snapshot.profile.version,
      snapshot.profile.catalogueVersion,
      coreReceipt.snapshotHash,
      coreReceipt.inputHash,
      coreReceipt.configHash,
      ...snapshot.sourceCoverage.map(source => source.sourceId),
      ...snapshot.sourceCoverage.flatMap(source => source.providerId ? [source.providerId] : []),
      ...snapshot.obligations.map(obligation => obligation.id),
      ...snapshot.facts.map(fact => fact.evidenceHash),
      ...snapshot.facts.flatMap(fact => fact.sourceReferenceIds),
      ...snapshot.evidenceCoverage.gaps.flatMap(gap => [
        gap.id,
        gap.economicEventId,
        ...gap.safeSourceReferenceIds,
      ]),
    ]) {
      expect(serialized).not.toContain(unsafe);
    }
    expect(read.result.data.snapshot.workspaceId).toMatch(/^workspace:[A-Za-z0-9_-]{43}$/);
    expect(read.result.data.snapshot.caseId).toMatch(/^case:[A-Za-z0-9_-]{43}$/);
    expect(read.result.data.cacheIdentity.configurationRevision).toMatch(/^cfg:[A-Za-z0-9_-]{43}$/);
    expect(read.result.data.cacheIdentity.inputRevision).toMatch(/^input:[A-Za-z0-9_-]{43}$/);
    expect(read.result.data.cacheIdentity.snapshotRevision).toMatch(/^snapshot:[A-Za-z0-9_-]{43}$/);
    store.close();
  });

  test('projects ready quality without exposing consent or source commitments', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const rawConsentVersion = 'quality-consent-private-v1';
    const rawConsentScopeHash = 'd'.repeat(64);
    const qualitySnapshot: TaxWidgetSnapshotV1 = {
      ...snapshot,
      evidenceQuality: {
        version: 'tax-evidence-quality-v1',
        purpose: 'tax_evidence_quality',
        state: 'ready',
        value: 100,
        band: 'strong',
        dimensions: [
          { id: 'subject_workspace_binding' as const, score: 25, weight: 25 },
          { id: 'source_provenance_verification' as const, score: 25, weight: 25 },
          { id: 'freshness_expiry' as const, score: 20, weight: 20 },
          { id: 'required_evidence_coverage' as const, score: 20, weight: 20 },
          { id: 'reviewed_reconciliation' as const, score: 10, weight: 10 },
        ].map(dimension => ({
          ...dimension,
          safeSourceReferenceIds: snapshot.sourceCoverage.map(source => `source:${source.sourceId}`),
          safeRevisionReferenceIds: [`revision:${dimension.id}`],
          bindingState: 'verified' as const,
          freshnessState: 'current' as const,
          reviewState: 'accepted' as const,
          supersessionState: 'current' as const,
          limitationCodes: [],
          ruleVersion: 'tax-evidence-quality-v1' as const,
        })),
        reasonCodes: [],
        authorizedActionIds: [],
        asOf: GENERATED_AT,
        validUntil: VALID_UNTIL,
        safeSourceReferenceIds: snapshot.sourceCoverage.map(source => `source:${source.sourceId}`),
        consentVersion: rawConsentVersion,
        consentScopeHash: rawConsentScopeHash,
        limitationCodes: [],
        affectsCredit: false,
        affectsFactoring: false,
      },
    };
    const receipt = persistCoreSnapshot(store, qualitySnapshot, GENERATED_AT, GENERATED_AT);
    const projector = new TaxBrowserSnapshotProjector(SECRET);
    const projected = projector.project(receipt, {
      caseRef: projector.caseReference(snapshot.workspaceId, PROJECTION_KEY),
      caseRevision: 1,
      sourceFingerprint: projector.sourceFingerprint(receipt),
    });
    const serialized = JSON.stringify(projected.supplementalEvidenceQuality);
    expect(projected.supplementalEvidenceQuality).toMatchObject({
      state: 'ready', value: 100, band: 'strong', affectsCredit: false, affectsFactoring: false,
    });
    expect(serialized).not.toContain(rawConsentVersion);
    expect(serialized).not.toContain(rawConsentScopeHash);
    for (const source of snapshot.sourceCoverage) expect(serialized).not.toContain(source.sourceId);
    store.close();
  });

  test('keeps raw source IDs distinct from canonical source-reference wrappers', async () => {
    const snapshot = await demoSnapshot('AR');
    const source = snapshot.sourceCoverage[0];
    if (!source) throw new Error('expected source fixture');
    const aliasedBeforeNamespacing: TaxWidgetSnapshotV1 = {
      ...snapshot,
      sourceCoverage: [
        { ...source, sourceId: 'bank' },
        { ...source, sourceId: 'source:bank' },
      ],
    };
    const store = new TaxProfileStore(':memory:');
    const receipt = persistCoreSnapshot(
      store,
      aliasedBeforeNamespacing,
      GENERATED_AT,
      GENERATED_AT,
    );
    const projector = new TaxBrowserSnapshotProjector(SECRET);
    const projected = projector.project(receipt, {
      caseRef: projector.caseReference(snapshot.workspaceId, PROJECTION_KEY),
      caseRevision: 1,
      sourceFingerprint: projector.sourceFingerprint(receipt),
    });

    expect(projected.sourceHealth.sources).toHaveLength(2);
    expect(projected.sourceHealth.sources[0]?.sourceRef)
      .not.toBe(projected.sourceHealth.sources[1]?.sourceRef);
    store.close();
  });

  test('keeps pre-BU-238 durable snapshots readable as unknown quality', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const coreReceipt = persistCoreSnapshot(store, snapshot, GENERATED_AT, GENERATED_AT);
    const legacyReceipt = structuredClone(coreReceipt) as any;
    delete legacyReceipt.snapshot.evidenceQuality;
    const projector = new TaxBrowserSnapshotProjector(SECRET);
    const projected = projector.project(legacyReceipt, {
      caseRef: projector.caseReference(snapshot.workspaceId, PROJECTION_KEY),
      caseRevision: 1,
      sourceFingerprint: projector.sourceFingerprint(legacyReceipt),
    });
    expect(projected.supplementalEvidenceQuality).toMatchObject({
      state: 'unknown',
      limitationCodes: ['TAX_EVIDENCE_QUALITY_NOT_PROJECTED'],
    });
    store.close();
  });

  test('fails closed when an internal receipt cannot satisfy the browser schema', async () => {
    const store = new TaxProfileStore(':memory:');
    const snapshot = await demoSnapshot('AR');
    const coreReceipt = persistCoreSnapshot(store, snapshot, GENERATED_AT, GENERATED_AT);
    const projector = new TaxBrowserSnapshotProjector(SECRET);
    const malformed = {
      ...coreReceipt,
      snapshot: {
        ...coreReceipt.snapshot,
        metrics: {
          ...coreReceipt.snapshot.metrics,
          grossIncome: { decimal: '1e3', currency: coreReceipt.snapshot.displayCurrency },
        },
      },
    } as TaxWidgetSnapshotReceiptV1;
    expect(() => projector.project(malformed, {
      caseRef: projector.caseReference(snapshot.workspaceId, PROJECTION_KEY),
      caseRevision: 1,
      sourceFingerprint: projector.sourceFingerprint(malformed),
    })).toThrow('Tax browser snapshot projection failed schema validation');
    store.close();
  });

  test('returns only canonical setup, syncing, and expired problem results', () => {
    const store = new TaxProfileStore(':memory:');
    const projector = new TaxBrowserSnapshotProjector(SECRET);
    for (const [code, status] of [
      ['TAX_SNAPSHOT_NOT_FOUND', 404],
      ['TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED', 404],
      ['TAX_SNAPSHOT_STALE', 409],
      ['TAX_EVIDENCE_GENERATION_CONFLICT', 409],
      ['TAX_SNAPSHOT_EXPIRED', 410],
    ] as const) {
      const service = new TaxBrowserSnapshotService(store, {
        latestSnapshot() { throw new Error(code); },
      }, projector);
      const read = service.read('workspace:demo', PROJECTION_KEY);
      expect(read.status).toBe(status);
      expect(read.result).toEqual(expect.objectContaining({
        ok: false,
        problem: expect.objectContaining({ code, status }),
      }));
    }
    store.close();
  });
});

function browserService(
  store: TaxProfileStore,
  latest: () => TaxWidgetSnapshotReceiptV1,
  now: string,
): TaxBrowserSnapshotService {
  return new TaxBrowserSnapshotService(
    store,
    { latestSnapshot: latest },
    new TaxBrowserSnapshotProjector(SECRET),
    () => new Date(now),
  );
}

function createTestOnboarding(
  workspaceId: string,
  onboardingId: string,
  environment: 'homologation' | 'production',
  occurredAt: string,
) {
  return createArcaOnboardingRun({
    onboardingId,
    workspaceId,
    taxpayerReferenceHash: hashCanonical(`taxpayer:${workspaceId}:${onboardingId}`),
    environment,
    requestedServices: ['wsfex', 'wsfe'],
    actorId: 'user:owner',
    occurredAt,
    idempotencyKey: `create:${onboardingId}`,
  });
}

function createProofPendingOnboarding(workspaceId: string): ArcaOnboardingRunV1 {
  let run = createTestOnboarding(
    workspaceId,
    '10000000-0000-4000-8000-000000000010',
    'homologation',
    GENERATED_AT,
  ).run;
  run = applyOnboarding(run, {
    kind: 'complete_login_handoff',
    browserSessionReferenceHash: hashCanonical('private-browser-session'),
    idempotencyKey: 'complete-login',
  });
  run = applyOnboarding(run, {
    kind: 'record_human_auth_completion',
    completion: {
      version: 'human-auth-completion-v1',
      completionReceiptHash: hashCanonical('private-human-auth-receipt'),
      capturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH,
      completedAt: GENERATED_AT,
      signatureVerified: true,
    },
    idempotencyKey: 'complete-human-auth',
  });
  run = applyOnboarding(run, {
    kind: 'record_service_adherence',
    pointOfSaleAdministrationActive: true,
    relationshipManagerActive: true,
    evidenceHash: hashCanonical('private-service-evidence'),
    idempotencyKey: 'record-services',
  });
  run = applyOnboarding(run, {
    kind: 'record_point_of_sale_discovery',
    exportPointOfSale: 7,
    evidenceHash: hashCanonical('private-point-of-sale-evidence'),
    idempotencyKey: 'discover-point-of-sale',
  });
  run = applyOnboarding(run, {
    kind: 'record_ws_delegation',
    delegatedServices: { wsfex: true, wsfe: true },
    issuerProfileReferenceHash: hashCanonical('private-issuer-profile'),
    representedCuitCommitment: hashCanonical('private-taxpayer-commitment'),
    evidenceHash: hashCanonical('private-delegation-evidence'),
    idempotencyKey: 'record-delegation',
  });
  run = applyOnboarding(run, {
    kind: 'record_api_verification',
    verifiedServices: { wsfex: true, wsfe: true },
    activeExportPointOfSale: 7,
    observedAt: GENERATED_AT,
    wsfexReceiptHash: hashCanonical('private-wsfex-receipt'),
    wsfeReceiptHash: hashCanonical('private-wsfe-receipt'),
    idempotencyKey: 'record-api-verification',
  });
  return applyOnboarding(run, {
    kind: 'start_zk_evidence',
    session: {
      sessionId: 'private-reclaim-session',
      providerId: 'private-reclaim-provider',
      providerVersion: '1.0.0',
      contextHash: hashCanonical('private-reclaim-context'),
      requestedAt: GENERATED_AT,
      expiresAt: '2026-07-10T12:10:00.000Z',
      state: 'pending',
    },
    idempotencyKey: 'start-proof',
  });
}

function applyOnboarding(
  run: ArcaOnboardingRunV1,
  command: Parameters<typeof applyArcaOnboardingCommand>[1],
): ArcaOnboardingRunV1 {
  return applyArcaOnboardingCommand(run, command, 'user:owner', GENERATED_AT).run;
}

function appendOnboarding(
  store: TaxProfileStore,
  run: ArcaOnboardingRunV1,
  event: ArcaOnboardingEventV1,
): void {
  store.appendArcaOnboardingRevision({
    run,
    event,
    stateHash: hashCanonical(run),
    appendedAt: run.updatedAt,
  });
}

function persistCoreSnapshot(
  store: TaxProfileStore,
  snapshot: TaxWidgetSnapshotV1,
  generatedAt: string,
  asOf: string,
  alreadyConfigured = false,
): TaxWidgetSnapshotReceiptV1 {
  if (!alreadyConfigured) {
    store.confirm({
      profile: snapshot.profile,
      expectedVersion: null,
      actorId: 'user:test',
      occurredAt: generatedAt,
    });
  }
  const configuration: TaxSnapshotProjectionConfigurationV1 = {
    version: 'tax-snapshot-projection-configuration-v1',
    workspaceId: snapshot.workspaceId,
    period: snapshot.period,
    displayCurrency: snapshot.displayCurrency,
    dataScope: { mode: 'all_connected' },
  };
  const configured = alreadyConfigured
    ? store.getSnapshotProjectionConfiguration(snapshot.workspaceId, PROJECTION_KEY)
    : store.configureSnapshotProjection({
        configuration,
        projectionKey: PROJECTION_KEY,
        expectedConfigHash: null,
        actorId: 'user:test',
        configuredAt: generatedAt,
      });
  if (!configured) throw new Error('missing projection configuration');
  const projection = {
    version: 'tax-evidence-presentation-v1',
    upstreamBundleHash: hashCanonical({ snapshot: snapshot.inputHash, asOf }),
    period: snapshot.period,
    resolvedScope: { mode: 'all_connected' },
    displayCurrency: snapshot.displayCurrency,
    asOf,
    validUntil: VALID_UNTIL,
    capabilityManifest: snapshot.capabilityManifest,
    sources: snapshot.sourceCoverage,
    safeFacts: snapshot.facts,
    evidenceCoverage: snapshot.evidenceCoverage,
    limitations: snapshot.warnings,
  } as TaxEvidencePresentationProjectionV1;
  const persisted = store.saveTaxWidgetSnapshot({
    snapshot,
    projection,
    projectionKey: PROJECTION_KEY,
    expectedEvidenceGeneration: store.getEvidenceGeneration(snapshot.workspaceId),
    expectedProjectionConfigHash: configured.configHash,
    generatedAt,
  });
  const { replayed: _replayed, ...receipt } = persisted;
  return receipt;
}
