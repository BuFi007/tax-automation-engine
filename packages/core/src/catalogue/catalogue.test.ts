import { describe, expect, test } from 'bun:test';

import { argentinaProfile, unitedStatesProfile } from '../fixtures';
import type { TaxProfile } from '../types';
import { ArgentinaJurisdictionProvider, assessMonotributoServiceCategory2026 } from './argentina';
import { UnitedStatesJurisdictionProvider } from './united-states';
import { assessUaeVatRegistrationThreshold, UnitedArabEmiratesJurisdictionProvider } from './united-arab-emirates';

const TAX_YEAR_2025 = { start: '2025-01-01', end: '2025-12-31' } as const;

describe('Argentina deterministic obligation catalogue', () => {
  test('publishes bounded 2026 Monotributo and CABA unified IIBB deadlines', () => {
    const obligations = new ArgentinaJurisdictionProvider().buildObligations({
      profile: argentinaProfile(),
      period: { start: '2026-01-01', end: '2026-01-31' },
    });

    expect(find(obligations, 'ar:monotributo-payment').dueAt).toBe('2026-02-20T23:59:59-03:00');
    expect(find(obligations, 'ar:recategorization:02').dueAt).toBe('2026-02-05T23:59:59-03:00');
    expect(find(obligations, 'ar:recategorization:08').dueAt).toBe('2026-08-05T23:59:59-03:00');
    expect(find(obligations, 'ar:iibb-review')).toMatchObject({
      dueAt: '2026-02-20T23:59:59-03:00',
      applicability: 'applicable',
    });
  });

  test('binds ARBA local deadlines only to the minimized confirmed CUIT group', () => {
    const provider = new ArgentinaJurisdictionProvider();
    const period = { start: '2026-01-01', end: '2026-01-31' } as const;
    const dueDates = ['0_1', '2_3', '4_5', '6_7', '8_9'].map(group =>
      find(provider.buildObligations({ profile: withIibb('buenos_aires_local', group), period }), 'ar:iibb-review').dueAt
    );
    expect(dueDates).toEqual([
      '2026-02-23T23:59:59-03:00',
      '2026-02-24T23:59:59-03:00',
      '2026-02-25T23:59:59-03:00',
      '2026-02-26T23:59:59-03:00',
      '2026-02-27T23:59:59-03:00',
    ]);

    expect(
      find(
        provider.buildObligations({ profile: withIibb('buenos_aires_local'), period }),
        'ar:iibb-review'
      )
    ).toMatchObject({ dueAt: null, applicability: 'needs_professional_review' });
  });

  test('uses the ARCA day-20 calendar for Buenos Aires simplified IIBB', () => {
    const obligations = new ArgentinaJurisdictionProvider().buildObligations({
      profile: withIibb('buenos_aires_simplified'),
      period: { start: '2026-05-01', end: '2026-05-31' },
    });
    expect(find(obligations, 'ar:iibb-review')).toMatchObject({
      dueAt: '2026-06-22T23:59:59-03:00',
      applicability: 'applicable',
    });
  });

  test('binds CABA local deadlines to only the verifier digit and refuses to repair the authority typo', () => {
    const provider = new ArgentinaJurisdictionProvider();
    const january = find(provider.buildObligations({
      profile: withIibb('caba_local', undefined, '0'),
      period: { start: '2026-01-01', end: '2026-01-31' },
    }), 'ar:iibb-review');
    expect(january).toMatchObject({
      dueAt: '2026-02-18T23:59:59-03:00',
      applicability: 'needs_professional_review',
    });

    const september = find(provider.buildObligations({
      profile: withIibb('caba_local', undefined, '0'),
      period: { start: '2026-09-01', end: '2026-09-30' },
    }), 'ar:iibb-review');
    expect(september.dueAt).toBeNull();
    expect(september.description).toContain('prints the 9th advance dates with year 2025');
  });

  test('uses COMARB verifier groups for Convenio Multilateral without collecting the full CUIT', () => {
    const provider = new ArgentinaJurisdictionProvider();
    const dueFor2 = find(provider.buildObligations({
      profile: withIibb('convenio_multilateral', undefined, '2'),
      period: { start: '2026-01-01', end: '2026-01-31' },
    }), 'ar:iibb-review');
    const dueFor3 = find(provider.buildObligations({
      profile: withIibb('convenio_multilateral', undefined, '3'),
      period: { start: '2026-01-01', end: '2026-01-31' },
    }), 'ar:iibb-review');
    expect(dueFor2.dueAt).toBe('2026-02-13T23:59:59-03:00');
    expect(dueFor3.dueAt).toBe('2026-02-18T23:59:59-03:00');
    expect(dueFor2.ruleVersionIds).toEqual(['ar-convenio-multilateral-sifere-2026-v1']);

    const missingDigit = find(provider.buildObligations({
      profile: withIibb('convenio_multilateral', '2_3'),
      period: { start: '2026-01-01', end: '2026-01-31' },
    }), 'ar:iibb-review');
    expect(missingDigit.dueAt).toBeNull();
    expect(missingDigit.description).toContain('Existing two-digit local groups are insufficient');
  });

  test('bounds the ARBA local calendar to the official 2026 advance table', () => {
    const provider = new ArgentinaJurisdictionProvider();
    expect(
      find(
        provider.buildObligations({
          profile: withIibb('buenos_aires_local', '0_1'),
          period: { start: '2026-12-01', end: '2026-12-31' },
        }),
        'ar:iibb-review'
      ).dueAt
    ).toBe('2027-01-18T23:59:59-03:00');
    expect(
      find(
        provider.buildObligations({
          profile: withIibb('caba_local', '0_1'),
          period: { start: '2026-01-01', end: '2026-01-31' },
        }),
        'ar:iibb-review'
      ).dueAt
    ).toBe('2026-02-18T23:59:59-03:00');
  });

  test('dates the 2025 individual annual review without inferring applicability', () => {
    const obligations = new ArgentinaJurisdictionProvider().buildObligations({
      profile: argentinaProfile(),
      period: TAX_YEAR_2025,
    });

    expect(find(obligations, 'ar:ganancias-individual-annual')).toMatchObject({
      dueAt: '2026-07-27T23:59:59-03:00',
      applicability: 'needs_professional_review',
    });
    expect(find(obligations, 'ar:bienes-personales-annual')).toMatchObject({
      dueAt: '2026-07-27T23:59:59-03:00',
      applicability: 'needs_professional_review',
    });
  });

  test('assesses the official February 2026 Monotributo ceiling without silently excluding a taxpayer', () => {
    expect(assessMonotributoServiceCategory2026({
      asOf: '2026-07-16T00:00:00.000Z',
      currentCategory: 'A',
      rollingGrossRevenue: { decimal: '15058447.71', currency: 'ARS' },
      activityMonths: 12,
    })).toMatchObject({ recommendedCategory: 'B', state: 'recategorization_required' });

    expect(assessMonotributoServiceCategory2026({
      asOf: '2026-07-16T00:00:00.000Z',
      currentCategory: 'K',
      rollingGrossRevenue: { decimal: '108357084.06', currency: 'ARS' },
      activityMonths: 12,
    })).toMatchObject({ recommendedCategory: null, state: 'exclusion_review' });

    expect(assessMonotributoServiceCategory2026({
      asOf: '2026-07-16T00:00:00.000Z',
      currentCategory: 'A',
      rollingGrossRevenue: { decimal: '15058447.71', currency: 'ARS' },
      activityMonths: 5,
    }).state).toBe('not_due_under_six_months');
  });

  test('binds IVA Simple to the minimized CUIT digit and keeps domestic invoice classes honest', () => {
    const provider = new ArgentinaJurisdictionProvider();
    const ri = withArgentinaRegime('responsable_inscripto', 'individual', [
      { questionId: 'cuit_verifier_digit', value: '8', confirmationState: 'user_confirmed' },
      { questionId: 'tax_accounting_basis', value: 'cash', confirmationState: 'accountant_confirmed' },
    ]);
    const obligations = provider.buildObligations({ profile: ri, period: { start: '2026-02-01', end: '2026-02-28' } });
    expect(find(obligations, 'ar:iva-simple')).toMatchObject({
      dueAt: '2026-03-26T23:59:59-03:00',
      applicability: 'applicable',
      preparationState: 'not_started',
    });

    const domesticMono = withArgentinaAnswer(argentinaProfile(), 'exports_services', false);
    expect(find(provider.buildObligations({ profile: domesticMono, period: { start: '2026-01-01', end: '2026-01-31' } }), 'ar:invoice-readiness')).toMatchObject({
      title: 'Factura C readiness',
      actionId: 'action:prepare-domestic-invoice',
      applicability: 'applicable',
    });
  });

  test('publishes bounded corporate IVA and Ganancias deadlines without collecting the full CUIT', () => {
    const company = withArgentinaRegime('sociedad_mipyme', 'company', [
      { questionId: 'cuit_verifier_digit', value: '5', confirmationState: 'accountant_confirmed' },
      { questionId: 'fiscal_year_end_month', value: 12, confirmationState: 'accountant_confirmed' },
      { questionId: 'tax_accounting_basis', value: 'accrual', confirmationState: 'accountant_confirmed' },
    ]);
    const obligations = new ArgentinaJurisdictionProvider().buildObligations({ profile: company, period: TAX_YEAR_2025 });
    expect(find(obligations, 'ar:ganancias-corporate-annual')).toMatchObject({
      dueAt: '2026-05-14T23:59:59-03:00',
      applicability: 'applicable',
    });
    expect(find(obligations, 'ar:iva-simple').ruleVersionIds).toEqual([
      'ar-iva-simple-2026-v1',
      'ar-rg-4172-iva-calendar-v1',
      'ar-national-holidays-2026-v1',
    ]);
  });

  test('requires export point-of-sale evidence only for exporters and rejects invalid profile facts', () => {
    const provider = new ArgentinaJurisdictionProvider();
    const domestic = withArgentinaAnswer(
      { ...argentinaProfile(), answers: argentinaProfile().answers.filter(answer => answer.questionId !== 'export_pos_ready') },
      'exports_services',
      false,
    );
    expect(provider.validateProfile(domestic)).not.toContain('MISSING_EXPORT_POS_READY');

    const exporterWithoutPos = withArgentinaAnswer(domestic, 'exports_services', true);
    expect(provider.validateProfile(exporterWithoutPos)).toContain('MISSING_EXPORT_POS_READY');
    expect(provider.validateProfile(withArgentinaAnswer(argentinaProfile(), 'monotributo_category', 'Z'))).toContain('INVALID_MONOTRIBUTO_CATEGORY');
    expect(provider.validateProfile({ ...argentinaProfile(), answers: [...argentinaProfile().answers, argentinaProfile().answers[0]!] })).toEqual(['DUPLICATE_PROFILE_QUESTION']);
  });
});

describe('United Arab Emirates deterministic obligation catalogue', () => {
  test('derives VAT threshold routing from exact AED ledger windows', () => {
    const base = {
      isResidentInUae: true, makesTaxableSuppliesInUae: true, anotherUaePartyResponsibleForVat: false,
      taxableSuppliesAndImportsPast12MonthsAed: '375000.01', taxableSuppliesAndImportsNext30DaysAed: '0',
      taxableExpensesPast12MonthsAed: '0', taxableExpensesNext30DaysAed: '0',
    } as const;
    expect(assessUaeVatRegistrationThreshold(base)).toMatchObject({ state: 'mandatory', basis: 'resident_turnover', thresholdAed: '375000' });
    expect(assessUaeVatRegistrationThreshold({ ...base, taxableSuppliesAndImportsPast12MonthsAed: '375000' })).toMatchObject({ state: 'voluntary', thresholdAed: '187500' });
    expect(assessUaeVatRegistrationThreshold({ ...base, taxableSuppliesAndImportsPast12MonthsAed: '187500' })).toMatchObject({ state: 'below' });
    expect(assessUaeVatRegistrationThreshold({ ...base, taxableSuppliesAndImportsPast12MonthsAed: '0', taxableExpensesPast12MonthsAed: '187500.01' })).toMatchObject({ state: 'voluntary', basis: 'resident_expenses' });
  });

  test('routes a non-resident UAE taxable supply without inventing a threshold', () => {
    const result = assessUaeVatRegistrationThreshold({
      isResidentInUae: false, makesTaxableSuppliesInUae: true, anotherUaePartyResponsibleForVat: false,
      taxableSuppliesAndImportsPast12MonthsAed: null, taxableSuppliesAndImportsNext30DaysAed: null,
      taxableExpensesPast12MonthsAed: null, taxableExpensesNext30DaysAed: null,
    });
    expect(result).toEqual({ state: 'nonresident_taxable_supplies', basis: 'nonresident_supply', thresholdAed: '0', ruleVersionId: 'ae-fta-vat-registration-2026-v1', limitationCodes: [] });
  });

  test('fails closed on incomplete or non-canonical ledger amounts', () => {
    const base = {
      isResidentInUae: true, makesTaxableSuppliesInUae: true, anotherUaePartyResponsibleForVat: false,
      taxableSuppliesAndImportsPast12MonthsAed: '100', taxableSuppliesAndImportsNext30DaysAed: '0',
      taxableExpensesPast12MonthsAed: '0', taxableExpensesNext30DaysAed: '0',
    } as const;
    expect(assessUaeVatRegistrationThreshold({ ...base, taxableExpensesNext30DaysAed: null }).state).toBe('needs_review');
    expect(assessUaeVatRegistrationThreshold({ ...base, taxableExpensesNext30DaysAed: '1e6' }).limitationCodes).toContain('UAE_VAT_LEDGER_AMOUNT_INVALID');
  });

  test('keeps Free Zone treatment under professional review and preserves authority-pending registration', () => {
    const provider = new UnitedArabEmiratesJurisdictionProvider();
    const profile = uaeProfile();
    const obligations = provider.buildObligations({ profile, period: TAX_YEAR_2025 });

    expect(provider.validateProfile(profile)).toEqual([]);
    expect(find(obligations, 'ae:corporate-tax-registration')).toMatchObject({
      submissionState: 'authority_receipt_pending',
      satisfactionState: 'outstanding',
    });
    expect(find(obligations, 'ae:free-zone-qualifying-status-review')).toMatchObject({
      applicability: 'needs_professional_review',
      dueAt: null,
    });
  });

  test('does not create a VAT return before verified VAT registration', () => {
    const obligations = new UnitedArabEmiratesJurisdictionProvider().buildObligations({
      profile: withAnswer(withAnswer(uaeProfile(), 'vat_threshold_state', 'below'), 'vat_registration', 'not_registered'),
      period: TAX_YEAR_2025,
    });
    expect(find(obligations, 'ae:vat-registration')).toMatchObject({ applicability: 'not_applicable', satisfactionState: 'not_due' });
    expect(find(obligations, 'ae:vat-return')).toMatchObject({ applicability: 'not_applicable' });
  });

  test('treats certificate availability as evidence pending verification, never authority acceptance', () => {
    const profile = withAnswer(withAnswer(uaeProfile(), 'corporate_tax_registration', 'certificate_available'), 'vat_registration', 'certificate_available');
    const obligations = new UnitedArabEmiratesJurisdictionProvider().buildObligations({ profile, period: TAX_YEAR_2025 });
    expect(find(obligations, 'ae:corporate-tax-registration')).toMatchObject({
      submissionState: 'authority_receipt_pending', satisfactionState: 'outstanding', actionId: 'action:verify-ae-corporate-tax-certificate',
    });
    expect(find(obligations, 'ae:vat-registration')).toMatchObject({
      submissionState: 'authority_receipt_pending', satisfactionState: 'outstanding', actionId: 'action:verify-ae-vat-registration-evidence',
    });
  });
});


describe('United States deterministic obligation catalogue', () => {
  test('routes a foreign-owned disregarded entity to the special 5472 path', () => {
    const obligations = new UnitedStatesJurisdictionProvider().buildObligations({
      profile: unitedStatesProfile(),
      period: TAX_YEAR_2025,
    });

    expect(find(obligations, 'us:form-5472-pro-forma-1120')).toMatchObject({
      dueAt: '2026-04-15T23:59:59-04:00',
      applicability: 'needs_professional_review',
      preparationState: 'unknown',
    });
  });

  test('does not infer U.S.-person status from a foreign domicile', () => {
    const provider = new UnitedStatesJurisdictionProvider();
    const foreignDomiciledUsPerson = withUsAnswer(
      withUsRegime('llc_single_member', 'disregarded_entity', 'foreign', 1),
      'owner_us_person_status',
      'us_person'
    );
    const obligations = provider.buildObligations({ profile: foreignDomiciledUsPerson, period: TAX_YEAR_2025 });

    expect(obligations.some(obligation => obligation.id === 'us:form-5472-pro-forma-1120')).toBe(false);
    expect(find(obligations, 'us:owner-income-return-review')).toBeTruthy();

    const foreignDomiciledSOwner = withUsAnswer(
      withUsRegime('s_corp', 's_corp', 'foreign'),
      'owner_us_person_status',
      'us_person'
    );
    expect(provider.validateProfile(foreignDomiciledSOwner)).not.toContain('S_CORP_NON_US_OWNER_NEEDS_PROFESSIONAL_REVIEW');
  });

  test('routes a 25% foreign-owned C corporation with reportable transactions to Form 5472 review', () => {
    const provider = new UnitedStatesJurisdictionProvider();
    const obligations = provider.buildObligations({
      profile: withUsRegime('c_corp', 'c_corp', 'foreign'),
      period: TAX_YEAR_2025,
    });

    expect(find(obligations, 'us:form-5472-corporation-review')).toMatchObject({
      dueAt: '2026-04-15T23:59:59-04:00',
      applicability: 'needs_professional_review',
    });
  });

  test('fails closed when foreign ownership or related-party reporting facts are unresolved', () => {
    const provider = new UnitedStatesJurisdictionProvider();
    const noOwnershipAnswer = withoutUsAnswer(withUsRegime('c_corp', 'c_corp', 'foreign'), 'foreign_ownership_25_percent');
    expect(provider.validateProfile(noOwnershipAnswer)).toContain('MISSING_FOREIGN_OWNERSHIP_25_PERCENT');

    const noTransactionAnswer = withoutUsAnswer(withUsRegime('c_corp', 'c_corp', 'foreign'), 'related_party_reportable_transactions');
    expect(provider.validateProfile(noTransactionAnswer)).toContain('MISSING_RELATED_PARTY_REPORTABLE_TRANSACTIONS');
    expect(find(provider.buildObligations({ profile: noTransactionAnswer, period: TAX_YEAR_2025 }), 'us:form-5472-corporation-review').dueAt).toBeNull();
  });

  test('dates partnership and S corporation returns after the 2026 weekend adjustment', () => {
    const partnership = withUsRegime('llc_multi_member', 'partnership', 'foreign', 2);
    const sCorporation = withUsRegime('s_corp', 's_corp', 'local');

    expect(find(new UnitedStatesJurisdictionProvider().buildObligations({ profile: partnership, period: TAX_YEAR_2025 }), 'us:form-1065').dueAt)
      .toBe('2026-03-16T23:59:59-04:00');
    expect(find(new UnitedStatesJurisdictionProvider().buildObligations({ profile: sCorporation, period: TAX_YEAR_2025 }), 'us:form-1120-s').dueAt)
      .toBe('2026-03-16T23:59:59-04:00');
  });

  test('publishes the four 2026 C corporation estimate dates but keeps state and sales tax in review', () => {
    const profile = withUsRegime('c_corp', 'c_corp', 'foreign');
    const obligations = new UnitedStatesJurisdictionProvider().buildObligations({
      profile,
      period: { start: '2026-01-01', end: '2026-12-31' },
    });

    expect(obligations.filter(obligation => obligation.category === 'estimated_tax').map(obligation => obligation.dueAt)).toEqual([
      '2026-04-15T23:59:59-04:00',
      '2026-06-15T23:59:59-04:00',
      '2026-09-15T23:59:59-04:00',
      '2026-12-15T23:59:59-04:00',
    ]);
    expect(find(obligations, 'us:state-review').applicability).toBe('needs_professional_review');
    expect(find(obligations, 'us:sales-tax').applicability).toBe('needs_professional_review');
  });

  test('publishes bounded Delaware entity and income-tax deadlines', () => {
    const provider = new UnitedStatesJurisdictionProvider();
    const llc = provider.buildObligations({ profile: unitedStatesProfile(), period: TAX_YEAR_2025 });
    expect(find(llc, 'us:de:llc-annual-tax')).toMatchObject({
      dueAt: '2026-06-01T23:59:59-04:00',
      applicability: 'applicable',
    });

    const corporation = provider.buildObligations({
      profile: withUsRegime('c_corp', 'c_corp', 'local'),
      period: TAX_YEAR_2025,
    });
    expect(find(corporation, 'us:de:corporation-franchise')).toMatchObject({
      dueAt: '2026-03-01T23:59:59-05:00',
      applicability: 'needs_professional_review',
    });
    expect(find(corporation, 'us:de:income-return').dueAt).toBe('2026-04-15T23:59:59-04:00');
  });

  test('routes LLC corporation elections to the elected federal return', () => {
    const provider = new UnitedStatesJurisdictionProvider();
    const electedS = withUsRegime('llc_single_member', 's_corp', 'local', 1);
    const electedC = withUsRegime('llc_multi_member', 'c_corp', 'foreign', 2);

    expect(find(provider.buildObligations({ profile: electedS, period: TAX_YEAR_2025 }), 'us:form-1120-s')).toBeTruthy();
    expect(find(provider.buildObligations({ profile: electedC, period: TAX_YEAR_2025 }), 'us:form-1120')).toBeTruthy();
  });

  test('rejects member-count and entity-classification contradictions', () => {
    const provider = new UnitedStatesJurisdictionProvider();
    expect(provider.validateProfile(withUsRegime('llc_single_member', 'partnership', 'local', 2))).toEqual(
      expect.arrayContaining(['LLC_MEMBER_COUNT_REGIME_MISMATCH', 'REGIME_CLASSIFICATION_MISMATCH'])
    );
    expect(provider.validateProfile(withUsRegime('c_corp', 's_corp', 'local'))).toContain('REGIME_CLASSIFICATION_MISMATCH');
  });
});

function find(obligations: readonly { id: string }[], id: string) {
  const obligation = obligations.find(candidate => candidate.id === id);
  if (!obligation) throw new Error(`Missing obligation: ${id}`);
  return obligation as (typeof obligations)[number] & Record<string, unknown>;
}

function uaeProfile(): TaxProfile {
  return {
    profileId: 'profile:ae-free-zone', workspaceId: 'workspace:ae', jurisdiction: 'AE', entityType: 'fzco', regimeId: 'uae_free_zone_person',
    ownerDomicileCountries: ['AR'], ownerTaxResidenceCountries: ['AR'], formationSubdivision: 'AE-DU', operatingSubdivisions: ['AE-DU'],
    answers: [
      { questionId: 'formation_emirate', value: 'AE-DU', confirmationState: 'user_confirmed' },
      { questionId: 'licensing_authority', value: 'dubai_free_zone_authority', confirmationState: 'user_confirmed' },
      { questionId: 'tax_period_end_month', value: 12, confirmationState: 'accountant_confirmed' },
      { questionId: 'corporate_tax_registration', value: 'submitted', confirmationState: 'user_confirmed' },
      { questionId: 'vat_threshold_state', value: 'mandatory', confirmationState: 'accountant_confirmed' },
      { questionId: 'vat_registration', value: 'submitted', confirmationState: 'user_confirmed' },
      { questionId: 'adequate_substance', value: 'yes', confirmationState: 'accountant_confirmed' },
      { questionId: 'qualifying_income', value: 'yes', confirmationState: 'accountant_confirmed' },
      { questionId: 'excluded_activities', value: 'no', confirmationState: 'accountant_confirmed' },
      { questionId: 'de_minimis_condition', value: 'yes', confirmationState: 'accountant_confirmed' },
      { questionId: 'audited_financial_statements', value: 'yes', confirmationState: 'accountant_confirmed' },
    ],
    catalogueVersion: 'ae-catalogue-2026-07-17', version: 'profile-v1', confirmationState: 'accountant_confirmed',
  };
}

function withAnswer(profile: TaxProfile, questionId: string, value: string): TaxProfile {
  return { ...profile, answers: profile.answers.map(answer => answer.questionId === questionId ? { ...answer, value } : answer) };
}

function withUsRegime(regimeId: string, classification: string, residency: 'local' | 'foreign', memberCount?: number): TaxProfile {
  const base = unitedStatesProfile();
  return {
    ...base,
    regimeId,
    entityType: regimeId.startsWith('llc_') ? 'llc' : 'corporation',
    ownerDomicileCountries: [residency === 'local' ? 'US' : 'AR'],
    ownerTaxResidenceCountries: [residency === 'local' ? 'US' : 'AR'],
    answers: base.answers.map(answer => {
      if (answer.questionId === 'founder_residency') return { ...answer, value: residency };
      if (answer.questionId === 'owner_us_person_status') return { ...answer, value: residency === 'local' ? 'us_person' : 'non_us_person' };
      if (answer.questionId === 'foreign_ownership_25_percent') return { ...answer, value: classification === 'c_corp' && residency === 'local' ? 'no' : 'yes' };
      if (answer.questionId === 'tax_classification') return { ...answer, value: classification };
      if (answer.questionId === 'member_count' && memberCount !== undefined) return { ...answer, value: memberCount };
      return answer;
    }),
  };
}

function withUsAnswer(profile: TaxProfile, questionId: string, value: string): TaxProfile {
  return {
    ...profile,
    answers: profile.answers.map(answer => answer.questionId === questionId ? { ...answer, value } : answer),
  };
}

function withoutUsAnswer(profile: TaxProfile, questionId: string): TaxProfile {
  return { ...profile, answers: profile.answers.filter(answer => answer.questionId !== questionId) };
}

function withIibb(regime: string, dueGroup?: string, verifierDigit?: string): TaxProfile {
  const base = argentinaProfile();
  return {
    ...base,
    answers: [
      ...base.answers.map(answer =>
        answer.questionId === 'iibb_regime' ? { ...answer, value: regime } : answer
      ),
      ...(dueGroup
        ? [{ questionId: 'cuit_due_group', value: dueGroup, confirmationState: 'user_confirmed' as const }]
        : []),
      ...(verifierDigit
        ? [{ questionId: 'cuit_verifier_digit', value: verifierDigit, confirmationState: 'user_confirmed' as const }]
        : []),
    ],
  };
}

function withArgentinaRegime(regimeId: string, entityType: string, extraAnswers: TaxProfile['answers']): TaxProfile {
  const base = argentinaProfile();
  return {
    ...base,
    regimeId,
    entityType,
    answers: [
      ...base.answers.filter(answer => !extraAnswers.some(extra => extra.questionId === answer.questionId)),
      ...extraAnswers,
    ],
  };
}

function withArgentinaAnswer(profile: TaxProfile, questionId: string, value: string | boolean | number): TaxProfile {
  return {
    ...profile,
    answers: profile.answers.map(answer => answer.questionId === questionId ? { ...answer, value } : answer),
  };
}
