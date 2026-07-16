import { createHash } from 'node:crypto';
import { z } from 'zod';

import { FINANCIAL_DECIMAL_RE, FinancialDecimal } from '../financial-decimal';
import type { TaxConsentPurpose } from '../types';
import type { TaxEvidenceBatchV1, TaxEvidenceRecord } from './types';

const SHA256_RE = /^[a-f0-9]{64}$/;
const safeOpaqueIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:/-]+$/);
export const taxWorkspaceIdSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const sourceKindSchema = z.enum([
  'bank',
  'wallet',
  'crypto',
  'stripe',
  'fx',
  'payroll',
  'bufi_invoice',
  'bufi_bill',
  'accounting',
  'magic_inbox',
  'transaction_enrichment',
  'knowledge_graph',
  'financial_analytics',
]);
const capabilitySchema = z.object({
  capability: z.enum([
    'transactions',
    'ledger_accounts',
    'payments',
    'payouts',
    'fees',
    'invoices',
    'bills',
    'payroll',
    'fx_rates',
    'counterparties',
    'tax_lines',
    'tax_documents',
    'documents',
    'receipts',
    'classification',
    'reconciliation',
    'entity_resolution',
    'actuals',
    'cash_planning',
  ]),
  state: z.enum(['available', 'partial', 'unsupported', 'failed', 'stale']),
  observedAt: z.iso.datetime({ offset: true }).nullable(),
  safeErrorCode: z.string().min(1).max(80).regex(/^[A-Z0-9_]+$/).nullable(),
}).strict();
const moneySchema = z.object({
  decimal: z.string().max(92).regex(FINANCIAL_DECIMAL_RE),
  currency: z.string().regex(/^[A-Z][A-Z0-9]{2,11}$/),
}).strict();
const evidenceRecordSchema = z.object({
  evidenceId: safeOpaqueIdSchema,
  workspaceId: taxWorkspaceIdSchema,
  revision: safeOpaqueIdSchema,
  sourceId: safeOpaqueIdSchema,
  sourceKind: sourceKindSchema,
  canonicalProviderId: safeOpaqueIdSchema.nullable(),
  externalReferenceHash: z.string().regex(SHA256_RE),
  sourceEventHash: z.string().regex(SHA256_RE),
  artifactHash: z.string().regex(SHA256_RE),
  jurisdiction: z.enum(['AR', 'US']).nullable(),
  period: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
  observedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  economicEventId: safeOpaqueIdSchema,
  economicRole: z.enum([
    'invoice',
    'payment',
    'settlement',
    'expense',
    'receipt',
    'accounting_entry',
    'payroll_obligation',
    'payroll_settlement',
    'fee',
    'tax',
    'cash_movement',
  ]),
  invoiceDocumentKind: z.enum([
    'arca_factura_e',
    'arca_factura_a',
    'arca_factura_b',
    'arca_factura_c',
    'arca_fce',
    'arca_nota_debito_e',
    'arca_nota_credito_e',
    'commercial_invoice',
    'unknown',
  ]).nullable().default(null),
  invoiceAdjustmentKind: z.enum(['debit', 'credit']).nullable().default(null),
  adjustsEconomicEventId: safeOpaqueIdSchema.nullable().default(null),
  countingDimension: z.enum(['revenue', 'expense', 'cash', 'fee', 'tax', 'withholding', 'none']),
  direction: z.enum(['inflow', 'outflow', 'neutral']),
  money: moneySchema.nullable(),
  normalizedMoney: moneySchema.nullable(),
  fxReferenceId: z.string().regex(SHA256_RE).nullable(),
  partyClaimHash: z.string().regex(SHA256_RE).nullable(),
  accountReferenceHash: z.string().regex(SHA256_RE).nullable(),
  confidence: z.object({
    extraction: z.string().min(1).max(32).nullable(),
    classification: z.string().min(1).max(32).nullable(),
    matching: z.string().min(1).max(32).nullable(),
  }).strict(),
  reviewState: z.enum(['unreviewed', 'accepted', 'rejected', 'disputed']),
  validityState: z.enum(['active', 'withdrawn', 'disputed']).default('active'),
  consentVersion: safeOpaqueIdSchema,
  idempotencyKey: z.string().regex(SHA256_RE),
  supersedesIdempotencyKey: z.string().regex(SHA256_RE).nullable(),
}).strict();
const batchSchema = z.object({
  version: z.literal('tax-evidence-batch-v1'),
  batchId: z.uuid(),
  workspaceId: taxWorkspaceIdSchema,
  source: z.object({
    sourceId: safeOpaqueIdSchema,
    sourceKind: sourceKindSchema,
    canonicalProviderId: safeOpaqueIdSchema.nullable(),
    adapterSchemaVersion: safeOpaqueIdSchema,
  }).strict(),
  checkpoint: z.object({
    sequence: z.number().int().positive().safe(),
    revision: safeOpaqueIdSchema,
    observedAt: z.iso.datetime({ offset: true }),
  }).strict(),
  mode: z.enum(['incremental', 'full_snapshot']),
  consent: z.object({
    purpose: z.literal('tax_workspace_processing'),
    version: safeOpaqueIdSchema,
    scopeHash: z.string().regex(SHA256_RE),
    sourceIds: z.array(safeOpaqueIdSchema).min(1).max(100),
  }).strict(),
  capabilities: z.array(capabilitySchema).min(1).max(19),
  records: z.array(evidenceRecordSchema).max(500),
  producedAt: z.iso.datetime({ offset: true }),
}).strict();

export function parseTaxEvidenceBatchV1(value: unknown): TaxEvidenceBatchV1 {
  const batch = batchSchema.parse(value) as TaxEvidenceBatchV1;
  assertTaxEvidenceBatchV1(batch);
  return batch;
}

export function hashTaxEvidenceConsentScope(version: string, sourceIds: readonly string[]): string {
  return hashTaxConsentScope('tax_workspace_processing', version, sourceIds);
}

export function hashTaxConsentScope(
  purpose: Extract<TaxConsentPurpose, 'tax_workspace_processing' | 'tax_evidence_quality'>,
  version: string,
  sourceIds: readonly string[],
): string {
  const canonical = {
    purpose,
    version,
    sourceIds: [...new Set(sourceIds)].sort(),
  };
  return createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
}

export function hashTaxEvidenceBatch(batch: TaxEvidenceBatchV1): string {
  return createHash('sha256').update(JSON.stringify(sortCanonical(batch)), 'utf8').digest('hex');
}

export function assertTaxEvidenceBatchV1(batch: TaxEvidenceBatchV1): void {
  const canonicalSourceIds = [...new Set(batch.consent.sourceIds)].sort();
  if (canonicalSourceIds.length !== batch.consent.sourceIds.length
    || canonicalSourceIds.some((sourceId, index) => sourceId !== batch.consent.sourceIds[index])) {
    throw new Error('EVIDENCE_CONSENT_SOURCE_IDS_NOT_CANONICAL');
  }
  if (!canonicalSourceIds.includes(batch.source.sourceId)) throw new Error('EVIDENCE_SOURCE_OUTSIDE_CONSENT');
  if (batch.consent.scopeHash !== hashTaxEvidenceConsentScope(batch.consent.version, canonicalSourceIds)) {
    throw new Error('EVIDENCE_CONSENT_SCOPE_HASH_INVALID');
  }
  if (new Set(batch.capabilities.map(result => result.capability)).size !== batch.capabilities.length) {
    throw new Error('EVIDENCE_CAPABILITY_DUPLICATE');
  }
  if (instant(batch.checkpoint.observedAt) > instant(batch.producedAt)) throw new Error('EVIDENCE_CHECKPOINT_IN_FUTURE');

  const recordKeys = new Set<string>();
  for (const record of batch.records) {
    assertBatchRecord(batch, record);
    if (recordKeys.has(record.idempotencyKey)) throw new Error('EVIDENCE_BATCH_RECORD_DUPLICATE');
    recordKeys.add(record.idempotencyKey);
  }
}

export function resolveActiveEvidenceRecords(
  records: readonly TaxEvidenceRecord[],
  options: Readonly<{ requireTargets?: boolean }> = {},
): readonly TaxEvidenceRecord[] {
  const byKey = new Map<string, TaxEvidenceRecord>();
  const successorByKey = new Map<string, string>();
  for (const record of records) {
    const existing = byKey.get(record.idempotencyKey);
    if (existing && hashTaxEvidenceRecord(existing) !== hashTaxEvidenceRecord(record)) {
      throw new Error('EVIDENCE_IDEMPOTENCY_CONFLICT');
    }
    byKey.set(record.idempotencyKey, record);
  }
  for (const record of byKey.values()) {
    const supersededKey = record.supersedesIdempotencyKey;
    if (!supersededKey) continue;
    if (supersededKey === record.idempotencyKey) throw new Error('EVIDENCE_SUPERSESSION_CYCLE');
    const target = byKey.get(supersededKey);
    if (!target) {
      if (options.requireTargets !== false) throw new Error('EVIDENCE_SUPERSESSION_TARGET_NOT_FOUND');
      const existingSuccessor = successorByKey.get(supersededKey);
      if (existingSuccessor && existingSuccessor !== record.idempotencyKey) throw new Error('EVIDENCE_SUPERSESSION_CONFLICT');
      successorByKey.set(supersededKey, record.idempotencyKey);
      continue;
    }
    if (target.workspaceId !== record.workspaceId || target.sourceId !== record.sourceId) {
      throw new Error('EVIDENCE_SUPERSESSION_SOURCE_MISMATCH');
    }
    const lifecycleRoles = new Set<TaxEvidenceRecord['economicRole']>([
      'settlement',
      'invoice',
      'receipt',
      'cash_movement',
    ]);
    const invoiceLifecycleIdentityMismatch = record.economicRole === 'invoice'
      && (target.invoiceAdjustmentKind !== record.invoiceAdjustmentKind
        || target.adjustsEconomicEventId !== record.adjustsEconomicEventId
        || ((!isActiveTaxEvidenceRecord(target) || !isActiveTaxEvidenceRecord(record))
          && target.invoiceDocumentKind !== record.invoiceDocumentKind));
    if ((lifecycleRoles.has(target.economicRole) || lifecycleRoles.has(record.economicRole))
      && (target.economicRole !== record.economicRole
        || target.economicEventId !== record.economicEventId
        || invoiceLifecycleIdentityMismatch)) {
      throw new Error(lifecycleSupersessionMismatchCode(record.economicRole));
    }
    const existingSuccessor = successorByKey.get(supersededKey);
    if (existingSuccessor && existingSuccessor !== record.idempotencyKey) throw new Error('EVIDENCE_SUPERSESSION_CONFLICT');
    successorByKey.set(supersededKey, record.idempotencyKey);
  }
  for (const key of byKey.keys()) {
    const visited = new Set<string>();
    let cursor: string | undefined = key;
    while (cursor) {
      if (visited.has(cursor)) throw new Error('EVIDENCE_SUPERSESSION_CYCLE');
      visited.add(cursor);
      cursor = successorByKey.get(cursor);
    }
  }
  return [...byKey.values()]
    .filter(record => !successorByKey.has(record.idempotencyKey))
    .sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey));
}

/** A chain tip can be a lifecycle tombstone; only active tips may support tax conclusions. */
export function isActiveTaxEvidenceRecord(record: TaxEvidenceRecord): boolean {
  return (record.validityState ?? 'active') === 'active';
}

function assertBatchRecord(batch: TaxEvidenceBatchV1, record: TaxEvidenceRecord): void {
  if (record.workspaceId !== batch.workspaceId) throw new Error('EVIDENCE_WORKSPACE_MISMATCH');
  if (record.sourceId !== batch.source.sourceId
    || record.sourceKind !== batch.source.sourceKind
    || record.canonicalProviderId !== batch.source.canonicalProviderId) {
    throw new Error('EVIDENCE_SOURCE_MISMATCH');
  }
  if (record.consentVersion !== batch.consent.version) throw new Error('EVIDENCE_CONSENT_VERSION_MISMATCH');
  if (instant(record.observedAt) > instant(batch.producedAt)) throw new Error('EVIDENCE_RECORD_IN_FUTURE');
  if (record.period.start > record.period.end) throw new Error('EVIDENCE_PERIOD_INVALID');
  if (record.expiresAt && instant(record.expiresAt) < instant(record.observedAt)) throw new Error('EVIDENCE_EXPIRY_INVALID');
  if (record.money && record.normalizedMoney
    && record.money.currency !== record.normalizedMoney.currency
    && !record.fxReferenceId
    && record.sourceKind !== 'fx') {
    throw new Error('EVIDENCE_FX_REFERENCE_REQUIRED');
  }
  if (record.countingDimension !== 'none') {
    if (!record.money || !record.normalizedMoney) throw new Error('EVIDENCE_COUNTING_MONEY_REQUIRED');
    if (!new FinancialDecimal(record.money.decimal).gt(0)
      || !new FinancialDecimal(record.normalizedMoney.decimal).gt(0)) {
      throw new Error('EVIDENCE_COUNTING_AMOUNT_INVALID');
    }
    if (record.money.currency === record.normalizedMoney.currency
      && !new FinancialDecimal(record.money.decimal).eq(record.normalizedMoney.decimal)) {
      throw new Error('EVIDENCE_SAME_CURRENCY_AMOUNT_MISMATCH');
    }
  }
  if (record.countingDimension !== 'none' && record.reviewState !== 'accepted') throw new Error('EVIDENCE_COUNTING_REQUIRES_ACCEPTANCE');
  if (!isActiveTaxEvidenceRecord(record)) {
    const lifecycleReviewValid = record.validityState === 'withdrawn'
      ? record.reviewState === 'accepted'
      : record.validityState === 'disputed' && record.reviewState === 'disputed';
    if (!['settlement', 'invoice', 'receipt', 'cash_movement'].includes(record.economicRole)
      || !lifecycleReviewValid
      || record.supersedesIdempotencyKey === null
      || record.countingDimension !== 'none'
      || record.money !== null
      || record.normalizedMoney !== null
      || record.fxReferenceId !== null) {
      throw new Error('EVIDENCE_NON_ACTIVE_POINTER_INVALID');
    }
  }
  if (record.countingDimension === 'revenue' && record.economicRole !== 'invoice') throw new Error('EVIDENCE_REVENUE_ROLE_INVALID');
  if (record.countingDimension === 'expense' && record.economicRole !== 'expense') throw new Error('EVIDENCE_EXPENSE_ROLE_INVALID');
  if (record.countingDimension === 'cash' && record.economicRole !== 'cash_movement') {
    throw new Error('EVIDENCE_CASH_ROLE_INVALID');
  }
  if (record.economicRole === 'cash_movement' && isActiveTaxEvidenceRecord(record)
    && record.countingDimension !== 'cash') {
    throw new Error('EVIDENCE_CASH_DIMENSION_INVALID');
  }
  if (record.invoiceDocumentKind !== null && record.economicRole !== 'invoice') {
    throw new Error('EVIDENCE_INVOICE_DOCUMENT_KIND_ROLE_INVALID');
  }
  assertInvoiceAdjustment(record);
  assertCountingDirection(record);
  if (['financial_analytics', 'knowledge_graph', 'transaction_enrichment'].includes(record.sourceKind)
    && record.countingDimension !== 'none') {
    throw new Error('EVIDENCE_DERIVED_SOURCE_CANNOT_COUNT');
  }
  if (record.economicRole === 'payroll_settlement') throw new Error('EVIDENCE_PAYROLL_FINALITY_NOT_AVAILABLE');
  if (record.economicRole === 'settlement'
    && (record.sourceKind !== 'bufi_invoice'
      || record.reviewState !== 'accepted'
      || record.countingDimension !== 'none'
      || record.money !== null
      || record.normalizedMoney !== null)) {
    throw new Error('EVIDENCE_SETTLEMENT_POINTER_INVALID');
  }
}

function lifecycleSupersessionMismatchCode(
  role: TaxEvidenceRecord['economicRole'],
): string {
  if (role === 'settlement') return 'EVIDENCE_SETTLEMENT_SUPERSESSION_MISMATCH';
  if (role === 'receipt') return 'EVIDENCE_RECEIPT_SUPERSESSION_MISMATCH';
  if (role === 'cash_movement') return 'EVIDENCE_CASH_SUPERSESSION_MISMATCH';
  return 'EVIDENCE_INVOICE_SUPERSESSION_MISMATCH';
}

function assertInvoiceAdjustment(record: TaxEvidenceRecord): void {
  const kind = record.invoiceAdjustmentKind;
  const target = record.adjustsEconomicEventId;
  const expectedKind = record.invoiceDocumentKind === 'arca_nota_debito_e'
    ? 'debit'
    : record.invoiceDocumentKind === 'arca_nota_credito_e'
      ? 'credit'
      : null;
  if (expectedKind === null) {
    if (kind !== null || target !== null) throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_KIND_INVALID');
    return;
  }
  if (record.economicRole !== 'invoice' || kind !== expectedKind || !target || target === record.economicEventId) {
    throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_KIND_INVALID');
  }
  if (record.jurisdiction !== 'AR') throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_JURISDICTION_INVALID');
  if (!isActiveTaxEvidenceRecord(record)) return;
  if (record.countingDimension !== 'revenue'
    || record.reviewState !== 'accepted'
    || !record.money
    || !record.normalizedMoney
    || !new FinancialDecimal(record.money.decimal).gt(0)
    || !new FinancialDecimal(record.normalizedMoney.decimal).gt(0)
    || (kind === 'debit' && record.direction !== 'inflow')
    || (kind === 'credit' && record.direction !== 'outflow')) {
    throw new Error('EVIDENCE_INVOICE_ADJUSTMENT_VALUE_INVALID');
  }
}

function assertCountingDirection(record: TaxEvidenceRecord): void {
  if (record.countingDimension === 'none') return;
  if (record.direction === 'neutral') throw new Error('EVIDENCE_COUNTING_DIRECTION_INVALID');
  if (record.countingDimension === 'revenue') {
    const expected = record.invoiceAdjustmentKind === 'credit' ? 'outflow' : 'inflow';
    if (record.direction !== expected) throw new Error('EVIDENCE_COUNTING_DIRECTION_INVALID');
  }
  if (record.countingDimension === 'expense' && record.direction !== 'outflow') {
    throw new Error('EVIDENCE_COUNTING_DIRECTION_INVALID');
  }
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('EVIDENCE_TIMESTAMP_INVALID');
  return parsed;
}

export function hashTaxEvidenceRecord(record: TaxEvidenceRecord): string {
  return createHash('sha256').update(JSON.stringify(sortCanonical(record)), 'utf8').digest('hex');
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortCanonical(nested)]));
  }
  return value;
}
