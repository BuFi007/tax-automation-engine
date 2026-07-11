import type { JurisdictionCatalogue, TaxJurisdictionProvider, WorkflowBuildContext } from './types';
import type { TaxObligation, TaxProfile } from '../types';

const RULES = {
  entity: 'us-entity-v1',
  estimated: 'us-estimated-tax-v1',
  records: 'us-recordkeeping-v1',
} as const;

export const unitedStatesCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'US',
  version: 'us-catalogue-2026-07-10',
  displayName: 'United States',
  questions: [
    { id: 'founder_residency', label: 'Founder tax residency', kind: 'enum', required: true, options: [
      { value: 'local', label: 'U.S. person' },
      { value: 'foreign', label: 'Foreign-domiciled founder' },
    ] },
    { id: 'member_count', label: 'LLC member count', kind: 'integer', required: false },
    { id: 'tax_classification', label: 'Confirmed federal classification/election', kind: 'enum', required: true },
    { id: 'formation_state', label: 'Formation state', kind: 'subdivision', required: true },
    { id: 'operating_states', label: 'Operating states', kind: 'multi_select', required: true },
    { id: 'sales_states', label: 'States with sales', kind: 'multi_select', required: true },
    { id: 'has_payroll', label: 'Has payroll', kind: 'boolean', required: true },
  ],
  regimes: [
    { id: 'llc_single_member', entityTypes: ['llc'], label: 'Single-member LLC', description: 'Entity, owner-residency, federal classification, state, and sales-tax review.', requiredQuestions: ['founder_residency', 'member_count', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.records] },
    { id: 'llc_multi_member', entityTypes: ['llc'], label: 'Multi-member LLC', description: 'Partnership/default-election ambiguity is routed to professional review.', requiredQuestions: ['founder_residency', 'member_count', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.records] },
    { id: 's_corp', entityTypes: ['corporation'], label: 'S-Corporation', description: 'Federal, state, payroll, and information-return workflow.', requiredQuestions: ['founder_residency', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.estimated] },
    { id: 'c_corp', entityTypes: ['corporation'], label: 'C-Corporation', description: 'Federal corporate, state franchise/income, sales-tax, and payroll workflow.', requiredQuestions: ['founder_residency', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.records] },
  ],
  rules: [
    { id: RULES.entity, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://www.irs.gov/businesses/small-businesses-self-employed/limited-liability-company-llc', title: 'IRS LLC classification overview', reviewedByAccountant: false, version: '1' },
    { id: RULES.estimated, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes', title: 'IRS estimated taxes', reviewedByAccountant: false, version: '1' },
    { id: RULES.records, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://www.irs.gov/businesses/small-businesses-self-employed/why-should-i-keep-records', title: 'IRS recordkeeping', reviewedByAccountant: false, version: '1' },
  ],
};

export class UnitedStatesJurisdictionProvider implements TaxJurisdictionProvider {
  readonly jurisdiction = 'US' as const;
  readonly catalogue = unitedStatesCatalogue;

  validateProfile(profile: TaxProfile): readonly string[] {
    if (profile.jurisdiction !== 'US') return ['PROFILE_JURISDICTION_MISMATCH'];
    const regime = this.catalogue.regimes.find(candidate => candidate.id === profile.regimeId);
    if (!regime) return ['UNSUPPORTED_REGIME'];
    const answerMap = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    const missing = regime.requiredQuestions.filter(question => !answerMap.has(question));
    if (profile.regimeId.startsWith('llc_')) {
      const memberCount = answerMap.get('member_count');
      if (typeof memberCount !== 'number' || memberCount < 1) missing.push('member_count');
    }
    const errors = [...new Set(missing)].map(question => `MISSING_${question.toUpperCase()}`);
    if (profile.regimeId === 's_corp' && answerMap.get('founder_residency') === 'foreign') {
      errors.push('S_CORP_FOREIGN_OWNER_NEEDS_PROFESSIONAL_REVIEW');
    }
    return errors;
  }

  buildObligations({ profile, period }: WorkflowBuildContext): readonly TaxObligation[] {
    const validation = this.validateProfile(profile);
    const needsReview = validation.length > 0;
    const shared = {
      jurisdiction: 'US' as const,
      regimeId: profile.regimeId,
      period,
      dueAt: null,
      dueTimeZone: null,
      applicability: needsReview ? ('needs_professional_review' as const) : ('applicable' as const),
      preparationState: needsReview ? ('unknown' as const) : ('not_started' as const),
      submissionState: 'not_submitted' as const,
      satisfactionState: 'outstanding' as const,
    };
    const obligations: TaxObligation[] = [
      {
        ...shared,
        id: 'us:federal-return',
        category: 'federal_income_return',
        title: 'Federal return preparation',
        description: 'Prepare a packet for an accountant or authorized e-file provider. BUFI does not file the return.',
        evidenceRequirementIds: ['us:req:income-ledger', 'us:req:expense-ledger', 'us:req:entity-profile'],
        ruleVersionIds: [RULES.entity, RULES.records],
        actionId: 'action:prepare-federal-packet',
      },
      {
        ...shared,
        id: 'us:state-review',
        category: 'state_income_franchise_return',
        title: 'State income and franchise review',
        description: 'Formation and operating states require accountant-confirmed applicability.',
        evidenceRequirementIds: ['us:req:formation-state', 'us:req:operating-states'],
        ruleVersionIds: [RULES.entity],
        actionId: 'action:review-state-obligations',
      },
      {
        ...shared,
        id: 'us:sales-tax',
        category: 'sales_tax_return',
        title: 'Sales-tax nexus review',
        description: 'Stripe Tax may supply calculation and registration signals, never federal filing authority.',
        evidenceRequirementIds: ['us:req:sales-states', 'us:req:sales-ledger'],
        ruleVersionIds: [RULES.records],
        actionId: 'action:review-sales-tax',
      },
    ];
    const hasPayroll = profile.answers.some(answer => answer.questionId === 'has_payroll' && answer.value === true);
    if (hasPayroll) {
      obligations.push({
        ...shared,
        id: 'us:payroll',
        category: 'payroll_information_return',
        title: 'Payroll and information-return review',
        description: 'Reconcile payroll obligations, approved batches, and settled cash evidence.',
        evidenceRequirementIds: ['us:req:payroll-ledger'],
        ruleVersionIds: [RULES.records],
        actionId: 'action:review-payroll-tax',
      });
    }
    return obligations;
  }
}
