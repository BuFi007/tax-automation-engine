import { describe, expect, test } from 'bun:test';

import { buildEvidenceGraph } from './graph';
import type { TaxEvidenceRecord } from './types';

describe('canonical financial evidence graph', () => {
  test('finds collection and receipt gaps without counting source duplicates twice', () => {
    const records = [
      record('invoice', 'invoice-event', 'invoice', 'revenue', '100', 'AR'),
      record('accounting-copy', 'invoice-event', 'accounting_entry', 'none', '100', 'AR'),
      record('expense', 'expense-event', 'expense', 'expense', '25', 'AR'),
    ];
    const graph = buildEvidenceGraph('workspace:1', records);
    expect(graph.gaps.map(gap => gap.kind)).toEqual([
      'factura_e_without_collection_evidence',
      'expense_without_receipt',
    ]);
    expect(graph.revision).toHaveLength(64);
  });

  test('rejects non-conserved allocations in the same counting dimension', () => {
    const records = [
      record('invoice', 'invoice-event', 'invoice', 'revenue', '100', 'AR'),
      record('bad-copy', 'invoice-event', 'accounting_entry', 'revenue', '90', 'AR'),
    ];
    expect(() => buildEvidenceGraph('workspace:1', records)).toThrow('Allocation is not conserved');
  });
});

function record(
  evidenceId: string,
  economicEventId: string,
  economicRole: TaxEvidenceRecord['economicRole'],
  countingDimension: TaxEvidenceRecord['countingDimension'],
  decimal: string,
  jurisdiction: TaxEvidenceRecord['jurisdiction']
): TaxEvidenceRecord {
  return {
    evidenceId,
    workspaceId: 'workspace:1',
    revision: '1',
    sourceId: 'source:1',
    sourceKind: economicRole === 'accounting_entry' ? 'accounting' : 'bank',
    canonicalProviderId: null,
    externalReferenceHash: `external:${evidenceId}`,
    sourceEventHash: `event:${evidenceId}`,
    artifactHash: `artifact:${evidenceId}`,
    jurisdiction,
    period: { start: '2026-01-01', end: '2026-12-31' },
    observedAt: '2026-07-10T00:00:00.000Z',
    expiresAt: null,
    economicEventId,
    economicRole,
    countingDimension,
    direction: countingDimension === 'expense' ? 'outflow' : 'inflow',
    money: { decimal, currency: jurisdiction === 'AR' ? 'ARS' : 'USD' },
    normalizedMoney: { decimal, currency: jurisdiction === 'AR' ? 'ARS' : 'USD' },
    fxReferenceId: null,
    partyClaimHash: 'party:1',
    accountReferenceHash: 'account:1',
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
    consentVersion: 'consent-v1',
    idempotencyKey: `key:${evidenceId}`,
  };
}
