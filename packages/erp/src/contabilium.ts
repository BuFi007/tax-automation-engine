import { hashCanonical } from '@tax-engine/core';

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

type ContabiliumFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface ContabiliumTokenSource {
  getAccessToken(): Promise<string>;
}

export type ContabiliumClientCredentials = Readonly<{
  clientId: string;
  clientSecret: string;
}>;

export class ContabiliumClientCredentialsTokenSource implements ContabiliumTokenSource {
  readonly #credentials: ContabiliumClientCredentials;
  readonly #fetcher: ContabiliumFetch;
  readonly #clock: () => Date;
  #cached: Readonly<{ token: string; expiresAtMs: number }> | null = null;

  constructor(
    credentials: ContabiliumClientCredentials,
    fetcher: ContabiliumFetch = (input, init) => fetch(input, init),
    clock: () => Date = () => new Date(),
  ) {
    if (!credentials.clientId.trim() || !credentials.clientSecret.trim()) {
      throw new Error('CONTABILIUM_CREDENTIALS_REQUIRED');
    }
    this.#credentials = credentials;
    this.#fetcher = fetcher;
    this.#clock = clock;
  }

  async getAccessToken(): Promise<string> {
    const now = this.#clock().getTime();
    if (this.#cached && this.#cached.expiresAtMs - now > 60_000) return this.#cached.token;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.#credentials.clientId,
      client_secret: this.#credentials.clientSecret,
    });
    const response = await boundedFetch(this.#fetcher, `${CONTABILIUM_AR_ORIGIN}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new Error(`CONTABILIUM_TOKEN_REJECTED_${response.status}`);
    const payload = asRecord(await boundedJson(response));
    const token = requiredString(payload.access_token, 'CONTABILIUM_TOKEN_MISSING');
    const expiresIn = requiredPositiveInteger(payload.expires_in, 'CONTABILIUM_TOKEN_EXPIRY_INVALID');
    this.#cached = { token, expiresAtMs: now + expiresIn * 1000 };
    return token;
  }
}

export type ContabiliumRestSandboxConfig = Readonly<{
  tenantId: string;
  expectedAccountCommitment: string;
  sandboxEvidenceHash: string;
  dateFrom: string;
  dateTo: string;
}>;

/**
 * Real Contabilium REST reader, deliberately limited to an authorized sandbox.
 *
 * The public API currently exposes searchable sales invoices and individual
 * collection reads, but no documented enumerable purchase/payment feed. The
 * capability manifest therefore stays honest: invoices and fiscal documents
 * are available, counterparty/reconciliation data is partial, and bills plus
 * payments remain unsupported until the provider proves those resources in an
 * authorized sandbox.
 */
export class ContabiliumRestSandboxProvider implements AccountingImportProvider {
  readonly providerId = 'contabilium' as const;
  readonly #config: ContabiliumRestSandboxConfig;
  readonly #tokens: ContabiliumTokenSource;
  readonly #fetcher: ContabiliumFetch;
  readonly #clock: () => Date;
  #accountBindingChecked = false;
  #currencyById: ReadonlyMap<number, string> | null = null;

  constructor(
    config: ContabiliumRestSandboxConfig,
    tokens: ContabiliumTokenSource,
    fetcher: ContabiliumFetch = (input, init) => fetch(input, init),
    clock: () => Date = () => new Date(),
  ) {
    if (!config.tenantId.trim()) throw new Error('CONTABILIUM_TENANT_REQUIRED');
    assertHash(config.expectedAccountCommitment, 'CONTABILIUM_ACCOUNT_COMMITMENT_INVALID');
    assertHash(config.sandboxEvidenceHash, 'CONTABILIUM_SANDBOX_EVIDENCE_INVALID');
    assertIsoDate(config.dateFrom, 'CONTABILIUM_DATE_FROM_INVALID');
    assertIsoDate(config.dateTo, 'CONTABILIUM_DATE_TO_INVALID');
    if (config.dateFrom > config.dateTo) throw new Error('CONTABILIUM_DATE_RANGE_INVALID');
    this.#config = config;
    this.#tokens = tokens;
    this.#fetcher = fetcher;
    this.#clock = clock;
  }

  async getImportCapabilities(tenantId: string) {
    await this.#ensureTenant(tenantId);
    return CAPABILITIES.map(id => ({ id, state: LIVE_CAPABILITY_STATE[id] }));
  }

  async readInvoicesPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    const page = await this.#readDocumentsPage(input);
    return {
      ...page.envelope,
      records: page.documents.map(document => normalizeInvoice(document, page.currencyById)),
      capability: capability('invoices', 'available', null),
    } satisfies AccountingImportPage<ImportedInvoice>;
  }

  async readTaxDocumentsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    const page = await this.#readDocumentsPage(input);
    return {
      ...page.envelope,
      records: page.documents
        .filter(document => optionalString(document.Cae) !== null)
        .map(document => normalizeTaxDocument(document, page.currencyById)),
      capability: capability('tax_documents', 'available', null),
    } satisfies AccountingImportPage<ImportedTaxDocument>;
  }

  async readBillsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    await this.#ensureTenant(input.tenantId);
    return this.#unsupportedPage<ImportedBill>(input, 'bills', 'CONTABILIUM_BILLS_SEARCH_NOT_DOCUMENTED');
  }

  async readPaymentsPage(input: { tenantId: string; cursor: string | null; limit: number }) {
    await this.#ensureTenant(input.tenantId);
    return this.#unsupportedPage<ImportedPayment>(input, 'payments', 'CONTABILIUM_PAYMENT_ENUMERATION_NOT_DOCUMENTED');
  }

  async #readDocumentsPage(input: { tenantId: string; cursor: string | null; limit: number }): Promise<Readonly<{
    envelope: Omit<AccountingImportPage<never>, 'records' | 'capability'>;
    documents: readonly Record<string, unknown>[];
    currencyById: ReadonlyMap<number, string>;
  }>> {
    validatePageInput(input);
    await this.#ensureTenant(input.tenantId);
    const cursor = parseCursor(input.cursor);
    const token = await this.#tokens.getAccessToken();
    const searchUrl = new URL('/api/comprobantes/search', CONTABILIUM_AR_ORIGIN);
    searchUrl.searchParams.set('page', String(cursor.page));
    searchUrl.searchParams.set('fechaDesde', this.#config.dateFrom);
    searchUrl.searchParams.set('fechaHasta', this.#config.dateTo);
    const search = await this.#getJson(searchUrl, token);
    const searchRecord = asRecord(search);
    const items = requiredArray(searchRecord.Items, 'CONTABILIUM_INVOICE_ITEMS_INVALID').map(asRecord);
    const totalItems = requiredNonNegativeInteger(searchRecord.TotalItems, 'CONTABILIUM_TOTAL_ITEMS_INVALID');
    const providerPageSize = requiredPositiveInteger(searchRecord.TotalPage, 'CONTABILIUM_PAGE_SIZE_INVALID');
    if (cursor.offset > items.length) throw new Error('Invalid cursor');
    const selected = items.slice(cursor.offset, cursor.offset + input.limit);
    const documents: Record<string, unknown>[] = [];
    for (const item of selected) {
      const id = requiredPositiveInteger(item.Id, 'CONTABILIUM_INVOICE_ID_INVALID');
      documents.push(asRecord(await this.#getJson(new URL(`/api/comprobantes/?id=${id}`, CONTABILIUM_AR_ORIGIN), token)));
    }
    const consumedOnPage = cursor.offset + selected.length;
    const consumedOverall = (cursor.page - 1) * providerPageSize + consumedOnPage;
    const nextCursor = consumedOnPage < items.length
      ? encodeCursor(cursor.page, consumedOnPage)
      : consumedOverall < totalItems
        ? encodeCursor(cursor.page + 1, 0)
        : null;
    const observedAt = this.#clock().toISOString();
    const responseHash = hashCanonical({
      providerId: this.providerId,
      accountCommitment: this.#config.expectedAccountCommitment,
      dateFrom: this.#config.dateFrom,
      dateTo: this.#config.dateTo,
      page: cursor.page,
      offset: cursor.offset,
      items,
      documents,
    });
    return {
      envelope: {
        providerId: this.providerId,
        tenantId: input.tenantId,
        schemaVersion: 'accounting-import-v1',
        nextCursor,
        checkpoint: { sourceRevision: responseHash, observedAt },
      },
      documents,
      currencyById: await this.#currencies(token),
    };
  }

  async #ensureTenant(tenantId: string): Promise<void> {
    if (tenantId !== this.#config.tenantId) throw new Error('TENANT_SCOPE_MISMATCH');
    if (this.#accountBindingChecked) return;
    const token = await this.#tokens.getAccessToken();
    const account = asRecord(await this.#getJson(new URL('/api/usuarios/obtenerinfo', CONTABILIUM_AR_ORIGIN), token));
    const commitment = contabiliumAccountCommitment({
      accountId: requiredPositiveInteger(account.IDUsuario, 'CONTABILIUM_ACCOUNT_ID_INVALID'),
      cuit: requiredString(account.CUIT, 'CONTABILIUM_ACCOUNT_CUIT_INVALID'),
    });
    if (commitment !== this.#config.expectedAccountCommitment) throw new Error('CONTABILIUM_ACCOUNT_BINDING_MISMATCH');
    this.#accountBindingChecked = true;
  }

  async #currencies(token: string): Promise<ReadonlyMap<number, string>> {
    if (this.#currencyById) return this.#currencyById;
    const rows = requiredArray(await this.#getJson(new URL('/api/monedas/search', CONTABILIUM_AR_ORIGIN), token), 'CONTABILIUM_CURRENCIES_INVALID').map(asRecord);
    const result = new Map<number, string>();
    for (const row of rows) {
      if (row.Activa === false) continue;
      const id = requiredPositiveInteger(row.IDMoneda, 'CONTABILIUM_CURRENCY_ID_INVALID');
      result.set(id, normalizeCurrency(row));
    }
    this.#currencyById = result;
    return result;
  }

  async #getJson(url: URL, token: string): Promise<unknown> {
    assertPinnedContabiliumUrl(url);
    const response = await boundedFetch(this.#fetcher, url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`CONTABILIUM_API_REJECTED_${response.status}`);
    return boundedJson(response);
  }

  #unsupportedPage<T>(
    input: { tenantId: string; cursor: string | null; limit: number },
    id: AccountingImportCapability,
    safeErrorCode: string,
  ): AccountingImportPage<T> {
    validatePageInput(input);
    return {
      providerId: this.providerId,
      tenantId: input.tenantId,
      schemaVersion: 'accounting-import-v1',
      records: [],
      nextCursor: null,
      checkpoint: {
        sourceRevision: hashCanonical({ providerId: this.providerId, tenantId: input.tenantId, id, state: 'unsupported' }),
        observedAt: this.#clock().toISOString(),
      },
      capability: capability(id, 'unsupported', safeErrorCode),
    };
  }
}

export function contabiliumAccountCommitment(input: Readonly<{ accountId: number; cuit: string }>): string {
  const cuit = input.cuit.replace(/\D/g, '');
  if (!Number.isSafeInteger(input.accountId) || input.accountId < 1) throw new Error('CONTABILIUM_ACCOUNT_ID_INVALID');
  if (!/^\d{11}$/.test(cuit)) throw new Error('CONTABILIUM_ACCOUNT_CUIT_INVALID');
  return hashCanonical({ providerId: 'contabilium', accountId: String(input.accountId), cuit });
}

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

const CONTABILIUM_AR_ORIGIN = 'https://rest.contabilium.com';
const MAX_RESPONSE_BYTES = 5_000_000;
const LIVE_CAPABILITY_STATE: Readonly<Record<AccountingImportCapability, CapabilityState>> = {
  ledger_accounts: 'unsupported',
  counterparties: 'partial',
  invoices: 'available',
  bills: 'unsupported',
  payments: 'unsupported',
  tax_documents: 'available',
  reconciliation: 'partial',
};

function normalizeInvoice(document: Record<string, unknown>, currencies: ReadonlyMap<number, string>): ImportedInvoice {
  const id = requiredPositiveInteger(document.Id, 'CONTABILIUM_INVOICE_ID_INVALID');
  const currency = currencyFor(document, currencies);
  const revision = hashCanonical(document);
  const cae = optionalString(document.Cae);
  return {
    externalId: `contabilium:invoice:${id}`,
    sourceRevision: revision,
    number: optionalString(document.Numero),
    counterpartyExternalId: optionalPositiveInteger(document.IdCliente) === null ? null : `contabilium:customer:${document.IdCliente}`,
    issuedAt: requiredIsoDateTime(document.FechaEmision, 'CONTABILIUM_ISSUED_AT_INVALID'),
    dueAt: optionalIsoDateTime(document.FechaVencimiento, 'CONTABILIUM_DUE_AT_INVALID'),
    settledAt: null,
    total: { decimal: parseLocalizedDecimal(document.ImporteTotalNeto), currency },
    taxLines: normalizeTaxLines(document, currency, id),
    paymentExternalIds: paymentReferences(document.Pagos),
    taxDocumentExternalIds: cae ? [`contabilium:tax-document:${id}`] : [],
  };
}

function normalizeTaxDocument(document: Record<string, unknown>, currencies: ReadonlyMap<number, string>): ImportedTaxDocument {
  const id = requiredPositiveInteger(document.Id, 'CONTABILIUM_INVOICE_ID_INVALID');
  const cae = requiredString(document.Cae, 'CONTABILIUM_CAE_INVALID');
  const related = optionalPositiveInteger(document.IdComprobanteAsociado);
  return {
    externalId: `contabilium:tax-document:${id}`,
    sourceRevision: hashCanonical(document),
    documentType: requiredString(document.TipoFc, 'CONTABILIUM_DOCUMENT_TYPE_INVALID'),
    documentNumber: optionalString(document.Numero),
    pointOfSale: pointOfSaleFromNumber(document.Numero),
    caeReferenceHash: hashCanonical({ providerId: 'contabilium', cae }),
    caeExpiresAt: null,
    issuedAt: requiredIsoDateTime(document.FechaEmision, 'CONTABILIUM_ISSUED_AT_INVALID'),
    relatedDocumentExternalIds: related === null ? [] : [`contabilium:invoice:${related}`],
    taxLines: normalizeTaxLines(document, currencyFor(document, currencies), id),
  };
}

function normalizeTaxLines(document: Record<string, unknown>, currency: string, documentId: number) {
  const rows = document.Tributos === null || document.Tributos === undefined ? [] : requiredArray(document.Tributos, 'CONTABILIUM_TAX_LINES_INVALID');
  return rows.map((raw, index) => {
    const row = asRecord(raw);
    const rate = row.Alicuota === null || row.Alicuota === undefined ? null : parsePlainDecimal(row.Alicuota, 'CONTABILIUM_TAX_RATE_INVALID');
    return {
      taxType: optionalString(row.Descripcion) ?? `contabilium_tributo_${String(row.Tipo ?? 'unknown')}`,
      rateDecimal: rate === null ? null : decimalPercentToRate(rate),
      amount: row.Importe === null || row.Importe === undefined ? null : { decimal: parsePlainDecimal(row.Importe, 'CONTABILIUM_TAX_AMOUNT_INVALID'), currency },
      sourceReference: `contabilium:invoice:${documentId}:tax:${optionalPositiveInteger(row.Id) ?? index}`,
      reviewState: 'provider_fact' as const,
    };
  });
}

function paymentReferences(raw: unknown): readonly string[] {
  if (raw === null || raw === undefined) return [];
  return requiredArray(raw, 'CONTABILIUM_PAYMENT_REFERENCES_INVALID').flatMap(value => {
    const row = asRecord(value);
    const id = optionalPositiveInteger(row.Id ?? row.ID ?? row.IdCobranza ?? row.IDCobranza);
    return id === null ? [] : [`contabilium:payment:${id}`];
  });
}

function currencyFor(document: Record<string, unknown>, currencies: ReadonlyMap<number, string>): string {
  const id = requiredPositiveInteger(document.IDMoneda, 'CONTABILIUM_DOCUMENT_CURRENCY_ID_INVALID');
  const currency = currencies.get(id);
  if (!currency) throw new Error('CONTABILIUM_DOCUMENT_CURRENCY_UNSUPPORTED');
  return currency;
}

function normalizeCurrency(row: Record<string, unknown>): string {
  const description = requiredString(row.DescripcionMoneda, 'CONTABILIUM_CURRENCY_DESCRIPTION_INVALID').toLowerCase();
  const code = requiredString(row.CodigoMoneda, 'CONTABILIUM_CURRENCY_CODE_INVALID').toUpperCase();
  if (description.includes('peso') && description.includes('argentin')) return 'ARS';
  if ((description.includes('dolar') || description.includes('dólar')) && description.includes('estadounid')) return 'USD';
  if (code === 'ARS' || code === 'USD' || code === 'EUR') return code;
  throw new Error('CONTABILIUM_CURRENCY_UNSUPPORTED');
}

function pointOfSaleFromNumber(value: unknown): string | null {
  const number = optionalString(value);
  const match = number?.match(/^(\d{1,5})-/);
  return match ? match[1]! : null;
}

function decimalPercentToRate(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
  const scale = fraction.length + 2;
  return decimalFromDigits(digits, scale);
}

function parseLocalizedDecimal(value: unknown): string {
  const raw = requiredString(value, 'CONTABILIUM_MONEY_INVALID').trim();
  if (!/^-?\d{1,3}(?:\.\d{3})*(?:,\d+)?$/.test(raw) && !/^-?\d+(?:,\d+)?$/.test(raw)) {
    throw new Error('CONTABILIUM_MONEY_INVALID');
  }
  return normalizeDecimal(raw.replace(/\./g, '').replace(',', '.'));
}

function parsePlainDecimal(value: unknown, error: string): string {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(error);
  const raw = String(value);
  if (!/^-?\d+(?:\.\d+)?$/.test(raw)) throw new Error(error);
  return normalizeDecimal(raw);
}

function normalizeDecimal(value: string): string {
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [wholeRaw, fractionRaw = ''] = unsigned.split('.');
  const whole = wholeRaw!.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');
  const normalized = fraction ? `${whole}.${fraction}` : whole;
  return negative && normalized !== '0' ? `-${normalized}` : normalized;
}

function decimalFromDigits(digitsRaw: string, scale: number): string {
  const digits = digitsRaw || '0';
  const padded = digits.padStart(scale + 1, '0');
  const split = padded.length - scale;
  return normalizeDecimal(`${padded.slice(0, split)}.${padded.slice(split)}`);
}

function capability(id: AccountingImportCapability, state: CapabilityState, safeErrorCode: string | null) {
  return { id, state, safeErrorCode } as const;
}

function validatePageInput(input: { cursor: string | null; limit: number }): void {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 200) throw new Error('Invalid page limit');
  parseCursor(input.cursor);
}

function parseCursor(value: string | null): Readonly<{ page: number; offset: number }> {
  if (value === null) return { page: 1, offset: 0 };
  const match = value.match(/^p:(\d+):o:(\d+)$/);
  if (!match) throw new Error('Invalid cursor');
  const page = Number(match[1]);
  const offset = Number(match[2]);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid cursor');
  return { page, offset };
}

function encodeCursor(page: number, offset: number) {
  return { value: `p:${page}:o:${offset}`, version: 'v1' as const };
}

async function boundedFetch(fetcher: ContabiliumFetch, input: string | URL, init: RequestInit): Promise<Response> {
  try {
    return await fetcher(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new Error('CONTABILIUM_TRANSPORT_FAILED');
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (length && Number(length) > MAX_RESPONSE_BYTES) throw new Error('CONTABILIUM_RESPONSE_TOO_LARGE');
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('CONTABILIUM_RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error('CONTABILIUM_RESPONSE_INVALID');
  }
}

function assertPinnedContabiliumUrl(url: URL): void {
  if (url.origin !== CONTABILIUM_AR_ORIGIN || url.username || url.password) throw new Error('CONTABILIUM_ORIGIN_REJECTED');
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CONTABILIUM_RESPONSE_INVALID');
  return value as Record<string, unknown>;
}

function requiredArray(value: unknown, error: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(error);
  return value;
}

function requiredString(value: unknown, error: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(error);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function requiredPositiveInteger(value: unknown, error: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error(error);
  return value;
}

function requiredNonNegativeInteger(value: unknown, error: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(error);
  return value;
}

function optionalPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function requiredIsoDateTime(value: unknown, error: string): string {
  const raw = requiredString(value, error);
  const parsed = new Date(raw.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw}-03:00`);
  if (Number.isNaN(parsed.getTime())) throw new Error(error);
  return parsed.toISOString();
}

function optionalIsoDateTime(value: unknown, error: string): string | null {
  return value === null || value === undefined ? null : requiredIsoDateTime(value, error);
}

function assertIsoDate(value: string, error: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) throw new Error(error);
}

function assertHash(value: string, error: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error(error);
}
