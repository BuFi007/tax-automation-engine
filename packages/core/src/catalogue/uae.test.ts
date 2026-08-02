import { describe, expect, test } from 'bun:test';

import { UaeJurisdictionProvider } from './uae';
import { uaeProfile } from '../fixtures';

describe('UAE jurisdiction provider', () => {
  test('registers a first-class UAE catalogue with current official sources', () => {
    const provider = new UaeJurisdictionProvider();

    expect(provider.catalogue.jurisdiction).toBe('AE');
    expect(provider.catalogue.version).toBe('ae-catalogue-2026-07-27');
    expect(provider.catalogue.regimes.map(regime => regime.id)).toEqual([
      'uae_free_zone_person',
      'uae_mainland_company',
    ]);
    expect(
      provider.catalogue.rules.every(rule =>
        rule.sourceUrl.startsWith('https://mof.gov.ae/')
        || rule.sourceUrl.startsWith('https://tax.gov.ae/')
      )
    ).toBe(true);
  });

  test('keeps Free Zone eligibility under review while creating real obligations', () => {
    const provider = new UaeJurisdictionProvider();
    const profile = uaeProfile();

    expect(provider.validateProfile(profile)).toEqual([]);
    const obligations = provider.buildObligations({
      profile,
      period: { start: '2026-01-01', end: '2026-12-31' },
    });

    expect(obligations.map(obligation => obligation.id)).toEqual([
      'ae:corporate-tax-registration',
      'ae:vat-registration',
      'ae:einvoicing-provider-onboarding',
      'ae:free-zone-qualifying-status',
    ]);
    expect(
      obligations.find(obligation => obligation.id === 'ae:free-zone-qualifying-status')
    ).toMatchObject({
      applicability: 'needs_professional_review',
      preparationState: 'unknown',
      satisfactionState: 'outstanding',
    });
    expect(JSON.stringify(obligations)).not.toMatch(/\b\d{15}\b/u);
  });

  test('rejects a mainland structure under the Free Zone regime', () => {
    const provider = new UaeJurisdictionProvider();
    const profile = uaeProfile();
    const mismatched = {
      ...profile,
      answers: profile.answers.map(answer =>
        answer.questionId === 'entity_structure'
          ? { ...answer, value: 'mainland_company' }
          : answer
      ),
    };

    expect(provider.validateProfile(mismatched)).toContain(
      'REGIME_ENTITY_STRUCTURE_MISMATCH'
    );
  });
});
