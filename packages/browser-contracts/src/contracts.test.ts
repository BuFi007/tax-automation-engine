import { describe, expect, test } from 'bun:test';

import {
  FACTURA_E_FACTORING_STATES_V1,
  deriveTaxSourceHealthStateV1,
  facturaEFactoringProjectionV1Schema,
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
      state: 'unavailable',
      band: null,
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

    const preMinorSnapshot = structuredClone(argentinaTaxWidgetSnapshotV1Fixture) as any;
    delete preMinorSnapshot.filingReadiness;
    delete preMinorSnapshot.evidenceTasks;
    delete preMinorSnapshot.accountantPacket;
    delete preMinorSnapshot.planningForecast;
    delete preMinorSnapshot.supplementalEvidenceQuality;
    expect(taxWidgetSnapshotV1Schema.safeParse(preMinorSnapshot).success).toBe(true);
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
