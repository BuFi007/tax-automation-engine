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
  delawareLlcAnnualTax: 'us-de-llc-annual-tax-2026-v1',
  delawareCorporationFranchise: 'us-de-corporation-franchise-2026-v1',
  delawareIncomeTax: 'us-de-income-tax-2025-v1',
} as const;

export const unitedStatesCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'US',
  version: 'us-catalogue-2026-07-16',
  displayName: 'United States',
  questions: [
    { id: 'founder_residency', label: 'Founder domicile context (not U.S.-person status)', kind: 'enum', required: true, options: [
      { value: 'local', label: 'U.S.-domiciled founder' },
      { value: 'foreign', label: 'Foreign-domiciled founder' },
    ] },
    { id: 'owner_us_person_status', label: 'Confirmed owner U.S.-person status', kind: 'enum', required: true, options: [
      { value: 'us_person', label: 'U.S. person' },
      { value: 'non_us_person', label: 'Non-U.S. person' },
      { value: 'needs_classification', label: 'Needs professional classification' },
    ] },
    { id: 'foreign_ownership_25_percent', label: 'At least 25% foreign ownership by vote or value', kind: 'enum', required: false, options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'needs_review', label: 'Needs professional review' },
    ] },
    { id: 'related_party_reportable_transactions', label: 'Reportable related-party transactions occurred', kind: 'enum', required: false, options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'needs_review', label: 'Needs professional review' },
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
    { id: 'llc_single_member', entityTypes: ['llc'], label: 'Single-member LLC', description: 'Entity, owner-status, federal classification, state, and sales-tax review.', requiredQuestions: ['founder_residency', 'owner_us_person_status', 'member_count', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form5472, RULES.form1120, RULES.filingCalendar, RULES.records] },
    { id: 'llc_multi_member', entityTypes: ['llc'], label: 'Multi-member LLC', description: 'Partnership/default-election ambiguity is routed to professional review.', requiredQuestions: ['founder_residency', 'owner_us_person_status', 'member_count', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form1065, RULES.filingCalendar, RULES.records] },
    { id: 's_corp', entityTypes: ['corporation'], label: 'S-Corporation', description: 'Federal, state, payroll, shareholder-eligibility, and information-return workflow.', requiredQuestions: ['founder_residency', 'owner_us_person_status', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form1120s, RULES.filingCalendar] },
    { id: 'c_corp', entityTypes: ['corporation'], label: 'C-Corporation', description: 'Federal corporate, foreign-ownership information reporting, state franchise/income, sales-tax, and payroll workflow.', requiredQuestions: ['founder_residency', 'owner_us_person_status', 'tax_classification', 'formation_state', 'operating_states', 'sales_states', 'has_payroll'], ruleVersionIds: [RULES.entity, RULES.form5472, RULES.form1120, RULES.estimated, RULES.filingCalendar, RULES.records] },
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
    { id: RULES.delawareLlcAnnualTax, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', sourceUrl: 'https://corp.delaware.gov/alt-entitytaxinstructions/', title: 'Delaware alternative entity annual tax instructions · 2026', reviewedByAccountant: false, version: '2026.1' },
    { id: RULES.delawareCorporationFranchise, jurisdiction: 'US', effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31', sourceUrl: 'https://corp.delaware.gov/paytaxes/', title: 'Delaware corporation annual report and franchise tax · 2026', reviewedByAccountant: false, version: '2026.1' },
    { id: RULES.delawareIncomeTax, jurisdiction: 'US', effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', sourceUrl: 'https://revenue.delaware.gov/frequently-asked-questions/corporate-income-tax-faqs/', title: 'Delaware corporate income tax FAQ · tax year 2025', reviewedByAccountant: false, version: '2025.1' },
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
    const classification = answerMap.get('tax_classification');
    const memberCount = answerMap.get('member_count');
    const ownerUsPersonStatus = answerMap.get('owner_us_person_status');
    const foreignOwnership = answerMap.get('foreign_ownership_25_percent');
    const reportableTransactions = answerMap.get('related_party_reportable_transactions');
    if (profile.regimeId === 'llc_single_member' && typeof memberCount === 'number' && memberCount !== 1) errors.push('LLC_MEMBER_COUNT_REGIME_MISMATCH');
    if (profile.regimeId === 'llc_multi_member' && typeof memberCount === 'number' && memberCount < 2) errors.push('LLC_MEMBER_COUNT_REGIME_MISMATCH');
    if (!classificationMatchesRegime(profile.regimeId, classification)) errors.push('REGIME_CLASSIFICATION_MISMATCH');
    if (ownerUsPersonStatus === 'needs_classification') errors.push('OWNER_US_PERSON_STATUS_NEEDS_PROFESSIONAL_REVIEW');
    if (ownerUsPersonStatus !== undefined && !isOwnerUsPersonStatus(ownerUsPersonStatus)) errors.push('INVALID_OWNER_US_PERSON_STATUS');
    if (classification === 's_corp' && ownerUsPersonStatus === 'non_us_person') {
      errors.push('S_CORP_NON_US_OWNER_NEEDS_PROFESSIONAL_REVIEW');
    }
    if (classification === 'needs_classification') errors.push('FEDERAL_CLASSIFICATION_NEEDS_PROFESSIONAL_REVIEW');
    if (profile.ownerDomicileCountries.length === 0) errors.push('MISSING_OWNER_DOMICILE_COUNTRY');
    if (profile.ownerTaxResidenceCountries.length === 0) errors.push('MISSING_OWNER_TAX_RESIDENCE_COUNTRY');
    if (answerMap.get('formation_state') !== profile.formationSubdivision) errors.push('PROFILE_FORMATION_STATE_MISMATCH');
    if (!sameStringSet(answerMap.get('operating_states'), profile.operatingSubdivisions)) errors.push('PROFILE_OPERATING_STATES_MISMATCH');
    if (classification === 'c_corp') {
      if (!isReviewAnswer(foreignOwnership)) errors.push('MISSING_FOREIGN_OWNERSHIP_25_PERCENT');
      if (foreignOwnership === 'needs_review') errors.push('FOREIGN_OWNERSHIP_NEEDS_PROFESSIONAL_REVIEW');
      if (foreignOwnership === 'yes') {
        if (!isReviewAnswer(reportableTransactions)) errors.push('MISSING_RELATED_PARTY_REPORTABLE_TRANSACTIONS');
        if (reportableTransactions === 'needs_review') errors.push('RELATED_PARTY_TRANSACTIONS_NEED_PROFESSIONAL_REVIEW');
      }
    }
    if (profile.regimeId === 'llc_single_member' && classification === 'disregarded_entity' && ownerUsPersonStatus === 'non_us_person') {
      if (!isReviewAnswer(reportableTransactions)) errors.push('MISSING_RELATED_PARTY_REPORTABLE_TRANSACTIONS');
      if (reportableTransactions === 'needs_review') errors.push('RELATED_PARTY_TRANSACTIONS_NEED_PROFESSIONAL_REVIEW');
    }
    return errors;
  }

  buildObligations({ profile, period }: WorkflowBuildContext): readonly TaxObligation[] {
    const validation = this.validateProfile(profile);
    const needsReview = validation.length > 0;
    const answerMap = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    const year = taxYear(period);
    const ownerUsPersonStatus = answerMap.get('owner_us_person_status');
    const ownerIsNonUsPerson = ownerUsPersonStatus === 'non_us_person';
    const classification = answerMap.get('tax_classification');
    const foreignOwnership = answerMap.get('foreign_ownership_25_percent');
    const reportableTransactions = answerMap.get('related_party_reportable_transactions');
    const formationState = answerMap.get('formation_state');
    const operatingStates = answerMap.get('operating_states');
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
      federalObligation(profile.regimeId, classification, ownerIsNonUsPerson, reportableTransactions, year, shared),
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
    if (formationState === 'US-DE' && profile.regimeId.startsWith('llc_')) {
      obligations.push({
        ...shared,
        id: 'us:de:llc-annual-tax',
        category: 'state_income_franchise_return',
        title: 'Delaware LLC annual tax',
        description: 'Delaware LLCs owe a $300 annual tax and do not file an annual report. Payment amount remains outside this obligation projection.',
        dueAt: year === 2025 ? localEndOfDay('2026-06-01', '-04:00') : null,
        evidenceRequirementIds: ['us:req:formation-state', 'us:req:delaware-payment'],
        ruleVersionIds: [RULES.delawareLlcAnnualTax],
        actionId: 'action:prepare-delaware-llc-annual-tax',
      });
    }
    if (formationState === 'US-DE' && !profile.regimeId.startsWith('llc_')) {
      obligations.push({
        ...shared,
        id: 'us:de:corporation-franchise',
        category: 'state_income_franchise_return',
        title: 'Delaware corporation annual report and franchise tax',
        description: 'Prepare the annual report and calculate franchise tax using the corporation\'s confirmed stock and asset facts.',
        dueAt: year === 2025 ? localEndOfDay('2026-03-01', '-05:00') : null,
        evidenceRequirementIds: ['us:req:formation-state', 'us:req:capitalization', 'us:req:delaware-payment'],
        ruleVersionIds: [RULES.delawareCorporationFranchise],
        actionId: 'action:prepare-delaware-corporation-franchise',
        applicability: 'needs_professional_review',
        preparationState: 'unknown',
      });
    }
    if (Array.isArray(operatingStates) && operatingStates.includes('US-DE') && !profile.regimeId.startsWith('llc_')) {
      obligations.push({
        ...shared,
        id: 'us:de:income-return',
        category: 'state_income_franchise_return',
        title: 'Delaware corporate income tax return',
        description: 'A corporation doing business in Delaware must confirm taxable income and prepare the state return with a qualified professional.',
        dueAt: year === 2025 ? localEndOfDay(classification === 's_corp' ? '2026-03-16' : '2026-04-15', '-04:00') : null,
        evidenceRequirementIds: ['us:req:operating-states', 'us:req:income-ledger', 'us:req:expense-ledger'],
        ruleVersionIds: [RULES.delawareIncomeTax],
        actionId: 'action:prepare-delaware-income-return',
        applicability: 'needs_professional_review',
        preparationState: 'unknown',
      });
    }
    if (classification === 'c_corp' && year === 2026) {
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
    if (classification === 'c_corp' && foreignOwnership !== 'no') {
      obligations.push({
        ...shared,
        id: 'us:form-5472-corporation-review',
        category: 'federal_income_return',
        title: '25% foreign-owned corporation · Form 5472 review',
        description: foreignOwnership === 'yes' && reportableTransactions === 'yes'
          ? 'Prepare each required Form 5472 with the corporation return; ownership attribution, related parties, transaction classification, and filing remain under professional review.'
          : 'Confirm whether the corporation was at least 25% foreign owned and had a reportable related-party transaction before creating a Form 5472 filing packet.',
        dueAt: foreignOwnership === 'yes' && reportableTransactions === 'yes' && year === 2025
          ? localEndOfDay('2026-04-15', '-04:00')
          : null,
        evidenceRequirementIds: ['us:req:foreign-ownership', 'us:req:related-party-transactions', 'us:req:entity-profile'],
        ruleVersionIds: [RULES.form5472, RULES.form1120, RULES.filingCalendar],
        actionId: 'action:review-form-5472',
        applicability: 'needs_professional_review',
        preparationState: 'unknown',
      });
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

function federalObligation(
  regimeId: string,
  classification: unknown,
  ownerIsNonUsPerson: boolean,
  reportableTransactions: unknown,
  year: number,
  shared: SharedObligation
): TaxObligation {
  const base = {
    ...shared,
    category: 'federal_income_return' as const,
    evidenceRequirementIds: ['us:req:income-ledger', 'us:req:expense-ledger', 'us:req:entity-profile'],
    actionId: 'action:prepare-federal-packet',
  };
  if (
    regimeId === 'llc_single_member'
    && classification === 'disregarded_entity'
    && ownerIsNonUsPerson
    && reportableTransactions !== 'no'
  ) {
    return {
      ...base,
      id: 'us:form-5472-pro-forma-1120',
      title: 'Foreign-owned disregarded entity · Form 5472 + pro forma Form 1120',
      description: reportableTransactions === 'yes'
        ? 'Prepare reportable-transaction evidence and route the special non-e-file submission to a qualified professional.'
        : 'Confirm reportable related-party transactions before preparing the special pro forma Form 1120 and Form 5472 submission.',
      dueAt: reportableTransactions === 'yes' && year === 2025 ? localEndOfDay('2026-04-15', '-04:00') : null,
      ruleVersionIds: [RULES.form5472, RULES.form1120, RULES.filingCalendar],
      applicability: 'needs_professional_review',
      preparationState: 'unknown',
    };
  }
  if (classification === 'partnership') {
    return {
      ...base,
      id: 'us:form-1065',
      title: 'Partnership return · Form 1065 and partner schedules',
      description: 'Prepare Form 1065, K-1/K-3 inputs, and partner allocation evidence for an authorized filing path.',
      dueAt: year === 2025 ? localEndOfDay('2026-03-16', '-04:00') : null,
      ruleVersionIds: [RULES.form1065, RULES.filingCalendar],
    };
  }
  if (classification === 's_corp') {
    return {
      ...base,
      id: 'us:form-1120-s',
      title: 'S corporation return · Form 1120-S',
      description: ownerIsNonUsPerson
        ? 'A non-U.S. owner does not establish ordinary S corporation shareholder eligibility; stop for professional review.'
        : 'Prepare Form 1120-S and shareholder schedule evidence for an authorized filing path.',
      dueAt: year === 2025 ? localEndOfDay('2026-03-16', '-04:00') : null,
      ruleVersionIds: [RULES.form1120s, RULES.filingCalendar],
      applicability: ownerIsNonUsPerson ? 'needs_professional_review' : shared.applicability,
      preparationState: ownerIsNonUsPerson ? 'unknown' : shared.preparationState,
    };
  }
  if (classification === 'c_corp') {
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

function classificationMatchesRegime(regimeId: string, classification: unknown): boolean {
  if (classification === 'needs_classification') return true;
  if (regimeId === 'llc_single_member') return classification === 'disregarded_entity' || classification === 's_corp' || classification === 'c_corp';
  if (regimeId === 'llc_multi_member') return classification === 'partnership' || classification === 's_corp' || classification === 'c_corp';
  if (regimeId === 's_corp') return classification === 's_corp';
  if (regimeId === 'c_corp') return classification === 'c_corp';
  return false;
}

function isOwnerUsPersonStatus(value: unknown): value is 'us_person' | 'non_us_person' | 'needs_classification' {
  return value === 'us_person' || value === 'non_us_person' || value === 'needs_classification';
}

function isReviewAnswer(value: unknown): value is 'yes' | 'no' | 'needs_review' {
  return value === 'yes' || value === 'no' || value === 'needs_review';
}

function sameStringSet(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.every(item => typeof item === 'string')
    && [...new Set(value)].sort().join('\u0000') === [...new Set(expected)].sort().join('\u0000');
}

const C_CORP_ESTIMATED_2026 = [
  ['1', '2026-04-15'],
  ['2', '2026-06-15'],
  ['3', '2026-09-15'],
  ['4', '2026-12-15'],
] as const;
