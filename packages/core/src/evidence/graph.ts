import { createHash } from 'node:crypto';

import { FinancialDecimal } from '../financial-decimal';
import { isActiveTaxEvidenceRecord, resolveActiveEvidenceRecords } from './batch';
import type { CanonicalFinancialEvidenceGraph, EvidenceEdge, EvidenceGap, EvidenceNode, TaxEvidenceRecord } from './types';

export function buildEvidenceGraph(workspaceId: string, records: readonly TaxEvidenceRecord[]): CanonicalFinancialEvidenceGraph {
  const activeRecords = resolveActiveEvidenceRecords(records, { requireTargets: false });
  const accepted = activeRecords.filter(record => record.reviewState === 'accepted' && isActiveTaxEvidenceRecord(record));
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];
  const gaps: EvidenceGap[] = [];

  for (const record of activeRecords) {
    nodes.push(
      { id: artifactNodeId(record), kind: 'source_artifact', safeLabel: record.sourceKind },
      { id: `event:${record.economicEventId}`, kind: 'financial_event', safeLabel: record.economicRole }
    );
    edges.push({
      id: `edge:represents:${record.idempotencyKey}`,
      from: artifactNodeId(record),
      to: `event:${record.economicEventId}`,
      kind: 'represents',
      allocation: record.money,
      derivation: record.reviewState === 'accepted' && isActiveTaxEvidenceRecord(record) ? 'deterministic_rule' : 'suggested',
      reviewState: record.reviewState,
    });
  }

  const byEvent = groupBy(activeRecords, record => record.economicEventId);
  for (const [eventId, eventRecords] of byEvent) {
    const acceptedEventRecords = eventRecords.filter(record => record.reviewState === 'accepted' && isActiveTaxEvidenceRecord(record));
    const acceptedRoles = new Set(acceptedEventRecords.map(record => record.economicRole));
    addCanonicalLinks(edges, acceptedEventRecords);
    if (acceptedRoles.has('settlement') && !acceptedRoles.has('invoice')) gaps.push(gap('payout_without_invoice', eventId, eventRecords, 'warning'));
    if (acceptedRoles.has('expense') && !acceptedRoles.has('receipt')) gaps.push(gap('expense_without_receipt', eventId, eventRecords, 'warning'));
    if (acceptedEventRecords.some(record => record.economicRole === 'invoice' && record.invoiceDocumentKind === 'arca_factura_e')
      && !acceptedRoles.has('settlement')) {
      gaps.push(gap('factura_e_without_collection_evidence', eventId, eventRecords, 'blocking'));
    }
    if (acceptedEventRecords.some(record => record.jurisdiction === 'AR'
      && record.economicRole === 'invoice'
      && (record.invoiceDocumentKind === null || record.invoiceDocumentKind === 'unknown'))) {
      gaps.push(gap('invoice_document_kind_unknown', eventId, eventRecords, 'blocking'));
    }
    const partyClaims = new Set(acceptedEventRecords.map(record => record.partyClaimHash).filter(Boolean));
    if (partyClaims.size > 1 && acceptedEventRecords.some(record => record.sourceKind === 'accounting')) {
      gaps.push(gap('accounting_counterparty_mismatch', eventId, eventRecords, 'warning'));
    }
    assertAllocationConservation(eventRecords);
  }
  for (const adjustment of accepted.filter(record => record.invoiceAdjustmentKind !== null)) {
    const targets = accepted.filter(record => record.economicRole === 'invoice'
      && record.economicEventId === adjustment.adjustsEconomicEventId
      && record.invoiceAdjustmentKind === null);
    if (targets.length === 0) {
      gaps.push(gap('invoice_adjustment_target_missing', adjustment.economicEventId, [adjustment], 'blocking'));
      continue;
    }
    for (const target of targets) edges.push(link(adjustment, target, 'adjusts'));
  }

  const revision = createHash('sha256')
    .update([...accepted].sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey)).map(record => record.idempotencyKey).join('\n'))
    .digest('hex');
  return {
    version: 'financial-evidence-graph-v1',
    workspaceId,
    revision,
    nodes: dedupe(nodes).sort((left, right) => left.id.localeCompare(right.id)),
    edges: dedupe(edges).sort((left, right) => left.id.localeCompare(right.id)),
    gaps: gaps.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function addCanonicalLinks(edges: EvidenceEdge[], records: readonly TaxEvidenceRecord[]): void {
  const invoices = records.filter(record => record.economicRole === 'invoice');
  const expenses = records.filter(record => record.economicRole === 'expense');
  const accountingEntries = records.filter(record => record.economicRole === 'accounting_entry');
  for (const settlement of records.filter(record => record.economicRole === 'settlement')) {
    for (const invoice of invoices) edges.push(link(settlement, invoice, 'settles'));
  }
  for (const payment of records.filter(record => record.economicRole === 'payment')) {
    for (const invoice of invoices) edges.push(link(payment, invoice, 'supports'));
  }
  for (const receipt of records.filter(record => record.economicRole === 'receipt')) {
    for (const expense of expenses) edges.push(link(receipt, expense, 'supports'));
  }
  for (const source of [...invoices, ...expenses]) {
    for (const accountingEntry of accountingEntries) edges.push(link(source, accountingEntry, 'recorded_as'));
  }
}

function link(from: TaxEvidenceRecord, to: TaxEvidenceRecord, kind: EvidenceEdge['kind']): EvidenceEdge {
  return {
    id: `edge:${kind}:${from.idempotencyKey}:${to.idempotencyKey}`,
    from: artifactNodeId(from),
    to: artifactNodeId(to),
    kind,
    allocation: from.money,
    derivation: 'deterministic_rule',
    reviewState: 'accepted',
  };
}

function artifactNodeId(record: TaxEvidenceRecord): string {
  return `artifact:${record.idempotencyKey}`;
}

function gap(kind: EvidenceGap['kind'], eventId: string, records: readonly TaxEvidenceRecord[], severity: EvidenceGap['severity']): EvidenceGap {
  return {
    id: `gap:${kind}:${eventId}`,
    kind,
    severity,
    economicEventId: eventId,
    safeSourceReferenceIds: [...new Set(records.map(record => `source:${record.sourceId}`))].sort(),
    actionId: `action:resolve:${kind}:${eventId}`,
  };
}

function assertAllocationConservation(records: readonly TaxEvidenceRecord[]): void {
  const accepted = records.filter(record => record.reviewState === 'accepted'
    && isActiveTaxEvidenceRecord(record)
    && record.countingDimension !== 'none'
    && record.countingDimension !== 'cash');
  const byDimension = groupBy(accepted, record => record.countingDimension);
  for (const [dimension, dimensionRecords] of byDimension) {
    if (dimensionRecords.some(record => !record.normalizedMoney)) throw new Error('MISSING_NORMALIZED_MONEY_EVIDENCE');
    if (dimensionRecords.some(record => !record.money)) throw new Error('MISSING_SOURCE_MONEY_EVIDENCE');
    const bySourceCurrency = groupBy(dimensionRecords, record => record.money!.currency);
    for (const sourceCurrencyRecords of bySourceCurrency.values()) {
      const sourceAmounts = sourceCurrencyRecords.map(record => new FinancialDecimal(record.money!.decimal).abs().toFixed());
      if (new Set(sourceAmounts).size > 1) throw new Error(`Source allocation is not conserved for ${dimension}`);
    }
    const normalizedCurrencies = new Set(dimensionRecords.map(record => record.normalizedMoney!.currency));
    if (normalizedCurrencies.size > 1) throw new Error(`Mixed normalized currencies in event allocation for ${dimension}`);
    const normalizedAmounts = dimensionRecords.map(record => new FinancialDecimal(record.normalizedMoney!.decimal).abs());
    if (normalizedAmounts.length > 1 && new Set(normalizedAmounts.map(value => value.toFixed())).size > 1) {
      throw new Error(`Allocation is not conserved for ${dimension}`);
    }
  }
}

function dedupe<T extends { id: string }>(values: readonly T[]): T[] {
  return [...new Map(values.map(value => [value.id, value])).values()];
}

function groupBy<T, K>(values: readonly T[], keyFor: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}
