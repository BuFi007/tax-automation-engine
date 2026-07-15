import { expect, test } from 'bun:test';

import { executionGateCopy } from './ObligationJourney';

// Regression: ISSUE-003 — United States execution gate mentioned ARCA onboarding
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-07-14.md
test('keeps authority execution copy inside its selected jurisdiction', () => {
  expect(executionGateCopy('AR')).toContain('ARCA onboarding');
  expect(executionGateCopy('AR')).not.toContain('IRS submission');
  expect(executionGateCopy('US')).toContain('IRS submission');
  expect(executionGateCopy('US')).not.toContain('ARCA');
});
