import { expect, test } from 'bun:test';

import { demoSnapshot } from './fixtures';
import { buildTaxWidgetSnapshot } from './snapshot';
import type { SafeFact, TaxEvidencePresentationProjectionV1 } from './evidence';

// Regression: ISSUE-005 — net activity was presented as calculated tax liability
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('withholds blocked estimates and keeps activity separate from tax metrics', async () => {
  const argentina = await demoSnapshot('AR');
  expect(argentina.estimate).toMatchObject({ state: 'unavailable', amount: null });
  expect(argentina.metrics.taxCollected).toBeNull();
  expect(argentina.metrics.taxPaid).toBeNull();
  expect(argentina.metrics.netTaxPosition).toBeNull();

  const unitedStates = await demoSnapshot('US');
  expect(unitedStates.estimate.amount).toEqual({ decimal: '7500', currency: 'USD' });
  expect(unitedStates.estimate.warning).toContain('not a tax liability');

  const sourceFacts = unitedStates.facts as readonly SafeFact[];
  const unsafeEvidence: TaxEvidencePresentationProjectionV1 = {
    version: 'tax-evidence-presentation-v1' as const,
    upstreamBundleHash: unitedStates.inputHash,
    period: unitedStates.period,
    resolvedScope: { mode: 'all_connected' as const },
    displayCurrency: unitedStates.displayCurrency,
    asOf: '2026-07-10T00:00:00.000Z',
    validUntil: null,
    capabilityManifest: unitedStates.capabilityManifest,
    sources: unitedStates.sourceCoverage,
    safeFacts: sourceFacts.map(fact => fact.value.kind === 'reconciled_revenue'
      ? { ...fact, confidence: { level: 'unknown' as const, value: null, derivation: 'provider_fact' as const } }
      : fact),
    evidenceCoverage: unitedStates.evidenceCoverage,
    limitations: [] as string[],
  };
  const confidenceBlocked = buildTaxWidgetSnapshot({
    workspaceId: unitedStates.workspaceId,
    profile: unitedStates.profile,
    evidence: unsafeEvidence,
  });
  expect(confidenceBlocked.estimate).toMatchObject({ state: 'unavailable', amount: null });
});
