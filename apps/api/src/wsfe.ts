import { assertArcaFiscalBeta } from './arca-fiscal-beta';
import { hashCanonical } from '@tax-engine/core';
import { nextVoucherSchema, pointOfSaleDiscoverySchema, pointOfSaleReadbackSchema, signerRequestSchema, signerResponseSchema, type NextVoucher, type NextVoucherRequest, type PointOfSaleDiscovery, type PointOfSaleReadback, type SignerRequest, type SignerResponse } from '@tax-engine/wsfe-signer/contracts';

import { readBoundedBody, refuseRedirect } from './bounded-body';

export interface WsfePointOfSaleGateway {
  discoverPointsOfSale(input: Readonly<{ workspaceId: string; issuerProfileRef: string }>): Promise<PointOfSaleDiscovery>;
  verifyPointOfSaleReadback(input: Readonly<{ workspaceId: string; issuerProfileRef: string; pointOfSale: 1 }>): Promise<PointOfSaleReadback>;
}

type WsfeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class HttpWsfePointOfSaleGateway implements WsfePointOfSaleGateway {
  readonly #origin: string;
  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string; environment: 'homologation' | 'production' }>,
    private readonly fetcher: WsfeFetch = (input, init) => fetch(input, init),
    private readonly effectGuard: ((workspaceId: string) => void) | null = null,
  ) {
    const endpoint = new URL(config.baseUrl);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) throw new Error('ARCA_WSFE_SIGNER_URL_INVALID');
    const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !(config.environment === 'homologation' && process.env.NODE_ENV !== 'production' && loopback))
      throw new Error('ARCA_WSFE_SIGNER_HTTPS_REQUIRED');
    this.#origin = endpoint.origin;
  }

  static fromEnvironment(fetcher?: WsfeFetch): HttpWsfePointOfSaleGateway | null {
    const baseUrl = process.env.ARCA_WSFE_SIGNER_URL ?? '';
    const token = process.env.ARCA_WSFE_SIGNER_TOKEN ?? '';
    const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
    return baseUrl && token ? new HttpWsfePointOfSaleGateway({ baseUrl, token, environment }, fetcher, assertArcaFiscalBeta) : null;
  }

  discoverPointsOfSale(input: Readonly<{ workspaceId: string; issuerProfileRef: string }>): Promise<PointOfSaleDiscovery> {
    return this.call('/v1/wsfev1/params/points-of-sale/discover', input, pointOfSaleDiscoverySchema);
  }

  verifyPointOfSaleReadback(input: Readonly<{ workspaceId: string; issuerProfileRef: string; pointOfSale: 1 }>): Promise<PointOfSaleReadback> {
    if (this.config.environment !== 'homologation') throw new Error('ARCA_WSFE_POS_READBACK_HOMOLOGATION_ONLY');
    return this.call('/v1/wsfev1/params/points-of-sale/verify-readback', input, pointOfSaleReadbackSchema);
  }

  getNextVoucher(input: NextVoucherRequest): Promise<NextVoucher> {
    this.effectGuard?.(input.workspaceId);
    return this.call('/v1/wsfev1/params/next-voucher', input, nextVoucherSchema);
  }

  /** An ambiguous transport result must be recovered with this exact requestId. */
  async issueInvoice(rawRequest: SignerRequest): Promise<SignerResponse> {
    const request = signerRequestSchema.parse(rawRequest);
    this.effectGuard?.(request.workspaceId);
    if (request.environment !== this.config.environment) throw new Error('ARCA_WSFE_ISSUE_ENVIRONMENT_MISMATCH');
    let response: Response;
    try {
      response = await this.fetcher(new URL('/v1/wsfev1/invoices', this.#origin), {
        method: 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json', 'idempotency-key': request.requestId },
        body: JSON.stringify(request), signal: AbortSignal.timeout(30_000),
      }).then(refuseRedirect);
    } catch { throw new Error('ARCA_WSFE_ISSUE_OUTCOME_UNKNOWN'); }
    if (!response.ok) {
      await readBoundedBody(response, 64 * 1024, 'ARCA_WSFE_SIGNER_ERROR_RESPONSE_TOO_LARGE');
      throw new Error(`ARCA_WSFE_ISSUE_OUTCOME_UNKNOWN_${response.status}`);
    }
    let receipt: SignerResponse;
    try { receipt = signerResponseSchema.parse(JSON.parse(await readBoundedBody(response, 64 * 1024, 'ARCA_WSFE_ISSUE_RESPONSE_TOO_LARGE'))); }
    catch { throw new Error('ARCA_WSFE_ISSUE_RESPONSE_INVALID'); }
    if (receipt.requestId !== request.requestId) throw new Error('ARCA_WSFE_ISSUE_BINDING_MISMATCH');
    if (receipt.status === 'accepted') {
      const expected = { intentHash: request.intentHash, ...request.expected };
      const echo = receipt.feCompConsultarEcho;
      if (receipt.resultado !== 'A' || !receipt.cae || !receipt.caeFchVto || !receipt.cbteNro
        || receipt.cbteTipo !== request.expected.documentType
        || receipt.ptoVta !== request.expected.pointOfSale || !receipt.authorizedDocument
        || JSON.stringify(receipt.authorizedDocument) !== JSON.stringify(expected)
        || (echo && (echo.cae !== receipt.cae || echo.caeExpiry !== receipt.caeFchVto
          || echo.documentType !== request.expected.documentType
          || echo.pointOfSale !== request.expected.pointOfSale
          || echo.issueDate !== request.expected.issueDate
          || echo.concept !== request.expected.concept
          || echo.receptorDocType !== request.expected.receptorDocType
          || echo.total.decimal !== request.expected.total.decimal
          || echo.total.currency !== request.expected.total.currency
          || echo.invoiceNumber !== receipt.cbteNro
          || echo.documentType !== receipt.cbteTipo || echo.pointOfSale !== receipt.ptoVta))) {
        throw new Error('ARCA_WSFE_ISSUE_BINDING_MISMATCH');
      }
    } else if (receipt.cae || receipt.authorizedDocument || receipt.feCompConsultarEcho) {
      throw new Error('ARCA_WSFE_ISSUE_BINDING_MISMATCH');
    }
    return receipt;
  }

  private async call<T extends PointOfSaleDiscovery | PointOfSaleReadback | NextVoucher>(
    path: string, input: Readonly<{ workspaceId: string; issuerProfileRef: string; pointOfSale?: number; documentType?: 11 }>, schema: { parse(value: unknown): T },
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.#origin), {
        method: 'POST', redirect: 'manual',
        headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(input), signal: AbortSignal.timeout(30_000),
      }).then(refuseRedirect);
    } catch { throw new Error('ARCA_WSFE_READ_UNAVAILABLE'); }
    if (!response.ok) {
      await readBoundedBody(response, 64 * 1024, 'ARCA_WSFE_SIGNER_ERROR_RESPONSE_TOO_LARGE');
      throw new Error(`ARCA_WSFE_READ_REJECTED_${response.status}`);
    }
    let receipt: T;
    try { receipt = schema.parse(JSON.parse(await readBoundedBody(response, 64 * 1024, 'ARCA_WSFE_READ_RESPONSE_TOO_LARGE'))); }
    catch { throw new Error('ARCA_WSFE_READ_RESPONSE_INVALID'); }
    if (receipt.environment !== this.config.environment
      || receipt.workspaceId !== input.workspaceId
      || receipt.issuerProfileReferenceHash !== hashCanonical(input.issuerProfileRef)
      || ('pointOfSale' in receipt && receipt.pointOfSale !== input.pointOfSale)
      || ('documentType' in receipt && input.documentType !== undefined && receipt.documentType !== input.documentType))
      throw new Error('ARCA_WSFE_POS_BINDING_MISMATCH');
    return receipt;
  }
}
