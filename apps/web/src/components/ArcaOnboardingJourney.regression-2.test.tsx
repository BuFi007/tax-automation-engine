import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ArcaOnboardingJourney } from './ArcaOnboardingJourney';

// Regression: ISSUE-002 — window.open handoff was blocked while UI claimed success
// Found by /qa on 2026-07-14
// Report: .gstack/qa-reports/qa-report-127-0-0-1-2026-07-14.md
test('uses a real isolated external link for the user-controlled ARCA handoff', () => {
  const html = renderToStaticMarkup(<ArcaOnboardingJourney />);
  expect(html).toContain('href="https://auth.afip.gob.ar/contribuyente_/login.xhtml"');
  expect(html).toContain('target="_blank"');
  expect(html).toContain('rel="noopener noreferrer"');
});
