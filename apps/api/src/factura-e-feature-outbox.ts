import { createHmac } from 'node:crypto';

import { z } from 'zod';

import type { FacturaEFeatureV1 } from '@tax-engine/core';

import type {
  ClaimedFacturaEFeatureEvent,
  FacturaEFeaturePublicationStore,
} from './factura-e-feature-publication';
import { refuseRedirect } from './bounded-body';

const MAX_RESPONSE_BYTES = 16 * 1024;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const receiptSchema = z.object({
  version: z.literal('factura-e-feature-event-receipt-v1'),
  eventId: z.uuid(),
  featureHash: z.string().regex(/^[a-f0-9]{64}$/),
  accepted: z.literal(true),
}).strict();

export type FacturaEFeatureEventEnvelopeV1 = Readonly<{
  version: 'factura-e-feature-event-envelope-v1';
  eventId: string;
  executionId: string;
  workspaceId: string;
  feature: FacturaEFeatureV1;
}>;

export interface FacturaEFeatureEventPublisher {
  publish(event: FacturaEFeatureEventEnvelopeV1): Promise<Readonly<{
    eventId: string;
    featureHash: string;
  }>>;
}

export class HttpFacturaEFeatureEventPublisher implements FacturaEFeatureEventPublisher {
  readonly #endpoint: URL;

  constructor(
    endpoint: URL,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.#endpoint = new URL(endpoint.href);
    assertEndpoint(this.#endpoint);
    if (Buffer.byteLength(secret) < 32) {
      throw new Error('TAX_FACTURA_E_FEATURE_EVENT_SECRET_REQUIRED');
    }
  }

  static fromEnvironment(): HttpFacturaEFeatureEventPublisher | null {
    const endpoint = process.env.TAX_FACTURA_E_FEATURE_EVENT_URL ?? null;
    const secret = process.env.TAX_FACTURA_E_FEATURE_EVENT_HMAC_SECRET ?? null;
    if (!endpoint && !secret) return null;
    if (!endpoint || !secret) {
      throw new Error('TAX_FACTURA_E_FEATURE_EVENT_CONFIGURATION_REQUIRED');
    }
    return new HttpFacturaEFeatureEventPublisher(new URL(endpoint), secret);
  }

  async publish(event: FacturaEFeatureEventEnvelopeV1): Promise<Readonly<{
    eventId: string;
    featureHash: string;
  }>> {
    const rawBody = JSON.stringify(event);
    let response: Response;
    try {
      response = await this.fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tax-feature-event-id': event.eventId,
          'x-tax-feature-event-signature': createHmac('sha256', this.secret)
            .update(rawBody)
            .digest('hex'),
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
        redirect: 'manual',
      }).then(refuseRedirect);
    } catch {
      throw new Error('TAX_FACTURA_E_FEATURE_EVENT_UPSTREAM_UNAVAILABLE');
    }
    if (!response.ok) {
      throw new Error('TAX_FACTURA_E_FEATURE_EVENT_UPSTREAM_UNAVAILABLE');
    }
    assertResponseOrigin(response, this.#endpoint);
    const raw = await boundedResponseText(response);
    let receipt: z.infer<typeof receiptSchema>;
    try {
      receipt = receiptSchema.parse(JSON.parse(raw) as unknown);
    } catch {
      throw new Error('TAX_FACTURA_E_FEATURE_EVENT_RECEIPT_INVALID');
    }
    if (
      receipt.eventId !== event.eventId
      || receipt.featureHash !== event.feature.featureHash
    ) throw new Error('TAX_FACTURA_E_FEATURE_EVENT_RECEIPT_MISMATCH');
    return { eventId: receipt.eventId, featureHash: receipt.featureHash };
  }
}

function assertResponseOrigin(response: Response, endpoint: URL): void {
  if (!response.url) return;
  let responseUrl: URL;
  try {
    responseUrl = new URL(response.url);
  } catch {
    throw new Error('TAX_FACTURA_E_FEATURE_EVENT_RESPONSE_ORIGIN_MISMATCH');
  }
  if (responseUrl.origin !== endpoint.origin) {
    throw new Error('TAX_FACTURA_E_FEATURE_EVENT_RESPONSE_ORIGIN_MISMATCH');
  }
}

async function boundedResponseText(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null
    && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  ) throw new Error('TAX_FACTURA_E_FEATURE_EVENT_RESPONSE_TOO_LARGE');
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
        throw new Error('TAX_FACTURA_E_FEATURE_EVENT_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

export async function drainFacturaEFeatureOutbox(
  store: FacturaEFeaturePublicationStore,
  publisher: FacturaEFeatureEventPublisher,
  input: Readonly<{
    now?: Date;
    limit?: number;
    leaseSeconds?: number;
  }> = {}
): Promise<Readonly<{ claimed: number; delivered: number; retried: number }>> {
  const claimedAt = input.now ?? new Date();
  const events = store.claimOutbox({
    limit: input.limit ?? 20,
    leaseSeconds: input.leaseSeconds ?? 30,
    now: claimedAt,
  });
  let delivered = 0;
  let retried = 0;
  for (const event of events) {
    try {
      const receipt = await publisher.publish(envelope(event));
      if (
        receipt.eventId !== event.eventId
        || receipt.featureHash !== event.feature.featureHash
      ) throw new Error('TAX_FACTURA_E_FEATURE_EVENT_RECEIPT_MISMATCH');
      const completedAt = input.now ?? new Date();
      store.ackOutbox(event.eventId, event.leaseToken, completedAt.toISOString());
      delivered += 1;
    } catch (error) {
      const failedAt = input.now ?? new Date();
      const retryAt = new Date(
        failedAt.getTime() + retryDelayMs(event.attempt)
      ).toISOString();
      try {
        store.nackOutbox(
          event.eventId,
          event.leaseToken,
          safeDeliveryError(error),
          retryAt,
          failedAt.toISOString()
        );
        retried += 1;
      } catch (fenceError) {
        if (
          !(fenceError instanceof Error)
          || fenceError.message !== 'FACTURA_E_FEATURE_OUTBOX_NACK_FENCE_REJECTED'
        ) throw fenceError;
      }
    }
  }
  return { claimed: events.length, delivered, retried };
}

function envelope(event: ClaimedFacturaEFeatureEvent): FacturaEFeatureEventEnvelopeV1 {
  return {
    version: 'factura-e-feature-event-envelope-v1',
    eventId: event.eventId,
    executionId: event.executionId,
    workspaceId: event.workspaceId,
    feature: event.feature,
  };
}

function safeDeliveryError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  return /^TAX_FACTURA_E_FEATURE_EVENT_[A-Z0-9_]{1,50}$/.test(code)
    ? code.slice(0, 80)
    : 'TAX_FACTURA_E_FEATURE_EVENT_DELIVERY_FAILED';
}

function retryDelayMs(attempt: number): number {
  return Math.min(300, 5 * 2 ** Math.max(0, attempt - 1)) * 1_000;
}

function assertEndpoint(endpoint: URL): void {
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new Error('TAX_FACTURA_E_FEATURE_EVENT_URL_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && loopback)) {
    throw new Error('TAX_FACTURA_E_FEATURE_EVENT_HTTPS_REQUIRED');
  }
}
