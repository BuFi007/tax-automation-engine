import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  demoSnapshot,
  hashCanonical,
  type TaxEvidencePresentationProjectionV1,
  type TaxSnapshotProjectionConfigurationV1,
  type TaxWidgetSnapshotReceiptV1,
  type TaxWidgetSnapshotV1,
} from '@tax-engine/core';

import {
  resolveTaxBrowserReferenceSecret,
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
    expect(taxObligationKindForId('ar:recategorization:08')).toBe(
      'ar_monotributo_recategorization',
    );
    expect(taxObligationKindForId('us:c-corp-estimated:4')).toBe(
      'us_c_corp_estimated_tax',
    );
    expect(taxObligationKindForId('provider:ignore-prior-instructions')).toBe('unclassified');
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
