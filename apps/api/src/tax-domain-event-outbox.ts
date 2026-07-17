import { createHmac, randomUUID } from 'node:crypto';

import {
  createTaxDomainEventDeliveryV1,
  type TaxDomainEventDeliveryV1,
  type TaxDomainEventV1,
} from '@tax-engine/core';
import { z } from 'zod';

const MAX_RESPONSE_BYTES = 16 * 1024;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const receiptSchema = z.object({
  version: z.literal('tax-domain-event-receipt-v1'),
  deliveryId: z.uuid(),
  eventId: z.uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  accepted: z.boolean(),
  status: z.enum(['waiting_for_tax_case', 'woken']),
  replayed: z.boolean(),
}).strict();

export interface TaxDomainEventPublisher {
  publish(
    event: TaxDomainEventV1,
    deliveredAt: string
  ): Promise<Readonly<{ eventId: string; payloadHash: string }>>;
}

export interface TaxDomainEventOutboxStore {
  claimTaxDomainEvents(input: Readonly<{
    now: string;
    leaseUntil: string;
    limit: number;
  }>): readonly Readonly<{
    event: TaxDomainEventV1;
    eventHash: string;
    leaseToken: string;
    attempt: number;
  }>[];
  ackTaxDomainEventClaim(eventId: string, leaseToken: string, deliveredAt: string): void;
  releaseTaxDomainEventClaim(
    eventId: string,
    leaseToken: string,
    retryAt: string,
    errorCode: string,
  ): void;
}

/** HTTP boundary from the canonical Tax Engine outbox to Open Agents. */
export class HttpTaxDomainEventPublisher implements TaxDomainEventPublisher {
  readonly #endpoint: URL;

  constructor(
    endpoint: URL,
    private readonly ingressToken: string,
    private readonly signingSecret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly nextDeliveryId: () => string = randomUUID
  ) {
    this.#endpoint = new URL(endpoint.href);
    assertEndpoint(this.#endpoint);
    if (Buffer.byteLength(ingressToken) < 32) {
      throw new Error('TAX_DOMAIN_EVENT_INGRESS_TOKEN_REQUIRED');
    }
    if (Buffer.byteLength(signingSecret) < 32) {
      throw new Error('TAX_DOMAIN_EVENT_HMAC_SECRET_REQUIRED');
    }
  }

  static fromEnvironment(): HttpTaxDomainEventPublisher | null {
    const endpoint = process.env.TAX_DOMAIN_EVENT_OPEN_AGENTS_URL ?? null;
    const token = process.env.TAX_DOMAIN_EVENT_OPEN_AGENTS_TOKEN ?? null;
    const secret = process.env.TAX_DOMAIN_EVENT_HMAC_SECRET ?? null;
    if (!endpoint && !token && !secret) return null;
    if (!endpoint || !token || !secret) {
      throw new Error('TAX_DOMAIN_EVENT_DELIVERY_CONFIGURATION_REQUIRED');
    }
    return new HttpTaxDomainEventPublisher(new URL(endpoint), token, secret);
  }

  async publish(
    event: TaxDomainEventV1,
    deliveredAt: string
  ): Promise<Readonly<{ eventId: string; payloadHash: string }>> {
    const envelope = createTaxDomainEventDeliveryV1({
      deliveryId: this.nextDeliveryId(),
      event,
      deliveredAt,
    });
    const rawBody = JSON.stringify(envelope);
    let response: Response;
    try {
      response = await this.fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.ingressToken}`,
          'content-type': 'application/json',
          'x-bufi-tax-event-signature': createHmac('sha256', this.signingSecret)
            .update(rawBody)
            .digest('hex'),
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
    } catch {
      throw new Error('TAX_DOMAIN_EVENT_TARGET_UNAVAILABLE');
    }
    if (!response.ok) throw new Error('TAX_DOMAIN_EVENT_TARGET_UNAVAILABLE');
    assertResponseOrigin(response, this.#endpoint);
    const receipt = await readReceipt(response);
    assertBoundReceipt(receipt, envelope);
    if (!receipt.accepted || receipt.status !== 'woken') {
      throw new Error('TAX_DOMAIN_EVENT_TARGET_NOT_READY');
    }
    return { eventId: receipt.eventId, payloadHash: receipt.payloadHash };
  }
}

export async function drainTaxDomainEventOutbox(
  store: TaxDomainEventOutboxStore,
  publisher: TaxDomainEventPublisher,
  input: Readonly<{ now?: Date; limit?: number; leaseSeconds?: number }> = {}
): Promise<Readonly<{ claimed: number; delivered: number; retried: number }>> {
  const claimedAt = input.now ?? new Date();
  const leaseUntil = new Date(
    claimedAt.getTime() + (input.leaseSeconds ?? 30) * 1_000
  );
  const claims = store.claimTaxDomainEvents({
    now: claimedAt.toISOString(),
    leaseUntil: leaseUntil.toISOString(),
    limit: input.limit ?? 20,
  });
  let delivered = 0;
  let retried = 0;
  for (const claim of claims) {
    try {
      const receipt = await publisher.publish(claim.event, claimedAt.toISOString());
      if (
        receipt.eventId !== claim.event.eventId
        || receipt.payloadHash !== claim.eventHash
      ) throw new Error('TAX_DOMAIN_EVENT_RECEIPT_MISMATCH');
      try {
        store.ackTaxDomainEventClaim(
          claim.event.eventId,
          claim.leaseToken,
          claimedAt.toISOString()
        );
        delivered += 1;
      } catch (error) {
        if (!hasCode(error, 'TAX_DOMAIN_EVENT_OUTBOX_ACK_FENCE_REJECTED')) throw error;
      }
    } catch (error) {
      const retryAt = new Date(
        claimedAt.getTime() + retryDelayMs(claim.attempt)
      ).toISOString();
      try {
        store.releaseTaxDomainEventClaim(
          claim.event.eventId,
          claim.leaseToken,
          retryAt,
          safeDeliveryError(error)
        );
        retried += 1;
      } catch (fenceError) {
        if (!hasCode(fenceError, 'TAX_DOMAIN_EVENT_OUTBOX_NACK_FENCE_REJECTED')) {
          throw fenceError;
        }
      }
    }
  }
  return { claimed: claims.length, delivered, retried };
}

async function readReceipt(response: Response): Promise<z.infer<typeof receiptSchema>> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null
    && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) throw new Error('TAX_DOMAIN_EVENT_RECEIPT_TOO_LARGE');
  const body = await boundedResponseText(response);
  try {
    return receiptSchema.parse(JSON.parse(body) as unknown);
  } catch (error) {
    if (hasCode(error, 'TAX_DOMAIN_EVENT_RECEIPT_TOO_LARGE')) throw error;
    throw new Error('TAX_DOMAIN_EVENT_RECEIPT_INVALID');
  }
}

async function boundedResponseText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('TAX_DOMAIN_EVENT_RECEIPT_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

function assertBoundReceipt(
  receipt: z.infer<typeof receiptSchema>,
  envelope: TaxDomainEventDeliveryV1
): void {
  if (
    receipt.deliveryId !== envelope.deliveryId
    || receipt.eventId !== envelope.event.eventId
    || receipt.payloadHash !== envelope.payloadHash
  ) throw new Error('TAX_DOMAIN_EVENT_RECEIPT_MISMATCH');
}

function safeDeliveryError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^TAX_DOMAIN_EVENT_[A-Z0-9_]{1,80}$/.test(code)
    ? code.slice(0, 120)
    : 'TAX_DOMAIN_EVENT_DELIVERY_FAILED';
}

function retryDelayMs(attempt: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, attempt - 1)) * 1_000;
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && error.message === code;
}

function assertResponseOrigin(response: Response, endpoint: URL): void {
  if (!response.url) return;
  let responseUrl: URL;
  try {
    responseUrl = new URL(response.url);
  } catch {
    throw new Error('TAX_DOMAIN_EVENT_RESPONSE_ORIGIN_MISMATCH');
  }
  if (responseUrl.origin !== endpoint.origin) {
    throw new Error('TAX_DOMAIN_EVENT_RESPONSE_ORIGIN_MISMATCH');
  }
}

function assertEndpoint(endpoint: URL): void {
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new Error('TAX_DOMAIN_EVENT_URL_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  if (
    endpoint.protocol !== 'https:'
    && !(process.env.NODE_ENV !== 'production' && loopback)
  ) throw new Error('TAX_DOMAIN_EVENT_HTTPS_REQUIRED');
}
