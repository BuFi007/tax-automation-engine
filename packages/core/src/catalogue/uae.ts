import type {
  JurisdictionCatalogue,
  TaxJurisdictionProvider,
  WorkflowBuildContext,
} from './types';
import type { TaxObligation, TaxProfile } from '../types';

const RULES = {
  corporateTax: 'ae-corporate-tax-registration-2026-v1',
  vatRegistration: 'ae-vat-registration-thresholds-2026-v1',
  freeZone: 'ae-qualifying-free-zone-person-review-2026-v1',
  einvoicing: 'ae-einvoicing-provider-onboarding-2026-v1',
} as const;

const ENTITY_STRUCTURES = [
  'free_zone_company',
  'free_zone_establishment',
  'mainland_company',
] as const;

const VAT_THRESHOLD_STATES = [
  'below_voluntary',
  'voluntary',
  'mandatory',
  'unconfirmed',
] as const;

const REGISTRATION_STATES = ['registered', 'not_registered', 'unconfirmed'] as const;

const EINVOICING_STATES = [
  'not_selected',
  'asp_selected',
  'agreement_active',
  'provider_onboarding',
  'reporting_validated',
] as const;

export const uaeCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'AE',
  version: 'ae-catalogue-2026-07-27',
  displayName: 'United Arab Emirates',
  questions: [
    {
      id: 'formation_emirate',
      label: 'Formation emirate',
      kind: 'subdivision',
      required: true,
    },
    {
      id: 'entity_structure',
      label: 'Entity structure',
      kind: 'enum',
      required: true,
      options: [
        { value: 'free_zone_company', label: 'Free Zone company' },
        { value: 'free_zone_establishment', label: 'Free Zone establishment' },
        { value: 'mainland_company', label: 'Mainland company' },
      ],
    },
    {
      id: 'corporate_tax_registration',
      label: 'Corporate Tax registration',
      kind: 'enum',
      required: true,
      options: [
        { value: 'registered', label: 'Registered' },
        { value: 'not_registered', label: 'Not registered' },
        { value: 'unconfirmed', label: 'Needs confirmation' },
      ],
    },
    {
      id: 'vat_threshold_state',
      label: 'VAT registration threshold state',
      kind: 'enum',
      required: true,
      options: [
        { value: 'below_voluntary', label: 'Below voluntary threshold' },
        { value: 'voluntary', label: 'Eligible for voluntary registration' },
        { value: 'mandatory', label: 'Mandatory registration threshold reached' },
        { value: 'unconfirmed', label: 'Needs confirmation' },
      ],
    },
    {
      id: 'vat_registration',
      label: 'VAT registration',
      kind: 'enum',
      required: true,
      options: [
        { value: 'registered', label: 'Registered' },
        { value: 'not_registered', label: 'Not registered' },
        { value: 'unconfirmed', label: 'Needs confirmation' },
      ],
    },
    {
      id: 'free_zone_qualifying_status',
      label: 'Qualifying Free Zone Person status',
      kind: 'enum',
      required: false,
      options: [
        { value: 'authority_confirmed', label: 'Supported by authority evidence' },
        { value: 'professional_confirmed', label: 'Confirmed by a qualified professional' },
        { value: 'needs_review', label: 'Needs eligibility review' },
        { value: 'not_claimed', label: 'Not claimed' },
      ],
    },
    {
      id: 'einvoicing_revenue_band',
      label: 'UAE eInvoicing revenue band',
      kind: 'enum',
      required: true,
      options: [
        { value: 'aed_50m_or_more', label: 'AED 50 million or more' },
        { value: 'below_aed_50m', label: 'Below AED 50 million' },
        { value: 'government', label: 'Government entity' },
        { value: 'voluntary', label: 'Voluntary early adoption' },
      ],
    },
    {
      id: 'einvoicing_onboarding_state',
      label: 'Accredited eInvoicing provider onboarding',
      kind: 'enum',
      required: true,
      options: [
        { value: 'not_selected', label: 'Provider not selected' },
        { value: 'asp_selected', label: 'Accredited provider selected' },
        { value: 'agreement_active', label: 'Commercial agreement active' },
        { value: 'provider_onboarding', label: 'Provider onboarding in progress' },
        { value: 'reporting_validated', label: 'FTA reporting validated' },
      ],
    },
  ],
  regimes: [
    {
      id: 'uae_free_zone_person',
      entityTypes: ['company', 'establishment'],
      label: 'UAE Free Zone Person',
      description:
        'Corporate Tax, VAT, Free Zone eligibility, and accredited eInvoicing-provider readiness.',
      requiredQuestions: [
        'formation_emirate',
        'entity_structure',
        'corporate_tax_registration',
        'vat_threshold_state',
        'vat_registration',
        'free_zone_qualifying_status',
        'einvoicing_revenue_band',
        'einvoicing_onboarding_state',
      ],
      ruleVersionIds: Object.values(RULES),
    },
    {
      id: 'uae_mainland_company',
      entityTypes: ['company'],
      label: 'UAE mainland company',
      description:
        'Corporate Tax, VAT, and accredited eInvoicing-provider readiness without a Free Zone eligibility claim.',
      requiredQuestions: [
        'formation_emirate',
        'entity_structure',
        'corporate_tax_registration',
        'vat_threshold_state',
        'vat_registration',
        'einvoicing_revenue_band',
        'einvoicing_onboarding_state',
      ],
      ruleVersionIds: [RULES.corporateTax, RULES.vatRegistration, RULES.einvoicing],
    },
  ],
  rules: [
    {
      id: RULES.corporateTax,
      jurisdiction: 'AE',
      effectiveFrom: '2023-06-01',
      effectiveTo: null,
      sourceUrl: 'https://mof.gov.ae/en/public-finance/tax/corporate-tax/',
      title: 'UAE Ministry of Finance · Corporate Tax',
      reviewedByAccountant: false,
      version: '2026.07.1',
    },
    {
      id: RULES.vatRegistration,
      jurisdiction: 'AE',
      effectiveFrom: '2018-01-01',
      effectiveTo: null,
      sourceUrl: 'https://tax.gov.ae/en/taxes/Vat/vat.topics/registration.for.vat.aspx',
      title: 'UAE Federal Tax Authority · VAT registration',
      reviewedByAccountant: false,
      version: '2026.07.1',
    },
    {
      id: RULES.freeZone,
      jurisdiction: 'AE',
      effectiveFrom: '2023-06-01',
      effectiveTo: null,
      sourceUrl: 'https://mof.gov.ae/en/public-finance/tax/corporate-tax/',
      title: 'UAE Ministry of Finance · Free Zone Corporate Tax treatment',
      reviewedByAccountant: false,
      version: '2026.07.1',
    },
    {
      id: RULES.einvoicing,
      jurisdiction: 'AE',
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      sourceUrl: 'https://mof.gov.ae/en/about-us/initiatives/einvoicing/',
      title: 'UAE Ministry of Finance · eInvoicing programme',
      reviewedByAccountant: false,
      version: '2026.07.1',
    },
  ],
};

export class UaeJurisdictionProvider implements TaxJurisdictionProvider {
  readonly jurisdiction = 'AE' as const;
  readonly catalogue = uaeCatalogue;

  validateProfile(profile: TaxProfile): readonly string[] {
    if (profile.jurisdiction !== 'AE') return ['PROFILE_JURISDICTION_MISMATCH'];
    const regime = this.catalogue.regimes.find(candidate => candidate.id === profile.regimeId);
    if (!regime) return ['UNSUPPORTED_REGIME'];
    if (!regime.entityTypes.includes(profile.entityType)) return ['PROFILE_ENTITY_TYPE_MISMATCH'];

    const answerMap = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    const errors = regime.requiredQuestions
      .filter(question => !answerMap.has(question))
      .map(question => `MISSING_${question.toUpperCase()}`);

    if (answerMap.get('formation_emirate') !== profile.formationSubdivision) {
      errors.push('PROFILE_FORMATION_EMIRATE_MISMATCH');
    }

    const structure = answerMap.get('entity_structure');
    if (!isOneOf(structure, ENTITY_STRUCTURES)) errors.push('INVALID_ENTITY_STRUCTURE');
    if (
      profile.regimeId === 'uae_mainland_company'
      && structure !== 'mainland_company'
    ) errors.push('REGIME_ENTITY_STRUCTURE_MISMATCH');
    if (
      profile.regimeId === 'uae_free_zone_person'
      && structure !== 'free_zone_company'
      && structure !== 'free_zone_establishment'
    ) errors.push('REGIME_ENTITY_STRUCTURE_MISMATCH');

    if (!isOneOf(answerMap.get('corporate_tax_registration'), REGISTRATION_STATES)) {
      errors.push('INVALID_CORPORATE_TAX_REGISTRATION');
    }
    if (!isOneOf(answerMap.get('vat_threshold_state'), VAT_THRESHOLD_STATES)) {
      errors.push('INVALID_VAT_THRESHOLD_STATE');
    }
    if (!isOneOf(answerMap.get('vat_registration'), REGISTRATION_STATES)) {
      errors.push('INVALID_VAT_REGISTRATION');
    }
    if (!isOneOf(answerMap.get('einvoicing_onboarding_state'), EINVOICING_STATES)) {
      errors.push('INVALID_EINVOICING_ONBOARDING_STATE');
    }
    if (
      profile.regimeId === 'uae_free_zone_person'
      && ![
        'authority_confirmed',
        'professional_confirmed',
        'needs_review',
        'not_claimed',
      ].includes(String(answerMap.get('free_zone_qualifying_status')))
    ) errors.push('INVALID_FREE_ZONE_QUALIFYING_STATUS');

    return [...new Set(errors)];
  }

  buildObligations({ profile, period }: WorkflowBuildContext): readonly TaxObligation[] {
    const validation = this.validateProfile(profile);
    const answerMap = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    const corporateTaxState = answerMap.get('corporate_tax_registration');
    const vatThresholdState = answerMap.get('vat_threshold_state');
    const vatRegistrationState = answerMap.get('vat_registration');
    const einvoicingState = answerMap.get('einvoicing_onboarding_state');
    const freeZoneStatus = answerMap.get('free_zone_qualifying_status');
    const shared = {
      jurisdiction: 'AE' as const,
      regimeId: profile.regimeId,
      period,
      dueAt: null,
      dueTimeZone: 'Asia/Dubai',
      preparationState: 'not_started' as const,
      submissionState: 'not_submitted' as const,
      satisfactionState: 'outstanding' as const,
    };

    const obligations: TaxObligation[] = [
      {
        ...shared,
        id: 'ae:corporate-tax-registration',
        category: 'registration',
        title: 'Corporate Tax registration',
        description:
          'Confirm the entity registration state in EmaraTax. This projection never stores a Tax Registration Number or login credential.',
        applicability:
          validation.length > 0 || corporateTaxState === 'unconfirmed'
            ? 'needs_professional_review'
            : 'applicable',
        preparationState:
          corporateTaxState === 'registered' ? 'ready_for_review' : 'not_started',
        satisfactionState:
          corporateTaxState === 'registered' ? 'satisfied' : 'outstanding',
        evidenceRequirementIds: ['ae:req:corporate-tax-registration-receipt'],
        ruleVersionIds: [RULES.corporateTax],
        actionId:
          corporateTaxState === 'registered'
            ? null
            : 'action:confirm-corporate-tax-registration',
      },
      {
        ...shared,
        id: 'ae:vat-registration',
        category: 'registration',
        title: 'VAT registration review',
        description:
          'Use confirmed UAE turnover evidence to determine registration applicability; no turnover amount is exposed in this obligation.',
        applicability:
          validation.length > 0 || vatThresholdState === 'unconfirmed'
            ? 'needs_professional_review'
            : vatThresholdState === 'mandatory'
              ? 'applicable'
              : vatThresholdState === 'voluntary'
                ? 'unknown'
                : 'not_applicable',
        preparationState:
          vatRegistrationState === 'registered' ? 'ready_for_review' : 'not_started',
        satisfactionState:
          vatRegistrationState === 'registered'
            ? 'satisfied'
            : vatThresholdState === 'below_voluntary'
              ? 'not_due'
              : 'outstanding',
        evidenceRequirementIds: [
          'ae:req:vat-threshold-conclusion',
          'ae:req:vat-registration-receipt',
        ],
        ruleVersionIds: [RULES.vatRegistration],
        actionId:
          vatRegistrationState === 'registered'
          || vatThresholdState === 'below_voluntary'
            ? null
            : 'action:review-vat-registration',
      },
      {
        ...shared,
        id: 'ae:einvoicing-provider-onboarding',
        category: 'registration',
        title: 'Accredited eInvoicing provider onboarding',
        description:
          'Select an accredited provider in EmaraTax, execute the provider agreement, and require provider-verified Peppol, PINT-AE, network, and FTA reporting receipts.',
        applicability:
          validation.length > 0 ? 'needs_professional_review' : 'applicable',
        preparationState:
          einvoicingState === 'reporting_validated'
            ? 'ready_for_review'
            : 'not_started',
        submissionState:
          einvoicingState === 'reporting_validated' ? 'accepted' : 'not_submitted',
        satisfactionState:
          einvoicingState === 'reporting_validated' ? 'satisfied' : 'outstanding',
        evidenceRequirementIds: [
          'ae:req:asp-selection-commitment',
          'ae:req:provider-agreement-commitment',
          'ae:req:fta-reporting-receipt-commitment',
        ],
        ruleVersionIds: [RULES.einvoicing],
        actionId:
          einvoicingState === 'reporting_validated'
            ? null
            : 'action:continue-uae-einvoicing-onboarding',
      },
    ];

    if (profile.regimeId === 'uae_free_zone_person') {
      const confirmed =
        freeZoneStatus === 'authority_confirmed'
        || freeZoneStatus === 'professional_confirmed';
      obligations.push({
        ...shared,
        id: 'ae:free-zone-qualifying-status',
        category: 'other',
        title: 'Qualifying Free Zone Person eligibility',
        description:
          'Record authority or qualified-professional support before relying on qualifying Free Zone treatment. The system does not self-certify eligibility.',
        applicability: confirmed ? 'applicable' : 'needs_professional_review',
        preparationState: confirmed ? 'ready_for_review' : 'unknown',
        satisfactionState: confirmed ? 'satisfied' : 'outstanding',
        evidenceRequirementIds: ['ae:req:free-zone-eligibility-support'],
        ruleVersionIds: [RULES.freeZone, RULES.corporateTax],
        actionId: confirmed ? null : 'action:review-free-zone-eligibility',
      });
    }

    return obligations;
  }
}

function isOneOf<T extends string>(
  value: unknown,
  candidates: readonly T[],
): value is T {
  return typeof value === 'string' && candidates.includes(value as T);
}
