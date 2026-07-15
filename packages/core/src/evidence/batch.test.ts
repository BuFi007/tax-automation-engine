import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import {
  hashTaxEvidenceConsentScope,
  parseTaxEvidenceBatchV1,
  isActiveTaxEvidenceRecord,
  resolveActiveEvidenceRecords,
} from './batch';
import type { TaxEvidenceBatchV1, TaxEvidenceRecord } from './types';

describe('tax evidence batch v1', () => {
  test('publishes a fixed canonical consent scope hash', () => {
    expect(hashTaxEvidenceConsentScope('consent-v1', ['magic-inbox', 'bufi-invoice', 'magic-inbox'])).toBe(
      '39728302c59d07cc894f9fe84b1831dbb481fc809d7d4914c42973d7c7fa268b',
    );
  });

  test('accepts exact USDC source money with explicit USD normalization evidence', () => {
    const parsed = parseTaxEvidenceBatchV1(batch());
    expect(parsed.records[0]?.money).toEqual({ decimal: '1000.000001', currency: 'USDC' });
    expect(parsed.records[0]?.normalizedMoney).toEqual({ decimal: '1000.000001', currency: 'USD' });
  });

  test('accepts legacy-safe opaque workspace IDs as well as UUIDs', () => {
    const input = batch();
    const workspaceId = 'workspace:legacy-1';
    const parsed = parseTaxEvidenceBatchV1({
      ...input,
      workspaceId,
      records: input.records.map(record => ({ ...record, workspaceId })),
    });
    expect(parsed.workspaceId).toBe(workspaceId);
  });

  test('defaults legacy records to active validity at the ingestion boundary', () => {
    const input = batch();
    const { validityState: _legacyOmission, ...legacyRecord } = input.records[0]!;
    const parsed = parseTaxEvidenceBatchV1({ ...input, records: [legacyRecord] });
    expect(parsed.records[0]?.validityState).toBe('active');
  });

  test('requires FX evidence whenever normalization changes currency', () => {
    const input = batch();
    expect(() => parseTaxEvidenceBatchV1({
      ...input,
      records: input.records.map(record => ({ ...record, fxReferenceId: null })),
    })).toThrow('EVIDENCE_FX_REFERENCE_REQUIRED');
  });

  test('requires both sides of counting money and exact same-currency normalization', () => {
    const input = batch();
    expect(() => parseTaxEvidenceBatchV1({
      ...input,
      records: input.records.map(item => ({ ...item, money: null })),
    })).toThrow('EVIDENCE_COUNTING_MONEY_REQUIRED');
    expect(() => parseTaxEvidenceBatchV1({
      ...input,
      records: input.records.map(item => ({
        ...item,
        money: { decimal: '100', currency: 'USD' },
        normalizedMoney: { decimal: '999', currency: 'USD' },
        fxReferenceId: null,
      })),
    })).toThrow('EVIDENCE_SAME_CURRENCY_AMOUNT_MISMATCH');
  });

  test('rejects negative, zero, neutral, and dimension-inconsistent countable money', () => {
    const input = batch();
    for (const decimal of ['-100', '0']) {
      expect(() => parseTaxEvidenceBatchV1({
        ...input,
        records: input.records.map(item => ({
          ...item,
          money: { decimal, currency: 'USD' },
          normalizedMoney: { decimal, currency: 'USD' },
          fxReferenceId: null,
        })),
      })).toThrow('EVIDENCE_COUNTING_AMOUNT_INVALID');
    }
    expect(() => parseTaxEvidenceBatchV1({
      ...input,
      records: input.records.map(item => ({ ...item, direction: 'neutral' as const })),
    })).toThrow('EVIDENCE_COUNTING_DIRECTION_INVALID');
    expect(() => parseTaxEvidenceBatchV1({
      ...input,
      records: input.records.map(item => ({ ...item, direction: 'outflow' as const })),
    })).toThrow('EVIDENCE_COUNTING_DIRECTION_INVALID');
  });

  test('compares offset timestamps by instant rather than lexical form', () => {
    const input = batch();
    expect(() => parseTaxEvidenceBatchV1({
      ...input,
      producedAt: '2026-07-10T00:30:00+01:00',
      checkpoint: { ...input.checkpoint, observedAt: '2026-07-10T00:00:00Z' },
      records: [],
    })).toThrow('EVIDENCE_CHECKPOINT_IN_FUTURE');
  });

  test('keeps only the tip of an explicit producer-local supersession chain', () => {
    const first = batch().records[0]!;
    const second = {
      ...first,
      evidenceId: 'invoice:2',
      revision: '2',
      idempotencyKey: hash('invoice-key-2'),
      supersedesIdempotencyKey: first.idempotencyKey,
    };
    expect(resolveActiveEvidenceRecords([first, second])).toEqual([second]);
  });

  test('allows active invoice document enrichment while preserving one supersession chain', () => {
    const draft = { ...record(), invoiceDocumentKind: 'commercial_invoice' as const };
    const authorized = {
      ...draft,
      evidenceId: 'invoice:arca-authorized',
      revision: '2',
      invoiceDocumentKind: 'arca_factura_e' as const,
      idempotencyKey: hash('invoice-key-authorized'),
      supersedesIdempotencyKey: draft.idempotencyKey,
    };
    const parsed = parseTaxEvidenceBatchV1(batch({ records: [draft, authorized] }));
    expect(resolveActiveEvidenceRecords(parsed.records)).toEqual([authorized]);
  });

  test('accepts an explicit settlement withdrawal tombstone and excludes it from active evidence', () => {
    const finalized = settlementRecord('settlement-finalized', null, 'active');
    const withdrawn = settlementRecord('settlement-reversed', finalized.idempotencyKey, 'withdrawn');
    const parsed = parseTaxEvidenceBatchV1(batch({ records: [finalized, withdrawn] }));
    const tips = resolveActiveEvidenceRecords(parsed.records);
    expect(tips).toEqual([withdrawn]);
    expect(isActiveTaxEvidenceRecord(tips[0]!)).toBe(false);
  });

  test('rejects a non-active settlement without an explicit predecessor', () => {
    expect(() => parseTaxEvidenceBatchV1(batch({
      records: [settlementRecord('settlement-reversed', null, 'withdrawn')],
    }))).toThrow('EVIDENCE_NON_ACTIVE_POINTER_INVALID');
  });

  test('accepts a non-monetary Magic Inbox receipt withdrawal tombstone', () => {
    const receipt = magicInboxReceipt('receipt-active', null, 'active');
    const withdrawn = magicInboxReceipt(
      'receipt-withdrawn',
      receipt.idempotencyKey,
      'withdrawn',
    );
    const parsed = parseTaxEvidenceBatchV1(magicInboxBatch([receipt, withdrawn]));

    expect(resolveActiveEvidenceRecords(parsed.records)).toEqual([withdrawn]);
    expect(withdrawn).toMatchObject({
      economicRole: 'receipt',
      countingDimension: 'none',
      money: null,
      normalizedMoney: null,
      fxReferenceId: null,
    });
  });

  test('rejects relabeling a receipt tombstone as a different economic event', () => {
    const receipt = magicInboxReceipt('receipt-active', null, 'active');
    const withdrawn = {
      ...magicInboxReceipt('receipt-withdrawn', receipt.idempotencyKey, 'withdrawn'),
      economicEventId: 'transaction:different',
    };
    const parsed = parseTaxEvidenceBatchV1(magicInboxBatch([receipt, withdrawn]));

    expect(() => resolveActiveEvidenceRecords(parsed.records))
      .toThrow('EVIDENCE_RECEIPT_SUPERSESSION_MISMATCH');
  });

  test('accepts exact bank cash and an exact non-monetary withdrawal lineage', () => {
    const active = bankCashRecord('cash-active', null, 'active');
    const withdrawn = bankCashRecord(
      'cash-withdrawn',
      active.idempotencyKey,
      'withdrawn',
    );
    const parsed = parseTaxEvidenceBatchV1(bankCashBatch([active, withdrawn]));

    expect(parsed.records[0]?.money).toEqual({
      decimal: '9007199254740991.01',
      currency: 'USDC',
    });
    expect(resolveActiveEvidenceRecords(parsed.records)).toEqual([withdrawn]);
    expect(withdrawn).toMatchObject({
      economicRole: 'cash_movement',
      countingDimension: 'none',
      direction: 'neutral',
      money: null,
      normalizedMoney: null,
      fxReferenceId: null,
    });
  });

  test('rejects unsafe cash tombstones and predecessor substitution', () => {
    const active = bankCashRecord('cash-active', null, 'active');
    const withdrawn = bankCashRecord(
      'cash-withdrawn',
      active.idempotencyKey,
      'withdrawn',
    );

    expect(() => resolveActiveEvidenceRecords([withdrawn]))
      .toThrow('EVIDENCE_SUPERSESSION_TARGET_NOT_FOUND');
    expect(() => parseTaxEvidenceBatchV1(bankCashBatch([active, {
      ...withdrawn,
      money: { decimal: '1', currency: 'USD' },
    }])))
      .toThrow('EVIDENCE_NON_ACTIVE_POINTER_INVALID');
    expect(() => parseTaxEvidenceBatchV1(bankCashBatch([active, {
      ...withdrawn,
      countingDimension: 'cash',
      direction: 'outflow',
      money: { decimal: '1', currency: 'USD' },
      normalizedMoney: { decimal: '1', currency: 'USD' },
    }])))
      .toThrow('EVIDENCE_NON_ACTIVE_POINTER_INVALID');

    expect(() => resolveActiveEvidenceRecords([active, {
      ...withdrawn,
      economicEventId: 'bank-transaction:different',
    }])).toThrow('EVIDENCE_CASH_SUPERSESSION_MISMATCH');
    expect(() => resolveActiveEvidenceRecords([active, {
      ...withdrawn,
      sourceId: 'bank-connection:different',
    }])).toThrow('EVIDENCE_SUPERSESSION_SOURCE_MISMATCH');
    expect(() => resolveActiveEvidenceRecords([active, {
      ...withdrawn,
      workspaceId: '00000000-0000-4000-8000-000000000099',
    }])).toThrow('EVIDENCE_SUPERSESSION_SOURCE_MISMATCH');
  });

  test('keeps the cash counting dimension bound to cash movement records', () => {
    const active = bankCashRecord('cash-active', null, 'active');
    expect(() => parseTaxEvidenceBatchV1(bankCashBatch([{
      ...active,
      economicRole: 'accounting_entry',
    }]))).toThrow('EVIDENCE_CASH_ROLE_INVALID');
    expect(() => parseTaxEvidenceBatchV1(bankCashBatch([{
      ...active,
      countingDimension: 'none',
      direction: 'neutral',
      money: null,
      normalizedMoney: null,
    }]))).toThrow('EVIDENCE_CASH_DIMENSION_INVALID');
  });

  test('supports invoice withdrawal, dispute, and explicit reinstatement without retaining revenue', () => {
    const invoice = record();
    const withdrawn: TaxEvidenceRecord = {
      ...invoice,
      evidenceId: 'invoice:withdrawn',
      revision: '2',
      countingDimension: 'none',
      money: null,
      normalizedMoney: null,
      fxReferenceId: null,
      validityState: 'withdrawn',
      idempotencyKey: hash('invoice-key-withdrawn'),
      supersedesIdempotencyKey: invoice.idempotencyKey,
    };
    const disputed: TaxEvidenceRecord = {
      ...withdrawn,
      evidenceId: 'invoice:disputed',
      revision: '3',
      reviewState: 'disputed',
      validityState: 'disputed',
      idempotencyKey: hash('invoice-key-disputed'),
      supersedesIdempotencyKey: withdrawn.idempotencyKey,
    };
    const reinstated: TaxEvidenceRecord = {
      ...invoice,
      evidenceId: 'invoice:reinstated',
      revision: '4',
      money: { decimal: '750', currency: 'USD' },
      normalizedMoney: { decimal: '750', currency: 'USD' },
      fxReferenceId: null,
      idempotencyKey: hash('invoice-key-reinstated'),
      supersedesIdempotencyKey: disputed.idempotencyKey,
    };

    const cancelled = parseTaxEvidenceBatchV1(batch({ records: [invoice, withdrawn] }));
    expect(resolveActiveEvidenceRecords(cancelled.records)).toEqual([withdrawn]);
    expect(isActiveTaxEvidenceRecord(resolveActiveEvidenceRecords(cancelled.records)[0]!)).toBe(false);
    const restored = parseTaxEvidenceBatchV1(batch({ records: [invoice, withdrawn, disputed, reinstated] }));
    expect(resolveActiveEvidenceRecords(restored.records)).toEqual([reinstated]);
  });

  test('requires an explicit positive associated ARCA debit or credit note', () => {
    const credit: TaxEvidenceRecord = {
      ...record(),
      evidenceId: 'credit:1',
      revision: '1',
      economicEventId: 'economic:credit:1',
      invoiceDocumentKind: 'arca_nota_credito_e',
      invoiceAdjustmentKind: 'credit',
      adjustsEconomicEventId: 'economic:invoice:1',
      direction: 'outflow',
      money: { decimal: '100', currency: 'USD' },
      normalizedMoney: { decimal: '100', currency: 'USD' },
      fxReferenceId: null,
      idempotencyKey: hash('credit-key-1'),
    };
    expect(parseTaxEvidenceBatchV1(batch({ records: [credit] })).records[0]).toEqual(credit);
    expect(() => parseTaxEvidenceBatchV1(batch({
      records: [{ ...credit, invoiceAdjustmentKind: null }],
    }))).toThrow('EVIDENCE_INVOICE_ADJUSTMENT_KIND_INVALID');
    expect(() => parseTaxEvidenceBatchV1(batch({
      records: [{
        ...credit,
        money: { decimal: '0', currency: 'USD' },
        normalizedMoney: { decimal: '0', currency: 'USD' },
      }],
    }))).toThrow('EVIDENCE_COUNTING_AMOUNT_INVALID');
  });
});

export function batch(input: Partial<TaxEvidenceBatchV1> = {}): TaxEvidenceBatchV1 {
  const sourceIds = ['bufi-invoice'];
  return {
    version: 'tax-evidence-batch-v1',
    batchId: '10000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    source: {
      sourceId: 'bufi-invoice',
      sourceKind: 'bufi_invoice',
      canonicalProviderId: 'bufi',
      adapterSchemaVersion: 'desk-tax-evidence-v1',
    },
    checkpoint: { sequence: 1, revision: 'invoice-revision:1', observedAt: '2026-07-10T00:00:00.000Z' },
    mode: 'incremental',
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    capabilities: [{ capability: 'invoices', state: 'available', observedAt: '2026-07-10T00:00:00.000Z', safeErrorCode: null }],
    records: [record()],
    producedAt: '2026-07-10T00:00:01.000Z',
    ...input,
  };
}

function record(): TaxEvidenceRecord {
  return {
    evidenceId: 'invoice:1',
    workspaceId: '00000000-0000-4000-8000-000000000001',
    revision: '1',
    sourceId: 'bufi-invoice',
    sourceKind: 'bufi_invoice',
    canonicalProviderId: 'bufi',
    externalReferenceHash: hash('external:1'),
    sourceEventHash: hash('source-event:1'),
    artifactHash: hash('artifact:1'),
    jurisdiction: 'AR',
    period: { start: '2026-01-01', end: '2026-12-31' },
    observedAt: '2026-07-10T00:00:00.000Z',
    expiresAt: null,
    economicEventId: 'economic:invoice:1',
    economicRole: 'invoice',
    invoiceDocumentKind: 'arca_factura_e',
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    countingDimension: 'revenue',
    direction: 'inflow',
    money: { decimal: '1000.000001', currency: 'USDC' },
    normalizedMoney: { decimal: '1000.000001', currency: 'USD' },
    fxReferenceId: hash('key:fx:provider:1'),
    partyClaimHash: hash('party:1'),
    accountReferenceHash: hash('account:1'),
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
    validityState: 'active',
    consentVersion: 'consent-v1',
    idempotencyKey: hash('invoice-key-1'),
    supersedesIdempotencyKey: null,
  };
}

function settlementRecord(
  evidenceId: string,
  supersedesIdempotencyKey: string | null,
  validityState: TaxEvidenceRecord['validityState'],
): TaxEvidenceRecord {
  return {
    ...record(),
    evidenceId,
    revision: evidenceId,
    externalReferenceHash: hash(`external:${evidenceId}`),
    sourceEventHash: hash(`source-event:${evidenceId}`),
    artifactHash: hash(`artifact:${evidenceId}`),
    economicEventId: 'economic:invoice:1',
    economicRole: 'settlement',
    invoiceDocumentKind: null,
    countingDimension: 'none',
    money: null,
    normalizedMoney: null,
    fxReferenceId: null,
    idempotencyKey: hash(`key:${evidenceId}`),
    supersedesIdempotencyKey,
    validityState,
  };
}

function magicInboxBatch(records: readonly TaxEvidenceRecord[]): TaxEvidenceBatchV1 {
  const sourceId = 'magic-inbox';
  const sourceIds = [sourceId];
  return {
    ...batch(),
    source: {
      sourceId,
      sourceKind: 'magic_inbox',
      canonicalProviderId: 'bufi',
      adapterSchemaVersion: 'desk-magic-inbox-tax-v1',
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    capabilities: [
      {
        capability: 'receipts',
        state: 'available',
        observedAt: '2026-07-10T00:00:00.000Z',
        safeErrorCode: null,
      },
    ],
    records,
  };
}

function magicInboxReceipt(
  evidenceId: string,
  supersedesIdempotencyKey: string | null,
  validityState: TaxEvidenceRecord['validityState'],
): TaxEvidenceRecord {
  return {
    ...record(),
    evidenceId,
    revision: evidenceId,
    sourceId: 'magic-inbox',
    sourceKind: 'magic_inbox',
    externalReferenceHash: hash('magic-inbox:receipt:1'),
    sourceEventHash: hash(`magic-inbox:source-event:${evidenceId}`),
    artifactHash: hash(`magic-inbox:artifact:${evidenceId}`),
    economicEventId: 'transaction:1',
    economicRole: 'receipt',
    invoiceDocumentKind: null,
    countingDimension: 'none',
    direction: 'neutral',
    money: null,
    normalizedMoney: null,
    fxReferenceId: null,
    reviewState: validityState === 'disputed' ? 'disputed' : 'accepted',
    validityState,
    idempotencyKey: hash(`magic-inbox:key:${evidenceId}`),
    supersedesIdempotencyKey,
  };
}

function bankCashBatch(records: readonly TaxEvidenceRecord[]): TaxEvidenceBatchV1 {
  const sourceId = 'bank-connection:22222222-2222-4222-8222-222222222222';
  const sourceIds = [sourceId];
  return {
    ...batch(),
    source: {
      sourceId,
      sourceKind: 'bank',
      canonicalProviderId: 'plaid',
      adapterSchemaVersion: 'desk-bank-transaction-tax-v1',
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'consent-v1',
      scopeHash: hashTaxEvidenceConsentScope('consent-v1', sourceIds),
      sourceIds,
    },
    capabilities: [
      {
        capability: 'transactions',
        state: 'available',
        observedAt: '2026-07-10T00:00:00.000Z',
        safeErrorCode: null,
      },
    ],
    records,
  };
}

function bankCashRecord(
  evidenceId: string,
  supersedesIdempotencyKey: string | null,
  validityState: TaxEvidenceRecord['validityState'],
): TaxEvidenceRecord {
  const active = validityState === 'active';
  return {
    ...record(),
    evidenceId,
    revision: evidenceId,
    sourceId: 'bank-connection:22222222-2222-4222-8222-222222222222',
    sourceKind: 'bank',
    canonicalProviderId: 'plaid',
    externalReferenceHash: hash('bank:transaction:1'),
    sourceEventHash: hash(`bank:source-event:${evidenceId}`),
    artifactHash: hash(`bank:artifact:${evidenceId}`),
    economicEventId: 'bank-transaction:33333333-3333-4333-8333-333333333333',
    economicRole: 'cash_movement',
    invoiceDocumentKind: null,
    countingDimension: active ? 'cash' : 'none',
    direction: active ? 'inflow' : 'neutral',
    money: active ? { decimal: '9007199254740991.01', currency: 'USDC' } : null,
    normalizedMoney: active
      ? { decimal: '9007199254740991.01', currency: 'USDC' }
      : null,
    fxReferenceId: null,
    reviewState: validityState === 'disputed' ? 'disputed' : 'accepted',
    validityState,
    idempotencyKey: hash(`bank:key:${evidenceId}`),
    supersedesIdempotencyKey,
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
