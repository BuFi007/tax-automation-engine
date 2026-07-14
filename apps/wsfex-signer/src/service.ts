import { hashCanonical } from '@tax-engine/core';
import Decimal from 'decimal.js';

import { assertPayloadMatchesRequest, signerRequestSchema, type AuthorityPayload, type SignerRequest, type SignerResponse } from './contracts';
import {
  buenosAiresToday,
  cotizacionResponseSchema,
  type CotizacionResponse,
  CTZ_SOURCE_ARCA,
  isArgentineBusinessDay,
  isWithinCtzBand,
  monIdSchema,
  previousBusinessDay,
} from './cotizacion';
import type { AuthorityPayloadVault } from './vault';
import { type WsfexAuthorityClient, WsfexAmbiguousTransportError, type WsfexAuthorizationResult, type WsfexRetrievedDocument } from './soap';
import { SignerAttemptStore, type SignerAttempt } from './store';
import type { WsaaTicketBroker, WsfexAccessTicket } from './wsaa';

export class WsfexSignerService {
  constructor(
    private readonly config: Readonly<{ environment: 'homologation' | 'production'; signerVersion: string }>,
    private readonly store: SignerAttemptStore,
    private readonly vault: AuthorityPayloadVault,
    private readonly wsaa: WsaaTicketBroker,
    private readonly authority: WsfexAuthorityClient
  ) {}

  async health() {
    const wsaa = await this.wsaa.health(this.config.environment);
    return {
      version: 'motora-wsfex-signer-health-v1' as const,
      environment: this.config.environment,
      signerVersion: this.config.signerVersion,
      wsfexVersion: '3.1.1',
      certificateDelegationConfigured: wsaa.certificateDelegationConfigured,
      wsaaReady: wsaa.wsaaReady,
    };
  }

  async authorize(rawRequest: unknown, idempotencyKey: string, occurredAt: string): Promise<SignerResponse> {
    const request = this.parseRequest(rawRequest, idempotencyKey);
    const existing = this.store.get(request.requestId);
    if (existing) {
      this.assertAttemptBinding(existing, request);
      if (existing.response && existing.state !== 'ambiguous') return existing.response;
      return this.executeExisting(request, existing, occurredAt, false);
    }
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    const ticket = await this.ticket(request, resolved.payload);
    await this.assertAuthorityPreflight(request, resolved.payload, ticket);
    const attempt = this.store.begin({
      request,
      payloadReferenceHash: hashCanonical(request.authorityPayloadRef),
      payloadHash: resolved.payloadHash,
      invoiceNumber: resolved.payload.invoiceNumber,
      occurredAt,
    });
    return this.issue(request, resolved.payload, attempt, ticket, occurredAt, false);
  }

  // GET /v1/wsfexv1/params/ctz surface. Returns the cotización fail-closed: ARCA's
  // FEXGetPARAM_Ctz ORIENTATIVO value, explicitly labeled `arca_orientativo` (never a
  // fabricated legal rate) until a verified machine-readable BNA "divisa vendedor"
  // feed is wired. `referenceDate` names the día hábil anterior whose BNA rate is legal.
  async getCotizacion(monId: string, context: Readonly<{ workspaceId: string; issuerProfileRef: string }>, occurredAt: string): Promise<CotizacionResponse> {
    if (!monIdSchema.safeParse(monId).success) throw new Error('WSFEX_CTZ_MON_ID_INVALID');
    const ticket = await this.wsaa.getTicket({ environment: this.config.environment, workspaceId: context.workspaceId, issuerProfileRef: context.issuerProfileRef });
    const arca = await this.authority.getCotizacion(ticket, monId);
    const today = buenosAiresToday(occurredAt);
    if (arca.date > today) throw new Error('WSFEX_CTZ_DATE_IN_FUTURE');
    if (!isArgentineBusinessDay(arca.date)) throw new Error('WSFEX_CTZ_DATE_NOT_BUSINESS_DAY');
    return cotizacionResponseSchema.parse({ monId, ctz: arca.ctz, date: arca.date, referenceDate: previousBusinessDay(today), source: CTZ_SOURCE_ARCA });
  }

  async recover(rawRequest: unknown, idempotencyKey: string, occurredAt: string): Promise<SignerResponse> {
    const request = this.parseRequest(rawRequest, idempotencyKey);
    const existing = this.store.get(request.requestId);
    if (!existing) throw new Error('WSFEX_RECOVERY_ATTEMPT_NOT_FOUND');
    this.assertAttemptBinding(existing, request);
    if (existing.response && existing.state !== 'ambiguous') return existing.response;
    return this.executeExisting(request, existing, occurredAt, true);
  }

  private parseRequest(rawRequest: unknown, idempotencyKey: string): SignerRequest {
    const request = signerRequestSchema.parse(rawRequest);
    if (request.environment !== this.config.environment) throw new Error('WSFEX_SIGNER_ENVIRONMENT_MISMATCH');
    if (idempotencyKey !== request.requestId) throw new Error('WSFEX_IDEMPOTENCY_KEY_MISMATCH');
    return request;
  }

  private async executeExisting(request: SignerRequest, existing: SignerAttempt, occurredAt: string, recovering: boolean): Promise<SignerResponse> {
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    if (resolved.payloadHash !== existing.payloadHash) throw new Error('WSFEX_RECOVERY_PAYLOAD_HASH_MISMATCH');
    const ticket = await this.ticket(request, resolved.payload);
    return this.issue(request, resolved.payload, existing, ticket, occurredAt, recovering);
  }

  private async issue(
    request: SignerRequest,
    payload: AuthorityPayload,
    attempt: SignerAttempt,
    ticket: WsfexAccessTicket,
    occurredAt: string,
    recovering: boolean
  ): Promise<SignerResponse> {
    try {
      const authority = await this.authority.authorize(ticket, payload);
      this.assertAuthorizationEcho(authority, request, payload);
      const response = responseFromAuthority(request, authority, payload);
      this.store.complete(request.requestId, response, occurredAt);
      return response;
    } catch (error) {
      if (!(error instanceof WsfexAmbiguousTransportError)) throw error;
      if (recovering || attempt.state === 'ambiguous' || attempt.state === 'pending') {
        try {
          const retrieved = await this.authority.getDocument(ticket, payload.documentType, payload.pointOfSale, payload.invoiceNumber);
          if (retrieved) {
            this.assertRetrievedDocument(retrieved, request, payload);
            const recovered = acceptedResponseFromRetrieved(request, retrieved, payload);
            this.store.complete(request.requestId, recovered, occurredAt);
            return recovered;
          }
        } catch (retrievalError) {
          if (!(retrievalError instanceof WsfexAmbiguousTransportError)) throw retrievalError;
        }
      }
      const ambiguous: SignerResponse = {
        requestId: request.requestId,
        status: 'ambiguous',
        invoiceNumber: null,
        cae: null,
        reprocessed: null,
        authorizedDocument: null,
        safeErrors: [{ code: 'WSFEX_TRANSPORT_AMBIGUOUS', message: 'Authority outcome is ambiguous; recover with the exact request and payload reference.' }],
      };
      this.store.complete(request.requestId, ambiguous, occurredAt);
      return ambiguous;
    }
  }

  private async assertAuthorityPreflight(request: SignerRequest, payload: AuthorityPayload, ticket: WsfexAccessTicket): Promise<void> {
    await this.authority.assertPointOfSaleActive(ticket, payload.pointOfSale);
    const [lastRequestId, lastInvoiceNumber] = await Promise.all([
      this.authority.getLastRequestId(ticket),
      this.authority.getLastInvoiceNumber(ticket, payload.documentType, payload.pointOfSale),
    ]);
    if (BigInt(request.requestId) <= BigInt(lastRequestId)) throw new Error('WSFEX_REQUEST_ID_NOT_MONOTONIC');
    if (BigInt(payload.invoiceNumber) !== BigInt(lastInvoiceNumber) + 1n) throw new Error('WSFEX_INVOICE_NUMBER_NOT_SEQUENTIAL');
    if (payload.documentType === 19) {
      // Error-1667 band guard on the invoice's Moneda_ctz. Only invoices are
      // checked: an NC/ND (20/21) must carry the SAME quote as its original (below),
      // which is legitimately "stale" relative to today's orientativo. Pesos (PES,
      // quote 1) need no cotización.
      if (payload.currency.arcaId !== 'PES') {
        const orientativo = await this.authority.getCotizacion(ticket, payload.currency.arcaId);
        if (!isWithinCtzBand(payload.currency.quote, orientativo.ctz)) throw new Error('WSFEX_MONEDA_CTZ_OUT_OF_BAND');
      }
    } else {
      const association = payload.associatedDocument!;
      const original = await this.authority.getDocument(ticket, association.documentType, association.pointOfSale, association.invoiceNumber);
      if (!original || original.result !== 'A') throw new Error('WSFEX_ASSOCIATED_DOCUMENT_NOT_AUTHORIZED');
      if (original.currencyId !== payload.currency.arcaId || !new Decimal(original.currencyQuote).eq(payload.currency.quote)) {
        throw new Error('WSFEX_ADJUSTMENT_CURRENCY_QUOTE_MISMATCH');
      }
    }
  }

  private ticket(request: SignerRequest, payload: AuthorityPayload): Promise<WsfexAccessTicket> {
    return this.wsaa.getTicket({ environment: this.config.environment, workspaceId: request.workspaceId, issuerProfileRef: payload.issuerProfileRef });
  }

  private assertAttemptBinding(attempt: SignerAttempt, request: SignerRequest): void {
    if (attempt.intentHash !== request.intentHash) throw new Error('WSFEX_REQUEST_ID_INTENT_CONFLICT');
    if (attempt.payloadReferenceHash !== hashCanonical(request.authorityPayloadRef)) throw new Error('WSFEX_REQUEST_ID_PAYLOAD_REFERENCE_CONFLICT');
    if (attempt.documentType !== request.expected.documentType || attempt.pointOfSale !== request.expected.pointOfSale) throw new Error('WSFEX_REQUEST_ID_DOCUMENT_CONFLICT');
  }

  private assertAuthorizationEcho(authority: WsfexAuthorizationResult, request: SignerRequest, payload: AuthorityPayload): void {
    if (
      authority.requestId !== request.requestId
      || authority.documentType !== payload.documentType
      || authority.pointOfSale !== payload.pointOfSale
      || authority.invoiceNumber !== payload.invoiceNumber
      || authority.issueDate !== payload.issueDate
    ) throw new Error('WSFEX_AUTHORITY_RESPONSE_MISMATCH');
    if (authority.status === 'accepted' && !authority.cae) throw new Error('WSFEX_AUTHORITY_CAE_REQUIRED');
  }

  private assertRetrievedDocument(retrieved: WsfexRetrievedDocument, request: SignerRequest, payload: AuthorityPayload): void {
    if (
      retrieved.result !== 'A'
      || retrieved.documentType !== payload.documentType
      || retrieved.pointOfSale !== payload.pointOfSale
      || retrieved.invoiceNumber !== payload.invoiceNumber
      || retrieved.issueDate !== payload.issueDate
      || retrieved.currencyId !== payload.currency.arcaId
      || !new Decimal(retrieved.currencyQuote).eq(payload.currency.quote)
      || !new Decimal(retrieved.total).eq(payload.total)
    ) throw new Error('WSFEX_RECOVERED_DOCUMENT_MISMATCH');
    const expectedAssociation = payload.associatedDocument;
    if (JSON.stringify(retrieved.associatedDocument) !== JSON.stringify(expectedAssociation)) throw new Error('WSFEX_RECOVERED_ASSOCIATION_MISMATCH');
    if (request.intentHash !== payload.intentHash) throw new Error('WSFEX_RECOVERED_INTENT_MISMATCH');
  }
}

function responseFromAuthority(request: SignerRequest, authority: WsfexAuthorizationResult, payload: AuthorityPayload): SignerResponse {
  return {
    requestId: request.requestId,
    status: authority.status,
    invoiceNumber: authority.invoiceNumber,
    cae: authority.cae,
    reprocessed: authority.reprocessed,
    authorizedDocument: authority.status === 'accepted' ? authorizedDocument(request, payload) : null,
    safeErrors: [...authority.safeErrors],
  };
}

function acceptedResponseFromRetrieved(request: SignerRequest, retrieved: WsfexRetrievedDocument, payload: AuthorityPayload): SignerResponse {
  return {
    requestId: request.requestId,
    status: 'accepted',
    invoiceNumber: retrieved.invoiceNumber,
    cae: retrieved.cae,
    reprocessed: true,
    authorizedDocument: authorizedDocument(request, payload),
    safeErrors: [],
  };
}

// The applied Moneda_ctz echoed for the desk: the frozen payload quote (which the
// recovery path already bound equal to ARCA's FEXGetCMP Moneda_ctz).
function authorizedDocument(request: SignerRequest, payload: AuthorityPayload): NonNullable<SignerResponse['authorizedDocument']> {
  return { intentHash: request.intentHash, ...request.expected, currencyId: payload.currency.arcaId, currencyQuote: payload.currency.quote };
}
