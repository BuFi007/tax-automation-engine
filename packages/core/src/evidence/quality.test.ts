import { describe, expect, test } from 'bun:test';

import type { TaxConsentGrant } from '../types';
import { hashTaxConsentScope } from './batch';
import { calculateTaxEvidenceQualityV1, unavailableTaxEvidenceQualityV1 } from './quality';
import type {
  TaxEvidenceAdapterContext,
  TaxEvidenceQualityUnavailableStateV1,
  TaxEvidenceQualityV1,
  TaxEvidenceRecord,
  TaxSourceCoverage,
} from './types';

const AS_OF = '2026-07-16T12:00:00.000Z';
const SOURCE_ID = 'bank:primary';

describe('consented Tax evidence quality', () => {
  test('computes the frozen five-dimension 0-100 formula only in ready state', () => {
    const quality = calculateTaxEvidenceQualityV1(input({
      consentGrants: [qualityGrant()],
      records: [record('invoice'), record('settlement')],
    }));

    expect(quality).toMatchObject({
      state: 'ready',
      value: 100,
      band: 'strong',
      purpose: 'tax_evidence_quality',
      affectsCredit: false,
      affectsFactoring: false,
      dimensions: [
        { id: 'subject_workspace_binding', score: 25, weight: 25 },
        { id: 'source_provenance_verification', score: 25, weight: 25 },
        { id: 'freshness_expiry', score: 20, weight: 20 },
        { id: 'required_evidence_coverage', score: 20, weight: 20 },
        { id: 'reviewed_reconciliation', score: 10, weight: 10 },
      ],
    });
  });

  test('keeps consent, lifecycle, support, and subject failures numeric-free', () => {
    const revoked = { ...qualityGrant(), revokedAt: '2026-07-16T11:00:00.000Z' };
    const expired = { ...qualityGrant(), expiresAt: '2026-07-16T11:00:00.000Z' };
    const disputedRecord = { ...record('invoice'), reviewState: 'disputed' as const, validityState: 'disputed' as const };
    const staleSource = { ...source(), connectionState: 'stale' as const };
    const unsupportedSource = { ...source(), connectionState: 'not_connected' as const };
    const cases: readonly TaxEvidenceQualityV1[] = [
      calculateTaxEvidenceQualityV1(input()),
      calculateTaxEvidenceQualityV1(input({ consentGrants: [revoked] })),
      calculateTaxEvidenceQualityV1(input({ consentGrants: [expired] })),
      calculateTaxEvidenceQualityV1(input({ consentGrants: [qualityGrant()], records: [disputedRecord] })),
      calculateTaxEvidenceQualityV1(input({ consentGrants: [qualityGrant()], sources: [staleSource] })),
      calculateTaxEvidenceQualityV1(input({ consentGrants: [qualityGrant()], sources: [unsupportedSource] })),
      calculateTaxEvidenceQualityV1(input({ subjectState: 'not_subject' })),
      calculateTaxEvidenceQualityV1(input({ subjectState: 'unknown' })),
    ];
    expect(cases.map(value => value.state)).toEqual([
      'not_consented', 'revoked', 'expired', 'disputed', 'stale', 'unsupported', 'not_subject', 'unknown',
    ]);
    for (const quality of cases) {
      expect('value' in quality).toBe(false);
      expect('band' in quality).toBe(false);
      expect('dimensions' in quality).toBe(false);
      expect(quality.limitationCodes.length).toBeGreaterThan(0);
    }
  });

  test('publishes every unavailable state as a first-class, fail-closed value', () => {
    const states: readonly TaxEvidenceQualityUnavailableStateV1[] = [
      'unknown', 'not_subject', 'unsupported', 'disputed', 'stale', 'expired', 'revoked', 'not_consented',
    ];
    expect(states.map(state => unavailableTaxEvidenceQualityV1(state, AS_OF, `QUALITY_${state.toUpperCase()}`).state))
      .toEqual([...states]);
  });
});

function input(overrides: Partial<{
  consentGrants: readonly TaxConsentGrant[];
  records: readonly TaxEvidenceRecord[];
  sources: readonly TaxSourceCoverage[];
  subjectState: 'subject' | 'not_subject' | 'unknown';
}> = {}) {
  const records = overrides.records ?? [record('invoice')];
  const context: TaxEvidenceAdapterContext = {
    workspaceId: 'workspace:quality',
    actorId: 'actor:owner',
    connectionId: null,
    consentGrants: overrides.consentGrants ?? [],
    period: { start: '2026-07-01', end: '2026-07-31' },
    displayCurrency: 'ARS',
    asOf: AS_OF,
    dataScope: { mode: 'selected', sourceIds: [SOURCE_ID], includeKnowledgeGraph: false },
  };
  return {
    context,
    sources: overrides.sources ?? [source()],
    records,
    activePeriodRecords: records,
    gapCount: 0,
    ...(overrides.subjectState ? { subjectState: overrides.subjectState } : {}),
  };
}

function qualityGrant(): TaxConsentGrant {
  const scopeIds = [SOURCE_ID];
  return {
    purpose: 'tax_evidence_quality',
    version: 'quality-consent-v1',
    scopeIds,
    scopeHash: hashTaxConsentScope('tax_evidence_quality', 'quality-consent-v1', scopeIds),
    grantedAt: '2026-07-16T10:00:00.000Z',
    expiresAt: '2026-08-16T10:00:00.000Z',
    revokedAt: null,
  };
}

function source(): TaxSourceCoverage {
  return {
    sourceId: SOURCE_ID,
    kind: 'bank',
    providerId: 'provider:bank',
    displayName: 'Bank',
    capabilities: [{
      capability: 'transactions',
      state: 'available',
      observedAt: AS_OF,
      safeErrorCode: null,
    }],
    connectionState: 'connected',
    lastSuccessfulSyncAt: AS_OF,
    recordsScanned: 2,
    acceptedEvidenceCount: 2,
    needsReviewCount: 0,
    safeErrorCode: null,
  };
}

function record(role: 'invoice' | 'settlement'): TaxEvidenceRecord {
  const hash = role === 'invoice' ? 'a'.repeat(64) : 'b'.repeat(64);
  return {
    evidenceId: `evidence:${role}`,
    workspaceId: 'workspace:quality',
    revision: 'revision:1',
    sourceId: SOURCE_ID,
    sourceKind: 'bank',
    canonicalProviderId: 'provider:bank',
    externalReferenceHash: hash,
    sourceEventHash: hash,
    artifactHash: hash,
    jurisdiction: 'AR',
    period: { start: '2026-07-01', end: '2026-07-31' },
    observedAt: '2026-07-16T11:00:00.000Z',
    expiresAt: '2026-08-16T11:00:00.000Z',
    economicEventId: `event:${role}`,
    economicRole: role,
    invoiceDocumentKind: role === 'invoice' ? 'arca_factura_e' : null,
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    countingDimension: role === 'invoice' ? 'revenue' : 'none',
    direction: role === 'invoice' ? 'inflow' : 'neutral',
    money: role === 'invoice' ? { decimal: '100', currency: 'ARS' } : null,
    normalizedMoney: role === 'invoice' ? { decimal: '100', currency: 'ARS' } : null,
    fxReferenceId: null,
    partyClaimHash: hash,
    accountReferenceHash: hash,
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
    validityState: 'active',
    consentVersion: 'processing-consent-v1',
    idempotencyKey: hash,
    supersedesIdempotencyKey: null,
  };
}
