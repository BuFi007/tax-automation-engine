import { hashCanonical } from '@tax-engine/core';
import { z } from 'zod';

import { readBoundedBody, refuseRedirect } from './bounded-body';
import { isValidCuit, type AuthorityPayload } from './contracts';
import {
  normalizeWsfexAuthorization, normalizeWsfexCotizacion, normalizeWsfexDocument,
  normalizeWsfexLastInvoiceNumber, normalizeWsfexLastRequestId, normalizeWsfexPointsOfSale,
  WsfexAmbiguousTransportError, type WsfexAuthorityClient, type XmlNode,
} from './soap';
import type { WsaaTicketBroker, WsfexAccessTicket } from './wsaa';

type Environment = 'homologation' | 'production';
type IssuerScope = Readonly<{ environment: Environment; workspaceId: string; issuerProfileRef: string }>;
const issuerSchema = z.object({
  environment: z.enum(['homologation', 'production']),
  workspaceId: z.string().min(1),
  issuerProfileRef: z.string().min(1),
  representedCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit),
  representedCuitCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  active: z.literal(true),
  delegationConfirmed: z.literal(true),
}).strict();
export type AfipSdkIssuer = z.infer<typeof issuerSchema>;
const authSchema = z.object({
  token: z.string().min(1), sign: z.string().min(1), expiration: z.iso.datetime({ offset: true }),
});
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

// The resolver is trusted server-side custody: never resolve issuer identity from request JSON.
// Private keys stay in the local WSAA boundary and are never sent to this provider.
export class AfipSdkWsfexClient implements WsaaTicketBroker, WsfexAuthorityClient {
  readonly #issuedTickets = new WeakSet<WsfexAccessTicket>();

  constructor(
    private readonly config: Readonly<{
      accessToken: string;
      environment: Environment;
      healthIssuer?: Readonly<{ workspaceId: string; issuerProfileRef: string }>;
    }>,
    private readonly resolveIssuer: ((scope: IssuerScope) => Promise<AfipSdkIssuer>) | null,
    private readonly fetcher: Fetcher = fetch,
    private readonly trustedBroker: WsaaTicketBroker | null = null,
  ) {
    this.config = Object.freeze({ ...config });
    if (!config.accessToken.trim()) throw new Error('AFIPSDK_ACCESS_TOKEN_REQUIRED');
    if (!['homologation', 'production'].includes(config.environment)) throw new Error('AFIPSDK_ENVIRONMENT_INVALID');
  }

  async getTicket(scope: IssuerScope): Promise<WsfexAccessTicket> {
    if (scope.environment !== this.config.environment) throw new Error('AFIPSDK_ENVIRONMENT_MISMATCH');
    if (this.trustedBroker) {
      const ticket = await this.trustedBroker.getTicket(scope);
      if (!isValidCuit(ticket.representedCuit)
        || !/^[a-f0-9]{64}$/.test(ticket.representedCuitCommitment))
        throw new Error('AFIPSDK_BROKER_TICKET_INVALID');
      if (Date.parse(ticket.expiresAt) <= Date.now() + 60_000)
        throw new Error('AFIPSDK_TICKET_EXPIRED');
      this.#issuedTickets.add(ticket);
      return ticket;
    }
    if (!this.resolveIssuer) throw new Error('AFIPSDK_ISSUER_RESOLVER_REQUIRED');
    const issuer = issuerSchema.parse(await this.resolveIssuer(scope));
    if (issuer.environment !== scope.environment || issuer.workspaceId !== scope.workspaceId
      || issuer.issuerProfileRef !== scope.issuerProfileRef) throw new Error('AFIPSDK_ISSUER_BINDING_MISMATCH');
    const response = await this.post('auth', { tax_id: issuer.representedCuit });
    let auth: z.infer<typeof authSchema>;
    try { auth = authSchema.parse(response.value); }
    catch { throw new Error('AFIPSDK_AUTH_RESPONSE_INVALID'); }
    if (Date.parse(auth.expiration) <= Date.now() + 60_000) throw new Error('AFIPSDK_TICKET_EXPIRED');
    const ticket = Object.freeze({
      token: auth.token, sign: auth.sign, expiresAt: auth.expiration,
      representedCuit: issuer.representedCuit,
      representedCuitCommitment: issuer.representedCuitCommitment,
    });
    this.#issuedTickets.add(ticket);
    return ticket;
  }

  async health(environment: Environment) {
    if (this.trustedBroker) return this.trustedBroker.health(environment);
    if (environment !== this.config.environment || !this.config.healthIssuer)
      return { certificateDelegationConfigured: false, wsaaReady: false };
    try {
      await this.getTicket({ ...this.config.healthIssuer, environment });
      return { certificateDelegationConfigured: true, wsaaReady: true };
    } catch {
      return { certificateDelegationConfigured: false, wsaaReady: false };
    }
  }

  async authorize(ticket: WsfexAccessTicket, payload: AuthorityPayload) {
    this.assertTicket(ticket);
    if (payload.representedCuitCommitment !== ticket.representedCuitCommitment)
      throw new Error('AFIPSDK_PAYLOAD_ISSUER_MISMATCH');
    return normalizeWsfexAuthorization(await this.call('FEXAuthorize', ticket, {
      Cmp: invoiceParams(payload, ticket.representedCuit),
    }), payload);
  }

  async getLastRequestId(ticket: WsfexAccessTicket) {
    return normalizeWsfexLastRequestId(await this.call('FEXGetLast_ID', ticket));
  }

  async getLastInvoiceNumber(ticket: WsfexAccessTicket, documentType: 19 | 20 | 21, pointOfSale: number) {
    return normalizeWsfexLastInvoiceNumber(await this.call('FEXGetLast_CMP', ticket, {}, {
      Cbte_Tipo: documentType, Pto_venta: pointOfSale,
    }));
  }

  async getDocument(ticket: WsfexAccessTicket, documentType: 19 | 20 | 21, pointOfSale: number, invoiceNumber: string) {
    const response = await this.call('FEXGetCMP', ticket, {
      Cmp: { Cbte_tipo: documentType, Punto_vta: pointOfSale, Cbte_nro: invoiceNumber },
    });
    try { return normalizeWsfexDocument(response); }
    catch { throw new WsfexAmbiguousTransportError(response.rawHash); }
  }

  async getCotizacion(ticket: WsfexAccessTicket, monId: string) {
    return normalizeWsfexCotizacion(await this.call('FEXGetPARAM_Ctz', ticket, { Mon_id: monId }), monId);
  }

  async getPointsOfSale(ticket: WsfexAccessTicket) {
    return normalizeWsfexPointsOfSale(await this.call('FEXGetPARAM_PtoVenta', ticket));
  }

  async assertPointOfSaleActive(ticket: WsfexAccessTicket, pointOfSale: number) {
    if (!(await this.getPointsOfSale(ticket)).activePoints.includes(pointOfSale))
      throw new Error('WSFEX_POINT_OF_SALE_NOT_ACTIVE');
  }

  private assertTicket(ticket: WsfexAccessTicket) {
    if (!this.#issuedTickets.has(ticket)) throw new Error('AFIPSDK_TICKET_BINDING_MISMATCH');
    if (Date.parse(ticket.expiresAt) <= Date.now()) throw new Error('AFIPSDK_TICKET_EXPIRED');
  }

  private async call(method: string, ticket: WsfexAccessTicket, params: XmlNode = {}, authParams: XmlNode = {}) {
    this.assertTicket(ticket);
    const response = await this.post('requests', {
      method,
      params: { ...params, Auth: { Token: ticket.token, Sign: ticket.sign, Cuit: ticket.representedCuit, ...authParams } },
    });
    const value = response.value;
    const result = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)[`${method}Result`] : null;
    if (!result || typeof result !== 'object' || Array.isArray(result))
      throw new WsfexAmbiguousTransportError(response.rawHash);
    const parsed = result as XmlNode;
    const document = method === 'FEXAuthorize' ? parsed.FEXResultAuth : method === 'FEXGetCMP' ? parsed.FEXResultGet : null;
    if (document && typeof document === 'object' && !Array.isArray(document)) {
      if (document.Cuit !== undefined && String(document.Cuit) !== ticket.representedCuit)
        throw new WsfexAmbiguousTransportError(response.rawHash);
      if (method === 'FEXAuthorize' && !['A', 'R'].includes(String(document.Resultado)))
        throw new WsfexAmbiguousTransportError(response.rawHash);
    }
    return { parsed, rawHash: response.rawHash };
  }

  private async post(endpoint: 'auth' | 'requests', body: Record<string, unknown>) {
    let response: Response;
    let raw: string;
    try {
      response = await this.fetcher(`https://app.afipsdk.com/api/v1/afip/${endpoint}`, {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Bearer ${this.config.accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ environment: this.config.environment === 'production' ? 'prod' : 'dev', wsid: 'wsfex', ...body }),
      }).then(refuseRedirect);
      raw = await readBoundedBody(response, 2_097_152, 'AFIPSDK_RESPONSE_TOO_LARGE');
    } catch {
      // A provider error cannot prove that ARCA did not commit an invoice.
      throw new WsfexAmbiguousTransportError(hashCanonical({ endpoint, outcome: 'transport_ambiguous' }));
    }
    const rawHash = hashCanonical(raw);
    if (endpoint === 'auth' && response.status === 400) {
      let errors: Record<string, unknown> | undefined;
      try { errors = JSON.parse(raw)?.data_errors; } catch { /* Keep the generic safe error below. */ }
      if (errors && typeof errors === 'object' && ('cert' in errors || 'key' in errors))
        throw new Error('AFIPSDK_ISSUER_CERTIFICATE_CONFIGURATION_REQUIRED');
    }
    if (!response.ok) throw new WsfexAmbiguousTransportError(hashCanonical({ endpoint, status: response.status, rawHash }));
    try { return { value: JSON.parse(raw) as unknown, rawHash }; }
    catch { throw new WsfexAmbiguousTransportError(rawHash); }
  }
}

function invoiceParams(p: AuthorityPayload, representedCuit: string): XmlNode {
  const optional = (key: string, value: string | null): XmlNode => value === null || value === '' ? {} : { [key]: value };
  return {
    Id: p.requestId, Fecha_cbte: p.issueDate.replaceAll('-', ''), Cbte_Tipo: p.documentType,
    Punto_vta: p.pointOfSale, Cbte_nro: p.invoiceNumber, Tipo_expo: p.operationType,
    Permiso_existente: '',
    Dst_cmp: p.destinationCountryArcaCode, Cliente: p.customer.name,
    Cuit_pais_cliente: p.customer.countryCuit, Domicilio_cliente: p.customer.address,
    ...optional('Id_impositivo', p.customer.foreignTaxId),
    Moneda_Id: p.currency.arcaId, Moneda_ctz: p.currency.quote, Imp_total: p.total,
    ...(p.documentType === 19 && p.sameCurrencyPayment !== null ? { CanMisMonExt: p.sameCurrencyPayment ? 'S' : 'N' } : {}),
    ...optional('Obs_comerciales', p.commercialObservation), ...optional('Obs', p.generalObservation),
    ...optional('Forma_pago', p.paymentTerms), Idioma_cbte: p.language,
    ...(p.paymentDate ? { Fecha_pago: p.paymentDate.replaceAll('-', '') } : {}),
    ...(p.associatedDocument ? { Cmps_asoc: { Cmp_asoc: [{
      Cbte_tipo: p.associatedDocument.documentType, Cbte_punto_vta: p.associatedDocument.pointOfSale,
      Cbte_nro: p.associatedDocument.invoiceNumber, Cbte_cuit: representedCuit,
    }] } } : {}),
    Items: { Item: p.items.map(item => ({
      ...optional('Pro_codigo', item.code), Pro_ds: item.description, Pro_qty: item.quantity,
      Pro_umed: item.unitCode, Pro_precio_uni: item.unitPrice, Pro_bonificacion: item.discount, Pro_total_item: item.total,
    })) },
  };
}
