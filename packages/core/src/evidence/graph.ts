import { createHash } from 'node:crypto';
import Decimal from 'decimal.js';

import type { CanonicalFinancialEvidenceGraph, EvidenceEdge, EvidenceGap, EvidenceNode, TaxEvidenceRecord } from './types';

export function buildEvidenceGraph(workspaceId: string, records: readonly TaxEvidenceRecord[]): CanonicalFinancialEvidenceGraph {
  const accepted = records.filter(record => record.reviewState === 'accepted');
  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];
  const gaps: EvidenceGap[] = [];

  for (const record of records) {
    nodes.push(
      { id: `artifact:${record.evidenceId}`, kind: 'source_artifact', safeLabel: record.sourceKind },
      { id: `event:${record.economicEventId}`, kind: 'financial_event', safeLabel: record.economicRole }
    );
    edges.push({
      id: `edge:represents:${record.evidenceId}`,
      from: `artifact:${record.evidenceId}`,
      to: `event:${record.economicEventId}`,
      kind: 'represents',
      allocation: record.money,
      derivation: record.reviewState === 'accepted' ? 'deterministic_rule' : 'suggested',
      reviewState: record.reviewState,
    });
  }

  const byEvent = groupBy(records, record => record.economicEventId);
  for (const [eventId, eventRecords] of byEvent) {
    const roles = new Set(eventRecords.map(record => record.economicRole));
    const acceptedRoles = new Set(eventRecords.filter(record => record.reviewState === 'accepted').map(record => record.economicRole));
    if (roles.has('settlement') && !roles.has('invoice')) gaps.push(gap('payout_without_invoice', eventId, eventRecords, 'warning'));
    if (roles.has('expense') && !acceptedRoles.has('receipt')) gaps.push(gap('expense_without_receipt', eventId, eventRecords, 'warning'));
    if (eventRecords.some(record => record.jurisdiction === 'AR' && record.economicRole === 'invoice') && !acceptedRoles.has('settlement')) {
      gaps.push(gap('factura_e_without_collection_evidence', eventId, eventRecords, 'blocking'));
    }
    const partyClaims = new Set(eventRecords.map(record => record.partyClaimHash).filter(Boolean));
    if (partyClaims.size > 1 && eventRecords.some(record => record.sourceKind === 'accounting')) {
      gaps.push(gap('accounting_counterparty_mismatch', eventId, eventRecords, 'warning'));
    }
    assertAllocationConservation(eventRecords);
  }

  const revision = createHash('sha256')
    .update([...accepted].sort((a, b) => a.idempotencyKey.localeCompare(b.idempotencyKey)).map(record => record.idempotencyKey).join('\n'))
    .digest('hex');
  return { version: 'financial-evidence-graph-v1', workspaceId, revision, nodes: dedupe(nodes), edges, gaps };
}

function gap(kind: EvidenceGap['kind'], eventId: string, records: readonly TaxEvidenceRecord[], severity: EvidenceGap['severity']): EvidenceGap {
  return {
    id: `gap:${kind}:${eventId}`,
    kind,
    severity,
    economicEventId: eventId,
    safeSourceReferenceIds: records.map(record => `source:${record.sourceId}`),
    actionId: `action:resolve:${kind}:${eventId}`,
  };
}

function assertAllocationConservation(records: readonly TaxEvidenceRecord[]): void {
  const accepted = records.filter(record => record.reviewState === 'accepted' && record.money);
  const byDimension = groupBy(accepted, record => record.countingDimension);
  for (const [dimension, dimensionRecords] of byDimension) {
    if (dimension === 'none' || dimension === 'cash') continue;
    const currencies = new Set(dimensionRecords.map(record => record.money!.currency));
    if (currencies.size > 1) throw new Error(`Mixed currencies in event allocation for ${dimension}`);
    const amounts = dimensionRecords.map(record => new Decimal(record.money!.decimal).abs());
    if (amounts.length > 1 && new Set(amounts.map(value => value.toFixed())).size > 1) {
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
