import { createHmac, createHash, randomUUID } from 'node:crypto';

import {
  assertTaxDomainEventV1,
  type TaxDomainEventV1,
} from '@tax-engine/core';
import { z } from 'zod';

import { TaxProfileStore } from './store';
import {
  drainTaxDomainEventOutbox,
  HttpTaxDomainEventPublisher,
} from './tax-domain-event-outbox';
import { refuseRedirect } from './bounded-body';

const MAX_RESPONSE_BYTES = 16 * 1024;
const DEFAULT_TIMEOUT_MS = 60_000;

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const startSchema = z
  .object({
    version: z.literal('tax-domain-event-certification-start-v1'),
    certificationId: z.uuid(),
    workspaceRef: z.string().uuid(),
    caseRef: z.string().regex(/^taxcase_e2e_[a-f0-9]{40}$/),
    runRef: z.string().regex(/^taxcert_[a-f0-9]{40}$/),
    workflowRunRef: z.string().min(1).max(200).nullable(),
    status: z.enum([
      'pending',
      'running',
      'completed',
      'failed',
      'cancelled',
    ]),
    replayed: z.boolean(),
  })
  .strict();

const statusSchema = z
  .object({
    version: z.literal('tax-domain-event-certification-status-v1'),
    certificationId: z.uuid(),
    runRef: z.string().regex(/^taxcert_[a-f0-9]{40}$/),
    caseRef: z.string().regex(/^taxcase_e2e_[a-f0-9]{40}$/),
    workflowRunRef: z.string().min(1).max(200).nullable(),
    status: z.enum([
      'pending',
      'running',
      'pause_requested',
      'paused',
      'awaiting_approval',
      'approved',
      'rejected',
      'completed',
      'failed',
      'cancelled',
    ]),
    eventId: z.uuid().nullable(),
  })
  .strict();

export type TaxDomainEventCertificationReport = Readonly<{
  version: 'tax-domain-event-corridor-certification-v1';
  certificationId: string;
  runRef: string;
  caseRef: string;
  eventId: string;
  outboxDelivered: true;
  workflowStatus: 'completed';
  replayed: boolean;
  certifiedAt: string;
}>;

export type TaxDomainEventCertificationConfig = Readonly<{
  eventEndpoint: URL;
  ingressToken: string;
  hmacSecret: string;
  certificationSecret: string;
  productionApproved?: boolean;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  sleepImpl?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  nextEventId?: () => string;
}>;

/**
 * Certify the real producer outbox, signed ingress, durable tenant inbox and
 * Open Agents workflow wake without touching a user workspace or authority.
 */
export async function certifyTaxDomainEventCorridor(
  config: TaxDomainEventCertificationConfig,
  certificationIdInput: string,
): Promise<TaxDomainEventCertificationReport> {
  const certificationId = z.uuid().parse(certificationIdInput);
  const eventEndpoint = new URL(config.eventEndpoint.href);
  assertCertificationTarget(eventEndpoint, config.productionApproved === true);
  assertSecret(config.ingressToken, 'TAX_DOMAIN_EVENT_INGRESS_TOKEN_REQUIRED');
  assertSecret(config.hmacSecret, 'TAX_DOMAIN_EVENT_HMAC_SECRET_REQUIRED');
  assertSecret(
    config.certificationSecret,
    'TAX_DOMAIN_EVENT_CERTIFICATION_SECRET_REQUIRED',
  );
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleepImpl = config.sleepImpl ?? delay;
  const now = config.now ?? (() => new Date());
  const deadline = Date.now() + (config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const certificationEndpoint = new URL(
    '/api/internal/certification/tax-domain-event',
    eventEndpoint,
  );
  const start = await startCertification({
    endpoint: certificationEndpoint,
    certificationId,
    secret: config.certificationSecret,
    fetchImpl,
  });
  assertCertificationIdentity(start, certificationId);

  if (start.status === 'completed') {
    const completed = await readCertificationStatus({
      endpoint: certificationEndpoint,
      certificationId,
      secret: config.certificationSecret,
      fetchImpl,
    });
    assertCertificationStatusIdentity(completed, start);
    return completedReport(completed, now().toISOString(), true);
  }
  if (['failed', 'cancelled'].includes(start.status))
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_RUN_TERMINAL');

  const event = certificationEvent({
    certificationId,
    workspaceRef: start.workspaceRef,
    caseRef: start.caseRef,
    hmacSecret: config.hmacSecret,
    eventId: (config.nextEventId ?? randomUUID)(),
    occurredAt: now().toISOString(),
  });
  const storeSecret = createHash('sha256')
    .update(`tax-domain-event-certification-store:v1:${config.hmacSecret}`)
    .digest('hex');
  const store = new TaxProfileStore(':memory:', storeSecret);
  try {
    store.appendTaxDomainEvent(event, event.occurredAt);
    const publisher = new HttpTaxDomainEventPublisher(
      eventEndpoint,
      config.ingressToken,
      config.hmacSecret,
      fetchImpl,
    );
    let delivered = false;
    while (Date.now() < deadline && !delivered) {
      const result = await drainTaxDomainEventOutbox(store, publisher, {
        now: now(),
        limit: 1,
        leaseSeconds: 10,
      });
      delivered = result.delivered === 1;
      if (!delivered) await sleepImpl(500);
    }
    if (!delivered)
      throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_DELIVERY_TIMEOUT');

    while (Date.now() < deadline) {
      const status = await readCertificationStatus({
        endpoint: certificationEndpoint,
        certificationId,
        secret: config.certificationSecret,
        fetchImpl,
      });
      assertCertificationStatusIdentity(status, start);
      if (status.status === 'completed') {
        if (status.eventId !== event.eventId)
          throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_EVENT_MISMATCH');
        return completedReport(status, now().toISOString(), start.replayed);
      }
      if (['failed', 'cancelled', 'rejected'].includes(status.status))
        throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_WORKFLOW_FAILED');
      await sleepImpl(500);
    }
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_WORKFLOW_TIMEOUT');
  } finally {
    store.close();
  }
}

export function taxDomainEventCertificationConfigFromEnvironment():
  TaxDomainEventCertificationConfig {
  const endpoint = process.env.TAX_DOMAIN_EVENT_OPEN_AGENTS_URL;
  if (!endpoint)
    throw new Error('TAX_DOMAIN_EVENT_OPEN_AGENTS_URL_REQUIRED');
  return {
    eventEndpoint: new URL(endpoint),
    ingressToken: process.env.TAX_DOMAIN_EVENT_OPEN_AGENTS_TOKEN ?? '',
    hmacSecret: process.env.TAX_DOMAIN_EVENT_HMAC_SECRET ?? '',
    certificationSecret:
      process.env.OPEN_AGENTS_TAX_DOMAIN_EVENT_CERTIFICATION_SECRET ?? '',
    productionApproved:
      process.env.TAX_DOMAIN_EVENT_CERTIFICATION_PRODUCTION_APPROVED === 'true',
  };
}

async function startCertification(input: {
  endpoint: URL;
  certificationId: string;
  secret: string;
  fetchImpl: FetchLike;
}): Promise<z.infer<typeof startSchema>> {
  const response = await input.fetchImpl(input.endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.secret}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ certificationId: input.certificationId }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  }).then(refuseRedirect).catch(() => {
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_TARGET_UNAVAILABLE');
  });
  if (!response.ok)
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_START_REJECTED');
  assertResponseOrigin(response, input.endpoint);
  return startSchema.parse(await boundedJson(response));
}

async function readCertificationStatus(input: {
  endpoint: URL;
  certificationId: string;
  secret: string;
  fetchImpl: FetchLike;
}): Promise<z.infer<typeof statusSchema>> {
  const endpoint = new URL(input.endpoint.href);
  endpoint.searchParams.set('certificationId', input.certificationId);
  const response = await input.fetchImpl(endpoint, {
    headers: { authorization: `Bearer ${input.secret}` },
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  }).then(refuseRedirect).catch(() => {
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_TARGET_UNAVAILABLE');
  });
  if (!response.ok)
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_STATUS_REJECTED');
  assertResponseOrigin(response, endpoint);
  return statusSchema.parse(await boundedJson(response));
}

function certificationEvent(input: {
  certificationId: string;
  workspaceRef: string;
  caseRef: string;
  hmacSecret: string;
  eventId: string;
  occurredAt: string;
}): TaxDomainEventV1 {
  const commit = (purpose: string) =>
    createHmac('sha256', input.hmacSecret)
      .update(
        `tax-domain-event-certification:v1:${purpose}:${input.certificationId}`,
      )
      .digest('hex');
  return assertTaxDomainEventV1({
    version: 'tax-domain-event-v1',
    eventId: z.uuid().parse(input.eventId),
    workspaceId: input.workspaceRef,
    caseRef: input.caseRef,
    kind: 'evidence.gap_changed',
    state: 'blocked',
    occurredAt: input.occurredAt,
    idempotencyKey: `taxcert_${commit('idempotency').slice(0, 40)}`,
    correlationRef: `taxcert_${commit('correlation').slice(0, 40)}`,
    source: {
      system: 'evidence_graph',
      sourceEventHash: commit('source-event'),
      verifiedAt: input.occurredAt,
    },
    authentication: {
      method: 'internal_outbox',
      principalRef: 'tax_domain_event_certifier',
      credentialVersion: 'tax-certification-v1',
      signatureHash: commit('authentication'),
    },
    consent: {
      purpose: 'tax_workspace_processing',
      version: 'synthetic-certification-v1',
      scopeHash: commit('consent-scope'),
      state: 'active',
    },
    evidenceHashes: [commit('evidence')],
    ruleVersionIds: ['tax-domain-event-certification-v1'],
    policyVersionIds: ['tax-domain-event-minimization-v1'],
    actionRefs: ['tax_action_certification_review'],
  });
}

function assertCertificationTarget(endpoint: URL, productionApproved: boolean) {
  if (
    endpoint.pathname !== '/api/bufi/tax-domain-event' ||
    endpoint.search ||
    endpoint.hash ||
    endpoint.username ||
    endpoint.password
  )
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_URL_INVALID');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(
    endpoint.hostname,
  );
  if (endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:'))
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_HTTPS_REQUIRED');
  if (!loopback && !endpoint.hostname.includes('-git-') && !productionApproved)
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_PREVIEW_REQUIRED');
}

function assertCertificationIdentity(
  start: z.infer<typeof startSchema>,
  certificationId: string,
) {
  if (
    start.certificationId !== certificationId ||
    start.workspaceRef !== certificationId
  )
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_IDENTITY_MISMATCH');
}

function assertCertificationStatusIdentity(
  status: z.infer<typeof statusSchema>,
  start: z.infer<typeof startSchema>,
) {
  if (
    status.certificationId !== start.certificationId ||
    status.runRef !== start.runRef ||
    status.caseRef !== start.caseRef ||
    (start.workflowRunRef !== null &&
      status.workflowRunRef !== start.workflowRunRef)
  )
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_IDENTITY_MISMATCH');
}

function completedReport(
  status: z.infer<typeof statusSchema>,
  certifiedAt: string,
  replayed: boolean,
): TaxDomainEventCertificationReport {
  if (status.status !== 'completed' || status.eventId === null)
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_RESULT_INVALID');
  return {
    version: 'tax-domain-event-corridor-certification-v1',
    certificationId: status.certificationId,
    runRef: status.runRef,
    caseRef: status.caseRef,
    eventId: status.eventId,
    outboxDelivered: true,
    workflowStatus: 'completed',
    replayed,
    certifiedAt,
  };
}

function assertSecret(value: string, errorCode: string) {
  if (Buffer.byteLength(value) < 32) throw new Error(errorCode);
}

async function boundedJson(response: Response): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)
  )
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_RESPONSE_TOO_LARGE');
  if (!response.body) throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_RESPONSE_INVALID');
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
        throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
    ) as unknown;
  } catch {
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_RESPONSE_INVALID');
  }
}

function assertResponseOrigin(response: Response, endpoint: URL) {
  if (!response.url) return;
  const responseUrl = new URL(response.url);
  if (responseUrl.origin !== endpoint.origin)
    throw new Error('TAX_DOMAIN_EVENT_CERTIFICATION_RESPONSE_ORIGIN_MISMATCH');
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
