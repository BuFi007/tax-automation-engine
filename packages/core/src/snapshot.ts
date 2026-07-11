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
    taxCollected: EvidenceMoney;
    taxPaid: EvidenceMoney;
    netTaxPosition: EvidenceMoney;
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
  capabilityManifest: TaxEvidencePresentationProjectionV1['capabilityManifest'];
  obligations: readonly TaxObligation[];
  nextSteps: readonly TaxJourneyStep[];
  facts: readonly TaxConclusionEnvelopeV1<unknown>[];
  warnings: readonly string[];
  inputHash: string;
}>;

export function buildTaxWidgetSnapshot(input: Readonly<{
  workspaceId: string;
  profile: TaxProfile;
  evidence: TaxEvidencePresentationProjectionV1;
}>): TaxWidgetSnapshotV1 {
  const provider = getJurisdictionProvider(input.profile.jurisdiction);
  const validation = provider.validateProfile(input.profile);
  const obligations = provider.buildObligations({ profile: input.profile, period: input.evidence.period });
  const partial = input.evidence.sources.some(source => source.connectionState !== 'connected') || input.evidence.evidenceCoverage.gaps.some(gap => gap.severity === 'blocking');
  const grossIncome = input.evidence.evidenceCoverage.revenue.reconciled;
  const supportedExpenses = input.evidence.evidenceCoverage.expenses.supported;
  const net = grossIncome && supportedExpenses ? subtractMoney(grossIncome, supportedExpenses) : null;
  const estimateState = validation.length > 0 || !net ? 'unavailable' : partial ? 'preliminary' : 'review_ready';
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
      taxCollected: input.evidence.evidenceCoverage.revenue.reconciled ?? { decimal: '0', currency: input.evidence.displayCurrency },
      taxPaid: input.evidence.evidenceCoverage.expenses.supported ?? { decimal: '0', currency: input.evidence.displayCurrency },
      netTaxPosition: net ?? { decimal: '0', currency: input.evidence.displayCurrency },
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
    capabilityManifest: input.evidence.capabilityManifest,
    obligations,
    nextSteps,
    facts: input.evidence.safeFacts,
    warnings: [...validation, ...input.evidence.limitations],
    inputHash,
  };
}

function estimateWarning(state: TaxWidgetSnapshotV1['estimate']['state']): string | null {
  return state === 'verified' ? null : 'Planning estimate only. Accountant review and authority receipt are separate.';
}
