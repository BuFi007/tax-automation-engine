import { createHash } from 'node:crypto';

import { getJurisdictionProvider } from './catalogue';
import { subtractMoney } from './money';
import type { TaxEvidencePresentationProjectionV1 } from './evidence';
import type { EvidenceMoney, TaxConclusionEnvelopeV1, TaxObligation, TaxProfile } from './types';

export type TaxJourneyStep = Readonly<{
  id: string;
  title: string;
  description: string;
  owner: 'user' | 'tax_agent' | 'accountant';
  status: 'available' | 'in_progress' | 'needs_review' | 'complete';
  actionId: string | null;
  obligationId: string;
}>;

export type TaxWidgetSnapshotV1 = Readonly<{
  version: 'tax-widget-v1';
  workspaceId: string;
  profile: TaxProfile;
  period: Readonly<{ start: string; end: string }>;
  displayCurrency: string;
  metrics: Readonly<{
    taxCollected: EvidenceMoney | null;
    taxPaid: EvidenceMoney | null;
    netTaxPosition: EvidenceMoney | null;
    grossIncome: EvidenceMoney | null;
    supportedExpenses: EvidenceMoney | null;
  }>;
  estimate: Readonly<{
    state: 'unavailable' | 'preliminary' | 'review_ready' | 'verified';
    amount: EvidenceMoney | null;
    warning: string | null;
  }>;
  sourceCoverage: TaxEvidencePresentationProjectionV1['sources'];
  evidenceCoverage: TaxEvidencePresentationProjectionV1['evidenceCoverage'];
  evidenceQuality: NonNullable<TaxEvidencePresentationProjectionV1['evidenceQuality']>;
  capabilityManifest: TaxEvidencePresentationProjectionV1['capabilityManifest'];
  obligations: readonly TaxObligation[];
  nextSteps: readonly TaxJourneyStep[];
  facts: readonly TaxConclusionEnvelopeV1<unknown>[];
  warnings: readonly string[];
  inputHash: string;
}>;

export const DEFAULT_TAX_SNAPSHOT_PROJECTION_KEY = 'default';

export type TaxWidgetSnapshotReceiptV1 = Readonly<{
  version: 'tax-widget-snapshot-receipt-v1';
  projectionKey: string;
  snapshotHash: string;
  inputHash: string;
  configHash: string;
  evidenceGeneration: number;
  generatedAt: string;
  asOf: string;
  expiresAt: string | null;
  validity: Readonly<{
    state: 'current';
    checkedAt: string;
  }>;
  snapshot: TaxWidgetSnapshotV1;
}>;

export function normalizeTaxSnapshotProjectionKey(value: string | null | undefined): string {
  const projectionKey = value ?? DEFAULT_TAX_SNAPSHOT_PROJECTION_KEY;
  if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(projectionKey)) {
    throw new Error('TAX_SNAPSHOT_PROJECTION_KEY_INVALID');
  }
  return projectionKey;
}

export function buildTaxWidgetSnapshot(input: Readonly<{
  workspaceId: string;
  profile: TaxProfile;
  evidence: TaxEvidencePresentationProjectionV1;
}>): TaxWidgetSnapshotV1 {
  const provider = getJurisdictionProvider(input.profile.jurisdiction);
  const validation = provider.validateProfile(input.profile);
  const obligations = provider.buildObligations({ profile: input.profile, period: input.evidence.period });
  const missingSources = input.evidence.sources.length === 0;
  const partialSources = input.evidence.sources.some(source => source.connectionState !== 'connected');
  const hasBlockingGap = input.evidence.evidenceCoverage.gaps.some(gap => gap.severity === 'blocking');
  const hasUnsafeFactConfidence = input.evidence.safeFacts.some(fact => (
    fact.value.kind === 'reconciled_revenue' || fact.value.kind === 'supported_expenses'
  ) && (fact.confidence.level === 'low' || fact.confidence.level === 'unknown'));
  const grossIncome = input.evidence.evidenceCoverage.revenue.reconciled;
  const supportedExpenses = input.evidence.evidenceCoverage.expenses.supported;
  const net = grossIncome && supportedExpenses ? subtractMoney(grossIncome, supportedExpenses) : null;
  const estimateState = validation.length > 0
    || missingSources
    || partialSources
    || !net
    || hasBlockingGap
    || hasUnsafeFactConfidence
    ? 'unavailable'
    : 'review_ready';
  const nextSteps = obligations
    .filter(obligation => obligation.preparationState !== 'accountant_approved' || obligation.submissionState !== 'accepted')
    .slice(0, 3)
    .map(obligation => ({
      id: `step:${obligation.id}`,
      title: obligation.title,
      description: obligation.description,
      owner: obligation.applicability === 'needs_professional_review' ? ('accountant' as const) : ('user' as const),
      status: obligation.applicability === 'needs_professional_review' || obligation.applicability === 'unknown' ? ('needs_review' as const) : ('available' as const),
      actionId: obligation.actionId,
      obligationId: obligation.id,
    }));
  const inputHash = createHash('sha256')
    .update(JSON.stringify({ profileVersion: input.profile.version, catalogueVersion: input.profile.catalogueVersion, evidenceHash: input.evidence.upstreamBundleHash, obligations: obligations.map(obligation => obligation.id) }))
    .digest('hex');

  return {
    version: 'tax-widget-v1',
    workspaceId: input.workspaceId,
    profile: input.profile,
    period: input.evidence.period,
    displayCurrency: input.evidence.displayCurrency,
    metrics: {
      taxCollected: null,
      taxPaid: null,
      netTaxPosition: null,
      grossIncome,
      supportedExpenses,
    },
    estimate: {
      state: estimateState,
      amount: estimateState === 'unavailable' ? null : net,
      warning: estimateWarning(estimateState),
    },
    sourceCoverage: input.evidence.sources,
    evidenceCoverage: { ...input.evidence.evidenceCoverage, obligations: { applicable: obligations.length, mapped: obligations.filter(obligation => obligation.applicability === 'applicable').length } },
    evidenceQuality: input.evidence.evidenceQuality ?? {
      version: 'tax-evidence-quality-v1',
      purpose: 'tax_evidence_quality',
      state: 'unknown',
      asOf: input.evidence.asOf,
      validUntil: null,
      safeSourceReferenceIds: [],
      limitationCodes: ['TAX_EVIDENCE_QUALITY_NOT_PROJECTED'],
      affectsCredit: false,
      affectsFactoring: false,
    },
    capabilityManifest: input.evidence.capabilityManifest,
    obligations,
    nextSteps,
    facts: input.evidence.safeFacts,
    warnings: [...validation, ...input.evidence.limitations],
    inputHash,
  };
}

function estimateWarning(state: TaxWidgetSnapshotV1['estimate']['state']): string | null {
  return state === 'verified' ? null : 'Planning estimate only: this is evidence-derived net activity, not a tax liability. Accountant review and authority receipt are separate.';
}
