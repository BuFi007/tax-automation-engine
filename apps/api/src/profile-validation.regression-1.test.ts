import { expect, test } from 'bun:test';

import { argentinaProfile } from '@tax-engine/core';

import { assertCatalogueSafeProfile } from './profile-validation';

// Regression: ISSUE-004 — unknown answers could persist raw sensitive identifiers
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('accepts only versioned catalogue questions at the profile storage boundary', () => {
  expect(() => assertCatalogueSafeProfile(argentinaProfile())).not.toThrow();

  const unsafe = {
    ...argentinaProfile(),
    answers: [
      ...argentinaProfile().answers,
      { questionId: 'cuit', value: '00000000000', confirmationState: 'user_confirmed' as const },
    ],
  };
  expect(() => assertCatalogueSafeProfile(unsafe)).toThrow('UNKNOWN_PROFILE_QUESTION');
});
