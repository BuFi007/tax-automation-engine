import type {
  AccountingImportCapability,
  AccountingImportPage,
  AccountingImportProvider,
  CapabilityState,
  ImportedBill,
  ImportedInvoice,
  ImportedPayment,
  ImportedTaxDocument,
} from './types';

type ContabiliumFixture = Readonly<{
  tenantId: string;
  sourceRevision: string;
  observedAt: string;
  invoices: readonly ImportedInvoice[];
  bills: readonly ImportedBill[];
  payments: readonly ImportedPayment[];
  taxDocuments: readonly ImportedTaxDocument[];
}>;

/**
 * Conformance-first Contabilium adapter.
 *
 * It intentionally accepts already-authorized server-side fixture/transport
 * data. Production credentials, tenant discovery, and endpoint claims remain
 * disabled until an authorized sandbox passes the conformance matrix.
 */
export class ContabiliumSandboxProvider implements AccountingImportProvider {
  readonly providerId = 'contabilium' as const;
  readonly #fixture: ContabiliumFixture | null;

  constructor(fixture: ContabiliumFixture | null) {
    this.#fixture = fixture;
  }

  async getImportCapabilities(tenantId: string) {
    const state: CapabilityState = this.#fixture?.tenantId === tenantId ? 'available' : 'sandbox_required';
    return CAPABILITIES.map(id => ({ id, state }));
  }

  readInvoicesPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'invoices', this.#fixture?.invoices ?? []);
  }

  readBillsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'bills', this.#fixture?.bills ?? []);
  }

  readPaymentsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'payments', this.#fixture?.payments ?? []);
  }

  readTaxDocumentsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    return this.#page(input, 'tax_documents', this.#fixture?.taxDocuments ?? []);
  }

  async #page<T>(
    input: { tenantId: string; cursor: string | null; limit: number },
    capability: AccountingImportCapability,
    records: readonly T[]
  ): Promise<AccountingImportPage<T>> {
    if (input.limit < 1 || input.limit > 200) throw new Error('Invalid page limit');
    const authorized = this.#fixture?.tenantId === input.tenantId;
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new Error('Invalid cursor');
    const pageRecords = authorized ? records.slice(offset, offset + input.limit) : [];
    const next = offset + pageRecords.length;
    return {
      providerId: this.providerId,
      tenantId: input.tenantId,
      schemaVersion: 'accounting-import-v1',
      records: pageRecords,
      nextCursor: authorized && next < records.length ? { value: String(next), version: 'v1' } : null,
      checkpoint: {
        sourceRevision: authorized ? this.#fixture!.sourceRevision : 'sandbox-required',
        observedAt: authorized ? this.#fixture!.observedAt : new Date(0).toISOString(),
      },
      capability: {
        id: capability,
        state: authorized ? 'available' : 'sandbox_required',
        safeErrorCode: authorized ? null : 'AUTHORIZED_SANDBOX_REQUIRED',
      },
    };
  }
}

const CAPABILITIES: readonly AccountingImportCapability[] = [
  'ledger_accounts',
  'counterparties',
  'invoices',
  'bills',
  'payments',
  'tax_documents',
  'reconciliation',
];
