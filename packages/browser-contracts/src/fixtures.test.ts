import { describe, expect, test } from 'bun:test';

import {
  facturaEFactoringProjectionV1Schema,
  taxCaseV1Schema,
  taxWidgetSnapshotReceiptV1Schema,
  taxWidgetSnapshotV1Schema,
} from './contracts';
import {
  TAX_BROWSER_GOLDEN_FIXTURES_V1,
  TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256,
  argentinaTaxWidgetSnapshotReceiptV1Fixture,
  facturaENeedsConsentProjectionV1Fixture,
  unitedStatesTaxWidgetSnapshotV1Fixture,
} from './fixtures';
import { taxSnapshotProblemV1Schema } from './problems';
import { TAX_BROWSER_SCENARIO_FIXTURES_V1 } from './scenario-fixtures';

describe('Tax browser golden fixtures', () => {
  test('validate through the same runtime schemas consumers import', () => {
    expect(taxCaseV1Schema.parse(TAX_BROWSER_GOLDEN_FIXTURES_V1.argentinaCase)).toEqual(TAX_BROWSER_GOLDEN_FIXTURES_V1.argentinaCase);
    expect(taxCaseV1Schema.parse(TAX_BROWSER_GOLDEN_FIXTURES_V1.unsupportedCase)).toEqual(TAX_BROWSER_GOLDEN_FIXTURES_V1.unsupportedCase);
    expect(taxWidgetSnapshotV1Schema.parse(unitedStatesTaxWidgetSnapshotV1Fixture)).toEqual(unitedStatesTaxWidgetSnapshotV1Fixture);
    expect(taxWidgetSnapshotReceiptV1Schema.parse(argentinaTaxWidgetSnapshotReceiptV1Fixture)).toEqual(argentinaTaxWidgetSnapshotReceiptV1Fixture);
    expect(facturaEFactoringProjectionV1Schema.parse(facturaENeedsConsentProjectionV1Fixture)).toEqual(facturaENeedsConsentProjectionV1Fixture);
    expect(Object.values(TAX_BROWSER_GOLDEN_FIXTURES_V1.problems).every(problem => taxSnapshotProblemV1Schema.safeParse(problem).success)).toBe(true);
  });

  test('serialized fixtures contain no forbidden browser fields', () => {
    const keys = collectKeys({
      golden: TAX_BROWSER_GOLDEN_FIXTURES_V1,
      scenarios: TAX_BROWSER_SCENARIO_FIXTURES_V1,
    }).map(key => key.toLowerCase());
    for (const forbidden of ['cuit', 'tin', 'cae', 'privatekey', 'credential', 'providertoken', 'storagepath', 'rawevidence']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  test('have a pinned serialization digest so cross-repository drift is visible', async () => {
    const serialized = new TextEncoder().encode(JSON.stringify(TAX_BROWSER_GOLDEN_FIXTURES_V1));
    const digest = await crypto.subtle.digest('SHA-256', serialized);
    const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');

    expect(actual).toBe(TAX_BROWSER_GOLDEN_FIXTURES_V1_SHA256);
  });
});

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}
