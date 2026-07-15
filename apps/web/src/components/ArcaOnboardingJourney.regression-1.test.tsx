import { expect, test } from 'bun:test';

import { arcaScopeDescriptions } from './ArcaOnboardingJourney';

// Regression: ISSUE-001 — export-only UI retained WSFE verification requirements
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-07-14.md
test('derives authority verification copy from the selected ARCA service scope', () => {
  const exportOnly = arcaScopeDescriptions('wsfex');
  expect(exportOnly.apiVerification).toContain('WSFEX independently');
  expect(exportOnly.apiVerification).not.toContain('WSFE independently');
  expect(exportOnly.ready).toContain('the authoritative WSFEX receipt');
  expect(exportOnly.ready).not.toContain('both authoritative API receipts');

  const exportAndLocal = arcaScopeDescriptions('wsfex_wsfe');
  expect(exportAndLocal.apiVerification).toContain('WSFEX and WSFE independently');
  expect(exportAndLocal.ready).toContain('both authoritative API receipts');
});
