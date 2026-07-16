import { hashCanonical } from '@tax-engine/core';
import Decimal from 'decimal.js';

import {
  assertPayloadMatchesRequest,
  hashWsfexAuthorityIdentity,
  hashWsfexReconciliationAttestation,
  pointOfSaleDiscoverySchema,
  sequenceReservationRequestSchema,
  signerRequestSchema,
  type AuthorityPayload,
  type SequenceReservationReceipt,
  type SignerRequest,
  type SignerResponse,
  type WsfexReconciliationAttestation,
} from './contracts';
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
import {
  type WsfexAuthorityClient,
  WsfexAmbiguousTransportError,
  type WsfexAuthorizationResult,
  type WsfexRetrievedDocument,
} from './soap';
import {
  identityFor,
  SignerAttemptStore,
  type SignerAttempt,
  type SignerAttemptIdentity,
  type WsfexSequenceReservation,
} from './store';
import type { WsaaTicketBroker, WsfexAccessTicket } from './wsaa';

const DETERMINISTIC_PREFLIGHT_REJECTIONS = new Set([
  'WSFEX_POINT_OF_SALE_NOT_ACTIVE',
  'WSFEX_REQUEST_ID_NOT_MONOTONIC',
  'WSFEX_INVOICE_NUMBER_NOT_SEQUENTIAL',
  'WSFEX_MONEDA_CTZ_OUT_OF_BAND',
  'WSFEX_ASSOCIATED_DOCUMENT_NOT_AUTHORIZED',
  'WSFEX_ADJUSTMENT_CURRENCY_QUOTE_MISMATCH',
  'WSFEX_AUTHORITY_SEQUENCE_BUSY',
  'WSFEX_SEQUENCE_RESERVATION_REQUIRED',
  'WSFEX_SEQUENCE_RESERVATION_CONSUMED',
  'WSFEX_SEQUENCE_RESERVATION_EXPIRED',
  'WSFEX_SEQUENCE_RESERVATION_BINDING_MISMATCH',
  'WSFEX_SEQUENCE_RESERVATION_CONFLICT',
  'WSFEX_SEQUENCE_RESERVATION_BUSY',
]);

export class WsfexSignerService {
  constructor(
    private readonly config: Readonly<{
      environment: 'homologation' | 'production';
      signerVersion: string;
      sequenceReservationsRequired?: boolean;
    }>,
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
      sequenceReservationsRequired: this.config.sequenceReservationsRequired === true,
    };
  }

  async reserveSequence(rawRequest: unknown, occurredAt: string): Promise<SequenceReservationReceipt> {
    const request = sequenceReservationRequestSchema.parse(rawRequest);
    const ticket = await this.wsaa.getTicket({
      environment: this.config.environment,
      workspaceId: request.workspaceId,
      issuerProfileRef: request.issuerProfileRef,
    });
    const replay = this.store.getSequenceReservationByIdempotency(
      this.config.environment,
      ticket.representedCuitCommitment,
      request.idempotencyKey
    );
    if (replay && sequenceReservationReplayUsable(replay, occurredAt))
      return sequenceReservationReceipt(request, replay, true);
    const identity: SignerAttemptIdentity = {
      environment: this.config.environment,
      representedCuitCommitment: ticket.representedCuitCommitment,
      requestId: '1',
    };
    const leaseOwner = this.store.acquireAuthoritySequenceLease(identity, new Date(occurredAt));
    try {
      const racedReplay = this.store.getSequenceReservationByIdempotency(
        this.config.environment,
        ticket.representedCuitCommitment,
        request.idempotencyKey
      );
      if (racedReplay && sequenceReservationReplayUsable(racedReplay, occurredAt))
        return sequenceReservationReceipt(request, racedReplay, true);
      await this.authority.assertPointOfSaleActive(ticket, request.pointOfSale);
      const [lastRequestId, lastInvoiceNumber] = await Promise.all([
        this.authority.getLastRequestId(ticket),
        this.authority.getLastInvoiceNumber(ticket, 19, request.pointOfSale),
      ]);
      const requestId = incrementAuthoritySequence(lastRequestId, 15, 'WSFEX_REQUEST_ID_EXHAUSTED');
      const invoiceNumber = incrementAuthoritySequence(lastInvoiceNumber, 8, 'WSFEX_INVOICE_NUMBER_EXHAUSTED');
      const expiresAt = new Date(Date.parse(occurredAt) + 10 * 60_000).toISOString();
      const { reservation, replayed } = this.store.reserveSequence({
        environment: this.config.environment,
        representedCuitCommitment: ticket.representedCuitCommitment,
        workspaceId: request.workspaceId,
        issuerProfileRef: request.issuerProfileRef,
        runId: request.runId,
        intentHash: request.intentHash,
        subjectId: request.subjectId,
        idempotencyKey: request.idempotencyKey,
        requestId,
        documentType: 19,
        pointOfSale: request.pointOfSale,
        invoiceNumber,
        reservedAt: occurredAt,
        expiresAt,
      });
      return sequenceReservationReceipt(request, reservation, replayed);
    } finally {
      this.store.releaseAuthoritySequenceLease(identity, leaseOwner);
    }
  }

  async authorize(
    rawRequest: unknown,
    idempotencyKey: string,
    occurredAt: string
  ): Promise<SignerResponse> {
    const request = this.parseRequest(rawRequest, idempotencyKey);
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    const ticket = await this.ticket(request, resolved.payload);
    const identity = identityFor(request, ticket.representedCuitCommitment);
    const existing = this.store.get(identity);
    if (existing) {
      this.assertAttemptBinding(existing, request, resolved.payload, ticket);
      this.assertPayloadHash(existing, resolved.payloadHash, 'RECOVERY');
      if (existing.response && existing.state !== 'ambiguous') return existing.response;
      return this.withAuthoritySequenceLease(identity, async () =>
        this.recoverExisting(
          request,
          resolved.payload,
          resolved.payloadHash,
          existing,
          identity,
          ticket,
          occurredAt
        )
      );
    }

    let leaseOwner: string;
    try {
      leaseOwner = this.store.acquireAuthoritySequenceLease(
        identity,
        new Date(occurredAt)
      );
    } catch (error) {
      if (isDeterministicPreflightRejection(error)) {
        return preflightRejectedResponse(request, error.message);
      }
      throw error;
    }

    try {
      // A second process may have completed this scope while this process waited
      // for the represented-CUIT sequence lease. Bind and replay that attempt
      // instead of allocating or submitting a second authority operation.
      const raced = this.store.get(identity);
      if (raced) {
        this.assertAttemptBinding(raced, request, resolved.payload, ticket);
        this.assertPayloadHash(raced, resolved.payloadHash, 'RECOVERY');
        if (raced.response && raced.state !== 'ambiguous') return raced.response;
        return this.recoverExisting(
          request,
          resolved.payload,
          resolved.payloadHash,
          raced,
          identity,
          ticket,
          occurredAt
        );
      }

      try {
        await this.assertAuthorityPreflight(request, resolved.payload, ticket);
      } catch (error) {
        if (isDeterministicPreflightRejection(error)) {
          return preflightRejectedResponse(request, error.message);
        }
        throw error;
      }

      const begin = this.config.sequenceReservationsRequired === true
        && request.expected.documentType === 19
        ? this.store.beginWithSequenceReservation.bind(this.store)
        : this.store.begin.bind(this.store);
      let attempt: SignerAttempt;
      try {
        attempt = begin({
          request,
          issuerProfileRef: resolved.payload.issuerProfileRef,
          representedCuitCommitment: ticket.representedCuitCommitment,
          payloadReferenceHash: hashCanonical(request.authorityPayloadRef),
          payloadHash: resolved.payloadHash,
          invoiceNumber: resolved.payload.invoiceNumber,
          occurredAt,
        });
      } catch (error) {
        if (isDeterministicPreflightRejection(error))
          return preflightRejectedResponse(request, error.message);
        throw error;
      }
      this.assertAttemptBinding(attempt, request, resolved.payload, ticket);
      this.assertPayloadHash(attempt, resolved.payloadHash, 'RECOVERY');
      if (attempt.response && attempt.state !== 'ambiguous') return attempt.response;
      return this.issueNew(
        request,
        resolved.payload,
        resolved.payloadHash,
        identity,
        ticket,
        occurredAt
      );
    } finally {
      this.store.releaseAuthoritySequenceLease(identity, leaseOwner);
    }
  }

  // GET /v1/wsfexv1/params/ctz surface. Returns the cotización fail-closed: ARCA's
  // FEXGetPARAM_Ctz ORIENTATIVO value, explicitly labeled `arca_orientativo` (never a
  // fabricated legal rate) until a verified machine-readable BNA "divisa vendedor"
  // feed is wired. `referenceDate` names the día hábil anterior whose BNA rate is legal.
  async getCotizacion(
    monId: string,
    context: Readonly<{ workspaceId: string; issuerProfileRef: string }>,
    occurredAt: string
  ): Promise<CotizacionResponse> {
    if (!monIdSchema.safeParse(monId).success)
      throw new Error('WSFEX_CTZ_MON_ID_INVALID');
    const ticket = await this.wsaa.getTicket({
      environment: this.config.environment,
      workspaceId: context.workspaceId,
      issuerProfileRef: context.issuerProfileRef,
    });
    const arca = await this.authority.getCotizacion(ticket, monId);
    const today = buenosAiresToday(occurredAt);
    if (arca.date > today) throw new Error('WSFEX_CTZ_DATE_IN_FUTURE');
    if (!isArgentineBusinessDay(arca.date))
      throw new Error('WSFEX_CTZ_DATE_NOT_BUSINESS_DAY');
    return cotizacionResponseSchema.parse({
      monId,
      ctz: arca.ctz,
      date: arca.date,
      referenceDate: previousBusinessDay(today),
      source: CTZ_SOURCE_ARCA,
    });
  }

  async discoverPointsOfSale(
    context: Readonly<{ workspaceId: string; issuerProfileRef: string }>,
    occurredAt: string
  ) {
    const ticket = await this.wsaa.getTicket({
      environment: this.config.environment,
      workspaceId: context.workspaceId,
      issuerProfileRef: context.issuerProfileRef,
    });
    const authority = await this.authority.getPointsOfSale(ticket);
    const activePoints = [...new Set(authority.activePoints)].sort((left, right) => left - right);
    const receipt = {
      version: 'arca-wsfex-point-of-sale-discovery-v1' as const,
      environment: this.config.environment,
      workspaceId: context.workspaceId,
      issuerProfileReferenceHash: hashCanonical(context.issuerProfileRef),
      representedCuitCommitment: ticket.representedCuitCommitment,
      activePoints,
      authorityResponseHash: authority.rawResponseHash,
      observedAt: occurredAt,
    };
    return pointOfSaleDiscoverySchema.parse({
      ...receipt,
      evidenceHash: hashCanonical(receipt),
    });
  }

  async recover(
    rawRequest: unknown,
    idempotencyKey: string,
    occurredAt: string
  ): Promise<SignerResponse> {
    const request = this.parseRequest(rawRequest, idempotencyKey);
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    const ticket = await this.ticket(request, resolved.payload);
    const identity = identityFor(request, ticket.representedCuitCommitment);
    const existing = this.store.get(identity);
    if (!existing) throw new Error('WSFEX_RECOVERY_ATTEMPT_NOT_FOUND');
    this.assertAttemptBinding(existing, request, resolved.payload, ticket);
    this.assertPayloadHash(existing, resolved.payloadHash, 'RECOVERY');
    if (existing.response && existing.state !== 'ambiguous') return existing.response;
    return this.withAuthoritySequenceLease(identity, async () =>
      this.recoverExisting(
        request,
        resolved.payload,
        resolved.payloadHash,
        existing,
        identity,
        ticket,
        occurredAt
      )
    );
  }

  /**
   * Independent post-submit authority read. This path never returns the stored
   * FEXAuthorize response as proof: it always performs FEXGetCMP against the
   * exact immutable payload before it can return accepted.
   */
  async reconcile(
    rawRequest: unknown,
    idempotencyKey: string,
    occurredAt: string
  ): Promise<SignerResponse> {
    const request = this.parseRequest(rawRequest, idempotencyKey);
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    const ticket = await this.ticket(request, resolved.payload);
    const identity = identityFor(request, ticket.representedCuitCommitment);
    const existing = this.store.get(identity);
    if (!existing) throw new Error('WSFEX_RECONCILIATION_ATTEMPT_NOT_FOUND');
    this.assertAttemptBinding(existing, request, resolved.payload, ticket);
    this.assertPayloadHash(existing, resolved.payloadHash, 'RECONCILIATION');
    let retrieved: WsfexRetrievedDocument | null;
    try {
      retrieved = await this.authority.getDocument(
        ticket,
        resolved.payload.documentType,
        resolved.payload.pointOfSale,
        resolved.payload.invoiceNumber
      );
    } catch (error) {
      if (!(error instanceof WsfexAmbiguousTransportError)) throw error;
      return reconciliationAmbiguous(
        request,
        'WSFEX_RECONCILIATION_TRANSPORT_AMBIGUOUS'
      );
    }
    if (!retrieved) {
      return reconciliationAmbiguous(request, 'WSFEX_DOCUMENT_NOT_YET_VISIBLE');
    }
    this.assertRetrievedDocument(retrieved, request, resolved.payload, ticket);
    const accepted = acceptedResponseFromRetrieved({
      request,
      retrieved,
      payload: resolved.payload,
      payloadHash: resolved.payloadHash,
      environment: this.config.environment,
      representedCuitCommitment: ticket.representedCuitCommitment,
      occurredAt,
    });
    return this.completeResponse(identity, accepted, occurredAt);
  }

  private parseRequest(rawRequest: unknown, idempotencyKey: string): SignerRequest {
    const request = signerRequestSchema.parse(rawRequest);
    if (request.environment !== this.config.environment)
      throw new Error('WSFEX_SIGNER_ENVIRONMENT_MISMATCH');
    if (idempotencyKey !== request.requestId)
      throw new Error('WSFEX_IDEMPOTENCY_KEY_MISMATCH');
    return request;
  }

  private async withAuthoritySequenceLease<T>(
    identity: SignerAttemptIdentity,
    callback: () => Promise<T>
  ): Promise<T> {
    const owner = this.store.acquireAuthoritySequenceLease(identity);
    try {
      return await callback();
    } finally {
      this.store.releaseAuthoritySequenceLease(identity, owner);
    }
  }

  private async issueNew(
    request: SignerRequest,
    payload: AuthorityPayload,
    payloadHash: string,
    identity: SignerAttemptIdentity,
    ticket: WsfexAccessTicket,
    occurredAt: string
  ): Promise<SignerResponse> {
    try {
      const authority = await this.authority.authorize(ticket, payload);
      this.assertAuthorizationEcho(authority, request, payload);
      const response = responseFromAuthority(request, authority, payload);
      return this.completeResponse(identity, response, occurredAt);
    } catch (error) {
      if (!(error instanceof WsfexAmbiguousTransportError)) throw error;
      const recovered = await this.readAfterAmbiguousSubmit({
        request,
        payload,
        payloadHash,
        identity,
        ticket,
        occurredAt,
      });
      if (recovered) return recovered;
      const ambiguous = ambiguousResponse(
        request,
        'WSFEX_TRANSPORT_AMBIGUOUS',
        'Authority outcome is ambiguous; recover with the exact request and payload reference.'
      );
      return this.completeResponse(identity, ambiguous, occurredAt);
    }
  }

  /** Recovery is query-first. Only an exact not-found permits an exact replay.
   * A transport-ambiguous read can never be treated as proof that no effect exists. */
  private async recoverExisting(
    request: SignerRequest,
    payload: AuthorityPayload,
    payloadHash: string,
    existing: SignerAttempt,
    identity: SignerAttemptIdentity,
    ticket: WsfexAccessTicket,
    occurredAt: string
  ): Promise<SignerResponse> {
    const firstRead = await this.readForRecovery({
      request,
      payload,
      payloadHash,
      ticket,
      occurredAt,
    });
    if (firstRead.kind === 'accepted') {
      return this.completeResponse(identity, firstRead.response, occurredAt);
    }
    if (firstRead.kind === 'ambiguous') {
      const ambiguous = ambiguousResponse(
        request,
        'WSFEX_RECOVERY_READ_AMBIGUOUS',
        'Authority recovery read is ambiguous; the exact operation was not replayed.'
      );
      return this.completeResponse(identity, ambiguous, occurredAt);
    }

    try {
      const authority = await this.authority.authorize(ticket, payload);
      this.assertAuthorizationEcho(authority, request, payload);
      if (authority.status === 'accepted') {
        const response = responseFromAuthority(request, authority, payload);
        return this.completeResponse(identity, response, occurredAt);
      }

      // A retry rejection cannot prove that the original ambiguous submit had no
      // effect. Query once more so a delayed/duplicate ARCA document wins; if the
      // document is still absent, retain ambiguity instead of false rejection.
      const afterRejectedReplay = await this.readForRecovery({
        request,
        payload,
        payloadHash,
        ticket,
        occurredAt,
      });
      if (afterRejectedReplay.kind === 'accepted') {
        return this.completeResponse(identity, afterRejectedReplay.response, occurredAt);
      }
      const ambiguous = ambiguousResponse(
        request,
        afterRejectedReplay.kind === 'ambiguous'
          ? 'WSFEX_RECOVERY_POST_REPLAY_READ_AMBIGUOUS'
          : 'WSFEX_RECOVERY_REPLAY_REJECTED_DOCUMENT_NOT_VISIBLE',
        'Recovery remains ambiguous after an authority replay rejection; no rejection is promoted.'
      );
      return this.completeResponse(identity, ambiguous, occurredAt);
    } catch (error) {
      if (!(error instanceof WsfexAmbiguousTransportError)) throw error;
      const recovered = await this.readAfterAmbiguousSubmit({
        request,
        payload,
        payloadHash,
        identity,
        ticket,
        occurredAt,
      });
      if (recovered) return recovered;
      const ambiguous = ambiguousResponse(
        request,
        existing.state === 'pending'
          ? 'WSFEX_PENDING_ATTEMPT_TRANSPORT_AMBIGUOUS'
          : 'WSFEX_RECOVERY_TRANSPORT_AMBIGUOUS',
        'Authority recovery remains ambiguous; retry recovery with the exact request.'
      );
      return this.completeResponse(identity, ambiguous, occurredAt);
    }
  }

  private async readAfterAmbiguousSubmit(input: Readonly<{
    request: SignerRequest;
    payload: AuthorityPayload;
    payloadHash: string;
    identity: SignerAttemptIdentity;
    ticket: WsfexAccessTicket;
    occurredAt: string;
  }>): Promise<SignerResponse | null> {
    const read = await this.readForRecovery(input);
    if (read.kind !== 'accepted') return null;
    return this.completeResponse(input.identity, read.response, input.occurredAt);
  }

  private async readForRecovery(input: Readonly<{
    request: SignerRequest;
    payload: AuthorityPayload;
    payloadHash: string;
    ticket: WsfexAccessTicket;
    occurredAt: string;
  }>): Promise<
    | Readonly<{ kind: 'accepted'; response: SignerResponse }>
    | Readonly<{ kind: 'not_found' }>
    | Readonly<{ kind: 'ambiguous' }>
  > {
    let retrieved: WsfexRetrievedDocument | null;
    try {
      retrieved = await this.authority.getDocument(
        input.ticket,
        input.payload.documentType,
        input.payload.pointOfSale,
        input.payload.invoiceNumber
      );
    } catch (error) {
      if (!(error instanceof WsfexAmbiguousTransportError)) throw error;
      return { kind: 'ambiguous' };
    }
    if (!retrieved) return { kind: 'not_found' };
    this.assertRetrievedDocument(retrieved, input.request, input.payload, input.ticket);
    return {
      kind: 'accepted',
      response: acceptedResponseFromRetrieved({
        request: input.request,
        retrieved,
        payload: input.payload,
        payloadHash: input.payloadHash,
        environment: this.config.environment,
        representedCuitCommitment: input.ticket.representedCuitCommitment,
        occurredAt: input.occurredAt,
      }),
    };
  }

  private completeResponse(
    identity: SignerAttemptIdentity,
    response: SignerResponse,
    occurredAt: string
  ): SignerResponse {
    const completed = this.store.complete(identity, response, occurredAt);
    if (!completed.response)
      throw new Error('WSFEX_ATTEMPT_COMPLETION_CONFLICT');
    return completed.response;
  }

  private async assertAuthorityPreflight(
    request: SignerRequest,
    payload: AuthorityPayload,
    ticket: WsfexAccessTicket
  ): Promise<void> {
    await this.authority.assertPointOfSaleActive(ticket, payload.pointOfSale);
    const [lastRequestId, lastInvoiceNumber] = await Promise.all([
      this.authority.getLastRequestId(ticket),
      this.authority.getLastInvoiceNumber(
        ticket,
        payload.documentType,
        payload.pointOfSale
      ),
    ]);
    if (BigInt(request.requestId) <= BigInt(lastRequestId))
      throw new Error('WSFEX_REQUEST_ID_NOT_MONOTONIC');
    if (BigInt(payload.invoiceNumber) !== BigInt(lastInvoiceNumber) + 1n)
      throw new Error('WSFEX_INVOICE_NUMBER_NOT_SEQUENTIAL');
    if (payload.documentType === 19) {
      // Error-1667 band guard on the invoice's Moneda_ctz. Only invoices are
      // checked: an NC/ND (20/21) must carry the SAME quote as its original (below),
      // which is legitimately "stale" relative to today's orientativo. Pesos (PES,
      // quote 1) need no cotización.
      if (payload.currency.arcaId !== 'PES') {
        const orientativo = await this.authority.getCotizacion(
          ticket,
          payload.currency.arcaId
        );
        if (!isWithinCtzBand(payload.currency.quote, orientativo.ctz))
          throw new Error('WSFEX_MONEDA_CTZ_OUT_OF_BAND');
      }
    } else {
      const association = payload.associatedDocument!;
      const original = await this.authority.getDocument(
        ticket,
        association.documentType,
        association.pointOfSale,
        association.invoiceNumber
      );
      if (!original || original.result !== 'A')
        throw new Error('WSFEX_ASSOCIATED_DOCUMENT_NOT_AUTHORIZED');
      if (
        original.currencyId !== payload.currency.arcaId
        || !new Decimal(original.currencyQuote).eq(payload.currency.quote)
      ) {
        throw new Error('WSFEX_ADJUSTMENT_CURRENCY_QUOTE_MISMATCH');
      }
    }
  }

  private async ticket(
    request: SignerRequest,
    payload: AuthorityPayload
  ): Promise<WsfexAccessTicket> {
    const ticket = await this.wsaa.getTicket({
      environment: this.config.environment,
      workspaceId: request.workspaceId,
      issuerProfileRef: payload.issuerProfileRef,
    });
    if (ticket.representedCuitCommitment !== payload.representedCuitCommitment) {
      throw new Error('WSFEX_REPRESENTED_CUIT_COMMITMENT_MISMATCH');
    }
    return ticket;
  }

  private assertAttemptBinding(
    attempt: SignerAttempt,
    request: SignerRequest,
    payload: AuthorityPayload,
    ticket: WsfexAccessTicket
  ): void {
    if (attempt.environment !== request.environment)
      throw new Error('WSFEX_REQUEST_SCOPE_ENVIRONMENT_CONFLICT');
    if (attempt.representedCuitCommitment !== ticket.representedCuitCommitment)
      throw new Error('WSFEX_REQUEST_SCOPE_REPRESENTED_CUIT_CONFLICT');
    if (attempt.workspaceIdHash !== hashCanonical(request.workspaceId))
      throw new Error('WSFEX_REQUEST_SCOPE_WORKSPACE_CONFLICT');
    if (attempt.issuerProfileReferenceHash !== hashCanonical(payload.issuerProfileRef))
      throw new Error('WSFEX_REQUEST_SCOPE_ISSUER_PROFILE_CONFLICT');
    if (attempt.subjectIdHash !== hashCanonical(request.subjectId))
      throw new Error('WSFEX_REQUEST_SCOPE_SUBJECT_CONFLICT');
    if (attempt.runId !== request.runId)
      throw new Error('WSFEX_REQUEST_SCOPE_RUN_CONFLICT');
    if (attempt.intentHash !== request.intentHash)
      throw new Error('WSFEX_REQUEST_ID_INTENT_CONFLICT');
    if (attempt.payloadReferenceHash !== hashCanonical(request.authorityPayloadRef))
      throw new Error('WSFEX_REQUEST_ID_PAYLOAD_REFERENCE_CONFLICT');
    if (
      attempt.documentType !== request.expected.documentType
      || attempt.pointOfSale !== request.expected.pointOfSale
      || attempt.invoiceNumber !== payload.invoiceNumber
    ) throw new Error('WSFEX_REQUEST_ID_DOCUMENT_CONFLICT');
  }

  private assertPayloadHash(
    attempt: SignerAttempt,
    actual: string,
    operation: 'RECOVERY' | 'RECONCILIATION'
  ): void {
    if (actual !== attempt.payloadHash)
      throw new Error(`WSFEX_${operation}_PAYLOAD_HASH_MISMATCH`);
  }

  private assertAuthorizationEcho(
    authority: WsfexAuthorizationResult,
    request: SignerRequest,
    payload: AuthorityPayload
  ): void {
    if (
      authority.requestId !== request.requestId
      || authority.documentType !== payload.documentType
      || authority.pointOfSale !== payload.pointOfSale
      || authority.invoiceNumber !== payload.invoiceNumber
      || authority.issueDate !== payload.issueDate
    ) throw new Error('WSFEX_AUTHORITY_RESPONSE_MISMATCH');
    if (authority.status === 'accepted' && (!authority.cae || !authority.caeExpiry))
      throw new Error('WSFEX_AUTHORITY_CAE_RECEIPT_REQUIRED');
  }

  private assertRetrievedDocument(
    retrieved: WsfexRetrievedDocument,
    request: SignerRequest,
    payload: AuthorityPayload,
    ticket: WsfexAccessTicket
  ): void {
    if (
      retrieved.result !== 'A'
      || retrieved.documentType !== payload.documentType
      || retrieved.operationType !== payload.operationType
      || retrieved.pointOfSale !== payload.pointOfSale
      || retrieved.invoiceNumber !== payload.invoiceNumber
      || retrieved.issueDate !== payload.issueDate
      || retrieved.destinationCountryArcaCode !== payload.destinationCountryArcaCode
      || retrieved.customer.name !== payload.customer.name
      || retrieved.customer.address !== payload.customer.address
      || retrieved.customer.countryCuit !== payload.customer.countryCuit
      || retrieved.customer.foreignTaxId !== payload.customer.foreignTaxId
      || retrieved.currencyId !== payload.currency.arcaId
      || !new Decimal(retrieved.currencyQuote).eq(payload.currency.quote)
      || retrieved.sameCurrencyPayment !== payload.sameCurrencyPayment
      || retrieved.paymentDate !== payload.paymentDate
      || !new Decimal(retrieved.total).eq(payload.total)
      || retrieved.paymentTerms !== payload.paymentTerms
      || retrieved.commercialObservation !== payload.commercialObservation
      || retrieved.generalObservation !== payload.generalObservation
      || retrieved.language !== payload.language
    ) throw new Error('WSFEX_RECOVERED_DOCUMENT_MISMATCH');
    if (retrieved.items.length !== payload.items.length)
      throw new Error('WSFEX_RECOVERED_ITEMS_MISMATCH');
    for (const [index, actual] of retrieved.items.entries()) {
      const expected = payload.items[index]!;
      if (
        actual.code !== expected.code
        || actual.description !== expected.description
        || !new Decimal(actual.quantity).eq(expected.quantity)
        || actual.unitCode !== expected.unitCode
        || !new Decimal(actual.unitPrice).eq(expected.unitPrice)
        || !new Decimal(actual.discount).eq(expected.discount)
        || !new Decimal(actual.total).eq(expected.total)
      ) throw new Error('WSFEX_RECOVERED_ITEMS_MISMATCH');
    }
    const actualAssociation = retrieved.associatedDocument;
    const expectedAssociation = payload.associatedDocument;
    if (
      (!actualAssociation) !== (!expectedAssociation)
      || (actualAssociation && expectedAssociation && (
        actualAssociation.documentType !== expectedAssociation.documentType
        || actualAssociation.pointOfSale !== expectedAssociation.pointOfSale
        || actualAssociation.invoiceNumber !== expectedAssociation.invoiceNumber
        || actualAssociation.representedCuit !== ticket.representedCuit
      ))
    ) throw new Error('WSFEX_RECOVERED_ASSOCIATION_MISMATCH');
    if (request.intentHash !== payload.intentHash)
      throw new Error('WSFEX_RECOVERED_INTENT_MISMATCH');
  }
}

function incrementAuthoritySequence(value: string, maximumDigits: number, exhaustedCode: string): string {
  if (!/^\d+$/.test(value)) throw new Error('WSFEX_AUTHORITY_SEQUENCE_INVALID');
  const next = BigInt(value) + 1n;
  const rendered = next.toString();
  if (next <= 0n || rendered.length > maximumDigits) throw new Error(exhaustedCode);
  return rendered;
}

function sequenceReservationReplayUsable(
  reservation: WsfexSequenceReservation,
  occurredAt: string
): boolean {
  return reservation.state === 'consumed'
    || Date.parse(reservation.expiresAt) > Date.parse(occurredAt);
}

function sequenceReservationReceipt(
  request: ReturnType<typeof sequenceReservationRequestSchema.parse>,
  reservation: WsfexSequenceReservation,
  replayed: boolean
): SequenceReservationReceipt {
  if (reservation.workspaceIdHash !== hashCanonical(request.workspaceId)
    || reservation.issuerProfileReferenceHash !== hashCanonical(request.issuerProfileRef)
    || reservation.runId !== request.runId
    || reservation.intentHash !== request.intentHash
    || reservation.subjectIdHash !== hashCanonical(request.subjectId)
    || reservation.idempotencyKey !== request.idempotencyKey
    || reservation.documentType !== request.documentType
    || reservation.pointOfSale !== request.pointOfSale)
    throw new Error('WSFEX_SEQUENCE_RESERVATION_BINDING_MISMATCH');
  const receipt = {
    version: 'tax-wsfex-sequence-reservation-receipt-v1' as const,
    environment: reservation.environment,
    workspaceId: request.workspaceId,
    issuerProfileRef: request.issuerProfileRef,
    issuerProfileReferenceHash: reservation.issuerProfileReferenceHash,
    representedCuitCommitment: reservation.representedCuitCommitment,
    runId: reservation.runId,
    intentHash: reservation.intentHash,
    subjectId: request.subjectId,
    documentType: reservation.documentType,
    pointOfSale: reservation.pointOfSale,
    requestId: reservation.requestId,
    invoiceNumber: reservation.invoiceNumber,
    idempotencyKey: reservation.idempotencyKey,
    reservedAt: reservation.reservedAt,
    expiresAt: reservation.expiresAt,
    replayed,
  };
  return { ...receipt, evidenceHash: hashCanonical(receipt) };
}

function responseFromAuthority(
  request: SignerRequest,
  authority: WsfexAuthorizationResult,
  payload: AuthorityPayload
): SignerResponse {
  return {
    requestId: request.requestId,
    status: authority.status,
    invoiceNumber: authority.invoiceNumber,
    cae: authority.cae,
    caeExpiry: authority.caeExpiry,
    reprocessed: authority.reprocessed,
    authorizedDocument:
      authority.status === 'accepted' ? authorizedDocument(request, payload) : null,
    reconciliation: null,
    safeErrors: [...authority.safeErrors],
  };
}

function acceptedResponseFromRetrieved(input: Readonly<{
  request: SignerRequest;
  retrieved: WsfexRetrievedDocument;
  payload: AuthorityPayload;
  payloadHash: string;
  environment: 'homologation' | 'production';
  representedCuitCommitment: string;
  occurredAt: string;
}>): SignerResponse {
  const authorityIdentityHash = hashWsfexAuthorityIdentity({
    environment: input.environment,
    representedCuitCommitment: input.representedCuitCommitment,
    documentType: input.retrieved.documentType,
    pointOfSale: input.retrieved.pointOfSale,
    invoiceNumber: input.retrieved.invoiceNumber,
  });
  const material: Omit<WsfexReconciliationAttestation, 'evidenceHash'> = {
    version: 'arca-wsfex-reconciliation-attestation-v1',
    source: 'FEXGetCMP',
    environment: input.environment,
    representedCuitCommitment: input.representedCuitCommitment,
    authorityIdentityHash,
    authorityResponseHash: input.retrieved.rawResponseHash,
    payloadHash: input.payloadHash,
    requestId: input.request.requestId,
    intentHash: input.request.intentHash,
    documentType: input.retrieved.documentType,
    pointOfSale: input.retrieved.pointOfSale,
    invoiceNumber: input.retrieved.invoiceNumber,
    cae: input.retrieved.cae,
    observedAt: input.occurredAt,
  };
  const reconciliation: WsfexReconciliationAttestation = {
    ...material,
    evidenceHash: hashWsfexReconciliationAttestation(material),
  };
  return {
    requestId: input.request.requestId,
    status: 'accepted',
    invoiceNumber: input.retrieved.invoiceNumber,
    cae: input.retrieved.cae,
    caeExpiry: input.retrieved.caeExpiry,
    reprocessed: true,
    authorizedDocument: authorizedDocument(input.request, input.payload),
    reconciliation,
    safeErrors: [],
  };
}

function preflightRejectedResponse(
  request: SignerRequest,
  code: string
): SignerResponse {
  return {
    requestId: request.requestId,
    status: 'preflight_rejected',
    invoiceNumber: null,
    cae: null,
    caeExpiry: null,
    reprocessed: null,
    authorizedDocument: null,
    reconciliation: null,
    safeErrors: [{
      code,
      message: 'The deterministic WSFEX preflight denied submission; allocate a corrected operation before retrying.',
    }],
  };
}

function reconciliationAmbiguous(
  request: SignerRequest,
  code: string
): SignerResponse {
  return ambiguousResponse(
    request,
    code,
    'Independent ARCA reconciliation is not conclusive; no downstream eligibility may be promoted.'
  );
}

function ambiguousResponse(
  request: SignerRequest,
  code: string,
  message: string
): SignerResponse {
  return {
    requestId: request.requestId,
    status: 'ambiguous',
    invoiceNumber: null,
    cae: null,
    caeExpiry: null,
    reprocessed: null,
    authorizedDocument: null,
    reconciliation: null,
    safeErrors: [{ code, message }],
  };
}

function isDeterministicPreflightRejection(error: unknown): error is Error {
  return error instanceof Error
    && DETERMINISTIC_PREFLIGHT_REJECTIONS.has(error.message);
}

// Direct authorization carries the exact frozen currency values submitted to ARCA;
// FEXAuthorize does not echo them. The recovery path binds those same values to the
// ARCA-confirmed FEXGetCMP Moneda_Id/Moneda_ctz before returning this document.
function authorizedDocument(
  request: SignerRequest,
  payload: AuthorityPayload
): NonNullable<SignerResponse['authorizedDocument']> {
  return {
    intentHash: request.intentHash,
    ...request.expected,
    currencyId: payload.currency.arcaId,
    currencyQuote: payload.currency.quote,
  };
}
