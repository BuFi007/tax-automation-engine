import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { demoSnapshot } from '@tax-engine/core';

import { ProfileSelector } from './ProfileSelector';

// Regression: ISSUE-006 — local and foreign U.S. founder personas were not selectable
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('shows the U.S. founder persona and routes foreign S-Corp ownership to review', async () => {
  const selector = renderToStaticMarkup(
    <ProfileSelector
      jurisdiction="US"
      selectedRegime="s_corp"
      founderResidency="foreign"
      onJurisdictionChange={() => undefined}
      onRegimeChange={() => undefined}
      onFounderResidencyChange={() => undefined}
    />
  );
  expect(selector).toContain('Founder domicile');
  expect(selector).toContain('Foreign-domiciled founder');
  expect(selector).toContain('U.S.-resident founder');

  const foreignFounder = await demoSnapshot('US', 's_corp', 'foreign');
  expect(foreignFounder.estimate.state).toBe('unavailable');
  expect(foreignFounder.obligations.every(obligation => obligation.applicability === 'needs_professional_review')).toBe(true);

  const localFounder = await demoSnapshot('US', 's_corp', 'local');
  expect(localFounder.estimate.state).toBe('review_ready');
  expect(localFounder.obligations.every(obligation => obligation.applicability === 'applicable')).toBe(true);
});
