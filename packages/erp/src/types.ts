import type { EvidenceMoney } from '@tax-engine/core';

export type AccountingProviderId = 'quickbooks' | 'xero' | 'contaazul' | 'contabilium';

export type AccountingImportCapability =
  | 'ledger_accounts'
  | 'counterparties'
  | 'invoices'
  | 'bills'
  | 'payments'
  | 'tax_documents'
  | 'reconciliation';

export type CapabilityState = 'available' | 'partial' | 'unsupported' | 'failed' | 'stale' | 'sandbox_required';

export type AccountingImportPage<T> = Readonly<{
  providerId: AccountingProviderId;
  tenantId: string;
  schemaVersion: 'accounting-import-v1';
  records: readonly T[];
  nextCursor: Readonly<{ value: string; version: 'v1' }> | null;
  checkpoint: Readonly<{ sourceRevision: string; observedAt: string }>;
  capability: Readonly<{
    id: AccountingImportCapability;
    state: CapabilityState;
    safeErrorCode: string | null;
  }>;
}>;

export type TaxLine = Readonly<{
  taxType: string;
  rateDecimal: string | null;
  amount: EvidenceMoney | null;
  sourceReference: string;
  reviewState: 'provider_fact' | 'needs_review' | 'unsupported';
}>;

export type ImportedInvoice = Readonly<{
  externalId: string;
  sourceRevision: string;
  number: string | null;
  counterpartyExternalId: string | null;
  issuedAt: string;
  dueAt: string | null;
  settledAt: string | null;
  total: EvidenceMoney;
  taxLines: readonly TaxLine[];
  paymentExternalIds: readonly string[];
  taxDocumentExternalIds: readonly string[];
}>;

export type ImportedBill = ImportedInvoice;

export type ImportedPayment = Readonly<{
  externalId: string;
  sourceRevision: string;
  occurredAt: string;
  direction: 'received' | 'paid' | 'refund' | 'reversal';
  amount: EvidenceMoney;
  allocations: readonly Readonly<{
    documentKind: 'invoice' | 'bill';
    documentExternalId: string;
    amount: EvidenceMoney;
  }>[];
}>;

export type ImportedTaxDocument = Readonly<{
  externalId: string;
  sourceRevision: string;
  documentType: string;
  documentNumber: string | null;
  pointOfSale: string | null;
  caeReferenceHash: string | null;
  caeExpiresAt: string | null;
  issuedAt: string;
  relatedDocumentExternalIds: readonly string[];
  taxLines: readonly TaxLine[];
}>;

export interface AccountingImportProvider {
  readonly providerId: AccountingProviderId;
  getImportCapabilities(tenantId: string): Promise<readonly Readonly<{ id: AccountingImportCapability; state: CapabilityState }>[] >;
  readInvoicesPage(input: Readonly<{ tenantId: string; cursor: string | null; limit: number }>): Promise<AccountingImportPage<ImportedInvoice>>;
  readBillsPage(input: Readonly<{ tenantId: string; cursor: string | null; limit: number }>): Promise<AccountingImportPage<ImportedBill>>;
  readPaymentsPage(input: Readonly<{ tenantId: string; cursor: string | null; limit: number }>): Promise<AccountingImportPage<ImportedPayment>>;
  readTaxDocumentsPage(input: Readonly<{ tenantId: string; cursor: string | null; limit: number }>): Promise<AccountingImportPage<ImportedTaxDocument>>;
}
