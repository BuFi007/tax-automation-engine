import { hashCanonical } from '@tax-engine/core';
import { XMLParser } from 'fast-xml-parser';

import type { AuthorityPayload } from './contracts';
import type { WsfexAccessTicket } from './wsaa';

const NAMESPACE = 'http://ar.gov.afip.dif.fexv1/';
const ENDPOINTS = {
  homologation: 'https://wswhomo.afip.gov.ar/wsfexv1/service.asmx',
  production: 'https://servicios1.afip.gov.ar/wsfexv1/service.asmx',
} as const;

type SoapFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type XmlValue = string | number | boolean | null | XmlNode | XmlValue[];
type XmlNode = { [key: string]: XmlValue };

export class WsfexAmbiguousTransportError extends Error {
  constructor(readonly receiptHash: string) {
    super('WSFEX_TRANSPORT_AMBIGUOUS');
  }
}

export type WsfexAuthorizationResult = Readonly<{
  status: 'accepted' | 'rejected';
  requestId: string;
  documentType: 19 | 20 | 21;
  pointOfSale: number;
  invoiceNumber: string;
  issueDate: string;
  cae: string | null;
  reprocessed: boolean;
  safeErrors: readonly Readonly<{ code: string; message: string }>[];
  rawResponseHash: string;
}>;

export type WsfexRetrievedDocument = Readonly<{
  documentType: 19 | 20 | 21;
  pointOfSale: number;
  invoiceNumber: string;
  issueDate: string;
  currencyId: string;
  currencyQuote: string;
  total: string;
  cae: string;
  result: string;
  associatedDocument: Readonly<{ documentType: 19 | 20 | 21; pointOfSale: number; invoiceNumber: string }> | null;
  rawResponseHash: string;
}>;

export type WsfexCotizacion = Readonly<{ monId: string; ctz: string; date: string }>;

export interface WsfexAuthorityClient {
  authorize(ticket: WsfexAccessTicket, payload: AuthorityPayload): Promise<WsfexAuthorizationResult>;
  getLastRequestId(ticket: WsfexAccessTicket): Promise<string>;
  getLastInvoiceNumber(ticket: WsfexAccessTicket, documentType: 19 | 20 | 21, pointOfSale: number): Promise<string>;
  getDocument(ticket: WsfexAccessTicket, documentType: 19 | 20 | 21, pointOfSale: number, invoiceNumber: string): Promise<WsfexRetrievedDocument | null>;
  getCotizacion(ticket: WsfexAccessTicket, monId: string): Promise<WsfexCotizacion>;
  assertPointOfSaleActive(ticket: WsfexAccessTicket, pointOfSale: number): Promise<void>;
}

export class SoapWsfexAuthorityClient implements WsfexAuthorityClient {
  readonly #parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true, processEntities: false });

  constructor(
    private readonly environment: 'homologation' | 'production',
    private readonly fetcher: SoapFetch = (input, init) => fetch(input, init)
  ) {}

  async authorize(ticket: WsfexAccessTicket, payload: AuthorityPayload): Promise<WsfexAuthorizationResult> {
    const response = await this.call('FEXAuthorize', `<Auth>${authXml(ticket)}</Auth><Cmp>${payloadXml(payload, ticket.representedCuit)}</Cmp>`);
    const result = node(response.parsed.FEXResultAuth);
    const error = errorFrom(response.parsed);
    if (error && Object.keys(result).length === 0) {
      return {
        status: 'rejected',
        requestId: payload.requestId,
        documentType: payload.documentType,
        pointOfSale: payload.pointOfSale,
        invoiceNumber: payload.invoiceNumber,
        issueDate: payload.issueDate,
        cae: null,
        reprocessed: false,
        safeErrors: [{ code: error, message: `ARCA WSFEX error ${error}` }],
        rawResponseHash: response.rawHash,
      };
    }
    const status = text(result.Resultado) === 'A' ? 'accepted' as const : 'rejected' as const;
    const cae = nullableText(result.Cae);
    return {
      status,
      requestId: requiredText(result.Id, 'WSFEX_RESPONSE_ID_REQUIRED'),
      documentType: numberInSet(result.Cbte_tipo, [19, 20, 21], 'WSFEX_RESPONSE_DOCUMENT_TYPE_INVALID'),
      pointOfSale: positiveNumber(result.Punto_vta, 'WSFEX_RESPONSE_POINT_OF_SALE_INVALID'),
      invoiceNumber: requiredText(result.Cbte_nro, 'WSFEX_RESPONSE_INVOICE_NUMBER_REQUIRED'),
      issueDate: arcaDateToIso(requiredText(result.Fch_cbte, 'WSFEX_RESPONSE_DATE_REQUIRED')),
      cae: status === 'accepted' ? requiredText(cae, 'WSFEX_RESPONSE_CAE_REQUIRED') : null,
      reprocessed: text(result.Reproceso) === 'S',
      safeErrors: [
        ...(error ? [{ code: error, message: `ARCA WSFEX error ${error}` }] : []),
        ...(nullableText(result.Motivos_Obs) ? [{ code: 'ARCA_OBSERVATION', message: 'ARCA returned an observation; inspect the protected signer audit record.' }] : []),
      ],
      rawResponseHash: response.rawHash,
    };
  }

  async getLastRequestId(ticket: WsfexAccessTicket): Promise<string> {
    const response = await this.call('FEXGetLast_ID', `<Auth>${authXml(ticket)}</Auth>`);
    assertNoError(response.parsed);
    return requiredText(node(response.parsed.FEXResultGet).Id, 'WSFEX_LAST_ID_REQUIRED');
  }

  async getLastInvoiceNumber(ticket: WsfexAccessTicket, documentType: 19 | 20 | 21, pointOfSale: number): Promise<string> {
    const response = await this.call('FEXGetLast_CMP', `<Auth>${authXml(ticket)}<Pto_venta>${pointOfSale}</Pto_venta><Cbte_Tipo>${documentType}</Cbte_Tipo></Auth>`);
    assertNoError(response.parsed);
    return requiredText(node(response.parsed.FEXResult_LastCMP).Cbte_nro, 'WSFEX_LAST_INVOICE_NUMBER_REQUIRED');
  }

  async getDocument(ticket: WsfexAccessTicket, documentType: 19 | 20 | 21, pointOfSale: number, invoiceNumber: string): Promise<WsfexRetrievedDocument | null> {
    const response = await this.call('FEXGetCMP', `<Auth>${authXml(ticket)}</Auth><Cmp><Cbte_tipo>${documentType}</Cbte_tipo><Punto_vta>${pointOfSale}</Punto_vta><Cbte_nro>${escapeXml(invoiceNumber)}</Cbte_nro></Cmp>`);
    const error = errorFrom(response.parsed);
    if (error === '1020') return null;
    assertNoError(response.parsed);
    const result = node(response.parsed.FEXResultGet);
    const associated = firstNode(node(result.Cmps_asoc).Cmp_asoc);
    const cae = requiredText(result.Cae, 'WSFEX_RETRIEVED_CAE_REQUIRED');
    return {
      documentType: numberInSet(result.Cbte_tipo, [19, 20, 21], 'WSFEX_RETRIEVED_DOCUMENT_TYPE_INVALID'),
      pointOfSale: positiveNumber(result.Punto_vta, 'WSFEX_RETRIEVED_POINT_OF_SALE_INVALID'),
      invoiceNumber: requiredText(result.Cbte_nro, 'WSFEX_RETRIEVED_INVOICE_NUMBER_REQUIRED'),
      issueDate: arcaDateToIso(requiredText(result.Fecha_cbte, 'WSFEX_RETRIEVED_DATE_REQUIRED')),
      currencyId: requiredText(result.Moneda_Id, 'WSFEX_RETRIEVED_CURRENCY_REQUIRED'),
      currencyQuote: requiredText(result.Moneda_ctz, 'WSFEX_RETRIEVED_QUOTE_REQUIRED'),
      total: requiredText(result.Imp_total, 'WSFEX_RETRIEVED_TOTAL_REQUIRED'),
      cae,
      result: requiredText(result.Resultado, 'WSFEX_RETRIEVED_RESULT_REQUIRED'),
      associatedDocument: associated ? {
        documentType: numberInSet(associated.Cbte_tipo, [19, 20, 21], 'WSFEX_RETRIEVED_ASSOCIATION_TYPE_INVALID'),
        pointOfSale: positiveNumber(associated.Cbte_punto_vta, 'WSFEX_RETRIEVED_ASSOCIATION_POS_INVALID'),
        invoiceNumber: requiredText(associated.Cbte_nro, 'WSFEX_RETRIEVED_ASSOCIATION_NUMBER_REQUIRED'),
      } : null,
      rawResponseHash: response.rawHash,
    };
  }

  // FEXGetPARAM_Ctz is ARCA's ORIENTATIVO cotización for a currency (Mon_id) plus
  // its date. Used both to answer the ctz endpoint (fail-closed source) and as the
  // error-1667 sanity band on submit — never treated as the legal BNA rate.
  async getCotizacion(ticket: WsfexAccessTicket, monId: string): Promise<WsfexCotizacion> {
    const response = await this.call('FEXGetPARAM_Ctz', `<Auth>${authXml(ticket)}</Auth><Mon_id>${escapeXml(monId)}</Mon_id>`);
    assertNoError(response.parsed);
    const result = node(response.parsed.FEXResultGet);
    return {
      monId: nullableText(result.Mon_Id) ?? monId,
      ctz: requiredText(result.Mon_ctz, 'WSFEX_CTZ_QUOTE_REQUIRED'),
      // WSFEXV1 v3.1.1 §2.13.3 names the response field `Mon_fecha`.
      // Keep the older `Fch_cotiz` spelling as a defensive compatibility
      // fallback for fixtures/proxies that still expose the legacy shape.
      date: arcaDateToIso(requiredText(
        nullableText(result.Mon_fecha) ?? nullableText(result.Fch_cotiz),
        'WSFEX_CTZ_DATE_REQUIRED'
      )),
    };
  }

  async assertPointOfSaleActive(ticket: WsfexAccessTicket, pointOfSale: number): Promise<void> {
    const response = await this.call('FEXGetPARAM_PtoVenta', `<Auth>${authXml(ticket)}</Auth>`);
    assertNoError(response.parsed);
    const entries = asArray(node(response.parsed.FEXResultGet).ClsFEXResponse_PtoVenta);
    const active = entries.map(node).some(entry => Number(text(entry.Pve_Nro)) === pointOfSale && text(entry.Pve_Bloqueado) !== 'S' && !nullableText(entry.Pve_FchBaja));
    if (!active) throw new Error('WSFEX_POINT_OF_SALE_NOT_ACTIVE');
  }

  private async call(action: string, body: string): Promise<Readonly<{ parsed: XmlNode; rawHash: string }>> {
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><${action} xmlns="${NAMESPACE}">${body}</${action}></soap:Body></soap:Envelope>`;
    let response: Response;
    try {
      response = await this.fetcher(ENDPOINTS[this.environment], {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: `"${NAMESPACE}${action}"` },
        body: envelope,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      throw new WsfexAmbiguousTransportError(hashCanonical({ action, requestHash: hashCanonical(envelope), errorType: error instanceof Error ? error.name : 'unknown' }));
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 2_097_152) throw new Error('WSFEX_RESPONSE_TOO_LARGE');
    const rawHash = hashCanonical(raw);
    if (response.status >= 500) throw new WsfexAmbiguousTransportError(hashCanonical({ action, status: response.status, rawHash }));
    if (!response.ok) throw new Error(`WSFEX_HTTP_REJECTED_${response.status}`);
    const parsedEnvelope = node(this.#parser.parse(raw));
    const soapBody = node(node(parsedEnvelope.Envelope).Body);
    if (soapBody.Fault) throw new Error('WSFEX_SOAP_FAULT');
    const actionResponse = node(soapBody[`${action}Response`]);
    return { parsed: node(actionResponse[`${action}Result`]), rawHash };
  }
}

function payloadXml(payload: AuthorityPayload, representedCuit: string): string {
  const associated = payload.associatedDocument
    ? `<Cmps_asoc><Cmp_asoc><Cbte_tipo>${payload.associatedDocument.documentType}</Cbte_tipo><Cbte_punto_vta>${payload.associatedDocument.pointOfSale}</Cbte_punto_vta><Cbte_nro>${escapeXml(payload.associatedDocument.invoiceNumber)}</Cbte_nro><Cbte_cuit>${escapeXml(representedCuit)}</Cbte_cuit></Cmp_asoc></Cmps_asoc>`
    : '';
  const items = payload.items.map(item => `<Item>${optionalTag('Pro_codigo', item.code)}<Pro_ds>${escapeXml(item.description)}</Pro_ds>${optionalTag('Pro_qty', item.quantity)}<Pro_umed>${item.unitCode}</Pro_umed>${optionalTag('Pro_precio_uni', item.unitPrice)}${optionalTag('Pro_bonificacion', item.discount)}<Pro_total_item>${escapeXml(item.total)}</Pro_total_item></Item>`).join('');
  const sameCurrency = payload.documentType === 19 && payload.sameCurrencyPayment !== null ? `<CanMisMonExt>${payload.sameCurrencyPayment ? 'S' : 'N'}</CanMisMonExt>` : '';
  return [
    `<Id>${escapeXml(payload.requestId)}</Id>`,
    `<Fecha_cbte>${isoDateToArca(payload.issueDate)}</Fecha_cbte>`,
    `<Cbte_Tipo>${payload.documentType}</Cbte_Tipo>`,
    `<Punto_vta>${payload.pointOfSale}</Punto_vta>`,
    `<Cbte_nro>${escapeXml(payload.invoiceNumber)}</Cbte_nro>`,
    '<Tipo_expo>2</Tipo_expo>',
    `<Dst_cmp>${payload.destinationCountryArcaCode}</Dst_cmp>`,
    `<Cliente>${escapeXml(payload.customer.name)}</Cliente>`,
    optionalTag('Cuit_pais_cliente', payload.customer.countryCuit),
    `<Domicilio_cliente>${escapeXml(payload.customer.address)}</Domicilio_cliente>`,
    optionalTag('Id_impositivo', payload.customer.foreignTaxId),
    `<Moneda_Id>${escapeXml(payload.currency.arcaId)}</Moneda_Id>`,
    `<Moneda_ctz>${escapeXml(payload.currency.quote)}</Moneda_ctz>`,
    sameCurrency,
    optionalTag('Obs_comerciales', payload.commercialObservation),
    `<Imp_total>${escapeXml(payload.total)}</Imp_total>`,
    optionalTag('Obs', payload.generalObservation),
    associated,
    optionalTag('Forma_pago', payload.paymentTerms),
    `<Idioma_cbte>${payload.language}</Idioma_cbte>`,
    `<Items>${items}</Items>`,
    payload.paymentDate ? `<Fecha_pago>${isoDateToArca(payload.paymentDate)}</Fecha_pago>` : '',
  ].join('');
}

function authXml(ticket: WsfexAccessTicket): string {
  return `<Token>${escapeXml(ticket.token)}</Token><Sign>${escapeXml(ticket.sign)}</Sign><Cuit>${escapeXml(ticket.representedCuit)}</Cuit>`;
}

function optionalTag(name: string, value: string | null): string {
  return value === null || value === '' ? '' : `<${name}>${escapeXml(value)}</${name}>`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function isoDateToArca(value: string): string {
  return value.replaceAll('-', '');
}

function arcaDateToIso(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error('WSFEX_DATE_INVALID');
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function errorFrom(result: XmlNode): string | null {
  const code = nullableText(node(result.FEXErr).ErrCode);
  return code && code !== '0' ? code : null;
}

function assertNoError(result: XmlNode): void {
  const error = errorFrom(result);
  if (error) throw new Error(`WSFEX_ERROR_${error}`);
}

function node(value: XmlValue | undefined): XmlNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as XmlNode : {};
}

function firstNode(value: XmlValue | undefined): XmlNode | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = node(candidate);
  return Object.keys(parsed).length ? parsed : null;
}

function asArray(value: XmlValue | undefined): XmlValue[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value: XmlValue | undefined): string {
  return value === undefined || value === null ? '' : String(value);
}

function nullableText(value: XmlValue | undefined): string | null {
  const valueText = text(value).trim();
  return valueText ? valueText : null;
}

function requiredText(value: XmlValue | undefined, code: string): string;
function requiredText(value: string | null, code: string): string;
function requiredText(value: XmlValue | undefined | string | null, code: string): string {
  const valueText = nullableText(value as XmlValue | undefined);
  if (!valueText) throw new Error(code);
  return valueText;
}

function positiveNumber(value: XmlValue | undefined, code: string): number {
  const parsed = Number(text(value));
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(code);
  return parsed;
}

function numberInSet<T extends number>(value: XmlValue | undefined, allowed: readonly T[], code: string): T {
  const parsed = Number(text(value));
  if (!allowed.includes(parsed as T)) throw new Error(code);
  return parsed as T;
}
