import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, DocumentType } from './contracts';
import {
  normalizeWsfeAuthorization, normalizeWsfeDocument, normalizeWsfeLastInvoiceNumber,
  normalizeWsfePointsOfSale, SoapWsfeAuthorityClient, WsfeAmbiguousTransportError,
  type WsfeAuthorityClient, type XmlNode,
} from './soap';
import type { WsfeAccessTicket } from './wsaa';

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type Environment = 'homologation' | 'production';

/** workerd rejects `redirect: 'error'`; fetch with 'manual' and refuse any 3xx here. */
function refuseRedirect(response: Response): Response {
  if (response.type !== 'opaqueredirect' && (response.status < 300 || response.status > 399)) return response;
  void response.body?.cancel();
  throw new Error('HTTP_REDIRECT_REFUSED');
}

// Factura C uses AFIP SDK's WSFE transport with the short-lived ticket from
// our own WSAA boundary. The private signing key never leaves that boundary.
export class AfipSdkWsfeClient implements WsfeAuthorityClient {
  constructor(
    private readonly config: Readonly<{ accessToken: string; environment: Environment }>,
    private readonly direct: WsfeAuthorityClient = new SoapWsfeAuthorityClient(config.environment),
    private readonly fetcher: Fetcher = fetch,
  ) {
    if (!config.accessToken.trim()) throw new Error('AFIPSDK_ACCESS_TOKEN_REQUIRED');
  }

  async authorize(ticket: WsfeAccessTicket, payload: AuthorityPayload) {
    if (payload.documentType !== 11) return this.direct.authorize(ticket, payload);
    const detail: XmlNode = {
      Concepto: payload.concept,
      DocTipo: payload.receptor.docType,
      DocNro: payload.receptor.docNumber,
      CbteDesde: payload.invoiceNumber,
      CbteHasta: payload.invoiceNumber,
      CbteFch: arcaDate(payload.issueDate),
      ImpTotal: payload.total.decimal,
      ImpTotConc: 0,
      ImpNeto: payload.total.decimal,
      ImpOpEx: 0,
      ImpIVA: 0,
      ImpTrib: 0,
      ...(payload.servicePeriod ? {
        FchServDesde: arcaDate(payload.servicePeriod.from),
        FchServHasta: arcaDate(payload.servicePeriod.to),
        FchVtoPago: arcaDate(payload.servicePeriod.paymentDueDate),
      } : {}),
      MonId: 'PES', MonCotiz: 1,
      CondicionIVAReceptorId: payload.receptor.condicionIvaId,
    };
    const response = await this.call('FECAESolicitar', ticket, {
      FeCAEReq: {
        FeCabReq: { CantReg: 1, PtoVta: payload.pointOfSale, CbteTipo: 11 },
        FeDetReq: { FECAEDetRequest: detail },
      },
    });
    const result = response.parsed.FECAESolicitarResult;
    const header = result && typeof result === 'object' && !Array.isArray(result) ? result.FeCabResp : null;
    if (header && typeof header === 'object' && !Array.isArray(header)
      && (!['A', 'R'].includes(String(header.Resultado))
        || (header.Cuit !== undefined && String(header.Cuit) !== ticket.representedCuit)))
      throw new WsfeAmbiguousTransportError(response.rawHash);
    try { return normalizeWsfeAuthorization(response, payload); }
    catch { throw new WsfeAmbiguousTransportError(response.rawHash); }
  }

  async getLastInvoiceNumber(ticket: WsfeAccessTicket, documentType: DocumentType, pointOfSale: number) {
    if (documentType !== 11) return this.direct.getLastInvoiceNumber(ticket, documentType, pointOfSale);
    const response = await this.call('FECompUltimoAutorizado', ticket, { PtoVta: pointOfSale, CbteTipo: documentType });
    const result = response.parsed.FECompUltimoAutorizadoResult;
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || (!('CbteNro' in result) && !('Errors' in result))
      || (result.PtoVta !== undefined && Number(result.PtoVta) !== pointOfSale)
      || (result.CbteTipo !== undefined && Number(result.CbteTipo) !== documentType))
      throw new WsfeAmbiguousTransportError(response.rawHash);
    return normalizeWsfeLastInvoiceNumber(response);
  }

  async getDocument(ticket: WsfeAccessTicket, documentType: DocumentType, pointOfSale: number, invoiceNumber: string) {
    if (documentType !== 11) return this.direct.getDocument(ticket, documentType, pointOfSale, invoiceNumber);
    const response = await this.call('FECompConsultar', ticket, {
      FeCompConsReq: { CbteTipo: documentType, CbteNro: invoiceNumber, PtoVta: pointOfSale },
    });
    const result = response.parsed.FECompConsultarResult;
    if (!result || typeof result !== 'object' || Array.isArray(result)
      || (!('ResultGet' in result) && !('Errors' in result)))
      throw new WsfeAmbiguousTransportError(response.rawHash);
    try { return normalizeWsfeDocument(response); }
    catch { throw new WsfeAmbiguousTransportError(response.rawHash); }
  }

  async getPointsOfSale(ticket: WsfeAccessTicket) {
    return normalizeWsfePointsOfSale(await this.call('FEParamGetPtosVenta', ticket));
  }

  async assertPointOfSaleActive(ticket: WsfeAccessTicket, pointOfSale: number) {
    if (!(await this.getPointsOfSale(ticket)).activePoints.includes(pointOfSale))
      throw new Error('WSFE_POINT_OF_SALE_NOT_ACTIVE');
  }

  dummy() { return this.direct.dummy(); }

  private async call(method: string, ticket: WsfeAccessTicket, params: XmlNode = {}) {
    if (!/^\d{11}$/.test(ticket.representedCuit) || !ticket.token || !ticket.sign
      || Date.parse(ticket.expiresAt) <= Date.now()) throw new Error('AFIPSDK_BROKER_TICKET_INVALID');
    let response: Response;
    let raw: string;
    try {
      response = await this.fetcher('https://app.afipsdk.com/api/v1/afip/requests', {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${this.config.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          environment: this.config.environment === 'production' ? 'prod' : 'dev',
          wsid: 'wsfe', method,
          params: { Auth: { Token: ticket.token, Sign: ticket.sign, Cuit: ticket.representedCuit }, ...params },
        }),
      }).then(refuseRedirect);
      raw = await boundedText(response);
    } catch {
      throw new WsfeAmbiguousTransportError(hashCanonical({ method, outcome: 'transport_ambiguous' }));
    }
    const rawHash = hashCanonical(raw);
    if (!response.ok) throw new WsfeAmbiguousTransportError(hashCanonical({ method, status: response.status, rawHash }));
    let value: unknown;
    try { value = JSON.parse(raw); }
    catch { throw new WsfeAmbiguousTransportError(rawHash); }
    if (!value || typeof value !== 'object' || Array.isArray(value)
      || !Object.hasOwn(value, `${method}Result`)) throw new WsfeAmbiguousTransportError(rawHash);
    return { parsed: value as XmlNode, rawHash };
  }
}

function arcaDate(value: string) { return value.replaceAll('-', ''); }

async function boundedText(response: Response): Promise<string> {
  const limit = 2_097_152;
  if (Number(response.headers.get('content-length') ?? 0) > limit) {
    await response.body?.cancel();
    throw new Error('AFIPSDK_RESPONSE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('AFIPSDK_RESPONSE_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
