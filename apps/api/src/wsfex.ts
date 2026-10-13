import { assertArcaFiscalBeta } from './arca-fiscal-beta';
import { hashCanonical, type FacturaEAgentRunV1 } from '@tax-engine/core';
import {
  pointOfSaleDiscoverySchema,
  pointOfSaleReadbackSchema,
  sequenceReservationReceiptSchema,
  signerResponseSchema,
  type PointOfSaleDiscovery,
  type PointOfSaleReadback,
  type SequenceReservationReceipt,
} from '@tax-engine/wsfex-signer/contracts';

export type WsfexAuthorityResult = Readonly<{
  providerId: string;
  requestId: string;
  status: 'accepted' | 'rejected' | 'ambiguous';
  invoiceNumber: string | null;
  cae: string | null;
  caeExpiry: string | null;
  currencyId: string | null;
  currencyQuote: string | null;
  reprocessed: boolean | null;
  receiptHash: string;
  authorityIdentityHash: string | null;
  reconciliationEvidenceHash: string | null;
  authorityEnvironment: 'homologation' | 'production';
}>;

export interface WsfexGateway {
  readonly providerId: string;
  authorize(input: WsfexInvoiceRequest): Promise<WsfexAuthorityResult>;
  recover(input: WsfexInvoiceRequest): Promise<WsfexAuthorityResult>;
  reconcile(input: WsfexInvoiceRequest): Promise<WsfexAuthorityResult>;
  authorizeAdjustment(input: WsfexAdjustmentRequest): Promise<WsfexAuthorityResult>;
  recoverAdjustment(input: WsfexAdjustmentRequest): Promise<WsfexAuthorityResult>;
}

export interface WsfexPointOfSaleGateway {
  discoverPointsOfSale(input: Readonly<{
    workspaceId: string;
    issuerProfileRef: string;
  }>): Promise<PointOfSaleDiscovery>;
  verifyPointOfSaleReadback(input: Readonly<{
    workspaceId: string;
    issuerProfileRef: string;
    pointOfSale: 2;
  }>): Promise<PointOfSaleReadback>;
}

export interface WsfexSequenceGateway {
  reserveSequence(input: Readonly<{
    workspaceId: string;
    issuerProfileRef: string;
    runId: string;
    intentHash: string;
    subjectId: string;
    pointOfSale: number;
    idempotencyKey: string;
  }>): Promise<SequenceReservationReceipt>;
}

export type WsfexInvoiceRequest = Readonly<{
  run: FacturaEAgentRunV1;
  requestId: string;
  authorityPayloadRef: string;
  authorityPayloadHash: string;
}>;

export type WsfexAdjustmentRequest = WsfexInvoiceRequest & Readonly<{
  adjustmentId: string;
}>;

type WsfexFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class HttpWsfexGateway implements WsfexGateway, WsfexPointOfSaleGateway, WsfexSequenceGateway {
  readonly providerId = 'tax-engine-wsfex-signer-v1';
  readonly #baseOrigin: string;

  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string; environment: 'homologation' | 'production' }>,
    private readonly fetcher: WsfexFetch = (input, init) => fetch(input, init),
    private readonly effectGuard: ((workspaceId: string) => void) | null = null
  ) {
    const endpoint = new URL(config.baseUrl);
    if (
      endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
      || !['', '/'].includes(endpoint.pathname)
    ) throw new Error('ARCA_SIGNER_URL_INVALID');
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
    if (
      endpoint.protocol !== 'https:'
      && !(config.environment === 'homologation' && process.env.NODE_ENV !== 'production' && loopback)
    ) throw new Error('ARCA_SIGNER_HTTPS_REQUIRED');
    this.#baseOrigin = endpoint.origin;
  }

  static fromEnvironment(): HttpWsfexGateway | null {
    const baseUrl = process.env.ARCA_SIGNER_URL ?? '';
    const token = process.env.ARCA_SIGNER_TOKEN ?? '';
    const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
    return baseUrl && token ? new HttpWsfexGateway({ baseUrl, token, environment }, undefined, assertArcaFiscalBeta) : null;
  }

  authorize(input: WsfexInvoiceRequest): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/authorize', input);
  }

  recover(input: WsfexInvoiceRequest): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/recover', input);
  }

  reconcile(input: WsfexInvoiceRequest): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/reconcile', input);
  }

  authorizeAdjustment(input: WsfexAdjustmentRequest): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/authorize', input, input.adjustmentId);
  }

  recoverAdjustment(input: WsfexAdjustmentRequest): Promise<WsfexAuthorityResult> {
    return this.call('/v1/wsfex/recover', input, input.adjustmentId);
  }

  async reserveSequence(input: Readonly<{
    workspaceId: string;
    issuerProfileRef: string;
    runId: string;
    intentHash: string;
    subjectId: string;
    pointOfSale: number;
    idempotencyKey: string;
  }>): Promise<SequenceReservationReceipt> {
    this.effectGuard?.(input.workspaceId);
    const endpoint = new URL('/v1/wsfexv1/sequence/reservations', `${this.#baseOrigin}/`);
    if (endpoint.origin !== this.#baseOrigin) throw new Error('ARCA_SIGNER_ORIGIN_MISMATCH');
    const body = {
      version: 'tax-wsfex-sequence-reservation-request-v1' as const,
      workspaceId: input.workspaceId,
      issuerProfileRef: input.issuerProfileRef,
      runId: input.runId,
      intentHash: input.intentHash,
      subjectId: input.subjectId,
      documentType: 19 as const,
      pointOfSale: input.pointOfSale,
      idempotencyKey: input.idempotencyKey,
    };
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error('ARCA_SEQUENCE_RESERVATION_UNAVAILABLE');
    }
    if (!response.ok) {
      await readBoundedResponseBody(response, 64 * 1024, 'ARCA_SIGNER_ERROR_RESPONSE_TOO_LARGE');
      throw new Error(`ARCA_SEQUENCE_RESERVATION_REJECTED_${response.status}`);
    }
    const raw = await readBoundedResponseBody(
      response,
      64 * 1024,
      'ARCA_SEQUENCE_RESERVATION_RESPONSE_TOO_LARGE'
    );
    let receipt: SequenceReservationReceipt;
    try {
      receipt = sequenceReservationReceiptSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error('ARCA_SEQUENCE_RESERVATION_RESPONSE_INVALID');
    }
    if (receipt.environment !== this.config.environment
      || receipt.workspaceId !== input.workspaceId
      || receipt.issuerProfileRef !== input.issuerProfileRef
      || receipt.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
      || receipt.runId !== input.runId
      || receipt.intentHash !== input.intentHash
      || receipt.subjectId !== input.subjectId
      || receipt.pointOfSale !== input.pointOfSale
      || receipt.idempotencyKey !== input.idempotencyKey)
      throw new Error('ARCA_SEQUENCE_RESERVATION_BINDING_MISMATCH');
    const { evidenceHash, ...material } = receipt;
    if (evidenceHash !== hashCanonical(material))
      throw new Error('ARCA_SEQUENCE_RESERVATION_HASH_MISMATCH');
    return receipt;
  }

  async discoverPointsOfSale(input: Readonly<{
    workspaceId: string;
    issuerProfileRef: string;
  }>): Promise<PointOfSaleDiscovery> {
    const endpoint = new URL('/v1/wsfexv1/params/points-of-sale/discover', `${this.#baseOrigin}/`);
    if (endpoint.origin !== this.#baseOrigin) throw new Error('ARCA_SIGNER_ORIGIN_MISMATCH');
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error('ARCA_POINT_OF_SALE_DISCOVERY_UNAVAILABLE');
    }
    if (!response.ok) {
      await readBoundedResponseBody(response, 64 * 1024, 'ARCA_SIGNER_ERROR_RESPONSE_TOO_LARGE');
      throw new Error(`ARCA_POINT_OF_SALE_DISCOVERY_REJECTED_${response.status}`);
    }
    const body = await readBoundedResponseBody(
      response,
      256 * 1024,
      'ARCA_POINT_OF_SALE_DISCOVERY_RESPONSE_TOO_LARGE'
    );
    let raw: unknown;
    try {
      raw = JSON.parse(body);
    } catch {
      throw new Error('ARCA_POINT_OF_SALE_DISCOVERY_RESPONSE_INVALID');
    }
    const receipt = pointOfSaleDiscoverySchema.parse(raw);
    if (
      receipt.environment !== this.config.environment
      || receipt.workspaceId !== input.workspaceId
      || receipt.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
    ) {
      throw new Error('ARCA_POINT_OF_SALE_DISCOVERY_BINDING_MISMATCH');
    }
    return receipt;
  }

  async verifyPointOfSaleReadback(input: Readonly<{
    workspaceId: string; issuerProfileRef: string; pointOfSale: 2;
  }>): Promise<PointOfSaleReadback> {
    if (this.config.environment !== 'homologation') throw new Error('ARCA_POS_READBACK_HOMOLOGATION_ONLY');
    const endpoint = new URL('/v1/wsfexv1/params/points-of-sale/verify-readback', `${this.#baseOrigin}/`);
    if (endpoint.origin !== this.#baseOrigin) throw new Error('ARCA_SIGNER_ORIGIN_MISMATCH');
    let response: Response;
    try {
      response = await this.fetcher(endpoint, {
        method: 'POST', redirect: 'error',
        headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input), signal: AbortSignal.timeout(30_000),
      });
    } catch { throw new Error('ARCA_POS_READBACK_UNAVAILABLE'); }
    if (!response.ok) {
      await readBoundedResponseBody(response, 64 * 1024, 'ARCA_SIGNER_ERROR_RESPONSE_TOO_LARGE');
      throw new Error(`ARCA_POS_READBACK_REJECTED_${response.status}`);
    }
    const body = await readBoundedResponseBody(response, 64 * 1024, 'ARCA_POS_READBACK_RESPONSE_TOO_LARGE');
    let receipt: PointOfSaleReadback;
    try { receipt = pointOfSaleReadbackSchema.parse(JSON.parse(body)); }
    catch { throw new Error('ARCA_POS_READBACK_RESPONSE_INVALID'); }
    if (receipt.workspaceId !== input.workspaceId
      || receipt.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
      || receipt.pointOfSale !== input.pointOfSale)
      throw new Error('ARCA_POS_READBACK_BINDING_MISMATCH');
    return receipt;
  }

  private async call(
    path: string,
    input: WsfexInvoiceRequest,
    adjustmentId: string | null = null
  ): Promise<WsfexAuthorityResult> {
    this.effectGuard?.(input.run.workspaceId);
    if (!input.run.intentHash || !input.run.intent) throw new Error('FROZEN_INTENT_REQUIRED');
    if (!/^[1-9]\d{0,14}$/.test(input.requestId)) throw new Error('WSFEX_REQUEST_ID_INVALID');
    const adjustment = adjustmentId ? input.run.adjustments.find(candidate => candidate.adjustmentId === adjustmentId) : null;
    if (adjustmentId && !adjustment) throw new Error('ADJUSTMENT_NOT_FOUND');
    const intentHash = adjustment?.intentHash ?? input.run.intentHash;
    const expected = adjustment
      ? {
          documentType: adjustment.documentType,
          operationType: 2 as const,
          pointOfSale: adjustment.associatedDocument.pointOfSale,
          issueDate: adjustment.issueDate,
          total: adjustment.amount,
          associatedDocument: adjustment.associatedDocument,
        }
      : {
          documentType: 19 as const,
          operationType: 2 as const,
          pointOfSale: input.run.intent.pointOfSale,
          issueDate: input.run.intent.issueDate,
          total: input.run.intent.total,
        };
    const safeRequest = {
      version: 'motora-wsfex-boundary-v1',
      environment: this.config.environment,
      workspaceId: input.run.workspaceId,
      runId: input.run.runId,
      requestId: input.requestId,
      subjectId: adjustment?.adjustmentId ?? input.run.intent.intentId,
      intentHash,
      authorityPayloadRef: input.authorityPayloadRef,
      authorityPayloadHash: input.authorityPayloadHash,
      expected,
    };
    let response: Response;
    try {
      const endpoint = new URL(path, `${this.#baseOrigin}/`);
      if (endpoint.origin !== this.#baseOrigin) throw new Error('ARCA_SIGNER_ORIGIN_MISMATCH');
      response = await this.fetcher(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
          'idempotency-key': input.requestId,
        },
        body: JSON.stringify(safeRequest),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      return {
        providerId: this.providerId,
        requestId: input.requestId,
        status: 'ambiguous',
        invoiceNumber: null,
        cae: null,
        caeExpiry: null,
        currencyId: null,
        currencyQuote: null,
        reprocessed: null,
        receiptHash: hashCanonical({ requestId: input.requestId, outcome: 'network_ambiguous', errorType: error instanceof Error ? error.name : 'unknown' }),
        authorityIdentityHash: null,
        reconciliationEvidenceHash: null,
        authorityEnvironment: this.config.environment,
      };
    }
    if (!response.ok) {
      const body = await readBoundedResponseBody(
        response,
        64 * 1024,
        'ARCA_SIGNER_ERROR_RESPONSE_TOO_LARGE'
      );
      if (response.status >= 500) {
        return {
          providerId: this.providerId,
          requestId: input.requestId,
          status: 'ambiguous',
          invoiceNumber: null,
          cae: null,
          caeExpiry: null,
          currencyId: null,
          currencyQuote: null,
          reprocessed: null,
          receiptHash: hashCanonical({ requestId: input.requestId, status: response.status, bodyHash: hashCanonical(body) }),
          authorityIdentityHash: null,
          reconciliationEvidenceHash: null,
          authorityEnvironment: this.config.environment,
        };
      }
      throw new Error(`ARCA_SIGNER_REJECTED_REQUEST_${response.status}`);
    }
    const body = await readBoundedResponseBody(
      response,
      256 * 1024,
      'ARCA_SIGNER_RESPONSE_TOO_LARGE'
    );
    let rawResult: unknown;
    try {
      rawResult = JSON.parse(body);
    } catch {
      throw new Error('ARCA_SIGNER_RESPONSE_INVALID');
    }
    const parsed = signerResponseSchema.parse(rawResult);
    if (parsed.requestId !== input.requestId) throw new Error('ARCA_SIGNER_REQUEST_ID_MISMATCH');
    if (parsed.status === 'accepted' && (!parsed.cae || !parsed.caeExpiry || !parsed.invoiceNumber || !parsed.authorizedDocument)) throw new Error('ARCA_SIGNER_ACCEPTED_RESULT_INCOMPLETE');
    if (parsed.authorizedDocument) {
      const expectedCurrencyQuote = input.run.intent.total.currency === 'ARS' ? '1' : input.run.intent.exchangeRate?.decimal;
      if (!expectedCurrencyQuote) throw new Error('FROZEN_INTENT_EXCHANGE_RATE_REQUIRED');
      const expectedAuthorizedDocument = {
        intentHash,
        ...expected,
        currencyId: parsed.authorizedDocument.currencyId,
        currencyQuote: expectedCurrencyQuote,
      };
      if (hashCanonical(parsed.authorizedDocument) !== hashCanonical(expectedAuthorizedDocument)) throw new Error('ARCA_SIGNER_AUTHORIZED_DOCUMENT_MISMATCH');
      if (
        (input.run.intent.total.currency === 'ARS' && parsed.authorizedDocument.currencyId !== 'PES')
        || (input.run.intent.total.currency !== 'ARS' && parsed.authorizedDocument.currencyId === 'PES')
      ) throw new Error('ARCA_SIGNER_AUTHORIZED_CURRENCY_MISMATCH');
    }
    if (parsed.reconciliation) {
      if (
        parsed.reconciliation.environment !== this.config.environment
        || parsed.reconciliation.payloadHash !== input.authorityPayloadHash
        || parsed.reconciliation.requestId !== input.requestId
        || parsed.reconciliation.intentHash !== intentHash
        || parsed.reconciliation.documentType !== expected.documentType
        || parsed.reconciliation.pointOfSale !== expected.pointOfSale
        || parsed.reconciliation.invoiceNumber !== parsed.invoiceNumber
        || parsed.reconciliation.cae !== parsed.cae
      ) throw new Error('ARCA_SIGNER_RECONCILIATION_BINDING_MISMATCH');
    }
    if (path === '/v1/wsfex/reconcile' && parsed.status === 'accepted' && !parsed.reconciliation) {
      throw new Error('ARCA_SIGNER_RECONCILIATION_ATTESTATION_REQUIRED');
    }
    return {
      providerId: this.providerId,
      requestId: parsed.requestId,
      status: parsed.status === 'preflight_rejected' ? 'rejected' : parsed.status,
      invoiceNumber: parsed.invoiceNumber,
      cae: parsed.cae,
      caeExpiry: parsed.caeExpiry,
      currencyId: parsed.authorizedDocument?.currencyId ?? null,
      currencyQuote: parsed.authorizedDocument?.currencyQuote ?? null,
      reprocessed: parsed.reprocessed,
      receiptHash: parsed.reconciliation?.evidenceHash ?? hashCanonical(parsed),
      authorityIdentityHash: parsed.reconciliation?.authorityIdentityHash ?? null,
      reconciliationEvidenceHash: parsed.reconciliation?.evidenceHash ?? null,
      authorityEnvironment: this.config.environment,
    };
  }
}

async function readBoundedResponseBody(
  response: Response,
  maxBytes: number,
  errorCode: string
): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    await response.body?.cancel();
    throw new Error(errorCode);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error(errorCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}
