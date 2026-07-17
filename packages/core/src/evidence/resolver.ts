import { createHash } from 'node:crypto';

import { buildCapabilityManifest } from '../capabilities';
import { FinancialDecimal, isFinancialDecimal } from '../financial-decimal';
import { addMoney, money } from '../money';
import type { EvidenceMoney, TaxConsentGrant, TaxConclusionEnvelopeV1 } from '../types';
import { hashTaxEvidenceRecord, isActiveTaxEvidenceRecord, resolveActiveEvidenceRecords } from './batch';
import { buildEvidenceGraph } from './graph';
import { calculateTaxEvidenceQualityV1 } from './quality';
import type {
  SafeFact,
  TaxEvidenceAdapterCapabilityResult,
  TaxEvidenceAdapterContext,
  TaxEvidencePresentationProjectionV1,
  TaxEvidenceRecord,
  TaxEvidenceSourceAdapter,
  TaxSourceKind,
  TaxSourceCoverage,
} from './types';

const PAGE_SIZE = 500;
const MAX_PAGES_PER_SOURCE = 1_000;
const TAX_EVIDENCE_ACTUALS_RULE_VERSION = 'tax-evidence-actuals-v1';

export type TaxFactEvidenceReceiptV2Input = Readonly<{
  conclusionId: string;
  value: SafeFact['value'];
  period: TaxEvidenceAdapterContext['period'];
  asOf: TaxEvidenceAdapterContext['asOf'];
  resolvedScope: TaxEvidenceAdapterContext['dataScope'];
  consent: TaxConclusionEnvelopeV1<unknown>['consent'];
  ruleVersionIds: readonly string[];
  upstreamBundleHash: string;
  records: readonly Readonly<{
    idempotencyKey: string;
    revision: string;
    recordHash: string;
  }>[];
}>;

export function hashTaxFactEvidenceReceiptV2(input: TaxFactEvidenceReceiptV2Input): string {
  return createHash('sha256').update(JSON.stringify({
    version: 'tax-fact-evidence-v2',
    conclusionId: input.conclusionId,
    value: input.value,
    period: input.period,
    asOf: input.asOf,
    resolvedScope: input.resolvedScope,
    consent: input.consent,
    ruleVersionIds: input.ruleVersionIds,
    upstreamBundleHash: input.upstreamBundleHash,
    records: input.records,
  })).digest('hex');
}

export class TaxEvidenceResolver {
  readonly #adapters: readonly TaxEvidenceSourceAdapter[];

  constructor(adapters: readonly TaxEvidenceSourceAdapter[]) {
    this.#adapters = adapters;
  }

  async resolve(context: TaxEvidenceAdapterContext): Promise<TaxEvidencePresentationProjectionV1> {
    const observedRecords: TaxEvidenceRecord[] = [];
    const lineageRecords: TaxEvidenceRecord[] = [];
    const periodRecords: TaxEvidenceRecord[] = [];
    const sources: TaxSourceCoverage[] = [];
    const sourceRevisions: string[] = [];

    for (const adapter of this.#adapters) {
      if (context.dataScope.mode === 'selected') {
        if (adapter.sourceKind === 'knowledge_graph' && !context.dataScope.includeKnowledgeGraph) continue;
        if (adapter.sourceKind !== 'knowledge_graph' && !context.dataScope.sourceIds.includes(adapter.adapterId)) continue;
      }
      const resolved = await readAdapter(adapter, context);
      if (!resolved.ok) {
        sources.push({
          sourceId: adapter.adapterId,
          kind: adapter.sourceKind,
          providerId: null,
          displayName: adapter.adapterId,
          capabilities: resolved.capabilities,
          connectionState: 'failed',
          lastSuccessfulSyncAt: null,
          recordsScanned: 0,
          acceptedEvidenceCount: 0,
          needsReviewCount: 0,
          safeErrorCode: resolved.safeErrorCode,
        });
        continue;
      }

      const activeAsOf = resolveActiveEvidenceRecords(resolved.records, { requireTargets: false })
        .filter(record => instant(record.observedAt) <= instant(context.asOf)
          && (!record.expiresAt || instant(record.expiresAt) > instant(context.asOf)));
      observedRecords.push(...resolveActiveEvidenceRecords(resolved.records, { requireTargets: false })
        .filter(record => instant(record.observedAt) <= instant(context.asOf)));
      const activeInPeriod = activeAsOf.filter(record => periodsOverlap(record.period, context.period));
      lineageRecords.push(...activeAsOf);
      periodRecords.push(...activeInPeriod);
      sourceRevisions.push(`${resolved.sourceId}:${resolved.checkpoint.revision}:${resolved.checkpoint.observedAt}`);
      sources.push({
        sourceId: resolved.sourceId,
        kind: adapter.sourceKind,
        providerId: resolved.canonicalProviderId,
        displayName: resolved.canonicalProviderId ?? resolved.sourceId,
        capabilities: resolved.capabilities,
        connectionState: connectionState(resolved.capabilities),
        lastSuccessfulSyncAt: resolved.checkpoint.observedAt,
        recordsScanned: activeInPeriod.length,
        acceptedEvidenceCount: activeInPeriod.filter(record => record.reviewState === 'accepted' && isActiveTaxEvidenceRecord(record)).length,
        needsReviewCount: activeInPeriod.filter(record => record.reviewState === 'unreviewed'
          || record.validityState === 'disputed'
          || (record.reviewState === 'accepted' && recordConfidenceNeedsReview(record))).length,
        safeErrorCode: capabilityError(resolved.capabilities),
      });
    }

    if (context.dataScope.mode === 'selected') {
      const configuredAdapterIds = new Set(this.#adapters.map(adapter => adapter.adapterId));
      for (const sourceId of [...new Set(context.dataScope.sourceIds)].sort()) {
        const configured = this.#adapters.find(adapter => adapter.adapterId === sourceId);
        if (configured?.sourceKind === 'knowledge_graph' && !context.dataScope.includeKnowledgeGraph) continue;
        if (configuredAdapterIds.has(sourceId)) continue;
        sources.push({
          sourceId,
          kind: 'unknown',
          providerId: null,
          displayName: sourceId,
          capabilities: [],
          connectionState: 'not_connected',
          lastSuccessfulSyncAt: null,
          recordsScanned: 0,
          acceptedEvidenceCount: 0,
          needsReviewCount: 0,
          safeErrorCode: 'EVIDENCE_SOURCE_NOT_CONNECTED',
        });
      }
    }
    sources.sort((left, right) => left.sourceId.localeCompare(right.sourceId));

    const activeLineageRecords = resolveActiveEvidenceRecords(lineageRecords, { requireTargets: false });
    const activeRecords = resolveActiveEvidenceRecords(periodRecords, { requireTargets: false });
    const acceptedLineage = activeLineageRecords.filter(record => record.reviewState === 'accepted' && isActiveTaxEvidenceRecord(record));
    const accepted = activeRecords.filter(record => record.reviewState === 'accepted' && isActiveTaxEvidenceRecord(record));
    const invoiceEvidence = accepted.filter(record => record.economicRole === 'invoice' && record.countingDimension === 'revenue');
    const lineageInvoiceEvidence = acceptedLineage.filter(record => record.economicRole === 'invoice' && record.countingDimension === 'revenue');
    const expenseEvidence = accepted.filter(record => record.economicRole === 'expense' && record.countingDimension === 'expense');
    const fxEvidenceById = new Map(acceptedLineage
      .filter(record => record.sourceKind === 'fx')
      .map(record => [record.idempotencyKey, record]));
    const adjustmentValidation = validateInvoiceAdjustments(invoiceEvidence, lineageInvoiceEvidence);
    const countableInvoiceEvidence = adjustmentValidation.records;
    const adjustmentTargets = [...new Map(
      [...adjustmentValidation.targetsByAdjustmentKey.values()].map(record => [record.idempotencyKey, record]),
    ).values()];
    const adjustmentTargetEventIds = new Set(adjustmentTargets.map(record => record.economicEventId));
    const adjustmentLineageRecords = activeLineageRecords.filter(record => adjustmentTargetEventIds.has(record.economicEventId));
    const graph = buildEvidenceGraph(context.workspaceId, dedupeEvidenceRecords([...activeRecords, ...adjustmentLineageRecords]));
    const invoiceFxEvidence = resolveFxEvidence([...countableInvoiceEvidence, ...adjustmentTargets], fxEvidenceById);
    const expenseFxEvidence = resolveFxEvidence(expenseEvidence, fxEvidenceById);
    const invoiceRecords = uniqueEconomicRole(countableInvoiceEvidence);
    const expenseRecords = uniqueEconomicRole(expenseEvidence);
    const acceptedRolesByEvent = groupRolesByEvent(acceptedLineage);
    const currency = context.displayCurrency;
    const invoiced = sumNormalizedOrNull(invoiceRecords, currency);
    const reconciledInvoiceRecords = invoiceRecords.filter(record => {
        const roles = acceptedRolesByEvent.get(record.economicEventId);
        if (record.invoiceAdjustmentKind === 'credit') {
          return Boolean(record.adjustsEconomicEventId
            && acceptedRolesByEvent.get(record.adjustsEconomicEventId)?.has('settlement'));
        }
        return Boolean(roles?.has('settlement'));
      });
    const reconciled = sumNormalizedOrNull(reconciledInvoiceRecords, currency);
    const reconciledAdjustmentTargets = reconciledInvoiceRecords
      .map(record => adjustmentValidation.targetsByAdjustmentKey.get(record.idempotencyKey))
      .filter((record): record is TaxEvidenceRecord => record !== undefined);
    const reconciledFxEvidence = resolveFxEvidence(
      [...reconciledInvoiceRecords, ...reconciledAdjustmentTargets],
      fxEvidenceById,
    );
    const recordedExpenses = sumNormalizedOrNull(expenseRecords, currency);
    const supportedExpenseRecords = expenseRecords.filter(record => acceptedRolesByEvent.get(record.economicEventId)?.has('receipt'));
    const supportedExpenses = sumNormalizedOrNull(supportedExpenseRecords, currency);
    const supportedExpenseFxEvidence = resolveFxEvidence(supportedExpenseRecords, fxEvidenceById);
    const reconciledInvoiceEventIds = new Set(reconciledInvoiceRecords.map(record => record.economicEventId));
    const reconciledSettlementEventIds = new Set(reconciledInvoiceRecords.map(record => (
      record.invoiceAdjustmentKind === 'credit' ? record.adjustsEconomicEventId! : record.economicEventId
    )));
    const supportedExpenseEventIds = new Set(supportedExpenseRecords.map(record => record.economicEventId));
    const countableInvoiceKeys = new Set(countableInvoiceEvidence.map(record => record.idempotencyKey));
    const reconciledAdjustmentTargetKeys = new Set(reconciledAdjustmentTargets.map(record => record.idempotencyKey));
    const reconciliationEvidence = acceptedLineage.filter(record => (record.economicRole === 'invoice'
      && countableInvoiceKeys.has(record.idempotencyKey)
      && reconciledInvoiceEventIds.has(record.economicEventId))
      || (record.economicRole === 'invoice' && reconciledAdjustmentTargetKeys.has(record.idempotencyKey))
      || (record.economicRole === 'settlement' && reconciledSettlementEventIds.has(record.economicEventId)));
    const expenseSupportEvidence = accepted.filter(record => supportedExpenseEventIds.has(record.economicEventId)
      && (record.economicRole === 'expense' || record.economicRole === 'receipt'));
    const bundleHash = createHash('sha256')
      .update(JSON.stringify({
        graphRevision: graph.revision,
        period: context.period,
        displayCurrency: context.displayCurrency,
        asOf: context.asOf,
        scope: context.dataScope.mode === 'all_connected'
          ? { mode: 'all_connected' }
          : {
              mode: 'selected',
              sourceIds: [...new Set(context.dataScope.sourceIds)].sort(),
              includeKnowledgeGraph: context.dataScope.includeKnowledgeGraph,
            },
        sourceRevisions: sourceRevisions.sort(),
        activeRecordLineage: dedupeEvidenceRecords([
          ...activeRecords,
          ...adjustmentLineageRecords,
          ...invoiceFxEvidence,
          ...expenseFxEvidence,
          ...supportedExpenseFxEvidence,
        ])
          .map(record => ({ idempotencyKey: record.idempotencyKey, hash: hashTaxEvidenceRecord(record) }))
          .sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey)),
        consentLineage: context.consentGrants
          .map(grant => ({
            purpose: grant.purpose,
            version: grant.version,
            scopeIds: [...grant.scopeIds].sort(),
            scopeHash: grant.scopeHash,
            grantedAt: grant.grantedAt,
            expiresAt: grant.expiresAt,
            revokedAt: grant.revokedAt,
          }))
          .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        manifests: sources.map(source => ({
          sourceId: source.sourceId,
          providerId: source.providerId,
          state: source.connectionState,
          recordsScanned: source.recordsScanned,
          acceptedEvidenceCount: source.acceptedEvidenceCount,
          needsReviewCount: source.needsReviewCount,
          capabilities: source.capabilities,
          safeErrorCode: source.safeErrorCode,
        })).sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
      }))
      .digest('hex');
    const safeFacts: SafeFact[] = [
      fact('fact:revenue:invoiced', 'invoiced_revenue', invoiced?.decimal ?? null, currency, context, [...countableInvoiceEvidence, ...adjustmentTargets, ...invoiceFxEvidence], bundleHash),
      fact('fact:revenue:reconciled', 'reconciled_revenue', reconciled?.decimal ?? null, currency, context, [...reconciliationEvidence, ...reconciledFxEvidence], bundleHash),
      fact('fact:expenses:recorded', 'recorded_expenses', recordedExpenses?.decimal ?? null, currency, context, [...expenseEvidence, ...expenseFxEvidence], bundleHash),
      fact('fact:expenses:supported', 'supported_expenses', supportedExpenses?.decimal ?? null, currency, context, [...expenseSupportEvidence, ...supportedExpenseFxEvidence], bundleHash),
    ];
    const limitations = sources
      .filter(source => source.connectionState !== 'connected')
      .map(source => `Source ${source.displayName} is ${source.connectionState}`);
    limitations.push(...sources
      .filter(source => source.needsReviewCount > 0)
      .map(source => `Source ${source.displayName} has ${source.needsReviewCount} evidence record(s) with missing, low-confidence, or unresolved review state.`));
    if (sources.length === 0) limitations.push('No connected evidence sources are available for this scope.');

    const validUntil = earliestTimestamp(dedupeEvidenceRecords([
      ...activeRecords,
      ...adjustmentLineageRecords,
      ...invoiceFxEvidence,
      ...expenseFxEvidence,
      ...supportedExpenseFxEvidence,
    ]).map(record => record.expiresAt).filter((value): value is string => value !== null));
    const evidenceQuality = calculateTaxEvidenceQualityV1({
      context,
      sources,
      records: dedupeEvidenceRecords(observedRecords),
      activePeriodRecords: activeRecords,
      gapCount: graph.gaps.length,
    });

    return {
      version: 'tax-evidence-presentation-v1',
      upstreamBundleHash: bundleHash,
      period: context.period,
      resolvedScope: context.dataScope,
      displayCurrency: currency,
      asOf: context.asOf,
      validUntil,
      capabilityManifest: buildCapabilityManifest(
        sources.length === 0 || sources.some(source => source.connectionState === 'failed' || source.connectionState === 'not_connected')
          ? 'failed'
          : sources.some(source => source.connectionState !== 'connected')
            ? 'partial'
            : 'available',
      ),
      sources,
      safeFacts,
      evidenceCoverage: {
        revenue: { invoiced, reconciled },
        expenses: { recorded: recordedExpenses, supported: supportedExpenses },
        obligations: { applicable: 0, mapped: 0 },
        gaps: graph.gaps,
      },
      evidenceQuality,
      limitations,
    };
  }
}

type ResolvedAdapter = Readonly<{
  ok: true;
  sourceId: string;
  canonicalProviderId: string | null;
  records: readonly TaxEvidenceRecord[];
  capabilities: readonly TaxEvidenceAdapterCapabilityResult[];
  checkpoint: Readonly<{ revision: string; observedAt: string }>;
}> | Readonly<{
  ok: false;
  safeErrorCode: string;
  capabilities: readonly TaxEvidenceAdapterCapabilityResult[];
}>;

async function readAdapter(adapter: TaxEvidenceSourceAdapter, context: TaxEvidenceAdapterContext): Promise<ResolvedAdapter> {
  const records: TaxEvidenceRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor: Readonly<{ value: string; version: string }> | null = null;
  let identity: Readonly<{
    sourceId: string;
    canonicalProviderId: string | null;
    adapterSchemaVersion: string;
    capabilities: readonly TaxEvidenceAdapterCapabilityResult[];
    checkpoint: Readonly<{ revision: string; observedAt: string }>;
  }> | null = null;

  for (let pageNumber = 0; pageNumber < MAX_PAGES_PER_SOURCE; pageNumber += 1) {
    let result: Awaited<ReturnType<TaxEvidenceSourceAdapter['readPage']>>;
    try {
      result = await adapter.readPage(context, { cursor, pageSize: PAGE_SIZE });
    } catch {
      return { ok: false, safeErrorCode: 'EVIDENCE_ADAPTER_FAILED', capabilities: identity?.capabilities ?? [] };
    }
    if (!result.ok) return { ok: false, safeErrorCode: result.safeErrorCode, capabilities: result.capabilities };
    const page = result.page;
    if (page.records.length > PAGE_SIZE) return { ok: false, safeErrorCode: 'EVIDENCE_PAGE_LIMIT_EXCEEDED', capabilities: page.capabilities };
    if (!identity) {
      identity = {
        sourceId: page.sourceId,
        canonicalProviderId: page.canonicalProviderId,
        adapterSchemaVersion: page.adapterSchemaVersion,
        capabilities: page.capabilities,
        checkpoint: page.sourceCheckpoint,
      };
    } else if (identity.sourceId !== page.sourceId
      || identity.canonicalProviderId !== page.canonicalProviderId
      || identity.adapterSchemaVersion !== page.adapterSchemaVersion
      || identity.checkpoint.revision !== page.sourceCheckpoint.revision
      || identity.checkpoint.observedAt !== page.sourceCheckpoint.observedAt
      || JSON.stringify(identity.capabilities) !== JSON.stringify(page.capabilities)) {
      return { ok: false, safeErrorCode: 'EVIDENCE_PAGE_SNAPSHOT_CHANGED', capabilities: page.capabilities };
    }
    if (page.records.some(record => record.workspaceId !== context.workspaceId
      || record.sourceId !== page.sourceId
      || record.sourceKind !== adapter.sourceKind
      || record.canonicalProviderId !== page.canonicalProviderId)) {
      return { ok: false, safeErrorCode: 'EVIDENCE_PAGE_SCOPE_MISMATCH', capabilities: page.capabilities };
    }
    records.push(...page.records);
    if (!page.nextCursor) {
      return {
        ok: true,
        sourceId: identity.sourceId,
        canonicalProviderId: identity.canonicalProviderId,
        records,
        capabilities: identity.capabilities,
        checkpoint: identity.checkpoint,
      };
    }
    const cursorKey = `${page.nextCursor.version}:${page.nextCursor.value}`;
    if (seenCursors.has(cursorKey)) return { ok: false, safeErrorCode: 'EVIDENCE_CURSOR_LOOP', capabilities: page.capabilities };
    seenCursors.add(cursorKey);
    cursor = page.nextCursor;
  }
  return { ok: false, safeErrorCode: 'EVIDENCE_PAGE_LIMIT_EXCEEDED', capabilities: identity?.capabilities ?? [] };
}

function connectionState(capabilities: readonly TaxEvidenceAdapterCapabilityResult[]): TaxSourceCoverage['connectionState'] {
  if (capabilities.length === 0 || capabilities.some(capability => capability.state === 'failed')) return 'failed';
  if (capabilities.some(capability => capability.state === 'stale')) return 'stale';
  if (capabilities.every(capability => capability.state === 'unsupported')) return 'not_connected';
  if (capabilities.some(capability => capability.state === 'partial' || capability.state === 'unsupported')) return 'degraded';
  return 'connected';
}

function capabilityError(capabilities: readonly TaxEvidenceAdapterCapabilityResult[]): string | null {
  return capabilities.find(capability => capability.safeErrorCode)?.safeErrorCode
    ?? (capabilities.length === 0 ? 'EVIDENCE_CAPABILITIES_MISSING' : null);
}

function uniqueEconomicRole(records: readonly TaxEvidenceRecord[]): TaxEvidenceRecord[] {
  const byEvent = new Map<string, TaxEvidenceRecord>();
  for (const record of records) {
    const existing = byEvent.get(record.economicEventId);
    if (existing) {
      if ((existing.money?.currency === record.money?.currency && !sameMoney(existing.money, record.money))
        || !sameMoney(existing.normalizedMoney, record.normalizedMoney)) {
        throw new Error('EVIDENCE_DUPLICATE_EVENT_AMOUNT_CONFLICT');
      }
      continue;
    }
    byEvent.set(record.economicEventId, record);
  }
  return [...byEvent.values()];
}

function sameMoney(left: EvidenceMoney | null, right: EvidenceMoney | null): boolean {
  if (!left || !right) return left === right;
  return left.currency === right.currency && new FinancialDecimal(left.decimal).eq(right.decimal);
}

function groupRolesByEvent(records: readonly TaxEvidenceRecord[]): Map<string, Set<TaxEvidenceRecord['economicRole']>> {
  const roles = new Map<string, Set<TaxEvidenceRecord['economicRole']>>();
  for (const record of records) {
    const eventRoles = roles.get(record.economicEventId) ?? new Set<TaxEvidenceRecord['economicRole']>();
    eventRoles.add(record.economicRole);
    roles.set(record.economicEventId, eventRoles);
  }
  return roles;
}

function validateInvoiceAdjustments(
  periodInvoiceEvidence: readonly TaxEvidenceRecord[],
  lineageInvoiceEvidence: readonly TaxEvidenceRecord[],
): Readonly<{
  records: TaxEvidenceRecord[];
  targetsByAdjustmentKey: ReadonlyMap<string, TaxEvidenceRecord>;
}> {
  const basesByEventAndSource = new Map<string, TaxEvidenceRecord[]>();
  for (const record of lineageInvoiceEvidence.filter(candidate => candidate.invoiceAdjustmentKind === null)) {
    const key = invoiceAdjustmentTargetKey(record.economicEventId, record.sourceId);
    const values = basesByEventAndSource.get(key) ?? [];
    values.push(record);
    basesByEventAndSource.set(key, values);
  }

  const groups = new Map<string, { target: TaxEvidenceRecord; adjustments: TaxEvidenceRecord[] }>();
  const targetsByAdjustmentKey = new Map<string, TaxEvidenceRecord>();
  for (const adjustment of periodInvoiceEvidence.filter(candidate => candidate.invoiceAdjustmentKind !== null)) {
    const targetEventId = adjustment.adjustsEconomicEventId;
    if (!targetEventId) throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_TARGET_INVALID');
    const candidates = basesByEventAndSource.get(invoiceAdjustmentTargetKey(targetEventId, adjustment.sourceId)) ?? [];
    const compatible = candidates.filter(target => compatibleInvoiceAdjustmentTarget(adjustment, target));
    if (compatible.length === 0) throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_TARGET_INVALID');
    if (compatible.length > 1) throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_TARGET_AMBIGUOUS');
    const target = compatible[0]!;
    const key = invoiceAdjustmentTargetKey(target.economicEventId, target.sourceId);
    targetsByAdjustmentKey.set(adjustment.idempotencyKey, target);
    groups.set(key, groups.get(key) ?? { target, adjustments: [] });
  }

  for (const [key, group] of groups) {
    group.adjustments.push(...lineageInvoiceEvidence.filter(record => record.invoiceAdjustmentKind !== null
      && invoiceAdjustmentTargetKey(record.adjustsEconomicEventId ?? '', record.sourceId) === key));
    if (group.adjustments.some(adjustment => !compatibleInvoiceAdjustmentTarget(adjustment, group.target))) {
      throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_TARGET_INVALID');
    }
  }

  for (const { target, adjustments } of groups.values()) {
    const sourceAvailable = new FinancialDecimal(target.money!.decimal).plus(sumAdjustmentAmounts(adjustments, 'debit', 'money'));
    const sourceCredits = sumAdjustmentAmounts(adjustments, 'credit', 'money');
    const normalizedAvailable = new FinancialDecimal(target.normalizedMoney!.decimal)
      .plus(sumAdjustmentAmounts(adjustments, 'debit', 'normalizedMoney'));
    const normalizedCredits = sumAdjustmentAmounts(adjustments, 'credit', 'normalizedMoney');
    if (sourceCredits.gt(sourceAvailable) || normalizedCredits.gt(normalizedAvailable)) {
      throw new Error('EVIDENCE_INVOICE_CREDIT_EXCEEDS_AUTHORIZED_AMOUNT');
    }
  }
  return { records: [...periodInvoiceEvidence], targetsByAdjustmentKey };
}

function compatibleInvoiceAdjustmentTarget(adjustment: TaxEvidenceRecord, target: TaxEvidenceRecord): boolean {
  return target.invoiceAdjustmentKind === null
    && target.invoiceDocumentKind === 'arca_factura_e'
    && target.jurisdiction === 'AR'
    && adjustment.jurisdiction === 'AR'
    && adjustment.sourceId === target.sourceId
    && adjustment.sourceKind === target.sourceKind
    && adjustment.canonicalProviderId === target.canonicalProviderId
    && adjustment.partyClaimHash !== null
    && adjustment.partyClaimHash === target.partyClaimHash
    && adjustment.money !== null
    && target.money !== null
    && adjustment.money.currency === target.money.currency
    && adjustment.normalizedMoney !== null
    && target.normalizedMoney !== null
    && adjustment.normalizedMoney.currency === target.normalizedMoney.currency;
}

function sumAdjustmentAmounts(
  adjustments: readonly TaxEvidenceRecord[],
  kind: 'debit' | 'credit',
  field: 'money' | 'normalizedMoney',
): InstanceType<typeof FinancialDecimal> {
  return adjustments
    .filter(record => record.invoiceAdjustmentKind === kind)
    .reduce((total, record) => total.plus(record[field]!.decimal), new FinancialDecimal(0));
}

function invoiceAdjustmentTargetKey(economicEventId: string, sourceId: string): string {
  return `${sourceId}\u0000${economicEventId}`;
}

function dedupeEvidenceRecords(records: readonly TaxEvidenceRecord[]): TaxEvidenceRecord[] {
  return [...new Map(records.map(record => [record.idempotencyKey, record])).values()]
    .sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey));
}

function resolveFxEvidence(
  records: readonly TaxEvidenceRecord[],
  fxEvidenceById: ReadonlyMap<string, TaxEvidenceRecord>,
): TaxEvidenceRecord[] {
  const required = new Map<string, TaxEvidenceRecord>();
  for (const record of records) {
    if (!record.money || !record.normalizedMoney) throw new Error('MISSING_NORMALIZED_MONEY_EVIDENCE');
    if (record.money.currency === record.normalizedMoney.currency) {
      if (!new FinancialDecimal(record.money.decimal).eq(record.normalizedMoney.decimal)) {
        throw new Error('EVIDENCE_SAME_CURRENCY_AMOUNT_MISMATCH');
      }
      continue;
    }
    if (!record.fxReferenceId) throw new Error('MISSING_ACCEPTED_FX_EVIDENCE');
    const fxEvidence = fxEvidenceById.get(record.fxReferenceId);
    if (!fxEvidence) throw new Error('MISSING_ACCEPTED_FX_EVIDENCE');
    if (!sameMoney(record.money, fxEvidence.money)
      || !sameMoney(record.normalizedMoney, fxEvidence.normalizedMoney)) {
      throw new Error('FX_EVIDENCE_CONVERSION_MISMATCH');
    }
    required.set(fxEvidence.idempotencyKey, fxEvidence);
  }
  return [...required.values()].sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey));
}

function sumNormalizedOrNull(records: readonly TaxEvidenceRecord[], currency: string): EvidenceMoney | null {
  if (records.length === 0) return null;
  return records.reduce((total, record) => {
    if (!record.normalizedMoney) throw new Error('MISSING_NORMALIZED_MONEY_EVIDENCE');
    if (record.normalizedMoney.currency !== currency) throw new Error('MISSING_NORMALIZED_FX_EVIDENCE');
    const signed = record.invoiceAdjustmentKind === 'credit'
      ? money(new FinancialDecimal(record.normalizedMoney.decimal).negated().toFixed(), currency)
      : record.normalizedMoney;
    return addMoney(total, signed);
  }, money('0', currency));
}

function fact(
  conclusionId: string,
  kind: string,
  safeDisplayValue: string | null,
  unit: string,
  context: TaxEvidenceAdapterContext,
  records: readonly TaxEvidenceRecord[],
  upstreamBundleHash: string,
): SafeFact {
  const exactRecords = [...new Map(records.map(record => [record.idempotencyKey, record])).values()]
    .sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey));
  const requiredSourceIds = [...new Set(exactRecords.map(record => record.sourceId))];
  const requiredConsentVersions = [...new Set(exactRecords.map(record => record.consentVersion))];
  if (requiredConsentVersions.length > 1) throw new Error('EVIDENCE_CONSENT_VERSION_INCONSISTENT');
  const consent = context.consentGrants.find(grant => grant.purpose === 'tax_workspace_processing'
    && grant.revokedAt === null
    && grant.version === requiredConsentVersions[0]
    && requiredSourceIds.every(sourceId => grant.scopeIds.includes(sourceId)));
  if (requiredSourceIds.length > 0 && !consent) throw new Error('EVIDENCE_CONSENT_MISSING');
  const value = { kind, safeDisplayValue, unit };
  const consentBinding = {
    purpose: 'tax_workspace_processing' as const,
    purposeVersion: consent?.version ?? null,
    scopeHash: consent?.scopeHash ?? null,
  };
  const ruleVersionIds = [TAX_EVIDENCE_ACTUALS_RULE_VERSION];
  return {
    conclusionId,
    value,
    period: context.period,
    sourceReferenceIds: [...new Set(exactRecords.flatMap(record => [
      `source:${record.sourceId}`,
      `evidence:${record.idempotencyKey}`,
    ]))].sort(),
    freshness: {
      state: exactRecords.length === 0 ? 'unknown' : 'fresh',
      observedAt: exactRecords.length === 0 ? null : earliestTimestamp(exactRecords.map(record => record.observedAt)),
      expiresAt: earliestTimestamp(exactRecords.map(record => record.expiresAt).filter((value): value is string => value !== null)),
    },
    confidence: aggregateFactConfidence(exactRecords),
    consent: consentBinding,
    evidenceHash: hashTaxFactEvidenceReceiptV2({
      conclusionId,
      value,
      period: context.period,
      asOf: context.asOf,
      resolvedScope: canonicalEvidenceScope(context),
      consent: consentBinding,
      ruleVersionIds,
      upstreamBundleHash,
      records: exactRecords.map(record => ({
        idempotencyKey: record.idempotencyKey,
        revision: record.revision,
        recordHash: hashTaxEvidenceRecord(record),
      })),
    }),
    accountantReview: { state: 'unreviewed', reviewedAt: null },
    ruleVersionIds,
    limitations: factLimitations(exactRecords),
  } satisfies TaxConclusionEnvelopeV1<SafeFact['value']>;
}

function canonicalEvidenceScope(context: TaxEvidenceAdapterContext): TaxEvidenceAdapterContext['dataScope'] {
  return context.dataScope.mode === 'all_connected'
    ? { mode: 'all_connected' }
    : {
        mode: 'selected',
        sourceIds: [...new Set(context.dataScope.sourceIds)].sort(),
        includeKnowledgeGraph: context.dataScope.includeKnowledgeGraph,
      };
}

function aggregateFactConfidence(records: readonly TaxEvidenceRecord[]): TaxConclusionEnvelopeV1<unknown>['confidence'] {
  const derivedSourceKinds = new Set<TaxSourceKind>(['financial_analytics', 'knowledge_graph', 'transaction_enrichment']);
  const derivation = records.length > 0 && records.every(record => !derivedSourceKinds.has(record.sourceKind))
    ? 'provider_fact' as const
    : 'deterministic_rule' as const;
  if (records.length === 0) return { level: 'unknown', value: null, derivation };
  let minimum: InstanceType<typeof FinancialDecimal> | null = null;
  for (const record of records) {
    for (const value of [record.confidence.extraction, record.confidence.classification, record.confidence.matching]) {
      if (value === null || !isFinancialDecimal(value)) return { level: 'unknown', value: null, derivation };
      const decimal = new FinancialDecimal(value);
      if (decimal.isNegative() || decimal.gt(1)) return { level: 'unknown', value: null, derivation };
      if (!minimum || decimal.lt(minimum)) minimum = decimal;
    }
  }
  if (!minimum) return { level: 'unknown', value: null, derivation };
  const value = minimum.toFixed();
  const level = minimum.eq(1) && derivation === 'provider_fact'
    ? 'verified' as const
    : minimum.gte('0.8')
      ? 'high' as const
      : minimum.gte('0.5')
        ? 'medium' as const
        : minimum.gt(0)
          ? 'low' as const
          : 'unknown' as const;
  return { level, value: level === 'unknown' ? null : value, derivation };
}

function recordConfidenceNeedsReview(record: TaxEvidenceRecord): boolean {
  const confidence = aggregateFactConfidence([record]);
  return confidence.level === 'low' || confidence.level === 'unknown';
}

function factLimitations(records: readonly TaxEvidenceRecord[]): string[] {
  if (records.length === 0) return ['No accepted source evidence supports this conclusion.'];
  const confidence = aggregateFactConfidence(records);
  if (confidence.level === 'unknown') return ['One or more supporting records have missing or invalid confidence evidence.'];
  if (confidence.level === 'low') return [`Supporting evidence confidence is low (${confidence.value}).`];
  return [];
}

export function activeWorkspaceConsent(grants: readonly TaxConsentGrant[]): TaxConsentGrant | null {
  return grants.find(grant => grant.purpose === 'tax_workspace_processing' && grant.revokedAt === null) ?? null;
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('EVIDENCE_TIMESTAMP_INVALID');
  return parsed;
}

function periodsOverlap(left: Readonly<{ start: string; end: string }>, right: Readonly<{ start: string; end: string }>): boolean {
  return left.start <= right.end && left.end >= right.start;
}

function earliestTimestamp(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return [...values].sort((left, right) => instant(left) - instant(right))[0] ?? null;
}
