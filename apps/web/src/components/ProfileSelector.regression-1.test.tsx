import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  argentinaTaxWidgetSnapshotV1Fixture,
  unitedStatesTaxWidgetSnapshotV1Fixture,
} from '@tax-engine/browser-contracts/fixtures';

import { ProfileSelector } from './ProfileSelector';

// Regression: ISSUE-003 — the old demo selector created client-only state.
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('renders only the persisted Argentina, United States, and UAE profile projection', () => {
  const render = (profile: typeof argentinaTaxWidgetSnapshotV1Fixture.profile) => renderToStaticMarkup(
    <ProfileSelector profile={profile} />
  );

  const argentina = render(argentinaTaxWidgetSnapshotV1Fixture.profile);
  expect(argentina).toContain('Argentina');
  expect(argentina).toContain('monotributo exportador');

  const unitedStates = render(unitedStatesTaxWidgetSnapshotV1Fixture.profile);
  expect(unitedStates).toContain('United States');
  expect(unitedStates).toContain('llc single member foreign owned');
  const uae = render({
    ...unitedStatesTaxWidgetSnapshotV1Fixture.profile,
    jurisdiction: 'AE',
    entityType: 'fzco',
    regimeId: 'uae_free_zone_person',
  });
  expect(uae).toContain('United Arab Emirates');
  expect(uae).toContain('uae free zone person');
  expect(`${argentina}${unitedStates}${uae}`).not.toContain('<select');
});
