import { hashCanonical } from '@tax-engine/core';
import Decimal from 'decimal.js';

import {
  assertIssueDateWithinWindow,
  assertPayloadMatchesRequest,
  signerRequestSchema,
  type AuthorityPayload,
  type FeCompConsultarEcho,
  type SignerRequest,
  type SignerResponse,
} from './contracts';
import { type WsfeAuthorityClient, WsfeAmbiguousTransportError, type WsfeAuthorizationResult, type WsfeRetrievedDocument } from './soap';
import { SignerAttemptStore, type SignerAttempt } from './store';
import type { AuthorityPayloadVault } from './vault';
import type { WsaaTicketBroker, WsfeAccessTicket } from './wsaa';

export class WsfeSignerService {
  constructor(
    private readonly config: Readonly<{ environment: 'homologation' | 'production'; signerVersion: string }>,
    private readonly store: SignerAttemptStore,
    private readonly vault: AuthorityPayloadVault,
    private readonly wsaa: WsaaTicketBroker,
    private readonly authority: WsfeAuthorityClient
  ) {}

  async health() {
    const wsaa = await this.wsaa.health(this.config.environment);
    return {
      schema: 'motora-wsfe-signer-health-v1' as const,
      environment: this.config.environment === 'production' ? 'production' as const : 'homologacion' as const,
      certificateDelegationConfigured: wsaa.certificateDelegationConfigured,
      wsaaReady: wsaa.wsaaReady,
    };
  }

  // Single idempotent entry point. A fresh requestId runs the full first
  // attempt; a settled one replays its receipt; an ambiguous/pending one
  // re-drives recovery by re-sending the byte-identical FECAESolicitar.
  async issueInvoice(rawRequest: unknown, idempotencyKey: string, occurredAt: string): Promise<SignerResponse> {
    const request = this.parseRequest(rawRequest, idempotencyKey);
    const existing = this.store.get(request.requestId);
    if (existing) {
      this.assertAttemptBinding(existing, request);
      if (existing.response && existing.state !== 'ambiguous') return existing.response;
      return this.executeExisting(request, existing, occurredAt);
    }
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    const ticket = await this.ticket(request, resolved.payload);
    await this.assertAuthorityPreflight(resolved.payload, ticket, occurredAt);
    const attempt = this.store.begin({
      request,
      payloadReferenceHash: hashCanonical(request.authorityPayloadRef),
      payloadHash: resolved.payloadHash,
      invoiceNumber: resolved.payload.invoiceNumber,
      occurredAt,
    });
    return this.performIssuance(request, resolved.payload, attempt, ticket, occurredAt, false);
  }

  private parseRequest(rawRequest: unknown, idempotencyKey: string): SignerRequest {
    const request = signerRequestSchema.parse(rawRequest);
    if (request.environment !== this.config.environment) throw new Error('WSFE_SIGNER_ENVIRONMENT_MISMATCH');
    if (idempotencyKey !== request.requestId) throw new Error('WSFE_IDEMPOTENCY_KEY_MISMATCH');
    return request;
  }

  private async executeExisting(request: SignerRequest, existing: SignerAttempt, occurredAt: string): Promise<SignerResponse> {
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    if (resolved.payloadHash !== existing.payloadHash) throw new Error('WSFE_RECOVERY_PAYLOAD_HASH_MISMATCH');
    const ticket = await this.ticket(request, resolved.payload);
    return this.performIssuance(request, resolved.payload, existing, ticket, occurredAt, true);
  }

  private async performIssuance(
    request: SignerRequest,
    payload: AuthorityPayload,
    attempt: SignerAttempt,
    ticket: WsfeAccessTicket,
    occurredAt: string,
    recovering: boolean
  ): Promise<SignerResponse> {
    try {
      const authority = await this.authority.authorize(ticket, payload);
      this.assertAuthorizationEcho(authority, payload);
      const confirm = authority.status === 'accepted' ? await this.confirmEcho(request, payload, ticket) : null;
      const response = responseFromAuthority(request, authority, confirm);
      this.store.complete(request.requestId, response, occurredAt);
      return response;
    } catch (error) {
      if (!(error instanceof WsfeAmbiguousTransportError)) throw error;
      if (recovering || attempt.state === 'ambiguous' || attempt.state === 'pending') {
        try {
          const retrieved = await this.authority.getDocument(ticket, payload.documentType, payload.pointOfSale, payload.invoiceNumber);
          if (retrieved) {
            this.assertRetrievedDocument(retrieved, request, payload);
            const recovered = acceptedResponseFromRetrieved(request, retrieved);
            this.store.complete(request.requestId, recovered, occurredAt);
            return recovered;
          }
        } catch (retrievalError) {
          if (!(retrievalError instanceof WsfeAmbiguousTransportError)) throw retrievalError;
        }
      }
      const ambiguous: SignerResponse = {
        requestId: request.requestId,
        status: 'ambiguous',
        resultado: null,
        cae: null,
        caeFchVto: null,
        cbteTipo: null,
        ptoVta: null,
        cbteNro: null,
        reprocessed: null,
        feCompConsultarEcho: null,
        authorizedDocument: null,
        safeErrors: [{ code: 'WSFE_TRANSPORT_AMBIGUOUS', message: 'Authority outcome is ambiguous; re-send the identical request and payload reference to recover.' }],
      };
      this.store.complete(request.requestId, ambiguous, occurredAt);
      return ambiguous;
    }
  }

  // After a direct CAE (whose FECAESolicitar echo was already bound field-for-
  // field), read back FECompConsultar for the authoritative echo. This is
  // best-effort: transport ambiguity, a not-yet-propagated read, or a
  // reconciliation gap must not brick an already-authorized CAE, so any of them
  // simply yields a null echo. The fatal echo-must-match discipline lives on the
  // recovery path, where the echo is the sole basis for acceptance.
  private async confirmEcho(request: SignerRequest, payload: AuthorityPayload, ticket: WsfeAccessTicket): Promise<WsfeRetrievedDocument | null> {
    try {
      const retrieved = await this.authority.getDocument(ticket, payload.documentType, payload.pointOfSale, payload.invoiceNumber);
      if (!retrieved) return null;
      this.assertRetrievedDocument(retrieved, request, payload);
      return retrieved;
    } catch (error) {
      if (error instanceof WsfeAmbiguousTransportError) return null;
      if (error instanceof Error && error.message.startsWith('WSFE_RECOVERED_')) return null;
      throw error;
    }
  }

  private async assertAuthorityPreflight(payload: AuthorityPayload, ticket: WsfeAccessTicket, occurredAt: string): Promise<void> {
    await this.authority.assertPointOfSaleActive(ticket, payload.pointOfSale);
    assertIssueDateWithinWindow(payload.issueDate, payload.concept, occurredAt);
    const lastInvoiceNumber = await this.authority.getLastInvoiceNumber(ticket, payload.documentType, payload.pointOfSale);
    // Freeze-time sequence guard. If someone else emitted on this PoS meanwhile,
    // fail loudly — never silently renumber the frozen document.
    if (BigInt(payload.invoiceNumber) !== BigInt(lastInvoiceNumber) + 1n) throw new Error('WSFE_ARCA_SEQUENCE_CONFLICT');
    if (payload.documentType !== 11) {
      const association = payload.associatedDocument!;
      const original = await this.authority.getDocument(ticket, association.documentType, association.pointOfSale, association.invoiceNumber);
      if (!original || original.result !== 'A') throw new Error('WSFE_ASSOCIATED_DOCUMENT_NOT_AUTHORIZED');
      if (original.currencyId !== 'PES') throw new Error('WSFE_ASSOCIATED_DOCUMENT_CURRENCY_MISMATCH');
    }
  }

  private ticket(request: SignerRequest, payload: AuthorityPayload): Promise<WsfeAccessTicket> {
    return this.wsaa.getTicket({ environment: this.config.environment, workspaceId: request.workspaceId, issuerProfileRef: payload.issuerProfileRef });
  }

  private assertAttemptBinding(attempt: SignerAttempt, request: SignerRequest): void {
    if (attempt.intentHash !== request.intentHash) throw new Error('WSFE_REQUEST_ID_INTENT_CONFLICT');
    if (attempt.payloadReferenceHash !== hashCanonical(request.authorityPayloadRef)) throw new Error('WSFE_REQUEST_ID_PAYLOAD_REFERENCE_CONFLICT');
    if (attempt.documentType !== request.expected.documentType || attempt.pointOfSale !== request.expected.pointOfSale) throw new Error('WSFE_REQUEST_ID_DOCUMENT_CONFLICT');
  }

  private assertAuthorizationEcho(authority: WsfeAuthorizationResult, payload: AuthorityPayload): void {
    if (
      authority.documentType !== payload.documentType
      || authority.pointOfSale !== payload.pointOfSale
      || authority.invoiceNumber !== payload.invoiceNumber
      || authority.issueDate !== payload.issueDate
      || authority.concept !== payload.concept
      || authority.receptorDocType !== payload.receptor.docType
      || authority.receptorDocNumber !== payload.receptor.docNumber
    ) throw new Error('WSFE_AUTHORITY_RESPONSE_MISMATCH');
    if (authority.status === 'accepted' && !authority.cae) throw new Error('WSFE_AUTHORITY_CAE_REQUIRED');
  }

  private assertRetrievedDocument(retrieved: WsfeRetrievedDocument, request: SignerRequest, payload: AuthorityPayload): void {
    if (
      retrieved.result !== 'A'
      || retrieved.documentType !== payload.documentType
      || retrieved.pointOfSale !== payload.pointOfSale
      || retrieved.invoiceNumber !== payload.invoiceNumber
      || retrieved.issueDate !== payload.issueDate
      || retrieved.concept !== payload.concept
      || retrieved.receptorDocType !== payload.receptor.docType
      || retrieved.receptorDocNumber !== payload.receptor.docNumber
      || retrieved.currencyId !== 'PES'
      || !new Decimal(retrieved.currencyQuote).eq(1)
      || !new Decimal(retrieved.total).eq(payload.total.decimal)
      || !new Decimal(retrieved.netAmount).eq(payload.total.decimal)
      || !new Decimal(retrieved.vatAmount).eq(0)
      || !retrieved.cae
    ) throw new Error('WSFE_RECOVERED_DOCUMENT_MISMATCH');
    // ARCA echoes a service period only for concepto 2/3; bind it when the
    // frozen document carries one (productos echo defaults we must not compare).
    if (payload.servicePeriod && JSON.stringify(retrieved.servicePeriod) !== JSON.stringify(payload.servicePeriod)) throw new Error('WSFE_RECOVERED_PERIOD_MISMATCH');
    if (JSON.stringify(retrieved.associatedDocument) !== JSON.stringify(payload.associatedDocument)) throw new Error('WSFE_RECOVERED_ASSOCIATION_MISMATCH');
    if (request.intentHash !== payload.intentHash) throw new Error('WSFE_RECOVERED_INTENT_MISMATCH');
  }
}

function responseFromAuthority(request: SignerRequest, authority: WsfeAuthorizationResult, confirm: WsfeRetrievedDocument | null): SignerResponse {
  const accepted = authority.status === 'accepted';
  return {
    requestId: request.requestId,
    status: authority.status,
    resultado: accepted ? 'A' : 'R',
    cae: authority.cae,
    caeFchVto: authority.caeExpiry,
    cbteTipo: authority.documentType,
    ptoVta: authority.pointOfSale,
    cbteNro: authority.invoiceNumber,
    reprocessed: authority.reprocessed,
    feCompConsultarEcho: confirm ? echoFromRetrieved(confirm) : null,
    authorizedDocument: accepted ? authorizedDocument(request) : null,
    safeErrors: [...authority.safeErrors],
  };
}

function acceptedResponseFromRetrieved(request: SignerRequest, retrieved: WsfeRetrievedDocument): SignerResponse {
  return {
    requestId: request.requestId,
    status: 'accepted',
    resultado: 'A',
    cae: retrieved.cae,
    caeFchVto: retrieved.caeExpiry,
    cbteTipo: retrieved.documentType,
    ptoVta: retrieved.pointOfSale,
    cbteNro: retrieved.invoiceNumber,
    reprocessed: true,
    feCompConsultarEcho: echoFromRetrieved(retrieved),
    authorizedDocument: authorizedDocument(request),
    safeErrors: [],
  };
}

// The published echo carries only safe coordinates — never the receptor DocNro.
function echoFromRetrieved(retrieved: WsfeRetrievedDocument): FeCompConsultarEcho {
  return {
    pointOfSale: retrieved.pointOfSale,
    documentType: retrieved.documentType,
    invoiceNumber: retrieved.invoiceNumber,
    issueDate: retrieved.issueDate,
    concept: retrieved.concept,
    receptorDocType: retrieved.receptorDocType,
    total: { decimal: retrieved.total, currency: 'ARS' },
    cae: retrieved.cae,
    caeExpiry: retrieved.caeExpiry,
    resultado: 'A',
    associatedDocument: retrieved.associatedDocument,
  };
}

function authorizedDocument(request: SignerRequest): NonNullable<SignerResponse['authorizedDocument']> {
  return { intentHash: request.intentHash, ...request.expected };
}
