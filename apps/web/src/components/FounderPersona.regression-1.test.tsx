import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { unitedStatesTaxWidgetSnapshotV1Fixture } from '@tax-engine/browser-contracts/fixtures';

import { ProfileSelector } from './ProfileSelector';

// Regression: ISSUE-006 — local and foreign U.S. founder personas were not selectable
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('shows the persisted foreign-founder U.S. entity without creating a client-side tax profile', () => {
  const selector = renderToStaticMarkup(
    <ProfileSelector profile={unitedStatesTaxWidgetSnapshotV1Fixture.profile} />
  );
  expect(selector).toContain('United States');
  expect(selector).toContain('llc single member foreign owned');
  expect(selector).toContain('accountant_confirmed');
  expect(selector).not.toContain('<select');
});
