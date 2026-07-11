import { createHash } from 'node:crypto';

import { buildCapabilityManifest } from '../capabilities';
import { addMoney, money } from '../money';
import type { TaxConsentGrant, TaxConclusionEnvelopeV1 } from '../types';
import { buildEvidenceGraph } from './graph';
import type {
  SafeFact,
  TaxEvidenceAdapterContext,
  TaxEvidencePresentationProjectionV1,
  TaxEvidenceRecord,
  TaxEvidenceSourceAdapter,
  TaxSourceCoverage,
} from './types';

export class TaxEvidenceResolver {
  readonly #adapters: readonly TaxEvidenceSourceAdapter[];

  constructor(adapters: readonly TaxEvidenceSourceAdapter[]) {
    this.#adapters = adapters;
  }

  async resolve(context: TaxEvidenceAdapterContext): Promise<TaxEvidencePresentationProjectionV1> {
    const records: TaxEvidenceRecord[] = [];
    const sources: TaxSourceCoverage[] = [];

    for (const adapter of this.#adapters) {
      if (context.dataScope.mode === 'selected' && !context.dataScope.sourceIds.includes(adapter.adapterId)) continue;
      const result = await adapter.readPage(context, { cursor: null, pageSize: 500 });
      if (!result.ok) {
        sources.push({
          sourceId: adapter.adapterId,
          kind: adapter.sourceKind,
          providerId: null,
          displayName: adapter.adapterId,
          capabilities: result.capabilities,
          connectionState: 'failed',
          lastSuccessfulSyncAt: null,
          recordsScanned: 0,
          acceptedEvidenceCount: 0,
          needsReviewCount: 0,
          safeErrorCode: result.safeErrorCode,
        });
        continue;
      }
      records.push(...result.page.records);
      sources.push({
        sourceId: result.page.sourceId,
        kind: adapter.sourceKind,
        providerId: result.page.canonicalProviderId,
        displayName: result.page.canonicalProviderId ?? result.page.sourceId,
        capabilities: result.page.capabilities,
        connectionState: result.page.capabilities.some(capability => capability.state !== 'available') ? 'degraded' : 'connected',
        lastSuccessfulSyncAt: result.page.sourceCheckpoint.observedAt,
        recordsScanned: result.page.records.length,
        acceptedEvidenceCount: result.page.records.filter(record => record.reviewState === 'accepted').length,
        needsReviewCount: result.page.records.filter(record => record.reviewState === 'unreviewed').length,
        safeErrorCode: null,
      });
    }

    const graph = buildEvidenceGraph(context.workspaceId, records);
    const accepted = records.filter(record => record.reviewState === 'accepted');
    const revenueRecords = uniqueEconomicEvents(accepted.filter(record => record.countingDimension === 'revenue'));
    const expenseRecords = uniqueEconomicEvents(accepted.filter(record => record.countingDimension === 'expense'));
    const currency = context.displayCurrency;
    const invoiced = sumNormalized(revenueRecords.filter(record => record.economicRole === 'invoice'), currency);
    const reconciled = sumNormalized(
      revenueRecords.filter(record => !graph.gaps.some(gap => gap.economicEventId === record.economicEventId)),
      currency
    );
    const recordedExpenses = sumNormalized(expenseRecords, currency);
    const supportedExpenses = sumNormalized(
      expenseRecords.filter(record => !graph.gaps.some(gap => gap.kind === 'expense_without_receipt' && gap.economicEventId === record.economicEventId)),
      currency
    );
    const bundleHash = createHash('sha256')
      .update([graph.revision, ...sources.map(source => `${source.sourceId}:${source.recordsScanned}:${source.connectionState}`)].join('|'))
      .digest('hex');
    const safeFacts: SafeFact[] = [
      fact('fact:revenue:invoiced', 'invoiced_revenue', invoiced.decimal, currency, context, records, bundleHash),
      fact('fact:revenue:reconciled', 'reconciled_revenue', reconciled.decimal, currency, context, records, bundleHash),
      fact('fact:expenses:recorded', 'recorded_expenses', recordedExpenses.decimal, currency, context, records, bundleHash),
      fact('fact:expenses:supported', 'supported_expenses', supportedExpenses.decimal, currency, context, records, bundleHash),
    ];

    return {
      version: 'tax-evidence-presentation-v1',
      upstreamBundleHash: bundleHash,
      period: context.period,
      resolvedScope: context.dataScope,
      displayCurrency: currency,
      asOf: context.asOf,
      capabilityManifest: buildCapabilityManifest(sources.some(source => source.connectionState === 'failed') ? 'partial' : 'available'),
      sources,
      safeFacts,
      evidenceCoverage: {
        revenue: { invoiced, reconciled },
        expenses: { recorded: recordedExpenses, supported: supportedExpenses },
        obligations: { applicable: 0, mapped: 0 },
        gaps: graph.gaps,
      },
      limitations: sources.filter(source => source.connectionState !== 'connected').map(source => `Source ${source.displayName} is ${source.connectionState}`),
    };
  }
}

function uniqueEconomicEvents(records: readonly TaxEvidenceRecord[]): TaxEvidenceRecord[] {
  return [...new Map(records.map(record => [`${record.economicEventId}:${record.countingDimension}`, record])).values()];
}

function sumNormalized(records: readonly TaxEvidenceRecord[], currency: string) {
  return records.reduce((total, record) => {
    if (!record.normalizedMoney) return total;
    if (record.normalizedMoney.currency !== currency) throw new Error('Missing normalized FX evidence');
    return addMoney(total, record.normalizedMoney);
  }, money('0', currency));
}

function fact(
  conclusionId: string,
  kind: string,
  safeDisplayValue: string,
  unit: string,
  context: TaxEvidenceAdapterContext,
  records: readonly TaxEvidenceRecord[],
  evidenceHash: string
): SafeFact {
  const consent = context.consentGrants.find(grant => grant.purpose === 'tax_workspace_processing' && grant.revokedAt === null);
  return {
    conclusionId,
    value: { kind, safeDisplayValue, unit },
    period: context.period,
    sourceReferenceIds: [...new Set(records.map(record => `source:${record.sourceId}`))],
    freshness: { state: 'fresh', observedAt: context.asOf, expiresAt: null },
    confidence: { level: 'verified', value: '1', derivation: 'deterministic_rule' },
    consent: { purpose: 'tax_workspace_processing', purposeVersion: consent?.version ?? null, scopeHash: consent?.scopeHash ?? null },
    evidenceHash,
    accountantReview: { state: 'unreviewed', reviewedAt: null },
    ruleVersionIds: [],
    limitations: [],
  } satisfies TaxConclusionEnvelopeV1<SafeFact['value']>;
}

export function activeWorkspaceConsent(grants: readonly TaxConsentGrant[]): TaxConsentGrant | null {
  return grants.find(grant => grant.purpose === 'tax_workspace_processing' && grant.revokedAt === null) ?? null;
}
