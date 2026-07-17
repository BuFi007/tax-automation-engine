import { describe, expect, test } from 'bun:test';

import {
  FACTURA_E_FACTORING_STATES_V1,
  TAX_OBLIGATION_KINDS_V1,
  deriveTaxSourceHealthStateV1,
  facturaEFactoringProjectionV1Schema,
  facturaEFactoringProjectionReadResultV1Schema,
  taxAuthorityReadinessV1Schema,
  taxCaseV1Schema,
  taxWidgetSnapshotReceiptV1Schema,
  taxWidgetSnapshotV1Schema,
} from './contracts';
import {
  argentinaTaxCaseV1Fixture,
  argentinaTaxWidgetSnapshotReceiptV1Fixture,
  argentinaTaxWidgetSnapshotV1Fixture,
  facturaENeedsConsentProjectionV1Fixture,
} from './fixtures';

describe('browser-safe Tax V1 contracts', () => {
  test('accepts closed specialist obligation semantics without changing legacy fixture bytes', () => {
    const specialist = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    specialist.obligations[0].kind = 'ar_invoice_readiness';
    specialist.obligations[0].ruleVersionRefs = ['rule-version:opaque'];
    expect(taxWidgetSnapshotV1Schema.safeParse(specialist).success).toBe(true);

    specialist.obligations[0].kind = 'arbitrary_prompt_text';
    expect(taxWidgetSnapshotV1Schema.safeParse(specialist).success).toBe(false);
    expect(TAX_OBLIGATION_KINDS_V1).toContain('us_form_5472_pro_forma_1120');
  });

  test('accepts only privacy-minimized, coherent ARCA authority readiness', () => {
    const actionRequired = {
      version: 'tax-authority-readiness-v1',
      kind: 'ar_factura_e_onboarding',
      state: 'action_required',
      environment: 'homologation',
      currentStep: 'point_of_sale_creation',
      requestedServices: ['wsfex', 'wsfe'],
      pointOfSaleState: 'missing',
      delegation: { wsfex: false, wsfe: false },
      apiVerification: { wsfex: false, wsfe: false, observedAt: null },
      reclaim: {
        state: 'not_started',
        teeVerified: null,
        custodyRecorded: null,
        verifiedAt: null,
      },
      updatedAt: '2026-07-17T10:00:00.000Z',
      limitationCodes: ['ARCA_POINT_OF_SALE_REQUIRED'],
      actionId: 'action:arca_onboarding_continue',
    } as const;
    expect(taxAuthorityReadinessV1Schema.safeParse(actionRequired).success).toBe(true);
    expect(taxWidgetSnapshotV1Schema.safeParse({
      ...argentinaTaxWidgetSnapshotV1Fixture,
      authorityReadiness: actionRequired,
      authorizedNextActions: [actionRequired.actionId],
    }).success).toBe(true);

    expect(taxWidgetSnapshotV1Schema.safeParse({
      ...argentinaTaxWidgetSnapshotV1Fixture,
      authorityReadiness: actionRequired,
    }).success).toBe(false);

    expect(taxWidgetSnapshotV1Schema.safeParse({
      ...argentinaTaxWidgetSnapshotV1Fixture,
      profile: { ...argentinaTaxWidgetSnapshotV1Fixture.profile, jurisdiction: 'US' },
      authorityReadiness: { ...actionRequired, actionId: null },
    }).success).toBe(false);

    const leaked = {
      ...actionRequired,
      pointOfSaleNumber: 7,
      onboardingId: '00000000-0000-4000-8000-000000000001',
      reclaimSessionRef: 'session:forbidden',
    };
    expect(taxAuthorityReadinessV1Schema.safeParse(leaked).success).toBe(false);

    const prematureReady = {
      ...actionRequired,
      state: 'ready',
      currentStep: 'ready',
      limitationCodes: [],
      actionId: null,
    };
    expect(taxAuthorityReadinessV1Schema.safeParse(prematureReady).success).toBe(false);

    const ready = {
      ...prematureReady,
      pointOfSaleState: 'active',
      delegation: { wsfex: true, wsfe: true },
      apiVerification: {
        wsfex: true,
        wsfe: true,
        observedAt: '2026-07-17T09:55:00.000Z',
      },
      reclaim: {
        state: 'verified',
        teeVerified: true,
        custodyRecorded: true,
        verifiedAt: '2026-07-17T09:59:00.000Z',
      },
    };
    expect(taxAuthorityReadinessV1Schema.safeParse(ready).success).toBe(true);

    const failedChecks = {
      ...actionRequired,
      currentStep: 'api_verification',
      pointOfSaleState: 'active',
      delegation: { wsfex: true, wsfe: true },
      apiVerification: {
        wsfex: false,
        wsfe: false,
        observedAt: '2026-07-17T09:55:00.000Z',
      },
      reclaim: {
        state: 'failed',
        teeVerified: false,
        custodyRecorded: true,
        verifiedAt: null,
      },
      limitationCodes: ['ARCA_API_VERIFICATION_REQUIRED'],
    };
    expect(taxAuthorityReadinessV1Schema.safeParse(failedChecks).success).toBe(true);
    expect(taxAuthorityReadinessV1Schema.safeParse({
      ...failedChecks,
      reclaim: { ...failedChecks.reclaim, state: 'pending' },
    }).success).toBe(false);
    expect(taxAuthorityReadinessV1Schema.safeParse({
      ...ready,
      reclaim: { ...ready.reclaim, teeVerified: null },
    }).success).toBe(false);

    expect(taxAuthorityReadinessV1Schema.safeParse({
      ...ready,
      state: 'verified',
      currentStep: 'zk_evidence',
      reclaim: {
        state: 'pending',
        teeVerified: null,
        custodyRecorded: null,
        verifiedAt: null,
      },
      limitationCodes: [],
    }).success).toBe(true);
  });

  test('keeps liability unavailable and exact activity separate', () => {
    expect(argentinaTaxWidgetSnapshotV1Fixture.taxPosition).toEqual({
      state: 'unavailable',
      taxCollected: null,
      taxPaid: null,
      netTaxPosition: null,
      limitationCodes: ['TAX_LIABILITY_RULES_NOT_PROJECTED'],
    });
    expect(argentinaTaxWidgetSnapshotV1Fixture.activity.grossIncome).toEqual({
      decimal: '12345678901234567890.000001',
      currency: 'ARS',
    });

    const numberMoney = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    numberMoney.activity.grossIncome.decimal = 0.1;
    expect(taxWidgetSnapshotV1Schema.safeParse(numberMoney).success).toBe(false);

    const exponentMoney = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    exponentMoney.activity.grossIncome.decimal = '1e-6';
    expect(taxWidgetSnapshotV1Schema.safeParse(exponentMoney).success).toBe(false);
  });

  test('enforces unavailable, partial, and available liability invariants', () => {
    const unavailableWithValue = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    unavailableWithValue.taxPosition.taxCollected = { decimal: '1', currency: 'ARS' };
    expect(taxWidgetSnapshotV1Schema.safeParse(unavailableWithValue).success).toBe(false);

    const emptyPartial = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    emptyPartial.taxPosition = {
      state: 'partial',
      taxCollected: null,
      taxPaid: null,
      netTaxPosition: null,
      limitationCodes: ['TAX_PAID_UNAVAILABLE'],
    };
    expect(taxWidgetSnapshotV1Schema.safeParse(emptyPartial).success).toBe(false);

    const exactAvailable = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    exactAvailable.taxPosition = {
      state: 'available',
      taxCollected: { decimal: '0.3', currency: 'ARS' },
      taxPaid: { decimal: '0.2', currency: 'ARS' },
      netTaxPosition: { decimal: '0.1', currency: 'ARS' },
      limitationCodes: [],
    };
    expect(taxWidgetSnapshotV1Schema.safeParse(exactAvailable).success).toBe(true);
    exactAvailable.taxPosition.netTaxPosition.decimal = '0.09999999999999999';
    expect(taxWidgetSnapshotV1Schema.safeParse(exactAvailable).success).toBe(false);
  });

  test('derives source health without optimistic provider claims', () => {
    const connected = argentinaTaxWidgetSnapshotV1Fixture.sourceHealth.sources[0]!;
    expect(deriveTaxSourceHealthStateV1([])).toBe('not_connected');
    expect(deriveTaxSourceHealthStateV1([{ ...connected, state: 'not_connected' }])).toBe('not_connected');
    expect(deriveTaxSourceHealthStateV1([connected])).toBe('healthy');
    expect(deriveTaxSourceHealthStateV1([{ ...connected, state: 'stale' }])).toBe('degraded');
    expect(deriveTaxSourceHealthStateV1([{ ...connected, state: 'failed' }])).toBe('blocked');

    const mismatched = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    mismatched.sourceHealth.state = 'healthy';
    expect(taxWidgetSnapshotV1Schema.safeParse(mismatched).success).toBe(false);

    const hiddenFailure = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    hiddenFailure.sourceHealth.sources[0].capabilities[0].state = 'failed';
    hiddenFailure.sourceHealth.sources[0].capabilities[0].safeErrorCode = 'SOURCE_CAPABILITY_FAILED';
    expect(deriveTaxSourceHealthStateV1(hiddenFailure.sourceHealth.sources)).toBe('blocked');
    expect(taxWidgetSnapshotV1Schema.safeParse(hiddenFailure).success).toBe(false);

    hiddenFailure.sourceHealth.sources[0].state = 'failed';
    hiddenFailure.sourceHealth.sources[0].safeErrorCode = 'SOURCE_CAPABILITY_FAILED';
    hiddenFailure.sourceHealth.state = 'blocked';
    expect(taxWidgetSnapshotV1Schema.safeParse(hiddenFailure).success).toBe(true);

    const hiddenStaleness = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    hiddenStaleness.sourceHealth.sources[0].capabilities[0].state = 'stale';
    hiddenStaleness.sourceHealth.sources[0].capabilities[0].safeErrorCode = 'SOURCE_CAPABILITY_STALE';
    expect(deriveTaxSourceHealthStateV1([hiddenStaleness.sourceHealth.sources[0]])).toBe('degraded');
    expect(taxWidgetSnapshotV1Schema.safeParse(hiddenStaleness).success).toBe(false);

    hiddenStaleness.sourceHealth.sources[0].state = 'stale';
    hiddenStaleness.sourceHealth.sources[0].safeErrorCode = 'SOURCE_CAPABILITY_STALE';
    expect(taxWidgetSnapshotV1Schema.safeParse(hiddenStaleness).success).toBe(true);
  });

  test('enforces temporal coherence for current snapshot receipts', () => {
    expect(taxWidgetSnapshotReceiptV1Schema.safeParse(argentinaTaxWidgetSnapshotReceiptV1Fixture).success).toBe(true);

    const futureEvidence = structuredClone(argentinaTaxWidgetSnapshotReceiptV1Fixture) as any;
    futureEvidence.asOf = '2026-07-15T10:00:00.001Z';
    expect(taxWidgetSnapshotReceiptV1Schema.safeParse(futureEvidence).success).toBe(false);

    const earlyCheck = structuredClone(argentinaTaxWidgetSnapshotReceiptV1Fixture) as any;
    earlyCheck.validity.checkedAt = '2026-07-15T09:59:59.999Z';
    expect(taxWidgetSnapshotReceiptV1Schema.safeParse(earlyCheck).success).toBe(false);

    const expiredAtCheck = structuredClone(argentinaTaxWidgetSnapshotReceiptV1Fixture) as any;
    expiredAtCheck.expiresAt = expiredAtCheck.validity.checkedAt;
    expect(taxWidgetSnapshotReceiptV1Schema.safeParse(expiredAtCheck).success).toBe(false);
  });

  test('keeps planning, accountant packets, and evidence quality fail-closed', () => {
    expect(argentinaTaxWidgetSnapshotV1Fixture.planningForecast).toMatchObject({
      state: 'unavailable',
      lowerBound: null,
      upperBound: null,
      planningOnly: true,
    });
    expect(argentinaTaxWidgetSnapshotV1Fixture.accountantPacket).toMatchObject({
      state: 'unavailable',
      packetRef: null,
      generatedAt: null,
    });
    expect(argentinaTaxWidgetSnapshotV1Fixture.supplementalEvidenceQuality).toMatchObject({
      state: 'not_consented',
      use: 'tax_evidence_only',
      affectsCredit: false,
      affectsFactoring: false,
    });

    const inventedForecast = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    inventedForecast.planningForecast.lowerBound = { decimal: '1', currency: 'ARS' };
    expect(taxWidgetSnapshotV1Schema.safeParse(inventedForecast).success).toBe(false);

    const unreferencedPacket = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    unreferencedPacket.accountantPacket.state = 'ready_for_review';
    unreferencedPacket.accountantPacket.limitationCodes = [];
    expect(taxWidgetSnapshotV1Schema.safeParse(unreferencedPacket).success).toBe(false);

    const scoringLeak = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    scoringLeak.supplementalEvidenceQuality.affectsFactoring = true;
    expect(taxWidgetSnapshotV1Schema.safeParse(scoringLeak).success).toBe(false);

    const numericWithoutConsent = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    numericWithoutConsent.supplementalEvidenceQuality.value = 100;
    numericWithoutConsent.supplementalEvidenceQuality.band = 'strong';
    expect(taxWidgetSnapshotV1Schema.safeParse(numericWithoutConsent).success).toBe(false);

    const readyQuality = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    readyQuality.supplementalEvidenceQuality = {
      ...readyQuality.supplementalEvidenceQuality,
      state: 'ready',
      value: 100,
      band: 'strong',
      dimensions: [
        { id: 'subject_workspace_binding', score: 25, weight: 25 },
        { id: 'source_provenance_verification', score: 25, weight: 25 },
        { id: 'freshness_expiry', score: 20, weight: 20 },
        { id: 'required_evidence_coverage', score: 20, weight: 20 },
        { id: 'reviewed_reconciliation', score: 10, weight: 10 },
      ].map(dimension => ({
        ...dimension,
        safeSourceRefs: [],
        safeRevisionRefs: ['evidence:quality_revision_0001'],
        bindingState: 'verified',
        freshnessState: 'current',
        reviewState: 'accepted',
        supersessionState: 'current',
        limitationCodes: [],
        ruleVersion: 'rule:tax-evidence-quality-v1',
      })),
      reasonCodes: [],
      authorizedActionIds: [],
      consentVersion: 'consent:quality-v1',
      consentScopeRevision: 'consent:quality-scope-v1',
      limitationCodes: [],
    };
    expect(taxWidgetSnapshotV1Schema.safeParse(readyQuality).success).toBe(true);
    readyQuality.supplementalEvidenceQuality.dimensions[0].score = 24;
    expect(taxWidgetSnapshotV1Schema.safeParse(readyQuality).success).toBe(false);

    const preMinorSnapshot = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    delete preMinorSnapshot.filingReadiness;
    delete preMinorSnapshot.evidenceTasks;
    delete preMinorSnapshot.accountantPacket;
    delete preMinorSnapshot.planningForecast;
    delete preMinorSnapshot.supplementalEvidenceQuality;
    expect(taxWidgetSnapshotV1Schema.safeParse(preMinorSnapshot).success).toBe(true);

    const legacyQuality = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    legacyQuality.supplementalEvidenceQuality = {
      state: 'unavailable',
      band: null,
      asOf: legacyQuality.supplementalEvidenceQuality.asOf,
      safeSourceRefs: [],
      limitationCodes: ['TAX_EVIDENCE_QUALITY_NOT_PROJECTED'],
      use: 'tax_evidence_only',
      affectsCredit: false,
      affectsFactoring: false,
    };
    expect(taxWidgetSnapshotV1Schema.safeParse(legacyQuality).success).toBe(true);
  });

  test('rejects restricted fiscal/evidence fields and incoherent durable steps', () => {
    const leaked = { ...argentinaTaxWidgetSnapshotV1Fixture, cae: '12345678901234' };
    expect(taxWidgetSnapshotV1Schema.safeParse(leaked).success).toBe(false);

    const leakedProfile = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    leakedProfile.profile.cuit = '20999999999';
    expect(taxWidgetSnapshotV1Schema.safeParse(leakedProfile).success).toBe(false);

    const unevidencedStep = structuredClone(argentinaTaxCaseV1Fixture) as any;
    unevidencedStep.steps[0].completionEvidenceRefs = [];
    expect(taxCaseV1Schema.safeParse(unevidencedStep).success).toBe(false);

    const incoherentApproval = structuredClone(argentinaTaxCaseV1Fixture) as any;
    incoherentApproval.approvals[0].state = 'approved';
    expect(taxCaseV1Schema.safeParse(incoherentApproval).success).toBe(false);
  });

  test('keeps factoring consented, capped, non-limit-feeding, and restricted', () => {
    expect(FACTURA_E_FACTORING_STATES_V1).toHaveLength(13);
    expect(facturaENeedsConsentProjectionV1Fixture.score).toMatchObject({
      basePaymentScore: null,
      facturaEContribution: null,
      compositePaymentScore: null,
      contributionCap: '0',
      feedsLimit: false,
    });

    const prematureScore = structuredClone(facturaENeedsConsentProjectionV1Fixture) as any;
    prematureScore.score.basePaymentScore = '80';
    expect(facturaEFactoringProjectionV1Schema.safeParse(prematureScore).success).toBe(false);

    const leaked = { ...facturaENeedsConsentProjectionV1Fixture, authorityInvoiceId: 'global-hash' };
    expect(facturaEFactoringProjectionV1Schema.safeParse(leaked).success).toBe(false);

    expect(facturaEFactoringProjectionReadResultV1Schema.safeParse({
      state: 'ready',
      receipt: {
        version: 'factura-e-factoring-projection-receipt-v1',
        projectionKey: facturaENeedsConsentProjectionV1Fixture.cacheIdentity.projectionKey,
        revision: 1,
        projectedAt: '2026-07-16T09:00:00.000Z',
        projection: facturaENeedsConsentProjectionV1Fixture,
      },
    }).success).toBe(true);
  });

  test('keeps evidence quality outside Payment Score, factoring, pricing, ACE, and exposure', () => {
    const factoringBytes = JSON.stringify(facturaENeedsConsentProjectionV1Fixture);
    for (const forbidden of ['paymentScore', 'pricing', 'ace', 'exposure']) {
      const leaked = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
      leaked.supplementalEvidenceQuality[forbidden] = { value: 'forbidden' };
      expect(taxWidgetSnapshotV1Schema.safeParse(leaked).success).toBe(false);
      expect(JSON.stringify(facturaENeedsConsentProjectionV1Fixture)).toBe(factoringBytes);
    }
  });

  test('rejects impossible Factura E score, authority, and offer combinations', () => {
    const prematureOffer = structuredClone(facturaENeedsConsentProjectionV1Fixture) as any;
    prematureOffer.offer = { state: 'ready', offerRef: 'offer:premature' };
    expect(facturaEFactoringProjectionV1Schema.safeParse(prematureOffer).success).toBe(false);

    const fakeActive = structuredClone(facturaENeedsConsentProjectionV1Fixture) as any;
    fakeActive.state = 'active';
    fakeActive.consentState = 'active';
    fakeActive.authorityEvidenceState = 'verified';
    fakeActive.kybState = 'verified';
    fakeActive.receivableRef = 'receivable:active';
    fakeActive.expiresAt = '2026-07-16T10:00:00.000Z';
    expect(facturaEFactoringProjectionV1Schema.safeParse(fakeActive).success).toBe(false);

    fakeActive.score = {
      basePaymentScore: '72', facturaEContribution: '11', compositePaymentScore: '83',
      contributionCap: '10', feedsLimit: false, policyVersion: 'factoring-policy:v1',
    };
    expect(facturaEFactoringProjectionV1Schema.safeParse(fakeActive).success).toBe(false);
  });
});
