import Decimal from 'decimal.js';

import { money } from './money';
import type { EvidenceMoney } from './types';

type Provenance = Readonly<{
  economicEventId: string;
  sourceEvidenceIds: readonly string[];
}>;

export type AssetValuationV1 = Readonly<{
  provider: string;
  pair: string;
  observedAt: string;
  rate: string;
  confidence: 'verified' | 'reviewed' | 'unreviewed';
  evidenceId: string;
}>;

export type DigitalAssetAcquisitionV1 = Readonly<{
  version: 'digital-asset-event-v1';
  kind: 'acquisition';
  eventId: string;
  workspaceId: string;
  occurredAt: string;
  asset: string;
  assetId: string;
  quantity: string;
  costBasis: EvidenceMoney;
  valuation: AssetValuationV1;
  purpose: 'invoice_settlement' | 'exchange_purchase' | 'transfer_in' | 'other';
  provenance: Provenance;
}>;

export type DigitalAssetDisposalV1 = Readonly<{
  version: 'digital-asset-event-v1';
  kind: 'disposal';
  eventId: string;
  workspaceId: string;
  occurredAt: string;
  asset: string;
  assetId: string;
  quantity: string;
  proceeds: EvidenceMoney;
  fee: EvidenceMoney;
  valuation: AssetValuationV1;
  purpose: 'payroll' | 'sale' | 'invoice_refund' | 'fee' | 'other';
  provenance: Provenance;
}>;

export type DigitalAssetDisposalReversalV1 = Readonly<{
  version: 'digital-asset-event-v1';
  kind: 'disposal_reversal';
  eventId: string;
  workspaceId: string;
  occurredAt: string;
  reversesEventId: string;
  provenance: Provenance;
}>;

export type DigitalAssetEventV1 = DigitalAssetAcquisitionV1 | DigitalAssetDisposalV1 | DigitalAssetDisposalReversalV1;

export type DigitalAssetLedgerV1 = Readonly<{
  version: 'digital-asset-ledger-v1';
  workspaceId: string;
  method: 'FIFO';
  openLots: readonly Readonly<{
    acquisitionEventId: string;
    asset: string;
    assetId: string;
    acquiredAt: string;
    remainingQuantity: string;
    remainingCostBasis: EvidenceMoney;
    economicEventId: string;
    sourceEvidenceIds: readonly string[];
    valuation: AssetValuationV1;
  }>[];
  dispositions: readonly Readonly<{
    disposalEventId: string;
    asset: string;
    assetId: string;
    disposedAt: string;
    purpose: DigitalAssetDisposalV1['purpose'];
    state: 'active' | 'reversed';
    quantity: string;
    proceeds: EvidenceMoney;
    fee: EvidenceMoney;
    allocatedCostBasis: EvidenceMoney | null;
    realizedResult: EvidenceMoney | null;
    lotMatches: readonly Readonly<{
      acquisitionEventId: string;
      quantity: string;
      allocatedCostBasis: EvidenceMoney;
    }>[];
    economicEventId: string;
    sourceEvidenceIds: readonly string[];
    valuation: AssetValuationV1;
  }>[];
  reversalEventIds: readonly string[];
}>;

export function buildDigitalAssetLedger(events: readonly DigitalAssetEventV1[]): DigitalAssetLedgerV1 {
  if (events.length === 0) throw new Error('DIGITAL_ASSET_EVENTS_REQUIRED');
  const ordered = [...events].sort(compareEvents);
  const workspaceId = ordered[0]!.workspaceId;
  const eventById = new Map<string, DigitalAssetEventV1>();
  const monetaryEventByEconomicId = new Map<string, string>();
  const reversedDisposals = new Map<string, string>();

  for (const event of ordered) {
    validateEvent(event, workspaceId);
    if (eventById.has(event.eventId)) throw new Error('DIGITAL_ASSET_EVENT_ID_CONFLICT');
    if (event.kind !== 'disposal_reversal') {
      const existingEventId = monetaryEventByEconomicId.get(event.provenance.economicEventId);
      if (existingEventId && existingEventId !== event.eventId) throw new Error('DIGITAL_ASSET_ECONOMIC_EVENT_CONFLICT');
      monetaryEventByEconomicId.set(event.provenance.economicEventId, event.eventId);
    }
    if (event.kind === 'disposal_reversal') {
      const target = eventById.get(event.reversesEventId);
      if (!target || target.kind !== 'disposal') throw new Error('DIGITAL_ASSET_REVERSAL_TARGET_INVALID');
      if (reversedDisposals.has(target.eventId)) throw new Error('DIGITAL_ASSET_DISPOSAL_ALREADY_REVERSED');
      reversedDisposals.set(target.eventId, event.eventId);
    }
    eventById.set(event.eventId, event);
  }

  type MutableLot = {
    acquisition: DigitalAssetAcquisitionV1;
    originalQuantity: Decimal;
    remainingQuantity: Decimal;
    originalCostBasis: Decimal;
    remainingCostBasis: Decimal;
  };
  const lots: MutableLot[] = [];
  const activeDispositions: DigitalAssetLedgerV1['dispositions'][number][] = [];

  for (const event of ordered) {
    if (event.kind === 'acquisition') {
      lots.push({
        acquisition: event,
        originalQuantity: positive(event.quantity, 'DIGITAL_ASSET_QUANTITY_INVALID'),
        remainingQuantity: new Decimal(event.quantity),
        originalCostBasis: nonNegative(event.costBasis.decimal, 'DIGITAL_ASSET_COST_BASIS_INVALID'),
        remainingCostBasis: new Decimal(event.costBasis.decimal),
      });
      continue;
    }
    if (event.kind !== 'disposal' || reversedDisposals.has(event.eventId)) continue;
    let needed = positive(event.quantity, 'DIGITAL_ASSET_QUANTITY_INVALID');
    let allocated = new Decimal(0);
    const lotMatches: DigitalAssetLedgerV1['dispositions'][number]['lotMatches'][number][] = [];
    for (const lot of lots) {
      if (lot.acquisition.assetId !== event.assetId || lot.remainingQuantity.isZero()) continue;
      if (lot.acquisition.costBasis.currency !== event.proceeds.currency) throw new Error('DIGITAL_ASSET_QUOTE_CURRENCY_MISMATCH');
      const taken = Decimal.min(needed, lot.remainingQuantity);
      const isFinalTake = taken.equals(lot.remainingQuantity);
      const cost = isFinalTake
        ? lot.remainingCostBasis
        : lot.originalCostBasis.times(taken).div(lot.originalQuantity);
      lot.remainingQuantity = lot.remainingQuantity.minus(taken);
      lot.remainingCostBasis = lot.remainingCostBasis.minus(cost);
      allocated = allocated.plus(cost);
      needed = needed.minus(taken);
      lotMatches.push({
        acquisitionEventId: lot.acquisition.eventId,
        quantity: canonical(taken),
        allocatedCostBasis: money(cost.toFixed(), event.proceeds.currency),
      });
      if (needed.isZero()) break;
    }
    if (!needed.isZero()) throw new Error('DIGITAL_ASSET_INSUFFICIENT_LOTS');
    const result = new Decimal(event.proceeds.decimal).minus(event.fee.decimal).minus(allocated);
    activeDispositions.push({
      disposalEventId: event.eventId,
      asset: event.asset,
      assetId: event.assetId,
      disposedAt: event.occurredAt,
      purpose: event.purpose,
      state: 'active',
      quantity: canonical(new Decimal(event.quantity)),
      proceeds: money(event.proceeds.decimal, event.proceeds.currency),
      fee: money(event.fee.decimal, event.fee.currency),
      allocatedCostBasis: money(allocated.toFixed(), event.proceeds.currency),
      realizedResult: money(result.toFixed(), event.proceeds.currency),
      lotMatches,
      economicEventId: event.provenance.economicEventId,
      sourceEvidenceIds: event.provenance.sourceEvidenceIds,
      valuation: event.valuation,
    });
  }

  const activeById = new Map(activeDispositions.map(disposition => [disposition.disposalEventId, disposition]));
  const dispositions = ordered.filter((event): event is DigitalAssetDisposalV1 => event.kind === 'disposal').map(event => {
    const active = activeById.get(event.eventId);
    if (active) return active;
    return {
      disposalEventId: event.eventId,
      asset: event.asset,
      assetId: event.assetId,
      disposedAt: event.occurredAt,
      purpose: event.purpose,
      state: 'reversed' as const,
      quantity: canonical(new Decimal(event.quantity)),
      proceeds: money(event.proceeds.decimal, event.proceeds.currency),
      fee: money(event.fee.decimal, event.fee.currency),
      allocatedCostBasis: null,
      realizedResult: null,
      lotMatches: [],
      economicEventId: event.provenance.economicEventId,
      sourceEvidenceIds: event.provenance.sourceEvidenceIds,
      valuation: event.valuation,
    };
  });

  return {
    version: 'digital-asset-ledger-v1',
    workspaceId,
    method: 'FIFO',
    openLots: lots.filter(lot => !lot.remainingQuantity.isZero()).map(lot => ({
      acquisitionEventId: lot.acquisition.eventId,
      asset: lot.acquisition.asset,
      assetId: lot.acquisition.assetId,
      acquiredAt: lot.acquisition.occurredAt,
      remainingQuantity: canonical(lot.remainingQuantity),
      remainingCostBasis: money(lot.remainingCostBasis.toFixed(), lot.acquisition.costBasis.currency),
      economicEventId: lot.acquisition.provenance.economicEventId,
      sourceEvidenceIds: lot.acquisition.provenance.sourceEvidenceIds,
      valuation: lot.acquisition.valuation,
    })),
    dispositions,
    reversalEventIds: ordered.filter(event => event.kind === 'disposal_reversal').map(event => event.eventId),
  };
}

function validateEvent(event: DigitalAssetEventV1, workspaceId: string): void {
  if (event.version !== 'digital-asset-event-v1') throw new Error('DIGITAL_ASSET_EVENT_VERSION_UNSUPPORTED');
  if (event.workspaceId !== workspaceId) throw new Error('DIGITAL_ASSET_WORKSPACE_MISMATCH');
  if (!event.eventId || !event.provenance.economicEventId || event.provenance.sourceEvidenceIds.length === 0 || event.provenance.sourceEvidenceIds.some(id => !id)) throw new Error('DIGITAL_ASSET_PROVENANCE_REQUIRED');
  if (new Set(event.provenance.sourceEvidenceIds).size !== event.provenance.sourceEvidenceIds.length) throw new Error('DIGITAL_ASSET_PROVENANCE_DUPLICATED');
  if (event.kind !== 'disposal_reversal') {
    if (!/^[A-Z][A-Z0-9._-]{1,15}$/.test(event.asset)) throw new Error('DIGITAL_ASSET_SYMBOL_INVALID');
    if (!/^[a-z0-9][a-z0-9:._/-]{2,191}$/.test(event.assetId)) throw new Error('DIGITAL_ASSET_ID_INVALID');
    validateValuation(event.valuation, event.occurredAt, event.asset, event.kind === 'acquisition' ? event.costBasis.currency : event.proceeds.currency);
  }
  if (!Number.isFinite(Date.parse(event.occurredAt)) || !/[zZ]|[+-]\d\d:\d\d$/.test(event.occurredAt)) throw new Error('DIGITAL_ASSET_TIMESTAMP_INVALID');
  if (event.kind === 'disposal') {
    if (event.proceeds.currency !== event.fee.currency) throw new Error('DIGITAL_ASSET_QUOTE_CURRENCY_MISMATCH');
    nonNegative(event.proceeds.decimal, 'DIGITAL_ASSET_PROCEEDS_INVALID');
    nonNegative(event.fee.decimal, 'DIGITAL_ASSET_FEE_INVALID');
  }
}

function validateValuation(valuation: AssetValuationV1, occurredAt: string, asset: string, quoteCurrency: string): void {
  if (!valuation.provider || !valuation.pair || !valuation.evidenceId) throw new Error('DIGITAL_ASSET_VALUATION_PROVENANCE_REQUIRED');
  if (valuation.pair !== `${asset}/${quoteCurrency}`) throw new Error('DIGITAL_ASSET_VALUATION_PAIR_MISMATCH');
  if (!Number.isFinite(Date.parse(valuation.observedAt)) || !/[zZ]|[+-]\d\d:\d\d$/.test(valuation.observedAt)) throw new Error('DIGITAL_ASSET_VALUATION_TIMESTAMP_INVALID');
  if (Date.parse(valuation.observedAt) > Date.parse(occurredAt)) throw new Error('DIGITAL_ASSET_VALUATION_FROM_FUTURE');
  positive(valuation.rate, 'DIGITAL_ASSET_VALUATION_RATE_INVALID');
}

function compareEvents(left: DigitalAssetEventV1, right: DigitalAssetEventV1): number {
  const instant = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  return instant || left.eventId.localeCompare(right.eventId);
}

function positive(value: string, error: string): Decimal {
  const decimal = decimalValue(value, error);
  if (!decimal.isPositive()) throw new Error(error);
  return decimal;
}

function nonNegative(value: string, error: string): Decimal {
  const decimal = decimalValue(value, error);
  if (decimal.isNegative()) throw new Error(error);
  return decimal;
}

function decimalValue(value: string, error: string): Decimal {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(error);
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) throw new Error(error);
  return decimal;
}

function canonical(value: Decimal): string {
  return value.toFixed();
}
