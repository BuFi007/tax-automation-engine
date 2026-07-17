import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { argentinaTaxWidgetSnapshotV1Fixture } from '@tax-engine/browser-contracts/fixtures';

import { ManualActionReview } from './ObligationJourney';

// Regression: ISSUE-002 — manual journey action buttons produced no response
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('manual review explains the non-execution boundary and next human gate', () => {
  const obligation = argentinaTaxWidgetSnapshotV1Fixture.obligations[0]!;

  const html = renderToStaticMarkup(<ManualActionReview obligation={obligation} panelId="manual-review" />);
  expect(html).toContain('cannot file, pay, or open an authority session');
  expect(html).toContain(obligation.actionId!);
  expect(html).toContain('request accountant review');
  expect(html).toContain('Submission remains separately approval-gated');
});
