import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ProfileSelector } from './ProfileSelector';

// Regression: ISSUE-003 — the regime selector was rendered disabled
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('renders selectable Argentina and United States regime catalogues', () => {
  const render = (jurisdiction: 'AR' | 'US', selectedRegime: string) => renderToStaticMarkup(
    <ProfileSelector
      jurisdiction={jurisdiction}
      selectedRegime={selectedRegime}
      onJurisdictionChange={() => undefined}
      onRegimeChange={() => undefined}
    />
  );

  const argentina = render('AR', 'monotributo_exportador');
  expect(argentina).toContain('value="sociedad_mipyme"');
  expect(argentina).not.toMatch(/<select[^>]*disabled/);

  const unitedStates = render('US', 'c_corp');
  expect(unitedStates).toContain('value="llc_multi_member"');
  expect(unitedStates).toContain('value="s_corp"');
  expect(unitedStates).toContain('value="c_corp" selected=""');
  expect(unitedStates).not.toMatch(/<select[^>]*disabled/);
});
