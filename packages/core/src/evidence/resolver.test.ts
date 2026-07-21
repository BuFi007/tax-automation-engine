import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import type { TaxConsentGrant } from '../types';
import { hashTaxFactEvidenceReceiptV2, TaxEvidenceResolver } from './resolver';
import type {
  TaxEvidenceAdapterContext,
  TaxEvidenceAdapterResult,
  TaxEvidenceRecord,
  TaxEvidenceSourceAdapter,
  TaxSourceCapability,
  TaxSourceKind,
} from './types';

describe('tax evidence resolver', () => {
  test('reads every page, filters the requested period, and does not treat a payment as settlement finality', async () => {
    const adapter = new PagesAdapter('invoice-source', 'bufi_invoice', [[
      record('invoice', 'invoice', 'revenue', '2026-01-01', '2026-12-31'),
      record('payment', 'payment', 'none', '2026-01-01', '2026-12-31'),
    ], [
      record('old-invoice', 'invoice', 'revenue', '2025-01-01', '2025-12-31', '50'),
    ]]);
    const projection = await new TaxEvidenceResolver([adapter]).resolve(context(['invoice-source']));

    expect(adapter.reads).toBe(2);
    expect(projection.evidenceCoverage.revenue.invoiced).toEqual({ decimal: '100', currency: 'USD' });
    expect(projection.evidenceCoverage.revenue.reconciled).toBeNull();
    expect(projection.evidenceCoverage.gaps.map(gap => gap.kind)).toContain('factura_e_without_collection_evidence');
  });

  test('uses accepted settlement and receipt sources in supported conclusion references', async () => {
    const adapters = [
      new PagesAdapter('invoice-source', 'bufi_invoice', [[record('invoice', 'invoice', 'revenue')]]),
      new PagesAdapter('settlement-source', 'bufi_invoice', [[record('settlement', 'settlement', 'none', undefined, undefined, undefined, 'event:invoice')]]),
      new PagesAdapter('expense-source', 'bufi_bill', [[record('expense', 'expense', 'expense', undefined, undefined, '20', 'event:expense')]]),
      new PagesAdapter('receipt-source', 'magic_inbox', [[record('receipt', 'receipt', 'none', undefined, undefined, '20', 'event:expense')]]),
    ];
    const projection = await new TaxEvidenceResolver(adapters).resolve(context(adapters.map(adapter => adapter.adapterId)));

    expect(projection.evidenceCoverage.revenue.reconciled).toEqual({ decimal: '100', currency: 'USD' });
    expect(projection.evidenceCoverage.expenses.supported).toEqual({ decimal: '20', currency: 'USD' });
    const reconciledReferences = projection.safeFacts.find(fact => fact.value.kind === 'reconciled_revenue')?.sourceReferenceIds ?? [];
    expect(reconciledReferences).toEqual(expect.arrayContaining([
      `evidence:${hash('key:invoice')}`,
      `evidence:${hash('key:settlement')}`,
      'source:invoice-source',
      'source:settlement-source',
    ]));
    expect(reconciledReferences).toHaveLength(4);
    const expenseReferences = projection.safeFacts.find(fact => fact.value.kind === 'supported_expenses')?.sourceReferenceIds ?? [];
    expect(expenseReferences).toEqual(expect.arrayContaining([
      `evidence:${hash('key:expense')}`,
      `evidence:${hash('key:receipt')}`,
      'source:expense-source',
      'source:receipt-source',
    ]));
    expect(expenseReferences).toHaveLength(4);
  });

  test('projects approved BUFI bill tax as exact input credit with a traceable bill count', async () => {
    const inputTax: TaxEvidenceRecord = {
      ...record(
        'bill-tax',
        'receipt',
        'tax',
        '2026-07-01',
        '2026-07-31',
        '1580.90',
        'bill:1',
      ),
      sourceKind: 'bufi_bill',
      direction: 'outflow',
      money: { decimal: '1580.90', currency: 'USD' },
      normalizedMoney: { decimal: '1580.90', currency: 'USD' },
    };
    const projection = await new TaxEvidenceResolver([
      new PagesAdapter('bufi-bill', 'bufi_bill', [[inputTax]]),
    ]).resolve(context(['bufi-bill']));

    const inputTaxFact = projection.safeFacts.find(
      fact => fact.value.kind === 'purchase_input_tax',
    );
    const countFact = projection.safeFacts.find(
      fact => fact.value.kind === 'purchase_input_tax_document_count',
    );
    expect(inputTaxFact?.value).toEqual({
      kind: 'purchase_input_tax',
      safeDisplayValue: '1580.9',
      unit: 'USD',
    });
    expect(inputTaxFact?.sourceReferenceIds).toEqual([
      `evidence:${inputTax.idempotencyKey}`,
      'source:bufi-bill',
    ]);
    expect(countFact?.value).toEqual({
      kind: 'purchase_input_tax_document_count',
      safeDisplayValue: '1',
      unit: 'count',
    });
  });

  test('withdraws settlement finality on reversal and restores it only after re-finalization', async () => {
    const invoice = record('invoice', 'invoice', 'revenue');
    const finalized = record('settlement-finalized', 'settlement', 'none');
    const reversed = {
      ...record('settlement-reversed', 'settlement', 'none'),
      validityState: 'withdrawn' as const,
      supersedesIdempotencyKey: finalized.idempotencyKey,
    };
    const reversedProjection = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice, finalized, reversed]]),
    ]).resolve(context(['invoice-source']));

    expect(reversedProjection.evidenceCoverage.revenue.reconciled).toBeNull();
    expect(reversedProjection.evidenceCoverage.gaps.map(gap => gap.kind)).toContain('factura_e_without_collection_evidence');

    const reFinalized = {
      ...record('settlement-refinalized', 'settlement', 'none'),
      supersedesIdempotencyKey: reversed.idempotencyKey,
    };
    const restoredProjection = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice, finalized, reversed, reFinalized]]),
    ]).resolve(context(['invoice-source']));

    expect(restoredProjection.evidenceCoverage.revenue.reconciled).toEqual({ decimal: '100', currency: 'USD' });
    expect(restoredProjection.evidenceCoverage.gaps.map(gap => gap.kind)).not.toContain('factura_e_without_collection_evidence');
  });

  test('treats withdrawn bank cash as lineage only, never as revenue or settlement', async () => {
    const active = {
      ...record('cash-active', 'cash_movement', 'cash', undefined, undefined, '125'),
      economicEventId: 'bank-transaction:1',
      invoiceDocumentKind: null,
    };
    const withdrawn: TaxEvidenceRecord = {
      ...active,
      evidenceId: 'cash-withdrawn',
      revision: '2',
      countingDimension: 'none',
      direction: 'neutral',
      money: null,
      normalizedMoney: null,
      validityState: 'withdrawn',
      idempotencyKey: hash('key:cash-withdrawn'),
      supersedesIdempotencyKey: active.idempotencyKey,
    };
    const projection = await new TaxEvidenceResolver([
      new PagesAdapter('bank-connection:1', 'bank', [[active, withdrawn]]),
    ]).resolve(context(['bank-connection:1']));

    expect(projection.evidenceCoverage.revenue.invoiced).toBeNull();
    expect(projection.evidenceCoverage.revenue.reconciled).toBeNull();
    expect(projection.evidenceCoverage.expenses.recorded).toBeNull();
    expect(projection.evidenceCoverage.expenses.supported).toBeNull();
    expect(projection.sources[0]).toMatchObject({
      recordsScanned: 1,
      acceptedEvidenceCount: 0,
    });
    expect(projection.safeFacts.flatMap(fact => fact.sourceReferenceIds))
      .not.toContain(`evidence:${active.idempotencyKey}`);
  });

  test('withdraws a counted invoice, unwinds its settlement, and restores only explicit successors', async () => {
    const invoice = record('invoice', 'invoice', 'revenue');
    const settlement = record('settlement', 'settlement', 'none');
    const invoiceWithdrawal = {
      ...record('invoice-withdrawn', 'invoice', 'none'),
      invoiceDocumentKind: invoice.invoiceDocumentKind,
      money: null,
      normalizedMoney: null,
      validityState: 'withdrawn' as const,
      supersedesIdempotencyKey: invoice.idempotencyKey,
    };
    const settlementWithdrawal = {
      ...record('settlement-withdrawn', 'settlement', 'none'),
      validityState: 'withdrawn' as const,
      supersedesIdempotencyKey: settlement.idempotencyKey,
    };
    const cancelled = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice, settlement, invoiceWithdrawal]]),
    ]).resolve(context(['invoice-source']));
    expect(cancelled.evidenceCoverage.revenue.invoiced).toBeNull();
    expect(cancelled.evidenceCoverage.revenue.reconciled).toBeNull();
    expect(cancelled.evidenceCoverage.gaps.map(gap => gap.kind)).toContain('payout_without_invoice');

    const fullyUnwound = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice, settlement, invoiceWithdrawal, settlementWithdrawal]]),
    ]).resolve(context(['invoice-source']));
    expect(fullyUnwound.evidenceCoverage.gaps.map(gap => gap.kind)).not.toContain('payout_without_invoice');

    const amended = {
      ...record('invoice-amended', 'invoice', 'revenue', undefined, undefined, '75'),
      invoiceDocumentKind: invoice.invoiceDocumentKind,
      supersedesIdempotencyKey: invoiceWithdrawal.idempotencyKey,
    };
    const refinalized = {
      ...record('settlement-refinalized-after-invoice', 'settlement', 'none'),
      supersedesIdempotencyKey: settlementWithdrawal.idempotencyKey,
    };
    const restored = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice, settlement, invoiceWithdrawal, settlementWithdrawal, amended, refinalized]]),
    ]).resolve(context(['invoice-source']));
    expect(restored.evidenceCoverage.revenue.invoiced).toEqual({ decimal: '75', currency: 'USD' });
    expect(restored.evidenceCoverage.revenue.reconciled).toEqual({ decimal: '75', currency: 'USD' });
  });

  test('applies an associated ARCA credit note to invoiced and reconciled revenue', async () => {
    const original = record('invoice', 'invoice', 'revenue');
    const settlement = record('settlement', 'settlement', 'none');
    const credit = {
      ...record('credit-note', 'invoice', 'revenue', undefined, undefined, '20', 'event:credit-note'),
      invoiceDocumentKind: 'arca_nota_credito_e' as const,
      invoiceAdjustmentKind: 'credit' as const,
      adjustsEconomicEventId: original.economicEventId,
      direction: 'outflow' as const,
    };
    const projection = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[original, settlement, credit]]),
    ]).resolve(context(['invoice-source']));

    expect(projection.evidenceCoverage.revenue.invoiced).toEqual({ decimal: '80', currency: 'USD' });
    expect(projection.evidenceCoverage.revenue.reconciled).toEqual({ decimal: '80', currency: 'USD' });
    expect(projection.evidenceCoverage.gaps.map(gap => gap.kind)).not.toContain('invoice_adjustment_target_missing');
    expect(projection.safeFacts.find(fact => fact.value.kind === 'reconciled_revenue')?.sourceReferenceIds)
      .toContain(`evidence:${credit.idempotencyKey}`);
  });

  test('does not infer debit-note settlement from the settled original invoice', async () => {
    const original = record('invoice', 'invoice', 'revenue');
    const originalSettlement = record('settlement', 'settlement', 'none');
    const debit = {
      ...record('debit-note', 'invoice', 'revenue', undefined, undefined, '20', 'event:debit-note'),
      invoiceDocumentKind: 'arca_nota_debito_e' as const,
      invoiceAdjustmentKind: 'debit' as const,
      adjustsEconomicEventId: original.economicEventId,
      direction: 'inflow' as const,
    };
    const unpaidDebit = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[original, originalSettlement, debit]]),
    ]).resolve(context(['invoice-source']));
    expect(unpaidDebit.evidenceCoverage.revenue.invoiced).toEqual({ decimal: '120', currency: 'USD' });
    expect(unpaidDebit.evidenceCoverage.revenue.reconciled).toEqual({ decimal: '100', currency: 'USD' });

    const debitSettlement = record(
      'debit-note-settlement',
      'settlement',
      'none',
      undefined,
      undefined,
      undefined,
      debit.economicEventId,
    );
    const paidDebit = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[original, originalSettlement, debit, debitSettlement]]),
    ]).resolve(context(['invoice-source']));
    expect(paidDebit.evidenceCoverage.revenue.reconciled).toEqual({ decimal: '120', currency: 'USD' });
  });

  test('uses historical Factura E lineage for current-period credit and debit notes', async () => {
    const original = record('invoice-january', 'invoice', 'revenue', '2026-01-01', '2026-01-31');
    const originalSettlement = record(
      'invoice-january-settlement',
      'settlement',
      'none',
      '2026-01-01',
      '2026-01-31',
    );
    const credit = {
      ...record('credit-february', 'invoice', 'revenue', '2026-02-01', '2026-02-28', '20', 'event:credit-february'),
      invoiceDocumentKind: 'arca_nota_credito_e' as const,
      invoiceAdjustmentKind: 'credit' as const,
      adjustsEconomicEventId: original.economicEventId,
      direction: 'outflow' as const,
    };
    const debit = {
      ...record('debit-february', 'invoice', 'revenue', '2026-02-01', '2026-02-28', '10', 'event:debit-february'),
      invoiceDocumentKind: 'arca_nota_debito_e' as const,
      invoiceAdjustmentKind: 'debit' as const,
      adjustsEconomicEventId: original.economicEventId,
      direction: 'inflow' as const,
    };
    const debitSettlement = record(
      'debit-february-settlement',
      'settlement',
      'none',
      '2026-02-01',
      '2026-02-28',
      undefined,
      debit.economicEventId,
    );
    const februaryContext = {
      ...context(['invoice-source']),
      period: { start: '2026-02-01', end: '2026-02-28' },
    };
    const projection = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[
        original,
        originalSettlement,
        credit,
        debit,
        debitSettlement,
      ]]),
    ]).resolve(februaryContext);

    expect(projection.evidenceCoverage.revenue.invoiced).toEqual({ decimal: '-10', currency: 'USD' });
    expect(projection.evidenceCoverage.revenue.reconciled).toEqual({ decimal: '-10', currency: 'USD' });
    const invoicedFact = projection.safeFacts.find(fact => fact.value.kind === 'invoiced_revenue');
    expect(invoicedFact?.sourceReferenceIds).toContain(`evidence:${original.idempotencyKey}`);
  });

  test('rejects cross-jurisdiction adjustment targets and cumulative over-crediting', async () => {
    const original = record('invoice', 'invoice', 'revenue');
    const credit = {
      ...record('credit-note', 'invoice', 'revenue', undefined, undefined, '120', 'event:credit-note'),
      invoiceDocumentKind: 'arca_nota_credito_e' as const,
      invoiceAdjustmentKind: 'credit' as const,
      adjustsEconomicEventId: original.economicEventId,
      direction: 'outflow' as const,
    };
    const commercialUsTarget = {
      ...original,
      jurisdiction: 'US' as const,
      invoiceDocumentKind: 'commercial_invoice' as const,
    };
    await expect(new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[commercialUsTarget, credit]]),
    ]).resolve(context(['invoice-source']))).rejects.toThrow('EVIDENCE_INVOICE_ADJUSTMENT_TARGET_INVALID');

    await expect(new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[original, credit]]),
    ]).resolve(context(['invoice-source']))).rejects.toThrow('EVIDENCE_INVOICE_CREDIT_EXCEEDS_AUTHORIZED_AMOUNT');
  });

  test('conserves mixed source currencies only through an exact accepted FX artifact', async () => {
    const fx = {
      ...record('fx-usd-ars', 'accounting_entry', 'none'),
      money: { decimal: '100', currency: 'USD' },
      normalizedMoney: { decimal: '100000', currency: 'ARS' },
    };
    const invoice = {
      ...record('invoice-usd', 'invoice', 'revenue'),
      money: { decimal: '100', currency: 'USD' },
      normalizedMoney: { decimal: '100000', currency: 'ARS' },
      fxReferenceId: fx.idempotencyKey,
    };
    const accountingCopy = {
      ...record('invoice-ars-copy', 'invoice', 'revenue'),
      money: { decimal: '100000', currency: 'ARS' },
      normalizedMoney: { decimal: '100000', currency: 'ARS' },
      fxReferenceId: null,
    };
    const adapters = [
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice]]),
      new PagesAdapter('accounting-source', 'accounting', [[accountingCopy]]),
      new PagesAdapter('fx-source', 'fx', [[fx]]),
    ];
    const projection = await new TaxEvidenceResolver(adapters).resolve({
      ...context(adapters.map(adapter => adapter.adapterId)),
      displayCurrency: 'ARS',
    });
    expect(projection.evidenceCoverage.revenue.invoiced).toEqual({ decimal: '100000', currency: 'ARS' });
  });

  test('rejects an accepted but unrelated FX artifact for a normalized counting amount', async () => {
    const fxEvidence = {
      ...record('fx-evidence', 'accounting_entry', 'none'),
      money: { decimal: '100', currency: 'EUR' },
      normalizedMoney: { decimal: '999', currency: 'USD' },
    };
    const invoice = {
      ...record('invoice', 'invoice', 'revenue'),
      money: { decimal: '100', currency: 'EUR' },
      normalizedMoney: { decimal: '110', currency: 'USD' },
      fxReferenceId: fxEvidence.idempotencyKey,
    };
    const adapters = [
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice]]),
      new PagesAdapter('fx-source', 'fx', [[fxEvidence]]),
    ];

    await expect(new TaxEvidenceResolver(adapters).resolve(context(adapters.map(adapter => adapter.adapterId))))
      .rejects.toThrow('FX_EVIDENCE_CONVERSION_MISMATCH');
  });

  test('reports selected missing and unsupported sources as not connected', async () => {
    const unsupported = new PagesAdapter('unsupported-source', 'accounting', [[]], 'unsupported');
    const projection = await new TaxEvidenceResolver([unsupported]).resolve({
      ...context(['unsupported-source', 'missing-source']),
      dataScope: { mode: 'selected', sourceIds: ['unsupported-source', 'missing-source'], includeKnowledgeGraph: false },
    });
    expect(projection.sources.map(source => [source.sourceId, source.connectionState])).toEqual([
      ['missing-source', 'not_connected'],
      ['unsupported-source', 'not_connected'],
    ]);
    expect(projection.capabilityManifest.reads.every(read => read.state === 'failed')).toBe(true);
  });

  test('binds unreviewed and rejected record lineage into the upstream bundle hash', async () => {
    const candidate = record('candidate', 'payment', 'none');
    const unreviewed = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[{ ...candidate, reviewState: 'unreviewed' }]]),
    ]).resolve(context(['invoice-source']));
    const rejected = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[{ ...candidate, reviewState: 'rejected' }]]),
    ]).resolve(context(['invoice-source']));

    expect(unreviewed.sources[0]?.needsReviewCount).toBe(1);
    expect(rejected.sources[0]?.needsReviewCount).toBe(0);
    expect(unreviewed.upstreamBundleHash).not.toBe(rejected.upstreamBundleHash);
  });

  test('derives conservative confidence and fact-specific evidence hashes', async () => {
    const invoice = {
      ...record('invoice', 'invoice', 'revenue'),
      confidence: { extraction: '0.95', classification: null, matching: '0.9' },
    };
    const settlement = record('settlement', 'settlement', 'none');
    const projection = await new TaxEvidenceResolver([
      new PagesAdapter('invoice-source', 'bufi_invoice', [[invoice, settlement]]),
    ]).resolve(context(['invoice-source']));
    const invoiced = projection.safeFacts.find(fact => fact.value.kind === 'invoiced_revenue')!;
    const reconciled = projection.safeFacts.find(fact => fact.value.kind === 'reconciled_revenue')!;

    expect(invoiced.confidence).toEqual({ level: 'unknown', value: null, derivation: 'provider_fact' });
    expect(invoiced.limitations).toContain('One or more supporting records have missing or invalid confidence evidence.');
    expect(invoiced.evidenceHash).not.toBe(reconciled.evidenceHash);
    expect(invoiced.ruleVersionIds).toEqual(['tax-evidence-actuals-v1']);
    expect(reconciled.ruleVersionIds).toEqual(['tax-evidence-actuals-v1']);
    expect(projection.sources[0]?.needsReviewCount).toBe(1);
  });

  test('binds conclusion value, period, and rule versions into the v2 fact evidence hash', () => {
    const receipt = {
      conclusionId: 'fact:revenue:invoiced',
      value: { kind: 'invoiced_revenue', safeDisplayValue: '100', unit: 'USD' },
      period: { start: '2026-01-01', end: '2026-12-31' },
      asOf: '2026-07-10T00:00:00.000Z',
      resolvedScope: { mode: 'all_connected' as const },
      consent: {
        purpose: 'tax_workspace_processing' as const,
        purposeVersion: 'consent-v1',
        scopeHash: hash('scope'),
      },
      ruleVersionIds: ['tax-evidence-actuals-v1'],
      upstreamBundleHash: hash('bundle'),
      records: [{
        idempotencyKey: hash('key:invoice'),
        revision: '1',
        recordHash: hash('record:invoice'),
      }],
    };
    const baseline = hashTaxFactEvidenceReceiptV2(receipt);

    expect(hashTaxFactEvidenceReceiptV2({
      ...receipt,
      value: { ...receipt.value, safeDisplayValue: '101' },
    })).not.toBe(baseline);
    expect(hashTaxFactEvidenceReceiptV2({
      ...receipt,
      period: { ...receipt.period, end: '2026-06-30' },
    })).not.toBe(baseline);
    expect(hashTaxFactEvidenceReceiptV2({
      ...receipt,
      ruleVersionIds: ['tax-evidence-actuals-v2'],
    })).not.toBe(baseline);
  });

  test('excludes knowledge graph adapters when selected scope disables them', async () => {
    const graph = new PagesAdapter('workspace-graph', 'knowledge_graph', [[]]);
    const projection = await new TaxEvidenceResolver([graph]).resolve({
      ...context(['workspace-graph']),
      dataScope: { mode: 'selected', sourceIds: ['workspace-graph'], includeKnowledgeGraph: false },
    });
    expect(graph.reads).toBe(0);
    expect(projection.sources).toEqual([]);
  });
});

class PagesAdapter implements TaxEvidenceSourceAdapter {
  readonly supportedCapabilities: readonly TaxSourceCapability[] = ['invoices'];
  reads = 0;

  constructor(
    readonly adapterId: string,
    readonly sourceKind: TaxSourceKind,
    private readonly pages: readonly (readonly TaxEvidenceRecord[])[],
    private readonly capabilityState: 'available' | 'unsupported' = 'available',
  ) {}

  async readPage(
    context: TaxEvidenceAdapterContext,
    input: Readonly<{ cursor: Readonly<{ value: string; version: string }> | null; pageSize: number }>,
  ): Promise<TaxEvidenceAdapterResult> {
    const index = input.cursor ? Number(input.cursor.value) : 0;
    const records = (this.pages[index] ?? []).map(item => ({
      ...item,
      workspaceId: context.workspaceId,
      sourceId: this.adapterId,
      sourceKind: this.sourceKind,
    }));
    this.reads += 1;
    return {
      ok: true,
      page: {
        adapterSchemaVersion: 'test-v1',
        sourceId: this.adapterId,
        canonicalProviderId: null,
        records,
        capabilities: [{
          capability: 'invoices',
          state: this.capabilityState,
          observedAt: context.asOf,
          safeErrorCode: null,
        }],
        nextCursor: index + 1 < this.pages.length ? { value: String(index + 1), version: 'v1' } : null,
        sourceCheckpoint: { revision: 'checkpoint:1', observedAt: context.asOf },
      },
    };
  }
}

function context(scopeIds: readonly string[]): TaxEvidenceAdapterContext {
  const consent: TaxConsentGrant = {
    purpose: 'tax_workspace_processing',
    version: 'consent-v1',
    scopeIds,
    scopeHash: hash('scope'),
    grantedAt: '2026-07-10T00:00:00.000Z',
    revokedAt: null,
  };
  return {
    workspaceId: 'workspace:1',
    actorId: 'user:1',
    connectionId: null,
    consentGrants: [consent],
    period: { start: '2026-01-01', end: '2026-12-31' },
    displayCurrency: 'USD',
    asOf: '2026-07-10T00:00:00.000Z',
    dataScope: { mode: 'all_connected' },
  };
}

function record(
  evidenceId: string,
  economicRole: TaxEvidenceRecord['economicRole'],
  countingDimension: TaxEvidenceRecord['countingDimension'],
  periodStart = '2026-01-01',
  periodEnd = '2026-12-31',
  decimal = '100',
  economicEventId = economicRole === 'expense' || economicRole === 'receipt' ? 'event:expense' : 'event:invoice',
): TaxEvidenceRecord {
  const carriesMoney = economicRole !== 'settlement' && economicRole !== 'receipt' && economicRole !== 'payment';
  return {
    evidenceId,
    workspaceId: 'workspace:1',
    revision: '1',
    sourceId: 'replaced-by-adapter',
    sourceKind: 'bufi_invoice',
    canonicalProviderId: null,
    externalReferenceHash: hash(`external:${evidenceId}`),
    sourceEventHash: hash(`event:${evidenceId}`),
    artifactHash: hash(`artifact:${evidenceId}`),
    jurisdiction: 'AR',
    period: { start: periodStart, end: periodEnd },
    observedAt: '2026-07-09T00:00:00.000Z',
    expiresAt: null,
    economicEventId,
    economicRole,
    invoiceDocumentKind: economicRole === 'invoice' ? 'arca_factura_e' : null,
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    countingDimension,
    direction: countingDimension === 'expense' ? 'outflow' : 'inflow',
    money: carriesMoney ? { decimal, currency: 'USD' } : null,
    normalizedMoney: carriesMoney ? { decimal, currency: 'USD' } : null,
    fxReferenceId: null,
    partyClaimHash: hash('party'),
    accountReferenceHash: hash('account'),
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
    validityState: 'active',
    consentVersion: 'consent-v1',
    idempotencyKey: hash(`key:${evidenceId}`),
    supersedesIdempotencyKey: null,
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
