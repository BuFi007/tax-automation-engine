import { hashCanonical } from '@tax-engine/core';
import Decimal from 'decimal.js';
import { XMLParser } from 'fast-xml-parser';

import { type AssociationDocumentType, type AuthorityPayload, type DocumentType, isAssociationDocumentType, isWsfeDocumentType } from './contracts';
import type { WsfeAccessTicket } from './wsaa';

const NAMESPACE = 'http://ar.gov.afip.dif.FEV1/';
const ENDPOINTS = {
  homologation: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  production: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
} as const;

// FECompConsultar returns error 602 when the requested comprobante does not
// exist yet — the domestic equivalent of the WSFEX 1020 "not found".
const NOT_FOUND_ERROR_CODE = '602';

type SoapFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type XmlValue = string | number | boolean | null | XmlNode | XmlValue[];
type XmlNode = { [key: string]: XmlValue };

export type { DocumentType };
export type Concept = 1 | 2 | 3;
export type ReceptorDocType = 80 | 86 | 96 | 99;
export type RetrievedIvaLine = Readonly<{ alicIvaId: number; baseImp: string; importe: string }>;

export class WsfeAmbiguousTransportError extends Error {
  constructor(readonly receiptHash: string) {
    super('WSFE_TRANSPORT_AMBIGUOUS');
  }
}

export type WsfeAuthorizationResult = Readonly<{
  status: 'accepted' | 'rejected';
  documentType: DocumentType;
  pointOfSale: number;
  invoiceNumber: string;
  issueDate: string;
  concept: Concept;
  receptorDocType: ReceptorDocType;
  receptorDocNumber: string;
  cae: string | null;
  caeExpiry: string | null;
  reprocessed: boolean;
  safeErrors: readonly Readonly<{ code: string; message: string }>[];
  rawResponseHash: string;
}>;

export type WsfeRetrievedDocument = Readonly<{
  documentType: DocumentType;
  pointOfSale: number;
  invoiceNumber: string;
  issueDate: string;
  concept: Concept;
  receptorDocType: ReceptorDocType;
  receptorDocNumber: string;
  currencyId: string;
  currencyQuote: string;
  total: string;
  netAmount: string;
  vatAmount: string;
  ivaLineItems: readonly RetrievedIvaLine[];
  servicePeriod: Readonly<{ from: string; to: string; paymentDueDate: string }> | null;
  // FchVtoPago read independently of the service period: FCE productos carry it
  // without FchServDesde, so the recovery path can bind it for any FCE leg.
  paymentDueDate: string | null;
  associatedDocument: Readonly<{ documentType: AssociationDocumentType; pointOfSale: number; invoiceNumber: string }> | null;
  result: string;
  cae: string;
  caeExpiry: string;
  rawResponseHash: string;
}>;

export interface WsfeAuthorityClient {
  authorize(ticket: WsfeAccessTicket, payload: AuthorityPayload): Promise<WsfeAuthorizationResult>;
  getLastInvoiceNumber(ticket: WsfeAccessTicket, documentType: DocumentType, pointOfSale: number): Promise<string>;
  getDocument(ticket: WsfeAccessTicket, documentType: DocumentType, pointOfSale: number, invoiceNumber: string): Promise<WsfeRetrievedDocument | null>;
  assertPointOfSaleActive(ticket: WsfeAccessTicket, pointOfSale: number): Promise<void>;
  dummy(): Promise<Readonly<{ appServer: string; dbServer: string; authServer: string }>>;
}

export class SoapWsfeAuthorityClient implements WsfeAuthorityClient {
  readonly #parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true, processEntities: false });

  constructor(
    private readonly environment: 'homologation' | 'production',
    private readonly fetcher: SoapFetch = (input, init) => fetch(input, init)
  ) {}

  async authorize(ticket: WsfeAccessTicket, payload: AuthorityPayload): Promise<WsfeAuthorizationResult> {
    const response = await this.call('FECAESolicitar', `<Auth>${authXml(ticket)}</Auth>${caeRequestXml(payload, ticket.representedCuit)}`);
    const result = node(response.parsed.FECAESolicitarResult);
    const header = node(result.FeCabResp);
    const detail = firstNode(node(result.FeDetResp).FECAEDetResponse) ?? {};
    const topLevelError = firstError(result.Errors);
    if (topLevelError && Object.keys(header).length === 0) {
      return {
        status: 'rejected',
        documentType: payload.documentType,
        pointOfSale: payload.pointOfSale,
        invoiceNumber: payload.invoiceNumber,
        issueDate: payload.issueDate,
        concept: payload.concept,
        receptorDocType: payload.receptor.docType,
        receptorDocNumber: payload.receptor.docNumber,
        cae: null,
        caeExpiry: null,
        reprocessed: false,
        safeErrors: [{ code: topLevelError, message: `ARCA WSFE error ${topLevelError}` }],
        rawResponseHash: response.rawHash,
      };
    }
    const status = text(header.Resultado) === 'A' ? 'accepted' as const : 'rejected' as const;
    const cae = nullableText(detail.CAE);
    return {
      status,
      documentType: documentTypeInSet(header.CbteTipo, 'WSFE_RESPONSE_DOCUMENT_TYPE_INVALID'),
      pointOfSale: positiveNumber(header.PtoVta, 'WSFE_RESPONSE_POINT_OF_SALE_INVALID'),
      invoiceNumber: requiredText(detail.CbteDesde, 'WSFE_RESPONSE_INVOICE_NUMBER_REQUIRED'),
      issueDate: arcaDateToIso(requiredText(detail.CbteFch, 'WSFE_RESPONSE_DATE_REQUIRED')),
      concept: conceptInSet(detail.Concepto, 'WSFE_RESPONSE_CONCEPT_INVALID'),
      receptorDocType: receptorDocTypeInSet(detail.DocTipo, 'WSFE_RESPONSE_DOC_TYPE_INVALID'),
      receptorDocNumber: text(detail.DocNro),
      cae: status === 'accepted' ? requiredText(cae, 'WSFE_RESPONSE_CAE_REQUIRED') : null,
      caeExpiry: status === 'accepted' ? arcaDateToIso(requiredText(detail.CAEFchVto, 'WSFE_RESPONSE_CAE_EXPIRY_REQUIRED')) : null,
      reprocessed: text(header.Reproceso) === 'S',
      safeErrors: [
        ...(topLevelError ? [{ code: topLevelError, message: `ARCA WSFE error ${topLevelError}` }] : []),
        ...(Object.keys(node(detail.Observaciones)).length > 0 ? [{ code: 'ARCA_OBSERVATION', message: 'ARCA returned an observation; inspect the protected signer audit record.' }] : []),
      ],
      rawResponseHash: response.rawHash,
    };
  }

  async getLastInvoiceNumber(ticket: WsfeAccessTicket, documentType: DocumentType, pointOfSale: number): Promise<string> {
    const response = await this.call('FECompUltimoAutorizado', `<Auth>${authXml(ticket)}</Auth><PtoVta>${pointOfSale}</PtoVta><CbteTipo>${documentType}</CbteTipo>`);
    const result = node(response.parsed.FECompUltimoAutorizadoResult);
    assertNoError(result.Errors);
    return text(result.CbteNro) || '0';
  }

  async getDocument(ticket: WsfeAccessTicket, documentType: DocumentType, pointOfSale: number, invoiceNumber: string): Promise<WsfeRetrievedDocument | null> {
    const response = await this.call(
      'FECompConsultar',
      `<Auth>${authXml(ticket)}</Auth><FeCompConsReq><CbteTipo>${documentType}</CbteTipo><CbteNro>${escapeXml(invoiceNumber)}</CbteNro><PtoVta>${pointOfSale}</PtoVta></FeCompConsReq>`
    );
    const result = node(response.parsed.FECompConsultarResult);
    if (firstErrorMatches(result.Errors, NOT_FOUND_ERROR_CODE)) return null;
    assertNoError(result.Errors);
    const got = node(result.ResultGet);
    if (Object.keys(got).length === 0) return null;
    const associated = firstNode(node(got.CbtesAsoc).CbteAsoc);
    return {
      documentType: documentTypeInSet(got.CbteTipo, 'WSFE_RETRIEVED_DOCUMENT_TYPE_INVALID'),
      pointOfSale: positiveNumber(got.PtoVta, 'WSFE_RETRIEVED_POINT_OF_SALE_INVALID'),
      invoiceNumber: requiredText(got.CbteDesde, 'WSFE_RETRIEVED_INVOICE_NUMBER_REQUIRED'),
      issueDate: arcaDateToIso(requiredText(got.CbteFch, 'WSFE_RETRIEVED_DATE_REQUIRED')),
      concept: conceptInSet(got.Concepto, 'WSFE_RETRIEVED_CONCEPT_INVALID'),
      receptorDocType: receptorDocTypeInSet(got.DocTipo, 'WSFE_RETRIEVED_DOC_TYPE_INVALID'),
      receptorDocNumber: text(got.DocNro),
      currencyId: requiredText(got.MonId, 'WSFE_RETRIEVED_CURRENCY_REQUIRED'),
      currencyQuote: requiredText(got.MonCotiz, 'WSFE_RETRIEVED_QUOTE_REQUIRED'),
      total: requiredText(got.ImpTotal, 'WSFE_RETRIEVED_TOTAL_REQUIRED'),
      netAmount: requiredText(got.ImpNeto, 'WSFE_RETRIEVED_NET_REQUIRED'),
      vatAmount: text(got.ImpIVA) || '0',
      ivaLineItems: asArray(node(got.Iva).AlicIva).map(node).map(entry => ({
        alicIvaId: positiveNumber(entry.Id, 'WSFE_RETRIEVED_IVA_ID_INVALID'),
        baseImp: requiredText(entry.BaseImp, 'WSFE_RETRIEVED_IVA_BASE_REQUIRED'),
        importe: requiredText(entry.Importe, 'WSFE_RETRIEVED_IVA_IMPORTE_REQUIRED'),
      })),
      servicePeriod: nullableText(got.FchServDesde)
        ? { from: arcaDateToIso(text(got.FchServDesde)), to: arcaDateToIso(requiredText(got.FchServHasta, 'WSFE_RETRIEVED_SERVICE_TO_REQUIRED')), paymentDueDate: arcaDateToIso(requiredText(got.FchVtoPago, 'WSFE_RETRIEVED_PAYMENT_DUE_REQUIRED')) }
        : null,
      paymentDueDate: nullableText(got.FchVtoPago) ? arcaDateToIso(text(got.FchVtoPago)) : null,
      associatedDocument: associated
        ? { documentType: associationTypeInSet(associated.Tipo, 'WSFE_RETRIEVED_ASSOCIATION_TYPE_INVALID'), pointOfSale: positiveNumber(associated.PtoVta, 'WSFE_RETRIEVED_ASSOCIATION_POS_INVALID'), invoiceNumber: requiredText(associated.Nro, 'WSFE_RETRIEVED_ASSOCIATION_NUMBER_REQUIRED') }
        : null,
      result: requiredText(got.Resultado, 'WSFE_RETRIEVED_RESULT_REQUIRED'),
      // WSFEV1 returns the CAE in CodAutorizacion (EmisionTipo distinguishes CAE from CAEA).
      cae: requiredText(got.CodAutorizacion, 'WSFE_RETRIEVED_CAE_REQUIRED'),
      caeExpiry: arcaDateToIso(requiredText(got.FchVto, 'WSFE_RETRIEVED_CAE_EXPIRY_REQUIRED')),
      rawResponseHash: response.rawHash,
    };
  }

  async assertPointOfSaleActive(ticket: WsfeAccessTicket, pointOfSale: number): Promise<void> {
    const response = await this.call('FEParamGetPtosVenta', `<Auth>${authXml(ticket)}</Auth>`);
    const result = node(response.parsed.FEParamGetPtosVentaResult);
    assertNoError(result.Errors);
    const entries = asArray(node(result.ResultGet).PtoVenta);
    const active = entries.map(node).some(entry => Number(text(entry.Nro)) === pointOfSale && text(entry.Bloqueado) !== 'S' && !nullableText(entry.FchBaja));
    if (!active) throw new Error('WSFE_POINT_OF_SALE_NOT_ACTIVE');
  }

  async dummy(): Promise<Readonly<{ appServer: string; dbServer: string; authServer: string }>> {
    const response = await this.call('FEDummy', '');
    const result = node(response.parsed.FEDummyResult);
    return { appServer: text(result.AppServer), dbServer: text(result.DbServer), authServer: text(result.AuthServer) };
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
      throw new WsfeAmbiguousTransportError(hashCanonical({ action, requestHash: hashCanonical(envelope), errorType: error instanceof Error ? error.name : 'unknown' }));
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 2_097_152) throw new Error('WSFE_RESPONSE_TOO_LARGE');
    const rawHash = hashCanonical(raw);
    if (response.status >= 500) throw new WsfeAmbiguousTransportError(hashCanonical({ action, status: response.status, rawHash }));
    if (!response.ok) throw new Error(`WSFE_HTTP_REJECTED_${response.status}`);
    const parsedEnvelope = node(this.#parser.parse(raw));
    const soapBody = node(node(parsedEnvelope.Envelope).Body);
    if (soapBody.Fault) throw new Error('WSFE_SOAP_FAULT');
    const actionResponse = node(soapBody[`${action}Response`]);
    return { parsed: actionResponse, rawHash };
  }
}

// FECAEDetRequest, ordered per the published FEV1 XSD sequence:
// Concepto, Doc*, Cbte*, Imp* (with ImpTrib before ImpIVA), FchServ*/FchVtoPago,
// MonId/MonCotiz, CondicionIVAReceptorId, CbtesAsoc, Iva, Opcionales.
//
// Money block is class-driven:
//   • class A/B (payload.taxBreakdown present): ImpNeto = net, ImpIVA = Σ importe,
//     ImpTrib/ImpOpEx from the breakdown, and an <Iva> array of alícuota lines.
//   • class C / FCE-C (no breakdown): ImpNeto = ImpTotal, ImpIVA = 0, no <Iva> —
//     the exact legacy bytes are preserved for plain C (11/12/13).
// FCE legs add FchVtoPago (facturas) and the <Opcionales> CBU/transmisión (2101/27)
// or anulación (22) block.
function caeRequestXml(payload: AuthorityPayload, representedCuit: string): string {
  const total = escapeXml(payload.total.decimal);
  const breakdown = payload.taxBreakdown;
  const moneyXml = breakdown
    ? `<ImpTotal>${total}</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>${escapeXml(breakdown.netAmount)}</ImpNeto><ImpOpEx>${escapeXml(breakdown.impOpEx)}</ImpOpEx><ImpTrib>${escapeXml(breakdown.impTrib)}</ImpTrib><ImpIVA>${escapeXml(sumIva(breakdown.ivaLineItems))}</ImpIVA>`
    : `<ImpTotal>${total}</ImpTotal><ImpTotConc>0</ImpTotConc><ImpNeto>${total}</ImpNeto><ImpOpEx>0</ImpOpEx><ImpIVA>0</ImpIVA><ImpTrib>0</ImpTrib>`;
  // FchVtoPago is a single shared element: the service payment-due date (concepto
  // 2/3) or the FCE payment-due date (any concepto). The schema forbids the two
  // disagreeing, so either source is authoritative.
  const paymentDue = payload.servicePeriod?.paymentDueDate ?? payload.fceEmission?.paymentDueDate ?? null;
  const periodXml = [
    payload.servicePeriod ? `<FchServDesde>${isoDateToArca(payload.servicePeriod.from)}</FchServDesde><FchServHasta>${isoDateToArca(payload.servicePeriod.to)}</FchServHasta>` : '',
    paymentDue ? `<FchVtoPago>${isoDateToArca(paymentDue)}</FchVtoPago>` : '',
  ].join('');
  const association = payload.associatedDocument
    ? `<CbtesAsoc><CbteAsoc><Tipo>${payload.associatedDocument.documentType}</Tipo><PtoVta>${payload.associatedDocument.pointOfSale}</PtoVta><Nro>${escapeXml(payload.associatedDocument.invoiceNumber)}</Nro><Cuit>${escapeXml(representedCuit)}</Cuit></CbteAsoc></CbtesAsoc>`
    : '';
  const ivaXml = breakdown
    ? `<Iva>${breakdown.ivaLineItems.map(line => `<AlicIva><Id>${line.alicIvaId}</Id><BaseImp>${escapeXml(line.baseImp)}</BaseImp><Importe>${escapeXml(line.importe)}</Importe></AlicIva>`).join('')}</Iva>`
    : '';
  const opcionalesXml = fceOpcionalesXml(payload);
  const detail = [
    `<Concepto>${payload.concept}</Concepto>`,
    `<DocTipo>${payload.receptor.docType}</DocTipo>`,
    `<DocNro>${escapeXml(payload.receptor.docNumber)}</DocNro>`,
    `<CbteDesde>${escapeXml(payload.invoiceNumber)}</CbteDesde>`,
    `<CbteHasta>${escapeXml(payload.invoiceNumber)}</CbteHasta>`,
    `<CbteFch>${isoDateToArca(payload.issueDate)}</CbteFch>`,
    moneyXml,
    periodXml,
    '<MonId>PES</MonId>',
    '<MonCotiz>1</MonCotiz>',
    `<CondicionIVAReceptorId>${payload.receptor.condicionIvaId}</CondicionIVAReceptorId>`,
    association,
    ivaXml,
    opcionalesXml,
  ].join('');
  return `<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${payload.pointOfSale}</PtoVta><CbteTipo>${payload.documentType}</CbteTipo></FeCabReq><FeDetReq><FECAEDetRequest>${detail}</FECAEDetRequest></FeDetReq></FeCAEReq>`;
}

function fceOpcionalesXml(payload: AuthorityPayload): string {
  if (payload.fceEmission) {
    const alias = payload.fceEmission.emitterAlias
      ? `<Opcional><Id>2102</Id><Valor>${escapeXml(payload.fceEmission.emitterAlias)}</Valor></Opcional>`
      : '';
    return `<Opcionales><Opcional><Id>2101</Id><Valor>${escapeXml(payload.fceEmission.emitterCbu)}</Valor></Opcional>${alias}<Opcional><Id>27</Id><Valor>${payload.fceEmission.transmissionMode}</Valor></Opcional></Opcionales>`;
  }
  if (payload.fceAdjustment) {
    return `<Opcionales><Opcional><Id>22</Id><Valor>${payload.fceAdjustment.anulacion}</Valor></Opcional></Opcionales>`;
  }
  return '';
}

function sumIva(lines: readonly Readonly<{ importe: string }>[]): string {
  return lines.reduce((sum, line) => sum.add(line.importe), new Decimal(0)).toFixed(2);
}

function authXml(ticket: WsfeAccessTicket): string {
  return `<Token>${escapeXml(ticket.token)}</Token><Sign>${escapeXml(ticket.sign)}</Sign><Cuit>${escapeXml(ticket.representedCuit)}</Cuit>`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function isoDateToArca(value: string): string {
  return value.replaceAll('-', '');
}

function arcaDateToIso(value: string): string {
  if (!/^\d{8}$/.test(value)) throw new Error('WSFE_DATE_INVALID');
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function firstError(errors: XmlValue | undefined): string | null {
  const entry = firstNode(node(errors).Err);
  const code = nullableText(node(entry).Code);
  return code && code !== '0' ? code : null;
}

function firstErrorMatches(errors: XmlValue | undefined, code: string): boolean {
  return asArray(node(errors).Err).map(node).some(entry => text(entry.Code) === code);
}

function assertNoError(errors: XmlValue | undefined): void {
  const error = firstError(errors);
  if (error) throw new Error(`WSFE_ERROR_${error}`);
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

function receptorDocTypeInSet(value: XmlValue | undefined, code: string): ReceptorDocType {
  const parsed = Number(text(value));
  if (parsed !== 80 && parsed !== 86 && parsed !== 96 && parsed !== 99) throw new Error(code);
  return parsed;
}

function documentTypeInSet(value: XmlValue | undefined, code: string): DocumentType {
  const parsed = Number(text(value));
  if (!Number.isInteger(parsed) || !isWsfeDocumentType(parsed)) throw new Error(code);
  return parsed;
}

function associationTypeInSet(value: XmlValue | undefined, code: string): AssociationDocumentType {
  const parsed = Number(text(value));
  if (!Number.isInteger(parsed) || !isAssociationDocumentType(parsed)) throw new Error(code);
  return parsed;
}

function conceptInSet(value: XmlValue | undefined, code: string): Concept {
  const parsed = Number(text(value));
  if (parsed !== 1 && parsed !== 2 && parsed !== 3) throw new Error(code);
  return parsed;
}
