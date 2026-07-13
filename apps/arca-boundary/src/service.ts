import { hashCanonical } from '@tax-engine/core';

import type { IssuerProvisionRequest, PayloadStoreRequest, TicketRequest, TicketResponse, WsaaService } from './contracts';
import { ArcaBoundaryStore } from './store';
import { SoapWsaaLoginClient, type WsaaLoginClient, validateIssuerCredential } from './wsaa';

const MAX_PAYLOAD_RETENTION_MS = 7 * 24 * 60 * 60_000;

export class ArcaBoundaryService {
  readonly #tickets = new Map<string, TicketResponse>();
  readonly #pendingTickets = new Map<string, Promise<TicketResponse>>();

  constructor(
    private readonly store: ArcaBoundaryStore,
    private readonly wsaa: WsaaLoginClient = new SoapWsaaLoginClient()
  ) {}

  storePayload(input: PayloadStoreRequest, idempotencyKey: string, occurredAt: string) {
    if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const now = Date.parse(occurredAt);
    const expiresAt = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('AUTHORITY_PAYLOAD_EXPIRATION_INVALID');
    if (expiresAt - now > MAX_PAYLOAD_RETENTION_MS) throw new Error('AUTHORITY_PAYLOAD_RETENTION_TOO_LONG');
    if (input.payload.canonicalDocument.version === 'factura-e-intent-v1' && input.payload.canonicalDocument.workspaceId !== input.workspaceId) {
      throw new Error('AUTHORITY_PAYLOAD_WORKSPACE_MISMATCH');
    }
    return this.store.storePayload({ ...input, idempotencyKey, occurredAt });
  }

  resolvePayload(reference: string, occurredAt: string) {
    return this.store.resolvePayload(reference, occurredAt);
  }

  revokePayload(workspaceId: string, reference: string, occurredAt: string): Readonly<{ revoked: true }> {
    this.store.revokePayload(workspaceId, reference, occurredAt);
    return { revoked: true };
  }

  provisionIssuer(input: IssuerProvisionRequest, occurredAt: string) {
    const validated = validateIssuerCredential(input, new Date(occurredAt));
    const receipt = this.store.provisionIssuer({
      ...validated,
      replaceCertificateFingerprint: input.replaceCertificateFingerprint,
      occurredAt,
    });
    this.#tickets.clear();
    return receipt;
  }

  revokeIssuer(issuerProfileRef: string, certificateFingerprint: string, occurredAt: string): Readonly<{ revoked: true }> {
    this.store.revokeIssuer(issuerProfileRef, certificateFingerprint, occurredAt);
    this.#tickets.clear();
    return { revoked: true };
  }

  async getTicket(input: TicketRequest, occurredAt: string): Promise<TicketResponse> {
    const credential = this.store.getIssuer(input.workspaceId, input.issuerProfileRef, input.environment);
    if (!credential.delegationConfirmed) throw new Error('WSAA_DELEGATION_NOT_CONFIRMED');
    const key = ticketKey(input.environment, input.workspaceId, input.issuerProfileRef, input.service, credential.certificateFingerprint);
    const cached = this.#tickets.get(key);
    if (cached && Date.parse(cached.expiresAt) > Date.parse(occurredAt) + 60_000) return cached;
    const pending = this.#pendingTickets.get(key);
    if (pending) return pending;
    const request = this.obtainTicket(input, credential, occurredAt).finally(() => this.#pendingTickets.delete(key));
    this.#pendingTickets.set(key, request);
    return request;
  }

  async health(environment: 'homologation' | 'production', occurredAt: string, service: WsaaService = 'wsfex') {
    const credential = this.store.firstDelegatedIssuer(environment);
    if (!credential) return health(environment, service, false, false);
    try {
      await this.getTicket({
        version: 'wsaa-ticket-request-v1',
        service,
        environment,
        workspaceId: credential.workspaceId,
        issuerProfileRef: credential.issuerProfileRef,
      }, occurredAt);
      return health(environment, service, true, true);
    } catch {
      return health(environment, service, true, false);
    }
  }

  private async obtainTicket(input: TicketRequest, credential: ReturnType<ArcaBoundaryStore['getIssuer']>, occurredAt: string): Promise<TicketResponse> {
    const result = await this.wsaa.login({ credential, service: input.service, now: new Date(occurredAt) });
    const ticket: TicketResponse = {
      token: result.token,
      sign: result.sign,
      representedCuit: credential.representedCuit,
      expiresAt: result.expiresAt,
    };
    this.#tickets.set(ticketKey(input.environment, input.workspaceId, input.issuerProfileRef, input.service, credential.certificateFingerprint), ticket);
    this.store.appendTicketEvent(input.issuerProfileRef, hashCanonical({ safeReceiptHash: result.safeReceiptHash, expiresAt: result.expiresAt }), occurredAt);
    return ticket;
  }
}

function ticketKey(environment: string, workspaceId: string, issuerProfileRef: string, service: string, certificateFingerprint: string): string {
  return hashCanonical({ environment, workspaceId, issuerProfileRef, service, certificateFingerprint });
}

function health(environment: 'homologation' | 'production', service: WsaaService, certificateDelegationConfigured: boolean, wsaaReady: boolean) {
  return { version: 'wsaa-broker-health-v1' as const, service, environment, certificateDelegationConfigured, wsaaReady };
}
