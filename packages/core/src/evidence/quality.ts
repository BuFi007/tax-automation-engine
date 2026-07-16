import { hashTaxConsentScope } from './batch';
import type {
  TaxEvidenceAdapterContext,
  TaxEvidenceQualityBandV1,
  TaxEvidenceQualityUnavailableStateV1,
  TaxEvidenceQualityV1,
  TaxEvidenceRecord,
  TaxSourceCoverage,
} from './types';

const DIMENSION_WEIGHTS = Object.freeze({
  subject_workspace_binding: 25,
  source_provenance_verification: 25,
  freshness_expiry: 20,
  required_evidence_coverage: 20,
  reviewed_reconciliation: 10,
} as const);

export type TaxEvidenceQualityInputV1 = Readonly<{
  context: TaxEvidenceAdapterContext;
  sources: readonly TaxSourceCoverage[];
  records: readonly TaxEvidenceRecord[];
  activePeriodRecords: readonly TaxEvidenceRecord[];
  gapCount: number;
  subjectState?: 'subject' | 'not_subject' | 'unknown';
}>;

/**
 * Computes an evidence-quality signal for Tax presentation only. It is not a
 * compliance conclusion, credit score, factoring input, price, limit, or ACE
 * policy signal. Callers must preserve those domains byte-for-byte.
 */
export function calculateTaxEvidenceQualityV1(input: TaxEvidenceQualityInputV1): TaxEvidenceQualityV1 {
  const asOf = input.context.asOf;
  const safeSourceReferenceIds = input.sources.map(source => `source:${source.sourceId}`).sort();
  const base = {
    version: 'tax-evidence-quality-v1' as const,
    purpose: 'tax_evidence_quality' as const,
    asOf,
    validUntil: earliestFutureIso([
      ...input.records.map(record => record.expiresAt),
      ...input.context.consentGrants
        .filter(grant => grant.purpose === 'tax_evidence_quality')
        .map(grant => grant.expiresAt ?? null),
    ], asOf),
    safeSourceReferenceIds,
    affectsCredit: false as const,
    affectsFactoring: false as const,
  };

  if (input.subjectState === 'not_subject') {
    return unavailable(base, 'not_subject', 'TAX_EVIDENCE_QUALITY_NOT_SUBJECT');
  }
  if (input.subjectState === 'unknown') {
    return unavailable(base, 'unknown', 'TAX_EVIDENCE_QUALITY_SUBJECT_UNKNOWN');
  }

  const requiredSourceIds = [...new Set(input.sources.map(source => source.sourceId))].sort();
  const qualityGrants = input.context.consentGrants
    .filter(grant => grant.purpose === 'tax_evidence_quality'
      && instant(grant.grantedAt) <= instant(asOf))
    .sort((left, right) => right.grantedAt.localeCompare(left.grantedAt));
  const activeGrant = qualityGrants.find(grant => grant.revokedAt === null);
  if (!activeGrant) {
    return qualityGrants.some(grant => grant.revokedAt !== null)
      ? unavailable(base, 'revoked', 'TAX_EVIDENCE_QUALITY_CONSENT_REVOKED')
      : unavailable(base, 'not_consented', 'TAX_EVIDENCE_QUALITY_CONSENT_REQUIRED');
  }
  if (activeGrant.expiresAt && instant(activeGrant.expiresAt) <= instant(asOf)) {
    return unavailable(base, 'expired', 'TAX_EVIDENCE_QUALITY_CONSENT_EXPIRED');
  }
  const canonicalScopeIds = [...new Set(activeGrant.scopeIds)].sort();
  const expectedScopeHash = hashTaxConsentScope(
    'tax_evidence_quality',
    activeGrant.version,
    canonicalScopeIds,
  );
  if (activeGrant.scopeHash !== expectedScopeHash
    || requiredSourceIds.some(sourceId => !canonicalScopeIds.includes(sourceId))) {
    return unavailable(base, 'not_consented', 'TAX_EVIDENCE_QUALITY_SCOPE_NOT_CONSENTED');
  }
  if (input.records.some(record => record.validityState === 'disputed' || record.reviewState === 'disputed')) {
    return unavailable(base, 'disputed', 'TAX_EVIDENCE_QUALITY_DISPUTED');
  }
  if (input.sources.length === 0) {
    return unavailable(base, 'unknown', 'TAX_EVIDENCE_QUALITY_SOURCES_UNKNOWN');
  }
  if (input.sources.every(source => source.connectionState === 'not_connected')) {
    return unavailable(base, 'unsupported', 'TAX_EVIDENCE_QUALITY_SOURCES_UNSUPPORTED');
  }
  if (input.sources.some(source => source.connectionState === 'stale')) {
    return unavailable(base, 'stale', 'TAX_EVIDENCE_QUALITY_SOURCE_STALE');
  }
  const relevantRecords = input.records.filter(record => periodsOverlap(record.period, input.context.period));
  if (relevantRecords.length > 0 && relevantRecords.every(record => (
    record.expiresAt !== null && instant(record.expiresAt) <= instant(asOf)
  ))) {
    return unavailable(base, 'expired', 'TAX_EVIDENCE_QUALITY_EVIDENCE_EXPIRED');
  }

  const active = input.activePeriodRecords;
  const connectedSources = input.sources.filter(source => source.connectionState === 'connected').length;
  const verifiedRecords = active.filter(record => (
    isSha256(record.externalReferenceHash)
    && isSha256(record.sourceEventHash)
    && isSha256(record.artifactHash)
  )).length;
  const acceptedRecords = active.filter(record => record.reviewState === 'accepted').length;
  const reviewedReconciliationRecords = active.filter(record => (
    record.reviewState === 'accepted'
    && (record.economicRole === 'settlement' || record.economicRole === 'receipt')
  )).length;

  const dimensions = [
    dimension('subject_workspace_binding', active.length > 0
      && active.every(record => record.workspaceId === input.context.workspaceId) ? 25 : 0),
    dimension('source_provenance_verification', Math.round(25 * average([
      ratio(connectedSources, input.sources.length),
      ratio(verifiedRecords, active.length),
    ]))),
    dimension('freshness_expiry', Math.round(20 * ratio(
      active.filter(record => !record.expiresAt || instant(record.expiresAt) > instant(asOf)).length,
      active.length,
    ))),
    dimension('required_evidence_coverage', Math.max(0, Math.round(20 * (
      1 - Math.min(input.gapCount, Math.max(active.length, 1)) / Math.max(active.length, 1)
    )))),
    dimension('reviewed_reconciliation', Math.round(10 * average([
      ratio(acceptedRecords, active.length),
      ratio(reviewedReconciliationRecords, active.filter(record => (
        record.economicRole === 'settlement' || record.economicRole === 'receipt'
      )).length),
    ]))),
  ].map(item => ({
    ...item,
    safeSourceReferenceIds,
    limitationCodes: item.score === item.weight ? [] : [dimensionLimitationCode(item.id)],
    ruleVersion: 'tax-evidence-quality-v1' as const,
  }));
  const value = dimensions.reduce((total, item) => total + item.score, 0);
  const reasonCodes = dimensions.flatMap(item => item.limitationCodes);

  return {
    ...base,
    state: 'ready',
    value,
    band: band(value),
    dimensions,
    reasonCodes,
    authorizedActionIds: [],
    consentVersion: activeGrant.version,
    consentScopeHash: activeGrant.scopeHash,
    limitationCodes: value === 100 ? [] : ['TAX_EVIDENCE_QUALITY_INCOMPLETE'],
  };
}

export function unavailableTaxEvidenceQualityV1(
  state: TaxEvidenceQualityUnavailableStateV1,
  asOf: string,
  limitationCode: string,
): TaxEvidenceQualityV1 {
  return unavailable({
    version: 'tax-evidence-quality-v1',
    purpose: 'tax_evidence_quality',
    asOf,
    validUntil: null,
    safeSourceReferenceIds: [],
    affectsCredit: false,
    affectsFactoring: false,
  }, state, limitationCode);
}

function dimension(
  id: keyof typeof DIMENSION_WEIGHTS,
  score: number,
): Readonly<{ id: keyof typeof DIMENSION_WEIGHTS; score: number; weight: number }> {
  const weight = DIMENSION_WEIGHTS[id];
  return { id, score: Math.max(0, Math.min(weight, score)), weight };
}

function dimensionLimitationCode(id: keyof typeof DIMENSION_WEIGHTS): string {
  return `TAX_EVIDENCE_QUALITY_${id.toUpperCase()}_INCOMPLETE`;
}

function unavailable(
  base: Omit<Extract<TaxEvidenceQualityV1, { state: 'ready' }>,
    'state' | 'value' | 'band' | 'dimensions' | 'reasonCodes' | 'authorizedActionIds'
    | 'consentVersion' | 'consentScopeHash' | 'limitationCodes'>,
  state: TaxEvidenceQualityUnavailableStateV1,
  limitationCode: string,
): TaxEvidenceQualityV1 {
  return { ...base, state, limitationCodes: [limitationCode] };
}

function band(value: number): TaxEvidenceQualityBandV1 {
  if (value <= 39) return 'limited';
  if (value <= 74) return 'developing';
  return 'strong';
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function periodsOverlap(
  left: Readonly<{ start: string; end: string }>,
  right: Readonly<{ start: string; end: string }>,
): boolean {
  return left.start <= right.end && left.end >= right.start;
}

function earliestFutureIso(values: readonly (string | null)[], asOf: string): string | null {
  const present = values.filter((value): value is string => value !== null && instant(value) > instant(asOf));
  if (present.length === 0) return null;
  return [...present].sort((left, right) => instant(left) - instant(right))[0] ?? null;
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('EVIDENCE_TIMESTAMP_INVALID');
  return parsed;
}
