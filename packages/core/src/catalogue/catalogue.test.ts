import { describe, expect, test } from 'bun:test';

import { argentinaProfile, unitedStatesProfile } from '../fixtures';
import type { TaxProfile } from '../types';
import { ArgentinaJurisdictionProvider } from './argentina';
import { UnitedStatesJurisdictionProvider } from './united-states';

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

    expect(find(obligations, 'ar:annual-individual-review')).toMatchObject({
      dueAt: '2026-07-27T23:59:59-03:00',
      applicability: 'needs_professional_review',
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
