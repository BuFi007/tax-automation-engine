import type { JurisdictionCatalogue, TaxJurisdictionProvider, WorkflowBuildContext } from './types';
import type { TaxObligation, TaxProfile } from '../types';
import { localEndOfDay, taxYear } from './calendar';

const RULES = {
  entity: 'us-entity-v1',
  estimated: 'us-estimated-tax-v1',
  records: 'us-recordkeeping-v1',
  filingCalendar: 'us-irs-pub-509-2026-v1',
  form1065: 'us-form-1065-2025-v1',
  form1120: 'us-form-1120-2025-v1',
  form1120s: 'us-form-1120s-2025-v1',
  form5472: 'us-form-5472-2025-v1',
} as const;

export const unitedStatesCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'US',
  version: 'us-catalogue-2026-07-15',
  displayName: 'United States',
  questions: [
    { id: 'founder_residency', label: 'Founder tax residency', kind: 'enum', required: true, options: [
      { value: 'local', label: 'U.S. person' },
      { value: 'foreign', label: 'Foreign-domiciled founder' },
    ] },
    { id: 'member_count', label: 'LLC member count', kind: 'integer', required: false },
    { id: 'tax_classification', label: 'Confirmed federal classification/election', kind: 'enum', required: true, options: [
      { value: 'disregarded_entity', label: 'Disregarded entity' },
      { value: 'partnership', label: 'Partnership' },
      { value: 's_corp', label: 'S corporation' },
      { value: 'c_corp', label: 'C corporation' },
      { value: 'needs_classification', label: 'Needs classification' },
    ] },
    { id: 'formation_state', label: 'Formation state', kind: 'subdivision', required: true },
    { id: 'operating_states', label: 'Operating states', kind: 'multi_select', required: true },
    { id: 'sales_states', label: 'States with sales', kind: 'multi_select', required: true },
    { id: 'has_payroll', label: 'Has payroll', kind: 'boolean', required: true },
  ],
  regimes: [
    { id: 'llc_single_member', entityTypes: ['llc'], label: 'Single-member LLC', description: 'Entity, owner-residency, federal classification, state, and sales-tax review.', requiredQuestions: ['founder_residency', 'member_count', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form5472, RULES.form1120, RULES.filingCalendar, RULES.records] },
    { id: 'llc_multi_member', entityTypes: ['llc'], label: 'Multi-member LLC', description: 'Partnership/default-election ambiguity is routed to professional review.', requiredQuestions: ['founder_residency', 'member_count', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form1065, RULES.filingCalendar, RULES.records] },
    { id: 's_corp', entityTypes: ['corporation'], label: 'S-Corporation', description: 'Federal, state, payroll, and information-return workflow.', requiredQuestions: ['founder_residency', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form1120s, RULES.filingCalendar] },
    { id: 'c_corp', entityTypes: ['corporation'], label: 'C-Corporation', description: 'Federal corporate, state franchise/income, sales-tax, and payroll workflow.', requiredQuestions: ['founder_residency', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form1120, RULES.estimated, RULES.filingCalendar, RULES.records] },
  ],
  rules: [
    { id: RULES.entity, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://www.irs.gov/businesses/small-businesses-self-employed/limited-liability-company-llc', title: 'IRS LLC classification overview', reviewedByAccountant: false, version: '1' },
    { id: RULES.estimated, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes', title: 'IRS estimated taxes', reviewedByAccountant: false, version: '1' },
    { id: RULES.records, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://www.irs.gov/businesses/small-businesses-self-employed/why-should-i-keep-records', title: 'IRS recordkeeping', reviewedByAccountant: false, version: '1' },
    { id: RULES.filingCalendar, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', sourceUrl: 'https://www.irs.gov/publications/p509', title: 'IRS Publication 509 · Tax Calendars 2026', reviewedByAccountant: false, version: '2026.1' },
    { id: RULES.form1065, jurisdiction: 'US', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', sourceUrl: 'https://www.irs.gov/instructions/i1065', title: 'IRS Form 1065 instructions · 2025', reviewedByAccountant: false, version: '2025.1' },
    { id: RULES.form1120, jurisdiction: 'US', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', sourceUrl: 'https://www.irs.gov/instructions/i1120', title: 'IRS Form 1120 instructions · 2025', reviewedByAccountant: false, version: '2025.1' },
    { id: RULES.form1120s, jurisdiction: 'US', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', sourceUrl: 'https://www.irs.gov/instructions/i1120s', title: 'IRS Form 1120-S instructions · 2025', reviewedByAccountant: false, version: '2025.1' },
    { id: RULES.form5472, jurisdiction: 'US', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', sourceUrl: 'https://www.irs.gov/instructions/i5472', title: 'IRS Form 5472 instructions · 2025', reviewedByAccountant: false, version: '2025.1' },
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
    if (answerMap.get('tax_classification') === 'needs_classification') errors.push('FEDERAL_CLASSIFICATION_NEEDS_PROFESSIONAL_REVIEW');
    return errors;
  }

  buildObligations({ profile, period }: WorkflowBuildContext): readonly TaxObligation[] {
    const validation = this.validateProfile(profile);
    const needsReview = validation.length > 0;
    const answerMap = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    const year = taxYear(period);
    const founderIsForeign = answerMap.get('founder_residency') === 'foreign';
    const shared = {
      jurisdiction: 'US' as const,
      regimeId: profile.regimeId,
      period,
      dueAt: null,
      dueTimeZone: 'America/New_York',
      applicability: needsReview ? ('needs_professional_review' as const) : ('applicable' as const),
      preparationState: needsReview ? ('unknown' as const) : ('not_started' as const),
      submissionState: 'not_submitted' as const,
      satisfactionState: 'outstanding' as const,
    };
    const obligations: TaxObligation[] = [
      federalObligation(profile.regimeId, founderIsForeign, year, shared),
      {
        ...shared,
        id: 'us:state-review',
        category: 'state_income_franchise_return',
        title: 'State income and franchise review',
        description: 'Formation and operating states require accountant-confirmed applicability.',
        evidenceRequirementIds: ['us:req:formation-state', 'us:req:operating-states'],
        ruleVersionIds: [RULES.entity],
        actionId: 'action:review-state-obligations',
        applicability: 'needs_professional_review',
        preparationState: 'unknown',
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
        applicability: 'needs_professional_review',
        preparationState: 'unknown',
      },
    ];
    if (profile.regimeId === 'c_corp' && year === 2026) {
      for (const [quarter, date] of C_CORP_ESTIMATED_2026) {
        obligations.push({
          ...shared,
          id: `us:c-corp-estimated:${quarter}`,
          category: 'estimated_tax',
          title: `C corporation estimated tax · installment ${quarter}`,
          description: 'Prepare the federal estimated-payment calculation; amount and filing requirement require confirmed taxable-income projections.',
          dueAt: localEndOfDay(date, '-04:00'),
          evidenceRequirementIds: ['us:req:income-ledger', 'us:req:taxable-income-forecast'],
          ruleVersionIds: [RULES.estimated, RULES.filingCalendar],
          actionId: 'action:prepare-c-corp-estimate',
          applicability: needsReview ? 'needs_professional_review' : 'applicable',
        });
      }
    }
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
        applicability: 'needs_professional_review',
        preparationState: 'unknown',
      });
    }
    return obligations;
  }
}

type SharedObligation = Omit<TaxObligation, 'id' | 'category' | 'title' | 'description' | 'evidenceRequirementIds' | 'ruleVersionIds' | 'actionId'>;

function federalObligation(regimeId: string, founderIsForeign: boolean, year: number, shared: SharedObligation): TaxObligation {
  const base = {
    ...shared,
    category: 'federal_income_return' as const,
    evidenceRequirementIds: ['us:req:income-ledger', 'us:req:expense-ledger', 'us:req:entity-profile'],
    actionId: 'action:prepare-federal-packet',
  };
  if (regimeId === 'llc_single_member' && founderIsForeign) {
    return {
      ...base,
      id: 'us:form-5472-pro-forma-1120',
      title: 'Foreign-owned disregarded entity · Form 5472 + pro forma Form 1120',
      description: 'Prepare reportable-transaction evidence and route the special non-e-file submission to a qualified professional.',
      dueAt: year === 2025 ? localEndOfDay('2026-04-15', '-04:00') : null,
      ruleVersionIds: [RULES.form5472, RULES.form1120, RULES.filingCalendar],
      applicability: 'needs_professional_review',
      preparationState: 'unknown',
    };
  }
  if (regimeId === 'llc_multi_member') {
    return {
      ...base,
      id: 'us:form-1065',
      title: 'Partnership return · Form 1065 and partner schedules',
      description: 'Prepare Form 1065, K-1/K-3 inputs, and partner allocation evidence for an authorized filing path.',
      dueAt: year === 2025 ? localEndOfDay('2026-03-16', '-04:00') : null,
      ruleVersionIds: [RULES.form1065, RULES.filingCalendar],
    };
  }
  if (regimeId === 's_corp') {
    return {
      ...base,
      id: 'us:form-1120-s',
      title: 'S corporation return · Form 1120-S',
      description: founderIsForeign
        ? 'Foreign ownership conflicts with the ordinary S corporation eligibility path; stop for professional review.'
        : 'Prepare Form 1120-S and shareholder schedule evidence for an authorized filing path.',
      dueAt: year === 2025 ? localEndOfDay('2026-03-16', '-04:00') : null,
      ruleVersionIds: [RULES.form1120s, RULES.filingCalendar],
      applicability: founderIsForeign ? 'needs_professional_review' : shared.applicability,
      preparationState: founderIsForeign ? 'unknown' : shared.preparationState,
    };
  }
  if (regimeId === 'c_corp') {
    return {
      ...base,
      id: 'us:form-1120',
      title: 'Corporate income tax return · Form 1120',
      description: 'Prepare the federal corporate return packet for an authorized e-file provider or accountant.',
      dueAt: year === 2025 ? localEndOfDay('2026-04-15', '-04:00') : null,
      ruleVersionIds: [RULES.form1120, RULES.filingCalendar],
    };
  }
  return {
    ...base,
    id: 'us:owner-income-return-review',
    title: 'Owner federal income-return review',
    description: 'A domestic disregarded entity generally flows to its owner; confirm the owner return and schedule with a professional.',
    dueAt: year === 2025 ? localEndOfDay('2026-04-15', '-04:00') : null,
    ruleVersionIds: [RULES.entity, RULES.filingCalendar],
    applicability: 'needs_professional_review',
    preparationState: 'unknown',
  };
}

const C_CORP_ESTIMATED_2026 = [
  ['1', '2026-04-15'],
  ['2', '2026-06-15'],
  ['3', '2026-09-15'],
  ['4', '2026-12-15'],
] as const;
