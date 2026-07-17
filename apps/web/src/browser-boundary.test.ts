import { describe, expect, test } from 'bun:test';

const browserProjectionFiles = [
  'App.tsx',
  'api.ts',
  'components/TaxWidget.tsx',
  'components/EvidenceCoverage.tsx',
  'components/ObligationJourney.tsx',
  'components/ProfileSelector.tsx',
] as const;

describe('Tax human-product browser boundary', () => {
  test('has no production/demo snapshot fallback', async () => {
    for (const file of browserProjectionFiles) {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      expect(source).not.toContain('/v1/snapshots/demo');
      expect(source).not.toContain('loadDemoSnapshot');
    }
  });

  test('presentation components import only the browser-safe Tax projection contract', async () => {
    for (const file of browserProjectionFiles) {
      const source = await Bun.file(new URL(file, import.meta.url)).text();
      expect(source).not.toContain("from '@tax-engine/core'");
      expect(source).not.toMatch(/TaxEvidenceResolver|TaxWorkspaceEvidenceBundle|TaxEvidenceRecord|CanonicalFinancialEvidenceGraph/);
      expect(source).not.toMatch(/plaid|stripe|quickbooks|xero|conta azul|contabilium/i);
    }
  });
});
