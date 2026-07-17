import type { TaxObligation, TaxProfile } from '../types';
import type { JurisdictionCatalogue, TaxJurisdictionProvider, WorkflowBuildContext } from './types';

const RULES = {
  registration: 'ae-fta-corporate-tax-registration-2026-v1',
  freeZone: 'ae-fta-free-zone-persons-2024-v1',
  vatRegistration: 'ae-fta-vat-registration-2026-v1',
  returns: 'ae-fta-corporate-tax-returns-2024-v1',
} as const;

const REVIEW = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'needs_review', label: 'Needs professional review' },
] as const;

export const unitedArabEmiratesCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'AE',
  version: 'ae-catalogue-2026-07-17',
  displayName: 'United Arab Emirates',
  questions: [
    { id: 'formation_emirate', label: 'Formation emirate', kind: 'subdivision', required: true },
    { id: 'licensing_authority', label: 'Licensing or Free Zone authority', kind: 'enum', required: true, options: [
      { value: 'dubai_free_zone_authority', label: 'Dubai Free Zone authority' },
      { value: 'other_uae_free_zone_authority', label: 'Other UAE Free Zone authority' },
      { value: 'mainland_authority', label: 'Mainland licensing authority' },
      { value: 'needs_review', label: 'Needs professional review' },
    ] },
    { id: 'tax_period_end_month', label: 'Confirmed tax-period end month', kind: 'integer', required: true },
    { id: 'corporate_tax_registration', label: 'Corporate Tax registration status', kind: 'enum', required: true, options: [
      { value: 'not_registered', label: 'Not registered' },
      { value: 'submitted', label: 'Submitted / in authority review' },
      { value: 'certificate_available', label: 'Certificate available · verification pending' },
      { value: 'needs_review', label: 'Needs review' },
    ] },
    { id: 'vat_threshold_state', label: 'VAT registration threshold assessment', kind: 'enum', required: true, options: [
      { value: 'mandatory', label: 'Mandatory threshold met' },
      { value: 'voluntary', label: 'Voluntary threshold met' },
      { value: 'below', label: 'Below voluntary threshold' },
      { value: 'nonresident_taxable_supplies', label: 'Non-resident making taxable supplies' },
      { value: 'needs_review', label: 'Needs professional review' },
    ] },
    { id: 'vat_registration', label: 'VAT registration status', kind: 'enum', required: true, options: [
      { value: 'not_registered', label: 'Not registered' },
      { value: 'submitted', label: 'Submitted / in authority review' },
      { value: 'certificate_available', label: 'Certificate available · verification pending' },
      { value: 'exemption_identifier_available', label: 'Exemption identifier available · verification pending' },
      { value: 'needs_review', label: 'Needs review' },
    ] },
    { id: 'adequate_substance', label: 'Adequate substance confirmed', kind: 'enum', required: false, options: REVIEW },
    { id: 'qualifying_income', label: 'Qualifying income conditions confirmed', kind: 'enum', required: false, options: REVIEW },
    { id: 'excluded_activities', label: 'Excluded activities present', kind: 'enum', required: false, options: REVIEW },
    { id: 'de_minimis_condition', label: 'De minimis condition confirmed', kind: 'enum', required: false, options: REVIEW },
    { id: 'audited_financial_statements', label: 'Audited financial statements available', kind: 'enum', required: false, options: REVIEW },
  ],
  regimes: [
    {
      id: 'uae_mainland_company', entityTypes: ['llc', 'company', 'branch'], label: 'UAE mainland company',
      description: 'Corporate Tax, VAT threshold, filing, and evidence workflow through EmaraTax.',
      requiredQuestions: ['formation_emirate', 'licensing_authority', 'tax_period_end_month', 'corporate_tax_registration', 'vat_threshold_state', 'vat_registration'],
      ruleVersionIds: [RULES.registration, RULES.vatRegistration, RULES.returns],
    },
    {
      id: 'uae_free_zone_person', entityTypes: ['fz_llc', 'fzco', 'branch'], label: 'UAE Free Zone person',
      description: 'Free Zone status does not itself establish the 0% Corporate Tax treatment.',
      requiredQuestions: ['formation_emirate', 'licensing_authority', 'tax_period_end_month', 'corporate_tax_registration', 'vat_threshold_state', 'vat_registration', 'adequate_substance', 'qualifying_income', 'excluded_activities', 'de_minimis_condition', 'audited_financial_statements'],
      ruleVersionIds: [RULES.registration, RULES.freeZone, RULES.vatRegistration, RULES.returns],
    },
  ],
  rules: [
    { id: RULES.registration, jurisdiction: 'AE', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://tax.gov.ae/en/services/corporate.tax.registration.aspx', title: 'FTA Corporate Tax registration', reviewedByAccountant: false, version: '2026.1' },
    { id: RULES.freeZone, jurisdiction: 'AE', effectiveFrom: '2024-01-01', effectiveTo: null, sourceUrl: 'https://tax.gov.ae/en/media.centre/news/federal.tax.authority.issues.corporate.tax.guide.on.free.zone.persons.aspx', title: 'FTA Corporate Tax guide for Free Zone persons', reviewedByAccountant: false, version: '2024.1' },
    { id: RULES.vatRegistration, jurisdiction: 'AE', effectiveFrom: '2026-01-01', effectiveTo: null, sourceUrl: 'https://tax.gov.ae/ar/services/vat.registration.aspx', title: 'FTA VAT registration', reviewedByAccountant: false, version: '2026.1' },
    { id: RULES.returns, jurisdiction: 'AE', effectiveFrom: '2024-01-01', effectiveTo: null, sourceUrl: 'https://www.tax.gov.ae/Datafolder/Files/Guides/CT/CT-Returns-EN-11-11-2024.pdf', title: 'FTA Corporate Tax returns guide', reviewedByAccountant: false, version: '2024.1' },
  ],
};

export class UnitedArabEmiratesJurisdictionProvider implements TaxJurisdictionProvider {
  readonly jurisdiction = 'AE' as const;
  readonly catalogue = unitedArabEmiratesCatalogue;

  validateProfile(profile: TaxProfile): readonly string[] {
    if (profile.jurisdiction !== 'AE') return ['PROFILE_JURISDICTION_MISMATCH'];
    const regime = this.catalogue.regimes.find(candidate => candidate.id === profile.regimeId);
    if (!regime) return ['UNSUPPORTED_REGIME'];
    const answers = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    if (answers.size !== profile.answers.length) return ['DUPLICATE_PROFILE_ANSWER'];
    const errors = regime.requiredQuestions.filter(id => !answers.has(id)).map(id => `MISSING_${id.toUpperCase()}`);
    if (!regime.entityTypes.includes(profile.entityType)) errors.push('ENTITY_TYPE_REGIME_MISMATCH');
    if (answers.get('formation_emirate') !== profile.formationSubdivision) errors.push('PROFILE_FORMATION_EMIRATE_MISMATCH');
    const endMonth = answers.get('tax_period_end_month');
    if (typeof endMonth !== 'number' || !Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) errors.push('INVALID_TAX_PERIOD_END_MONTH');
    if (!['dubai_free_zone_authority', 'other_uae_free_zone_authority', 'mainland_authority', 'needs_review'].includes(String(answers.get('licensing_authority')))) errors.push('INVALID_LICENSING_AUTHORITY');
    if (!['not_registered', 'submitted', 'certificate_available', 'needs_review'].includes(String(answers.get('corporate_tax_registration')))) errors.push('INVALID_CORPORATE_TAX_REGISTRATION_STATUS');
    if (!['mandatory', 'voluntary', 'below', 'nonresident_taxable_supplies', 'needs_review'].includes(String(answers.get('vat_threshold_state')))) errors.push('INVALID_VAT_THRESHOLD_STATE');
    if (!['not_registered', 'submitted', 'certificate_available', 'exemption_identifier_available', 'needs_review'].includes(String(answers.get('vat_registration')))) errors.push('INVALID_VAT_REGISTRATION_STATUS');
    if (answers.get('vat_threshold_state') === 'below' && !['not_registered', 'needs_review'].includes(String(answers.get('vat_registration')))) errors.push('VAT_THRESHOLD_REGISTRATION_CONTRADICTION');
    if (profile.regimeId === 'uae_free_zone_person') {
      for (const id of ['adequate_substance', 'qualifying_income', 'excluded_activities', 'de_minimis_condition', 'audited_financial_statements']) {
        if (answers.get(id) === 'needs_review') errors.push(`FREE_ZONE_${id.toUpperCase()}_NEEDS_PROFESSIONAL_REVIEW`);
      }
    }
    return [...new Set(errors)];
  }

  buildObligations({ profile, period }: WorkflowBuildContext): readonly TaxObligation[] {
    const answers = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    const invalid = this.validateProfile(profile).length > 0;
    const shared = base(profile, period, invalid);
    const ctStatus = answers.get('corporate_tax_registration');
    const vatStatus = answers.get('vat_registration');
    const vatThreshold = answers.get('vat_threshold_state');
    const obligations: TaxObligation[] = [
      {
        ...shared, id: 'ae:corporate-tax-registration', category: 'registration', title: 'Corporate Tax registration',
        description: 'Prepare the entity and ownership packet for the user-controlled EmaraTax submission. A submitted application remains in authority review until an FTA certificate or decision is verified.',
        evidenceRequirementIds: ['ae:req:trade-license', 'ae:req:incorporation-documents', 'ae:req:owner-and-signatory-documents'],
        ruleVersionIds: [RULES.registration], actionId: ctStatus === 'certificate_available' ? 'action:verify-ae-corporate-tax-certificate' : 'action:prepare-ae-corporate-tax-registration',
        preparationState: ctStatus === 'certificate_available' ? 'ready_for_review' : shared.preparationState,
        submissionState: authorityState(ctStatus), satisfactionState: 'outstanding',
      },
      {
        ...shared, id: 'ae:corporate-tax-return', category: 'corporate_tax_return', title: 'UAE Corporate Tax return',
        description: 'Reconcile financial statements and deterministic taxable-income inputs; exemptions, deductions, Free Zone treatment, filing, and final liability require professional and authority confirmation.',
        evidenceRequirementIds: ['ae:req:financial-statements', 'ae:req:ledger', 'ae:req:tax-adjustments'],
        ruleVersionIds: [RULES.returns, ...(profile.regimeId === 'uae_free_zone_person' ? [RULES.freeZone] : [])], actionId: 'action:prepare-ae-corporate-tax-return',
        applicability: 'needs_professional_review',
      },
      {
        ...shared, id: 'ae:vat-registration', category: 'registration', title: 'VAT registration assessment and application',
        description: 'Use ledger evidence to establish the threshold state, then prepare the user-controlled EmaraTax application. BUFI never stores EmaraTax passwords or UAE PASS sessions.',
        evidenceRequirementIds: ['ae:req:taxable-supplies-ledger', 'ae:req:vat-registration-documents'], ruleVersionIds: [RULES.vatRegistration],
        actionId: vatStatus === 'certificate_available' || vatStatus === 'exemption_identifier_available'
          ? 'action:verify-ae-vat-registration-evidence'
          : vatThreshold === 'below' ? null : 'action:prepare-ae-vat-registration',
        applicability: vatThreshold === 'below' ? 'not_applicable' : vatThreshold === 'needs_review' ? 'needs_professional_review' : 'applicable',
        submissionState: authorityState(vatStatus), satisfactionState: vatThreshold === 'below' ? 'not_due' : 'outstanding',
      },
      {
        ...shared, id: 'ae:vat-return', category: 'vat_return', title: 'UAE VAT return',
        description: 'Reconcile output and input VAT for the authority-assigned tax period. No cadence or due date is inferred without the verified FTA registration profile.',
        evidenceRequirementIds: ['ae:req:sales-tax-ledger', 'ae:req:purchase-tax-ledger', 'ae:req:vat-period'], ruleVersionIds: [RULES.vatRegistration], actionId: 'action:prepare-ae-vat-return',
        applicability: vatStatus === 'certificate_available' ? 'needs_professional_review' : vatStatus === 'needs_review' || vatStatus === 'submitted' ? 'needs_professional_review' : 'not_applicable',
      },
    ];
    if (profile.regimeId === 'uae_free_zone_person') obligations.push({
      ...shared, id: 'ae:free-zone-qualifying-status-review', category: 'other', title: 'Qualifying Free Zone Person review',
      description: 'Free Zone incorporation is not a blanket 0% outcome. Confirm adequate substance, qualifying income, excluded activities, de minimis, audited statements, permanent establishments, and any election before tax treatment is used.',
      evidenceRequirementIds: ['ae:req:free-zone-license', 'ae:req:qualifying-income-analysis', 'ae:req:audited-financial-statements'],
      ruleVersionIds: [RULES.freeZone], actionId: 'action:review-ae-free-zone-status', applicability: 'needs_professional_review', preparationState: 'unknown',
    });
    return obligations;
  }
}

function base(profile: TaxProfile, period: WorkflowBuildContext['period'], invalid: boolean) {
  return {
    jurisdiction: 'AE' as const, regimeId: profile.regimeId, period, dueAt: null, dueTimeZone: 'Asia/Dubai',
    applicability: invalid ? ('needs_professional_review' as const) : ('applicable' as const),
    preparationState: invalid ? ('unknown' as const) : ('not_started' as const), submissionState: 'not_submitted' as const,
    satisfactionState: 'outstanding' as const,
  };
}

function authorityState(value: unknown): TaxObligation['submissionState'] {
  if (value === 'submitted') return 'authority_receipt_pending';
  if (value === 'certificate_available' || value === 'exemption_identifier_available') return 'authority_receipt_pending';
  if (value === 'needs_review') return 'unknown';
  return 'not_submitted';
}
