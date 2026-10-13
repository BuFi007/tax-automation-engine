import { hashCanonical } from '@tax-engine/core';
import Decimal from 'decimal.js';

import {
  assertIssueDateWithinWindow,
  assertPayloadMatchesRequest,
  deriveVatTotal,
  isInvoiceLeg,
  nextVoucherSchema,
  pointOfSaleDiscoverySchema,
  pointOfSaleReadbackSchema,
  signerRequestSchema,
  type AuthorityPayload,
  type FeCompConsultarEcho,
  type NextVoucherRequest,
  type SignerRequest,
  type SignerResponse,
} from './contracts';
import { type WsfeAuthorityClient, WsfeAmbiguousTransportError, type WsfeAuthorizationResult, type WsfeRetrievedDocument } from './soap';
import { SignerAttemptStore, type SignerAttempt } from './store';
import type { AuthorityPayloadVault } from './vault';
import type { WsaaTicketBroker, WsfeAccessTicket } from './wsaa';

export class WsfeSignerService {
  constructor(
    private readonly config: Readonly<{
      environment: 'homologation' | 'production'; signerVersion: string;
      homologationPointOfSaleProof?: Readonly<{ workspaceId: string; issuerProfileRef: string; representedCuit: string; representedCuitCommitment: string; cae: string }>;
    }>,
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

  async discoverPointsOfSale(context: Readonly<{ workspaceId: string; issuerProfileRef: string }>, occurredAt: string) {
    const ticket = await this.wsaa.getTicket({ environment: this.config.environment, ...context });
    const discovery = await this.authority.getPointsOfSale(ticket);
    const material = {
      version: 'arca-wsfe-point-of-sale-discovery-v1' as const,
      environment: this.config.environment,
      workspaceId: context.workspaceId,
      issuerProfileReferenceHash: hashCanonical(context.issuerProfileRef),
      representedCuitCommitment: ticket.representedCuitCommitment,
      activePoints: [...discovery.activePoints],
      listedCount: discovery.listedCount,
      authorityResponseHash: discovery.rawResponseHash,
      observedAt: occurredAt,
    };
    return pointOfSaleDiscoverySchema.parse({ ...material, evidenceHash: hashCanonical(material) });
  }

  async verifyPointOfSaleReadback(context: Readonly<{ workspaceId: string; issuerProfileRef: string; pointOfSale: 1 }>, occurredAt: string) {
    if (this.config.environment !== 'homologation') throw new Error('WSFE_POS_READBACK_HOMOLOGATION_ONLY');
    const ticket = await this.wsaa.getTicket({ environment: 'homologation', workspaceId: context.workspaceId, issuerProfileRef: context.issuerProfileRef });
    const readback = await this.readbackKnownHomologationVoucher(ticket, context.workspaceId, context.issuerProfileRef, context.pointOfSale, 11);
    const material = {
      version: 'arca-wsfe-point-of-sale-readback-v1' as const,
      environment: 'homologation' as const,
      workspaceId: context.workspaceId,
      issuerProfileReferenceHash: hashCanonical(context.issuerProfileRef),
      representedCuitCommitment: ticket.representedCuitCommitment,
      pointOfSale: 1 as const,
      documentType: 11 as const,
      invoiceNumber: '1' as const,
      ...readback,
      observedAt: occurredAt,
    };
    return pointOfSaleReadbackSchema.parse({ ...material, evidenceHash: hashCanonical(material) });
  }

  async getNextVoucher(context: NextVoucherRequest, occurredAt: string) {
    const ticket = await this.wsaa.getTicket({ environment: this.config.environment, workspaceId: context.workspaceId, issuerProfileRef: context.issuerProfileRef });
    await this.ensurePointOfSaleActive(ticket, context.workspaceId, context.issuerProfileRef, context.pointOfSale, context.documentType);
    const lastInvoiceNumber = await this.authority.getLastInvoiceNumber(ticket, context.documentType, context.pointOfSale);
    if (!/^\d{1,8}$/.test(lastInvoiceNumber)) throw new Error('WSFE_LAST_VOUCHER_INVALID');
    const nextInvoiceNumber = (BigInt(lastInvoiceNumber) + 1n).toString();
    const material = {
      version: 'arca-wsfe-next-voucher-v1' as const,
      environment: this.config.environment,
      workspaceId: context.workspaceId,
      issuerProfileReferenceHash: hashCanonical(context.issuerProfileRef),
      representedCuitCommitment: ticket.representedCuitCommitment,
      documentType: context.documentType,
      pointOfSale: context.pointOfSale,
      lastInvoiceNumber,
      nextInvoiceNumber,
      observedAt: occurredAt,
    };
    return nextVoucherSchema.parse({ ...material, evidenceHash: hashCanonical(material) });
  }

  // Single idempotent entry point. A fresh requestId runs the full first
  // attempt; a settled one replays its receipt; an ambiguous/pending one
  // re-drives recovery by re-sending the byte-identical FECAESolicitar.
  async issueInvoice(rawRequest: unknown, idempotencyKey: string, occurredAt: string): Promise<SignerResponse> {
    const request = this.parseRequest(rawRequest, idempotencyKey);
    const existing = this.store.get(request.requestId);
    if (existing) {
      this.assertAttemptBinding(existing, request);
      if (existing.response?.status === 'accepted' && !existing.response.feCompConsultarEcho)
        return this.confirmAcceptedReadback(request, existing, occurredAt);
      if (existing.response && existing.state !== 'ambiguous') return existing.response;
      return this.executeExisting(request, existing, occurredAt);
    }
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    const ticket = await this.ticket(request, resolved.payload);
    await this.assertAuthorityPreflight(request, resolved.payload, ticket, occurredAt);
    const attempt = this.store.begin({
      request,
      payloadReferenceHash: hashCanonical(request.authorityPayloadRef),
      payloadHash: resolved.payloadHash,
      invoiceNumber: resolved.payload.invoiceNumber,
      occurredAt,
    });
    return this.performIssuance(request, resolved.payload, attempt, ticket, occurredAt, false);
  }

  private async confirmAcceptedReadback(request: SignerRequest, existing: SignerAttempt, occurredAt: string): Promise<SignerResponse> {
    const receipt = existing.response!;
    const resolved = await this.vault.resolve(request.authorityPayloadRef);
    assertPayloadMatchesRequest(resolved.payload, request);
    if (resolved.payloadHash !== existing.payloadHash) throw new Error('WSFE_RECOVERY_PAYLOAD_HASH_MISMATCH');
    const ticket = await this.ticket(request, resolved.payload);
    const retrieved = await this.confirmEcho(request, resolved.payload, ticket);
    if (!retrieved) return receipt;
    if (retrieved.cae !== receipt.cae || retrieved.caeExpiry !== receipt.caeFchVto)
      throw new Error('WSFE_ACCEPTED_READBACK_CAE_MISMATCH');
    const verified = { ...receipt, feCompConsultarEcho: echoFromRetrieved(retrieved) };
    this.store.complete(request.requestId, verified, occurredAt);
    return verified;
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

  private async assertAuthorityPreflight(request: SignerRequest, payload: AuthorityPayload, ticket: WsfeAccessTicket, occurredAt: string): Promise<void> {
    await this.assertPointOfSaleActive(request, payload, ticket);
    assertIssueDateWithinWindow(payload.issueDate, payload.concept, occurredAt);
    const lastInvoiceNumber = await this.authority.getLastInvoiceNumber(ticket, payload.documentType, payload.pointOfSale);
    // Freeze-time sequence guard. If someone else emitted on this PoS meanwhile,
    // fail loudly — never silently renumber the frozen document.
    if (BigInt(payload.invoiceNumber) !== BigInt(lastInvoiceNumber) + 1n) throw new Error('WSFE_ARCA_SEQUENCE_CONFLICT');
    // A NC/ND must reference an already-authorized original of the same class
    // family (the schema pins the type; here we confirm ARCA authorized it).
    if (payload.associatedDocument) {
      const association = payload.associatedDocument;
      const original = await this.authority.getDocument(ticket, association.documentType, association.pointOfSale, association.invoiceNumber);
      if (!original || original.result !== 'A') throw new Error('WSFE_ASSOCIATED_DOCUMENT_NOT_AUTHORIZED');
      if (original.documentType !== association.documentType) throw new Error('WSFE_ASSOCIATED_DOCUMENT_TYPE_MISMATCH');
      if (original.currencyId !== 'PES') throw new Error('WSFE_ASSOCIATED_DOCUMENT_CURRENCY_MISMATCH');
    }
  }

  private async assertPointOfSaleActive(request: SignerRequest, payload: AuthorityPayload, ticket: WsfeAccessTicket): Promise<void> {
    return this.ensurePointOfSaleActive(ticket, request.workspaceId, payload.issuerProfileRef, payload.pointOfSale, payload.documentType);
  }

  private async ensurePointOfSaleActive(ticket: WsfeAccessTicket, workspaceId: string, issuerProfileRef: string, pointOfSale: number, documentType: number): Promise<void> {
    try {
      await this.authority.assertPointOfSaleActive(ticket, pointOfSale);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'WSFE_POINT_OF_SALE_NOT_ACTIVE') throw error;
      await this.readbackKnownHomologationVoucher(ticket, workspaceId, issuerProfileRef, pointOfSale, documentType);
    }
  }

  private async readbackKnownHomologationVoucher(
    ticket: WsfeAccessTicket, workspaceId: string, issuerProfileRef: string, pointOfSale: number, documentType: number
  ) {
    const proof = this.config.homologationPointOfSaleProof;
    if (this.config.environment !== 'homologation' || !proof
      || workspaceId !== proof.workspaceId || issuerProfileRef !== proof.issuerProfileRef
      || ticket.representedCuit !== proof.representedCuit
      || ticket.representedCuitCommitment !== proof.representedCuitCommitment
      || documentType !== 11 || pointOfSale !== 1) throw new Error('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    const discovery = await this.authority.getPointsOfSale(ticket);
    if (discovery.listedCount !== 0) throw new Error('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    // ponytail: this exact sandbox voucher proves only the known C point; remove this seam once ARCA discovery reports it.
    const document = await this.authority.getDocument(ticket, 11, 1, '1');
    if (!document || document.result !== 'A' || document.documentType !== 11
      || document.pointOfSale !== 1 || document.invoiceNumber !== '1' || document.cae !== proof.cae)
      throw new Error('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    return { caeHash: hashCanonical(document.cae), discoveryResponseHash: discovery.rawResponseHash, authorityResponseHash: document.rawResponseHash };
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
      || !retrieved.cae
    ) throw new Error('WSFE_RECOVERED_DOCUMENT_MISMATCH');
    assertRecoveredMoney(retrieved, payload);
    // ARCA echoes a service period only for concepto 2/3; bind it when the
    // frozen document carries one (productos echo defaults we must not compare).
    if (payload.servicePeriod && JSON.stringify(retrieved.servicePeriod) !== JSON.stringify(payload.servicePeriod)) throw new Error('WSFE_RECOVERED_PERIOD_MISMATCH');
    // FCE facturas echo their payment-due date in FchVtoPago; bind it exactly.
    if (payload.fceEmission && retrieved.paymentDueDate !== payload.fceEmission.paymentDueDate) throw new Error('WSFE_RECOVERED_FCE_MISMATCH');
    if (JSON.stringify(retrieved.associatedDocument) !== JSON.stringify(payload.associatedDocument)) throw new Error('WSFE_RECOVERED_ASSOCIATION_MISMATCH');
    if (request.intentHash !== payload.intentHash) throw new Error('WSFE_RECOVERED_INTENT_MISMATCH');
  }
}

// Recovery money binding, class-driven. Class C: ImpNeto == ImpTotal, no IVA.
// Class A/B: ImpNeto == the frozen net, ImpIVA == Σ importe, and the echoed
// alícuota lines match the frozen breakdown one-for-one (order-independent).
function assertRecoveredMoney(retrieved: WsfeRetrievedDocument, payload: AuthorityPayload): void {
  if (!new Decimal(retrieved.total).eq(payload.total.decimal)) throw new Error('WSFE_RECOVERED_DOCUMENT_MISMATCH');
  const breakdown = payload.taxBreakdown;
  if (!breakdown) {
    if (!new Decimal(retrieved.netAmount).eq(payload.total.decimal) || !new Decimal(retrieved.vatAmount).eq(0) || retrieved.ivaLineItems.length !== 0) {
      throw new Error('WSFE_RECOVERED_DOCUMENT_MISMATCH');
    }
    return;
  }
  if (!new Decimal(retrieved.netAmount).eq(breakdown.netAmount) || !new Decimal(retrieved.vatAmount).eq(deriveVatTotal(breakdown))) {
    throw new Error('WSFE_RECOVERED_DOCUMENT_MISMATCH');
  }
  if (retrieved.ivaLineItems.length !== breakdown.ivaLineItems.length) throw new Error('WSFE_RECOVERED_IVA_MISMATCH');
  const echoed = [...retrieved.ivaLineItems].sort((a, b) => a.alicIvaId - b.alicIvaId);
  const frozen = [...breakdown.ivaLineItems].sort((a, b) => a.alicIvaId - b.alicIvaId);
  for (const [index, line] of frozen.entries()) {
    const other = echoed[index]!;
    if (line.alicIvaId !== other.alicIvaId || !new Decimal(line.baseImp).eq(other.baseImp) || !new Decimal(line.importe).eq(other.importe)) {
      throw new Error('WSFE_RECOVERED_IVA_MISMATCH');
    }
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
