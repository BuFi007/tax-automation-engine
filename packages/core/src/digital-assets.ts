import Decimal from 'decimal.js';
import { createHash } from 'node:crypto';

import { assertActiveAccountantMandate, type AccountantMandateV1 } from './accountant-mandate';
import { money } from './money';
import type { EvidenceMoney, Period } from './types';

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
  builtThrough: string;
  eventManifest: readonly Readonly<{
    eventId: string;
    kind: DigitalAssetEventV1['kind'];
    occurredAt: string;
    economicEventId: string;
    sourceEvidenceIds: readonly string[];
    valuationEvidenceId: string | null;
    reversesEventId: string | null;
  }>[];
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

export type DigitalAssetAccountantPackageV1 = Readonly<{
  version: 'digital-asset-accountant-package-v1';
  workspaceId: string;
  period: Period;
  method: DigitalAssetLedgerV1['method'];
  evidenceCoverageThrough: string;
  coverageState: 'complete' | 'partial';
  preparedAt: string;
  accountantAuthority: Readonly<{
    mandateId: string;
    accountantActorId: string;
    accountantOrganizationId: string;
  }>;
  files: readonly Readonly<{
    fileName: 'holdings.csv' | 'dispositions.csv' | 'lot-matches.csv' | 'source-manifest.csv';
    mediaType: 'text/csv';
    rowCount: number;
    sha256: string;
    contents: string;
  }>[];
  limitations: readonly ('ACCOUNTANT_REVIEW_REQUIRED' | 'JURISDICTION_CLASSIFICATION_NOT_INFERRED' | 'PARTIAL_EVIDENCE_COVERAGE')[];
  packageHash: string;
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
    builtThrough: ordered.at(-1)!.occurredAt,
    eventManifest: ordered.map(event => ({
      eventId: event.eventId,
      kind: event.kind,
      occurredAt: event.occurredAt,
      economicEventId: event.provenance.economicEventId,
      sourceEvidenceIds: [...event.provenance.sourceEvidenceIds].sort(),
      valuationEvidenceId: event.kind === 'disposal_reversal' ? null : event.valuation.evidenceId,
      reversesEventId: event.kind === 'disposal_reversal' ? event.reversesEventId : null,
    })),
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

export function buildDigitalAssetAccountantPackage(input: Readonly<{
  ledger: DigitalAssetLedgerV1;
  period: Period;
  evidenceCoverageThrough: string;
  preparedAt: string;
  accountantActorId: string;
  mandate: AccountantMandateV1;
}>): DigitalAssetAccountantPackageV1 {
  const periodStart = utcPeriodBoundary(input.period.start, 'start');
  const periodEnd = utcPeriodBoundary(input.period.end, 'end');
  if (periodStart > periodEnd) throw new Error('DIGITAL_ASSET_EXPORT_PERIOD_INVALID');
  const coverageThrough = instant(input.evidenceCoverageThrough, 'DIGITAL_ASSET_EXPORT_COVERAGE_INVALID');
  const preparedAt = instant(input.preparedAt, 'DIGITAL_ASSET_EXPORT_PREPARED_AT_INVALID');
  const builtThrough = instant(input.ledger.builtThrough, 'DIGITAL_ASSET_LEDGER_BUILT_THROUGH_INVALID');
  if (coverageThrough < builtThrough) throw new Error('DIGITAL_ASSET_EXPORT_COVERAGE_BEFORE_LEDGER');
  if (coverageThrough > periodEnd) throw new Error('DIGITAL_ASSET_EXPORT_COVERAGE_AFTER_PERIOD');
  if (coverageThrough > preparedAt) throw new Error('DIGITAL_ASSET_EXPORT_COVERAGE_FROM_FUTURE');
  assertActiveAccountantMandate(input.mandate, {
    workspaceId: input.ledger.workspaceId,
    accountantActorId: input.accountantActorId,
    scope: 'export_accountant_packet',
    at: input.preparedAt,
  });

  const holdingsRows = input.ledger.openLots
    .filter(lot => Date.parse(lot.acquiredAt) <= coverageThrough)
    .sort((left, right) => left.assetId.localeCompare(right.assetId) || left.acquiredAt.localeCompare(right.acquiredAt) || left.acquisitionEventId.localeCompare(right.acquisitionEventId))
    .map(lot => [
      lot.asset,
      lot.assetId,
      lot.acquisitionEventId,
      lot.acquiredAt,
      lot.remainingQuantity,
      lot.remainingCostBasis.decimal,
      lot.remainingCostBasis.currency,
      lot.valuation.provider,
      lot.valuation.pair,
      lot.valuation.observedAt,
      lot.valuation.rate,
      lot.valuation.confidence,
      lot.valuation.evidenceId,
    ]);
  const periodDispositions = input.ledger.dispositions
    .filter(disposition => {
      const occurredAt = Date.parse(disposition.disposedAt);
      return occurredAt >= periodStart && occurredAt <= coverageThrough;
    })
    .sort((left, right) => left.disposedAt.localeCompare(right.disposedAt) || left.disposalEventId.localeCompare(right.disposalEventId));
  const dispositionRows = periodDispositions.map(disposition => [
    disposition.disposalEventId,
    disposition.disposedAt,
    disposition.asset,
    disposition.assetId,
    disposition.purpose,
    disposition.state,
    disposition.quantity,
    disposition.proceeds.decimal,
    disposition.proceeds.currency,
    disposition.fee.decimal,
    disposition.allocatedCostBasis?.decimal ?? '',
    disposition.realizedResult?.decimal ?? '',
    disposition.economicEventId,
    disposition.valuation.provider,
    disposition.valuation.pair,
    disposition.valuation.observedAt,
    disposition.valuation.rate,
    disposition.valuation.confidence,
    disposition.valuation.evidenceId,
  ]);
  const lotMatchRows = periodDispositions.flatMap(disposition => disposition.lotMatches.map(match => [
    disposition.disposalEventId,
    match.acquisitionEventId,
    match.quantity,
    match.allocatedCostBasis.decimal,
    match.allocatedCostBasis.currency,
  ])).sort(compareRows);
  const includedEventIds = new Set([
    ...input.ledger.openLots.filter(lot => Date.parse(lot.acquiredAt) <= coverageThrough).map(lot => lot.acquisitionEventId),
    ...periodDispositions.map(disposition => disposition.disposalEventId),
    ...periodDispositions.flatMap(disposition => disposition.lotMatches.map(match => match.acquisitionEventId)),
  ]);
  for (const event of input.ledger.eventManifest) {
    if (event.kind === 'disposal_reversal' && event.reversesEventId && includedEventIds.has(event.reversesEventId)) {
      includedEventIds.add(event.eventId);
    }
  }
  const sourceRows = input.ledger.eventManifest
    .filter(event => includedEventIds.has(event.eventId) && Date.parse(event.occurredAt) <= coverageThrough)
    .flatMap(event => [
      ...event.sourceEvidenceIds.map(evidenceId => [event.eventId, event.kind, event.occurredAt, event.economicEventId, 'source_event', evidenceId, event.reversesEventId ?? '']),
      ...(event.valuationEvidenceId ? [[event.eventId, event.kind, event.occurredAt, event.economicEventId, 'historical_valuation', event.valuationEvidenceId, '']] : []),
    ])
    .sort(compareRows);

  const files = [
    csvFile('holdings.csv', ['asset', 'asset_id', 'acquisition_event_id', 'acquired_at', 'remaining_quantity', 'remaining_cost_basis', 'cost_basis_currency', 'valuation_provider', 'valuation_pair', 'valuation_observed_at', 'valuation_rate', 'valuation_confidence', 'valuation_evidence_id'], holdingsRows),
    csvFile('dispositions.csv', ['disposal_event_id', 'disposed_at', 'asset', 'asset_id', 'purpose', 'state', 'quantity', 'proceeds', 'currency', 'fee', 'allocated_cost_basis', 'realized_result', 'economic_event_id', 'valuation_provider', 'valuation_pair', 'valuation_observed_at', 'valuation_rate', 'valuation_confidence', 'valuation_evidence_id'], dispositionRows),
    csvFile('lot-matches.csv', ['disposal_event_id', 'acquisition_event_id', 'quantity', 'allocated_cost_basis', 'currency'], lotMatchRows),
    csvFile('source-manifest.csv', ['event_id', 'event_kind', 'occurred_at', 'economic_event_id', 'evidence_role', 'evidence_id', 'reverses_event_id'], sourceRows),
  ] as const;
  const coverageState: DigitalAssetAccountantPackageV1['coverageState'] = coverageThrough === periodEnd ? 'complete' : 'partial';
  const limitations: DigitalAssetAccountantPackageV1['limitations'] = [
    'ACCOUNTANT_REVIEW_REQUIRED',
    'JURISDICTION_CLASSIFICATION_NOT_INFERRED',
    ...(coverageState === 'partial' ? ['PARTIAL_EVIDENCE_COVERAGE' as const] : []),
  ];
  const packageWithoutHash = {
    version: 'digital-asset-accountant-package-v1' as const,
    workspaceId: input.ledger.workspaceId,
    period: input.period,
    method: input.ledger.method,
    evidenceCoverageThrough: input.evidenceCoverageThrough,
    coverageState,
    preparedAt: input.preparedAt,
    accountantAuthority: {
      mandateId: input.mandate.mandateId,
      accountantActorId: input.accountantActorId,
      accountantOrganizationId: input.mandate.accountantOrganizationId,
    },
    files,
    limitations,
  };
  return { ...packageWithoutHash, packageHash: sha256(JSON.stringify(packageWithoutHash)) };
}

function csvFile<Name extends DigitalAssetAccountantPackageV1['files'][number]['fileName']>(
  fileName: Name,
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): DigitalAssetAccountantPackageV1['files'][number] {
  const contents = [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  return { fileName, mediaType: 'text/csv', rowCount: rows.length, sha256: sha256(contents), contents };
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function compareRows(left: readonly string[], right: readonly string[]): number {
  return left.join('\u0000').localeCompare(right.join('\u0000'));
}

function utcPeriodBoundary(value: string, edge: 'start' | 'end'): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('DIGITAL_ASSET_EXPORT_PERIOD_INVALID');
  const suffix = edge === 'start' ? 'T00:00:00.000Z' : 'T23:59:59.999Z';
  const parsed = Date.parse(`${value}${suffix}`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) throw new Error('DIGITAL_ASSET_EXPORT_PERIOD_INVALID');
  return parsed;
}

function instant(value: string, error: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) throw new Error(error);
  return parsed;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateEvent(event: DigitalAssetEventV1, workspaceId: string): void {
  if (event.version !== 'digital-asset-event-v1') throw new Error('DIGITAL_ASSET_EVENT_VERSION_UNSUPPORTED');
  if (event.workspaceId !== workspaceId) throw new Error('DIGITAL_ASSET_WORKSPACE_MISMATCH');
  if (!isSafeReference(event.eventId) || !isSafeReference(event.provenance.economicEventId)
    || event.provenance.sourceEvidenceIds.length === 0
    || event.provenance.sourceEvidenceIds.some(id => !isSafeReference(id))) {
    throw new Error('DIGITAL_ASSET_PROVENANCE_REQUIRED');
  }
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
  if (!isSafeReference(valuation.provider) || !valuation.pair || !isSafeReference(valuation.evidenceId)) {
    throw new Error('DIGITAL_ASSET_VALUATION_PROVENANCE_REQUIRED');
  }
  // A deterministic lot cannot be built from an unaudited quote. `reviewed`
  // is the explicit accountant/provider-review path; `verified` is a native
  // provider fact. A model proposal must stay an evidence gap, never a lot.
  if (valuation.confidence === 'unreviewed') throw new Error('DIGITAL_ASSET_VALUATION_VERIFICATION_REQUIRED');
  if (valuation.pair !== `${asset}/${quoteCurrency}`) throw new Error('DIGITAL_ASSET_VALUATION_PAIR_MISMATCH');
  if (!Number.isFinite(Date.parse(valuation.observedAt)) || !/[zZ]|[+-]\d\d:\d\d$/.test(valuation.observedAt)) throw new Error('DIGITAL_ASSET_VALUATION_TIMESTAMP_INVALID');
  if (Date.parse(valuation.observedAt) > Date.parse(occurredAt)) throw new Error('DIGITAL_ASSET_VALUATION_FROM_FUTURE');
  positive(valuation.rate, 'DIGITAL_ASSET_VALUATION_RATE_INVALID');
}

function isSafeReference(value: string): boolean {
  // A raw EVM address is recognizable even when it otherwise fits the opaque
  // reference grammar. It belongs in the external verifier, never in Tax's
  // ledger provenance or accountant packet.
  return /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,191}$/.test(value)
    && !/^0x[0-9a-fA-F]{40}$/.test(value);
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
