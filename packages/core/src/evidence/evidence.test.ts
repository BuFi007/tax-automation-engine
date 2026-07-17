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
    expect(graph.gaps.map(gap => gap.kind)).toEqual(expect.arrayContaining([
      'factura_e_without_collection_evidence',
      'expense_without_receipt',
    ]));
    expect(graph.revision).toHaveLength(64);
  });

  test('rejects non-conserved allocations in the same counting dimension', () => {
    const records = [
      record('invoice', 'invoice-event', 'invoice', 'revenue', '100', 'AR'),
      record('bad-copy', 'invoice-event', 'accounting_entry', 'revenue', '90', 'AR'),
    ];
    expect(() => buildEvidenceGraph('workspace:1', records)).toThrow('not conserved');
  });

  test('rejects same-currency source contradictions even when normalized totals match', () => {
    const first = {
      ...record('invoice-usd', 'invoice-event', 'invoice', 'revenue', '100', 'US'),
      normalizedMoney: { decimal: '100000', currency: 'ARS' },
    };
    const contradictory = {
      ...record('accounting-usd', 'invoice-event', 'accounting_entry', 'revenue', '90', 'US'),
      normalizedMoney: { decimal: '100000', currency: 'ARS' },
    };
    expect(() => buildEvidenceGraph('workspace:1', [first, contradictory])).toThrow('Source allocation is not conserved');
  });

  test('surfaces conflicting reviewed party identities without merging them', () => {
    const invoice = record('invoice', 'invoice-event', 'invoice', 'revenue', '100', 'AR');
    const accounting = {
      ...record('accounting', 'invoice-event', 'accounting_entry', 'none', '100', 'AR'),
      partyClaimHash: 'party:conflicting-reviewed-identity',
    };
    const graph = buildEvidenceGraph('workspace:1', [invoice, accounting]);
    expect(graph.gaps).toContainEqual(expect.objectContaining({
      kind: 'accounting_counterparty_mismatch',
      severity: 'warning',
    }));
    expect(graph.edges.filter(edge => edge.kind === 'recorded_as')).toHaveLength(1);
  });

  test('accepts conserved USD and ARS source legs normalized to one exact amount', () => {
    const usd = {
      ...record('invoice-usd', 'invoice-event', 'invoice', 'revenue', '100', 'US'),
      normalizedMoney: { decimal: '100000', currency: 'ARS' },
    };
    const ars = {
      ...record('accounting-ars', 'invoice-event', 'accounting_entry', 'revenue', '100000', 'AR'),
      normalizedMoney: { decimal: '100000', currency: 'ARS' },
    };
    expect(() => buildEvidenceGraph('workspace:1', [usd, ars])).not.toThrow();
  });

  test('adds only accepted canonical settlement, support, and accounting links', () => {
    const invoice = record('invoice', 'invoice-event', 'invoice', 'revenue', '100', 'AR');
    const rejectedSettlement = { ...record('rejected-settlement', 'invoice-event', 'settlement', 'none', '100', 'AR'), reviewState: 'rejected' as const };
    const payment = record('payment', 'invoice-event', 'payment', 'none', '100', 'AR');
    const accounting = record('accounting', 'invoice-event', 'accounting_entry', 'none', '100', 'AR');
    const graphWithoutFinality = buildEvidenceGraph('workspace:1', [invoice, rejectedSettlement, payment, accounting]);
    expect(graphWithoutFinality.gaps.map(gap => gap.kind)).toContain('factura_e_without_collection_evidence');
    expect(graphWithoutFinality.edges.map(edge => edge.kind)).toEqual(expect.arrayContaining(['supports', 'recorded_as']));
    expect(graphWithoutFinality.edges.map(edge => edge.kind)).not.toContain('settles');

    const acceptedSettlement = { ...rejectedSettlement, reviewState: 'accepted' as const };
    const graphWithFinality = buildEvidenceGraph('workspace:1', [invoice, acceptedSettlement, payment, accounting]);
    expect(graphWithFinality.gaps.map(gap => gap.kind)).not.toContain('factura_e_without_collection_evidence');
    expect(graphWithFinality.edges.map(edge => edge.kind)).toContain('settles');
  });

  test('keeps a reversal tombstone in the graph but removes settlement finality', () => {
    const invoice = record('invoice', 'invoice-event', 'invoice', 'revenue', '100', 'AR');
    const finalized = {
      ...record('settlement-finalized', 'invoice-event', 'settlement', 'none', '100', 'AR'),
      sourceKind: 'bufi_invoice' as const,
    };
    const reversed = {
      ...record('settlement-reversed', 'invoice-event', 'settlement', 'none', '100', 'AR'),
      sourceKind: 'bufi_invoice' as const,
      validityState: 'withdrawn' as const,
      supersedesIdempotencyKey: finalized.idempotencyKey,
    };
    const graph = buildEvidenceGraph('workspace:1', [invoice, finalized, reversed]);

    expect(graph.nodes.map(node => node.id)).toContain('artifact:key:settlement-reversed');
    expect(graph.edges.map(edge => edge.kind)).not.toContain('settles');
    expect(graph.gaps.map(gap => gap.kind)).toContain('factura_e_without_collection_evidence');
  });

  test('does not classify an unpaid domestic invoice as an uncollected Factura E', () => {
    const domestic = {
      ...record('factura-c', 'domestic-event', 'invoice', 'revenue', '100', 'AR'),
      invoiceDocumentKind: 'arca_factura_c' as const,
    };
    const unknown = {
      ...record('unknown-invoice', 'unknown-event', 'invoice', 'revenue', '100', 'AR'),
      invoiceDocumentKind: null,
    };

    const kinds = buildEvidenceGraph('workspace:1', [domestic, unknown]).gaps.map(gap => gap.kind);
    expect(kinds).not.toContain('factura_e_without_collection_evidence');
    expect(kinds).toContain('invoice_document_kind_unknown');
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
    invoiceDocumentKind: economicRole === 'invoice' && jurisdiction === 'AR' ? 'arca_factura_e' : null,
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    countingDimension,
    direction: countingDimension === 'expense' ? 'outflow' : 'inflow',
    money: { decimal, currency: jurisdiction === 'AR' ? 'ARS' : 'USD' },
    normalizedMoney: { decimal, currency: jurisdiction === 'AR' ? 'ARS' : 'USD' },
    fxReferenceId: null,
    partyClaimHash: 'party:1',
    accountReferenceHash: 'account:1',
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
    validityState: 'active',
    consentVersion: 'consent-v1',
    idempotencyKey: `key:${evidenceId}`,
    supersedesIdempotencyKey: null,
  };
}
