import { describe, expect, test } from 'bun:test';

import { argentinaProfile, unitedStatesProfile } from '../fixtures';
import type { TaxProfile } from '../types';
import { ArgentinaJurisdictionProvider } from './argentina';
import { UnitedStatesJurisdictionProvider } from './united-states';

const TAX_YEAR_2025 = { start: '2025-01-01', end: '2025-12-31' } as const;

describe('Argentina deterministic obligation catalogue', () => {
  test('publishes bounded 2026 Monotributo deadlines and fails IIBB closed', () => {
    const obligations = new ArgentinaJurisdictionProvider().buildObligations({
      profile: argentinaProfile(),
      period: { start: '2026-01-01', end: '2026-01-31' },
    });

    expect(find(obligations, 'ar:monotributo-payment').dueAt).toBe('2026-02-20T23:59:59-03:00');
    expect(find(obligations, 'ar:recategorization:02').dueAt).toBe('2026-02-05T23:59:59-03:00');
    expect(find(obligations, 'ar:recategorization:08').dueAt).toBe('2026-08-05T23:59:59-03:00');
    expect(find(obligations, 'ar:iibb-review')).toMatchObject({
      dueAt: null,
      applicability: 'needs_professional_review',
    });
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
    answers: base.answers.map(answer => {
      if (answer.questionId === 'founder_residency') return { ...answer, value: residency };
      if (answer.questionId === 'tax_classification') return { ...answer, value: classification };
      if (answer.questionId === 'member_count' && memberCount !== undefined) return { ...answer, value: memberCount };
      return answer;
    }),
  };
}
