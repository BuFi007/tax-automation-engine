import { expect, test } from 'bun:test';

import { demoSnapshot } from './fixtures';

// Regression: ISSUE-005 — net activity was presented as calculated tax liability
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('withholds blocked estimates and keeps activity separate from tax metrics', async () => {
  const argentina = await demoSnapshot('AR');
  expect(argentina.estimate).toMatchObject({ state: 'unavailable', amount: null });
  expect(argentina.metrics.taxCollected).toEqual({ decimal: '0', currency: 'ARS' });
  expect(argentina.metrics.taxPaid).toEqual({ decimal: '0', currency: 'ARS' });
  expect(argentina.metrics.netTaxPosition).toEqual({ decimal: '0', currency: 'ARS' });

  const unitedStates = await demoSnapshot('US');
  expect(unitedStates.estimate.amount).toEqual({ decimal: '7500', currency: 'USD' });
  expect(unitedStates.estimate.warning).toContain('not a tax liability');
});
