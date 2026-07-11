import type {
  AccountingImportCapability,
  AccountingImportPage,
  AccountingImportProvider,
  AccountingProviderId,
  ImportedBill,
  ImportedInvoice,
  ImportedPayment,
  ImportedTaxDocument,
} from './types';

export type WorkspaceAccountingSnapshot = Readonly<{
  providerId: Extract<AccountingProviderId, 'quickbooks' | 'xero' | 'contaazul'>;
  tenantId: string;
  sourceRevision: string;
  observedAt: string;
  invoices: readonly ImportedInvoice[];
  bills: readonly ImportedBill[];
  payments: readonly ImportedPayment[];
  taxDocuments: readonly ImportedTaxDocument[];
  capabilities: readonly AccountingImportCapability[];
}>;

/**
 * Bridge for the already-authorized workspace accounting connectors.
 * OAuth tokens stay in the connector platform; the tax engine receives only
 * normalized, checkpointed accounting records.
 */
export class WorkspaceAccountingBridgeProvider implements AccountingImportProvider {
  readonly providerId: WorkspaceAccountingSnapshot['providerId'];
  readonly #snapshot: WorkspaceAccountingSnapshot;

  constructor(snapshot: WorkspaceAccountingSnapshot) {
    this.providerId = snapshot.providerId;
    this.#snapshot = snapshot;
  }

  async getImportCapabilities(tenantId: string) {
    return ALL_CAPABILITIES.map(id => ({
      id,
      state: tenantId === this.#snapshot.tenantId && this.#snapshot.capabilities.includes(id) ? ('available' as const) : ('unsupported' as const),
    }));
  }

  readInvoicesPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'invoices', this.#snapshot.invoices);
  }

  readBillsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'bills', this.#snapshot.bills);
  }

  readPaymentsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'payments', this.#snapshot.payments);
  }

  readTaxDocumentsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'tax_documents', this.#snapshot.taxDocuments);
  }

  async #page<T>(
    input: { tenantId: string; cursor: string | null; limit: number },
    capability: AccountingImportCapability,
    records: readonly T[]
  ): Promise<AccountingImportPage<T>> {
    if (input.limit < 1 || input.limit > 200) throw new Error('Invalid page limit');
    if (input.tenantId !== this.#snapshot.tenantId) throw new Error('TENANT_SCOPE_MISMATCH');
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid cursor');
    const supported = this.#snapshot.capabilities.includes(capability);
    const pageRecords = supported ? records.slice(offset, offset + input.limit) : [];
    const next = offset + pageRecords.length;
    return {
      providerId: this.providerId,
      tenantId: input.tenantId,
      schemaVersion: 'accounting-import-v1',
      records: pageRecords,
      nextCursor: supported && next < records.length ? { value: String(next), version: 'v1' } : null,
      checkpoint: { sourceRevision: this.#snapshot.sourceRevision, observedAt: this.#snapshot.observedAt },
      capability: { id: capability, state: supported ? 'available' : 'unsupported', safeErrorCode: supported ? null : 'CAPABILITY_UNSUPPORTED' },
    };
  }
}

const ALL_CAPABILITIES: readonly AccountingImportCapability[] = [
  'ledger_accounts',
  'counterparties',
  'invoices',
  'bills',
  'payments',
  'tax_documents',
  'reconciliation',
];
