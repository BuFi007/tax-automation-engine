import { XMLParser } from 'fast-xml-parser';

import type { LifecycleCoordinates, NormalizedLifecycle } from './contracts';
import type { WsfecredAccessTicket } from './wsaa';

// Verbatim from the live production WSDL (targetNamespace + document/literal
// binding with explicit soapActions = namespace + operation).
const NAMESPACE = 'http://ar.gob.afip.wsfecred/FECredService/';
const ENDPOINTS = {
  // Homologación is `.gov.ar`; producción is `.gob.ar` — an easy swap to get wrong.
  homologation: 'https://fwshomo.afip.gov.ar/wsfecred/FECredService',
  production: 'https://serviciosjava.afip.gob.ar/wsfecred/FECredService',
} as const;

// Business errors ARCA returns in `arrayErrores` for a comprobante/cuenta
// corriente that cannot be resolved. Manual v2.0.3 §2.4.2:
//   1102 "No existe la cuenta corriente indicada"
//   1105 "No existe el comprobante indicado"
//   32767 empty-result sentinel for filter queries
// These map to a 404 (null), not an upstream error.
const NOT_FOUND_ERROR_CODES = new Set(['1102', '1105', '32767']);

type SoapFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type XmlValue = string | number | boolean | null | XmlNode | XmlValue[];
type XmlNode = { [key: string]: XmlValue };

// A network failure / 5xx on a read-only query is transient; the caller simply
// retries. Surfaced as a 502 by the HTTP layer, never a fabricated lifecycle.
export class WsfecredTransportError extends Error {}

export interface WsfecredAuthorityClient {
  // Resolves the acceptance/negotiation lifecycle of one emitted FCE, or null
  // when ARCA does not know the comprobante (not-found business error).
  getLifecycle(ticket: WsfecredAccessTicket, coordinates: LifecycleCoordinates): Promise<NormalizedLifecycle | null>;
  dummy(): Promise<Readonly<{ appServer: string; dbServer: string; authServer: string }>>;
}

export class SoapWsfecredAuthorityClient implements WsfecredAuthorityClient {
  readonly #parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true, processEntities: false });

  constructor(
    private readonly environment: 'homologation' | 'production',
    private readonly fetcher: SoapFetch = (input, init) => fetch(input, init)
  ) {}

  async getLifecycle(ticket: WsfecredAccessTicket, coordinates: LifecycleCoordinates): Promise<NormalizedLifecycle | null> {
    const body = consultarCtaCteXml(ticket, coordinates);
    const parsed = await this.call('consultarCtaCte', body);

    // Not-found and format/business errors live in arrayErrores. Observaciones
    // are non-fatal and deliberately ignored.
    const errorCodes = [
      ...collectErrorCodes(deepFind(parsed, 'arrayErrores')),
      ...collectErrorCodes(deepFind(parsed, 'arrayErroresFormato')),
    ];
    if (errorCodes.some(code => NOT_FOUND_ERROR_CODES.has(code))) return null;
    if (errorCodes.length > 0) throw new Error(`WSFECRED_ERROR_${errorCodes[0]}`);

    // CuentaCorrienteType is the node that OWNS `estadoCtaCte`; the embedded
    // `factura` (ComprobanteType) is the node that owns `fechaEmision`.
    const ctaCte = deepFindContaining(parsed, 'estadoCtaCte');
    if (!ctaCte) return null;
    const factura = firstPopulated(node(ctaCte.factura), deepFindContaining(ctaCte, 'fechaEmision'));

    return {
      // `estado` is a nested EstadoCmp/EstadoCtaCteType: the enum sits at
      // `estado.estado`. estadoValue() tolerates both nested and flat shapes.
      estadoComprobante: estadoValue(factura.estado),
      estadoCtaCte: estadoValue(ctaCte.estadoCtaCte),
      tipoAceptacion: nullableText(factura.tipoAcep),
      opcionTransferencia: nullableText(factura.opcionTransferencia),
      fechaEmision: isoDate(nullableText(factura.fechaEmision)),
      fechaHoraAcep: nullableText(factura.fechaHoraAcep),
      fechaVenAcep: nullableText(factura.fechaVenAcep),
      codMoneda: nullableText(factura.codMoneda) ?? nullableText(ctaCte.codMoneda),
      importeTotal: nullableText(factura.importeTotal),
      saldoAceptado: nullableText(ctaCte.saldoAceptado),
      codCtaCte: nullableText(ctaCte.codCtaCte),
    };
  }

  async dummy(): Promise<Readonly<{ appServer: string; dbServer: string; authServer: string }>> {
    const parsed = await this.call('dummy', `<dummyRequest xmlns="${NAMESPACE}"/>`);
    return {
      appServer: text(deepFindValue(parsed, 'appserver') ?? deepFindValue(parsed, 'appServer')),
      dbServer: text(deepFindValue(parsed, 'dbserver') ?? deepFindValue(parsed, 'dbServer')),
      authServer: text(deepFindValue(parsed, 'authserver') ?? deepFindValue(parsed, 'authServer')),
    };
  }

  private async call(operation: string, body: string): Promise<XmlNode> {
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
    let response: Response;
    try {
      response = await this.fetcher(ENDPOINTS[this.environment], {
        method: 'POST',
        headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: `"${NAMESPACE}${operation}"` },
        body: envelope,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // Never surface the underlying error detail (may carry host/path).
      throw new WsfecredTransportError(`WSFECRED_TRANSPORT_FAILED_${error instanceof Error ? error.name.toUpperCase() : 'UNKNOWN'}`);
    }
    const raw = await response.text();
    if (Buffer.byteLength(raw) > 4_194_304) throw new Error('WSFECRED_RESPONSE_TOO_LARGE');
    if (response.status >= 500) throw new WsfecredTransportError(`WSFECRED_HTTP_REJECTED_${response.status}`);
    if (!response.ok) throw new Error(`WSFECRED_HTTP_REJECTED_${response.status}`);
    const parsedEnvelope = node(this.#parser.parse(raw));
    const soapBody = node(node(parsedEnvelope.Envelope).Body);
    if (soapBody.Fault) throw new Error('WSFECRED_SOAP_FAULT');
    return soapBody;
  }
}

// ---------------------------------------------------------------------------
// Request encoding — verbatim WSDL element tree. consultarCtaCteRequest wraps
// authRequest{token,sign,cuitRepresentada} + idCtaCte(choice) → idFactura
// (IdComprobanteType = CUITEmisor, codTipoCmp, ptoVta, nroCmp). Note the casing:
// `CUITEmisor` uppercase, `ptoVta` (mixed) on the identifier.
// ---------------------------------------------------------------------------
function consultarCtaCteXml(ticket: WsfecredAccessTicket, coordinates: LifecycleCoordinates): string {
  return [
    `<consultarCtaCteRequest xmlns="${NAMESPACE}">`,
    authRequestXml(ticket),
    '<idCtaCte>',
    '<idFactura>',
    `<CUITEmisor>${escapeXml(coordinates.cuitEmisor)}</CUITEmisor>`,
    `<codTipoCmp>${coordinates.comprobanteType}</codTipoCmp>`,
    `<ptoVta>${coordinates.pointOfSale}</ptoVta>`,
    `<nroCmp>${escapeXml(coordinates.invoiceNumber)}</nroCmp>`,
    '</idFactura>',
    '</idCtaCte>',
    '</consultarCtaCteRequest>',
  ].join('');
}

function authRequestXml(ticket: WsfecredAccessTicket): string {
  return `<authRequest><token>${escapeXml(ticket.token)}</token><sign>${escapeXml(ticket.sign)}</sign><cuitRepresentada>${escapeXml(ticket.representedCuit)}</cuitRepresentada></authRequest>`;
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

// EstadoCmpType / EstadoCtaCteType wrap the enum in a nested `estado` element
// alongside `fechaHoraEstado`. Read the nested value; tolerate a flat string.
function estadoValue(value: XmlValue | undefined): string | null {
  if (typeof value === 'string') return nullableText(value);
  const inner = node(value);
  if (Object.keys(inner).length === 0) return null;
  return nullableText(inner.estado);
}

// Collect `codigo` values from an arrayErrores/arrayErroresFormato subtree
// (each error is a `codigoDescripcion` = { codigo, descripcion }).
function collectErrorCodes(errorsRoot: XmlNode | null): string[] {
  if (!errorsRoot) return [];
  return deepCollect(errorsRoot, 'codigo').map(text).filter(code => code.length > 0);
}

// yyyy-mm-dd from an ARCA `date` or `dateTime`; null when not a recognizable date.
function isoDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------
// Defensive XML helpers. removeNSPrefix strips namespaces; deep-search keeps the
// decoder resilient to the exact response wrapper nesting.
// ---------------------------------------------------------------------------
function node(value: XmlValue | undefined): XmlNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as XmlNode : {};
}

function text(value: XmlValue | undefined): string {
  return value === undefined || value === null || typeof value === 'object' ? '' : String(value);
}

function nullableText(value: XmlValue | undefined): string | null {
  const valueText = text(value).trim();
  return valueText ? valueText : null;
}

// The child value at the first occurrence of `key`, coerced to a node.
function deepFind(root: XmlValue | undefined, key: string): XmlNode | null {
  const found = deepFindValue(root, key);
  return found === undefined ? null : node(found);
}

// The first object node in the tree that OWNS `key` (its parent), DFS.
function deepFindContaining(root: XmlValue | undefined, key: string): XmlNode | null {
  if (root === undefined || root === null || typeof root !== 'object') return null;
  if (!Array.isArray(root) && Object.prototype.hasOwnProperty.call(root, key)) return root as XmlNode;
  for (const value of Array.isArray(root) ? root : Object.values(root)) {
    const nested = deepFindContaining(value, key);
    if (nested) return nested;
  }
  return null;
}

function firstPopulated(...nodes: (XmlNode | null)[]): XmlNode {
  for (const candidate of nodes) {
    if (candidate && Object.keys(candidate).length > 0) return candidate;
  }
  return {};
}

function deepFindValue(root: XmlValue | undefined, key: string): XmlValue | undefined {
  if (root === undefined || root === null || typeof root !== 'object') return undefined;
  if (!Array.isArray(root) && Object.prototype.hasOwnProperty.call(root, key)) return (root as XmlNode)[key];
  for (const value of Array.isArray(root) ? root : Object.values(root)) {
    const nested = deepFindValue(value, key);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function deepCollect(root: XmlValue | undefined, key: string): XmlValue[] {
  const out: XmlValue[] = [];
  const visit = (value: XmlValue | undefined): void => {
    if (value === undefined || value === null || typeof value !== 'object') return;
    if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
      const found = (value as XmlNode)[key];
      for (const entry of Array.isArray(found) ? found : [found]) {
        if (entry !== undefined) out.push(entry);
      }
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child);
  };
  visit(root);
  return out;
}
