import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { TaxObligation } from '@tax-engine/core';

import { ManualActionReview } from './ObligationJourney';

// Regression: ISSUE-002 — manual journey action buttons produced no response
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('manual review explains the non-execution boundary and next human gate', () => {
  const obligation: TaxObligation = {
    id: 'ar:invoice-readiness',
    jurisdiction: 'AR',
    regimeId: 'monotributo_exportador',
    category: 'invoice',
    title: 'Factura E readiness and collection evidence',
    description: 'Prepare invoice evidence.',
    period: { start: '2026-01-01', end: '2026-12-31' },
    dueAt: null,
    dueTimeZone: 'America/Argentina/Buenos_Aires',
    applicability: 'applicable',
    preparationState: 'not_started',
    submissionState: 'not_submitted',
    satisfactionState: 'outstanding',
    evidenceRequirementIds: ['invoice', 'collection'],
    ruleVersionIds: ['rule-v1'],
    actionId: 'action:prepare-factura-e',
  };

  const html = renderToStaticMarkup(<ManualActionReview obligation={obligation} panelId="manual-review" />);
  expect(html).toContain('cannot file, pay, or open an authority session');
  expect(html).toContain('2 requirements');
  expect(html).toContain('request accountant review');
  expect(html).toContain('Submission remains separately approval-gated');
});
