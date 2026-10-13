import { hashCanonical } from '@tax-engine/core';
import { X509Certificate } from 'node:crypto';

import type {
  issuerDelegationRequestSchema,
  IssuerProvisionRequest,
  PayloadRetireReceipt,
  PayloadStoreRequest,
  PayloadTerminalRequest,
  TicketRequest,
  TicketResponse,
  WsaaService,
} from './contracts';
import type { z } from 'zod';
import { referenceRepresentedCuit } from './crypto';
import { ArcaBoundaryStore } from './store';
import { SoapWsaaLoginClient, type WsaaLoginClient, validateIssuerCredential } from './wsaa';

// The caller may request at most seven days as its minimum retention horizon.
// This is not a deletion deadline: unresolved authority effects remain recoverable
// until explicit terminal evidence starts the boundary-owned retention policy.
const MAX_REQUESTED_MINIMUM_RETENTION_MS = 7 * 24 * 60 * 60_000;

export class ArcaBoundaryService {
  readonly #tickets = new Map<string, TicketResponse>();
  readonly #pendingTickets = new Map<string, Promise<TicketResponse>>();
  readonly #taxpayerReferenceKey: Buffer | null;

  constructor(
    private readonly store: ArcaBoundaryStore,
    private readonly wsaa: WsaaLoginClient = new SoapWsaaLoginClient(),
    private readonly retentionPolicy: Readonly<{
      retentionPolicyId: string;
      terminalRetentionMs: number;
    }> = {
      retentionPolicyId: 'arca-authority-terminal-recovery-v1',
      terminalRetentionMs: 30 * 24 * 60 * 60_000,
    },
    taxpayerReferenceKey: Buffer | null = null,
    private readonly betaAliasWorkspaceIds: ReadonlySet<string> | null = null
  ) {
    if (taxpayerReferenceKey && taxpayerReferenceKey.length !== 32)
      throw new Error('ARCA_BOUNDARY_TAXPAYER_REFERENCE_KEY_INVALID');
    this.#taxpayerReferenceKey = taxpayerReferenceKey ? Buffer.from(taxpayerReferenceKey) : null;
    if (!/^[A-Za-z0-9._:-]{1,100}$/.test(retentionPolicy.retentionPolicyId))
      throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_INVALID');
    if (
      !Number.isSafeInteger(retentionPolicy.terminalRetentionMs)
      || retentionPolicy.terminalRetentionMs < 24 * 60 * 60_000
    ) throw new Error('AUTHORITY_PAYLOAD_RETENTION_POLICY_INVALID');
  }

  storePayload(input: PayloadStoreRequest, idempotencyKey: string, occurredAt: string) {
    if (!idempotencyKey) throw new Error('IDEMPOTENCY_KEY_REQUIRED');
    const now = Date.parse(occurredAt);
    const expiresAt = Date.parse(input.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('AUTHORITY_PAYLOAD_EXPIRATION_INVALID');
    if (expiresAt - now > MAX_REQUESTED_MINIMUM_RETENTION_MS) throw new Error('AUTHORITY_PAYLOAD_RETENTION_TOO_LONG');
    // Bind the payload to its workspace on every canonical that carries one
    // (WSFEX Factura E intents and both WSFE Factura C canonicals).
    const canonicalDocument = input.payload.canonicalDocument;
    if ('workspaceId' in canonicalDocument && canonicalDocument.workspaceId !== input.workspaceId) {
      throw new Error('AUTHORITY_PAYLOAD_WORKSPACE_MISMATCH');
    }
    return this.store.storePayload({ ...input, idempotencyKey, occurredAt });
  }

  resolvePayload(reference: string, occurredAt: string) {
    return this.store.resolvePayload(reference, occurredAt);
  }

  markPayloadTerminal(input: PayloadTerminalRequest, occurredAt: string) {
    return this.store.markPayloadTerminal(input, this.retentionPolicy, occurredAt);
  }

  retireEligiblePayloads(occurredAt: string): PayloadRetireReceipt {
    return {
      version: 'authority-payload-retire-eligible-receipt-v1',
      retired: this.store.retireEligiblePayloads(
        this.retentionPolicy.retentionPolicyId,
        occurredAt
      ),
      retentionPolicyId: this.retentionPolicy.retentionPolicyId,
      occurredAt,
    };
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

  delegateIssuerFromStoredCertificate(
    input: z.infer<typeof issuerDelegationRequestSchema>, occurredAt: string,
  ) {
    if (input.templateIssuerProfileRef === input.issuerProfileRef)
      throw new Error('WSAA_ISSUER_DELEGATION_TEMPLATE_MISMATCH');
    const template = this.store.getIssuer(
      input.templateWorkspaceId, input.templateIssuerProfileRef, input.environment,
    );
    if (!template.active || !template.delegationConfirmed || template.certificateHolderCuit !== template.representedCuit)
      throw new Error('WSAA_ISSUER_DELEGATION_TEMPLATE_NOT_OWNED');
    const validated = validateIssuerCredential({
      workspaceId: input.workspaceId,
      issuerProfileRef: input.issuerProfileRef,
      environment: input.environment,
      certificateHolderCuit: template.certificateHolderCuit,
      representedCuit: input.representedCuit,
      certificatePem: template.certificatePem,
      privateKeyPem: template.privateKeyPem,
      // Only an operator with the boundary admin token can attest that BUFI
      // accepted the third-party designation. Official POS reads still gate readiness.
      delegationConfirmed: true,
    }, new Date(occurredAt));
    const receipt = this.store.provisionIssuer({
      ...validated, replaceCertificateFingerprint: null, occurredAt,
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
    validateIssuerCredential(credential, new Date(occurredAt));
    if (!credential.delegationConfirmed) throw new Error('WSAA_DELEGATION_NOT_CONFIRMED');
    if (!credential.representedCuitCommitment)
      throw new Error('WSAA_ISSUER_REPRESENTED_CUIT_UNBOUND');
    const key = ticketKey(input.environment, input.workspaceId, input.issuerProfileRef, input.service, credential.certificateFingerprint, credential.representedCuitCommitment);
    const cached = this.#tickets.get(key);
    if (cached && Date.parse(cached.expiresAt) > Date.parse(occurredAt) + 60_000) return cached;
    const stored = this.store.getTicket(key, occurredAt);
    if (stored) {
      if (stored.representedCuitCommitment !== credential.representedCuitCommitment || stored.representedCuit !== credential.representedCuit)
        throw new Error('WSAA_TICKET_BINDING_MISMATCH');
      this.#tickets.set(key, stored);
      return stored;
    }
    if (input.environment === 'homologation' && this.betaAliasWorkspaceIds?.has(input.workspaceId)) {
      const reused = this.store.reusableAliasTicket(credential, input.service, occurredAt, this.betaAliasWorkspaceIds);
      if (reused) {
        this.store.storeTicket(key, input.issuerProfileRef, reused);
        this.#tickets.set(key, reused);
        return reused;
      }
    }
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

  issuerStatus(workspaceId: string, issuerProfileRef: string, environment: 'homologation' | 'production', occurredAt: string) {
    const credential = this.store.inspectIssuer(workspaceId, issuerProfileRef, environment);
    const certificate = credential ? new X509Certificate(credential.certificatePem) : null;
    const certificateValidFrom = certificate ? new Date(certificate.validFrom).toISOString() : null;
    const certificateValidUntil = certificate ? new Date(certificate.validTo).toISOString() : null;
    const certificateCurrent = Boolean(
      certificate && Date.parse(certificate.validFrom) <= Date.parse(occurredAt)
      && Date.parse(certificate.validTo) > Date.parse(occurredAt) + 60_000
    );
    const ticketCached = (service: WsaaService) => Boolean(
      credential?.active && credential.delegationConfirmed && certificateCurrent
      && credential.representedCuitCommitment
      && this.store.hasValidTicket(ticketKey(environment, workspaceId, issuerProfileRef, service, credential.certificateFingerprint, credential.representedCuitCommitment), occurredAt)
    );
    return {
      version: 'wsaa-issuer-status-v1' as const,
      workspaceId,
      issuerProfileRef,
      environment,
      configured: Boolean(credential),
      active: Boolean(credential?.active),
      delegationConfirmed: Boolean(credential?.delegationConfirmed),
      certificateFingerprint: credential?.certificateFingerprint ?? null,
      representedCuitCommitment: credential?.representedCuitCommitment ?? null,
      taxpayerReferenceHash: credential && this.#taxpayerReferenceKey
        ? referenceRepresentedCuit(this.#taxpayerReferenceKey, credential.representedCuit)
        : null,
      representedCuitLast4: credential?.representedCuit.slice(-4) ?? null,
      representedCuitMasked: credential ? `${credential.representedCuit.slice(0, 2)}******${credential.representedCuit.slice(-3)}` : null,
      certificate: { validFrom: certificateValidFrom, validUntil: certificateValidUntil, current: certificateCurrent },
      services: Object.fromEntries((['wsfe', 'wsfex', 'wsfecred'] as const).map(service => [service, {
        wsaaTicketCached: ticketCached(service),
        authorityStatus: 'not_checked' as const,
      }])),
    };
  }

  private async obtainTicket(input: TicketRequest, credential: ReturnType<ArcaBoundaryStore['getIssuer']>, occurredAt: string): Promise<TicketResponse> {
    const result = await this.wsaa.login({ credential, service: input.service, now: new Date(occurredAt) });
    const ticket: TicketResponse = {
      token: result.token,
      sign: result.sign,
      representedCuit: credential.representedCuit,
      representedCuitCommitment: credential.representedCuitCommitment!,
      expiresAt: result.expiresAt,
    };
    const key = ticketKey(input.environment, input.workspaceId, input.issuerProfileRef, input.service, credential.certificateFingerprint, credential.representedCuitCommitment!);
    this.store.storeTicket(key, input.issuerProfileRef, ticket);
    this.#tickets.set(key, ticket);
    this.store.appendTicketEvent(input.issuerProfileRef, hashCanonical({ safeReceiptHash: result.safeReceiptHash, expiresAt: result.expiresAt, representedCuitCommitment: credential.representedCuitCommitment }), occurredAt);
    return ticket;
  }
}

function ticketKey(environment: string, workspaceId: string, issuerProfileRef: string, service: string, certificateFingerprint: string, representedCuitCommitment: string): string {
  return hashCanonical({ environment, workspaceId, issuerProfileRef, service, certificateFingerprint, representedCuitCommitment });
}

function health(environment: 'homologation' | 'production', service: WsaaService, certificateDelegationConfigured: boolean, wsaaReady: boolean) {
  return { version: 'wsaa-broker-health-v1' as const, service, environment, certificateDelegationConfigured, wsaaReady };
}
