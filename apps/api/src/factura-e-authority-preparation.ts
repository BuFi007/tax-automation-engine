import { createHmac, timingSafeEqual } from 'node:crypto';

import { hashCanonical } from '@tax-engine/core';
import { isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';
import { refuseRedirect } from './bounded-body';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,500}$/;
const MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_PREPARATION_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1_000;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type FacturaEAuthorityPreparationRequest = Readonly<{
  executionId: string;
  workspaceId: string;
  runId: string;
  intentHash: string;
  pointOfSale: number;
  currency: string;
  taxpayerReferenceHash: string;
  foreignCustomerReferenceHash: string;
  idempotencyKey: string;
}>;

const privatePreparationSchema = z.object({
  version: z.literal('factura-e-authority-private-preparation-v1'),
  executionId: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  intentHash: z.string().regex(SHA256),
  taxpayerReferenceHash: z.string().regex(SHA256),
  foreignCustomerReferenceHash: z.string().regex(SHA256),
  representedCuitCommitment: z.string().regex(SHA256),
  idempotencyKey: z.string().min(16).max(200),
  requestId: z.string().regex(/^[1-9]\d{0,14}$/),
  invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/),
  issuerProfileRef: z.string().regex(SAFE_REFERENCE),
  customer: z.object({
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(300),
    countryCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit, {
      message: 'CUIT_CHECK_DIGIT_INVALID',
    }),
    foreignTaxId: z.string().min(1).max(50).nullable(),
  }).strict(),
  currencyArcaId: z.string().regex(/^[A-Z0-9]{1,3}$/),
  language: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  commercialObservation: z.string().max(4_000).nullable(),
  generalObservation: z.string().max(1_000).nullable(),
  preparedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
  preparationHash: z.string().regex(SHA256),
}).strict();

export type FacturaEAuthorityPrivatePreparation = z.infer<typeof privatePreparationSchema>;

export interface FacturaEAuthorityPreparationGateway {
  prepare(
    input: FacturaEAuthorityPreparationRequest
  ): Promise<FacturaEAuthorityPrivatePreparation>;
}

/**
 * Private Tax-to-preparation boundary. The resolver owns customer legal data,
 * issuer-profile selection, and monotonic WSFEX number allocation. None of that
 * material is accepted from Motora, Open Agents, or a browser.
 */
export class HttpFacturaEAuthorityPreparationGateway
  implements FacturaEAuthorityPreparationGateway {
  constructor(
    private readonly endpoint: URL,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => Date = () => new Date()
  ) {
    assertEndpoint(endpoint);
    if (Buffer.byteLength(secret) < 32) {
      throw new Error('TAX_ARCA_PREPARATION_HMAC_SECRET_REQUIRED');
    }
  }

  static fromEnvironment(): HttpFacturaEAuthorityPreparationGateway | null {
    const rawEndpoint = process.env.TAX_ENGINE_ARCA_PREPARATION_URL ?? null;
    const secret = process.env.TAX_ENGINE_ARCA_PREPARATION_HMAC_SECRET ?? null;
    if (!rawEndpoint && !secret) return null;
    if (!rawEndpoint || !secret) {
      throw new Error('TAX_ARCA_PREPARATION_CONFIGURATION_REQUIRED');
    }
    return new HttpFacturaEAuthorityPreparationGateway(new URL(rawEndpoint), secret);
  }

  async prepare(
    input: FacturaEAuthorityPreparationRequest
  ): Promise<FacturaEAuthorityPrivatePreparation> {
    assertRequest(input);
    const rawBody = JSON.stringify({
      version: 'factura-e-authority-private-preparation-request-v1',
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      runId: input.runId,
      intentHash: input.intentHash,
      pointOfSale: input.pointOfSale,
      currency: input.currency,
      taxpayerReferenceHash: input.taxpayerReferenceHash,
      foreignCustomerReferenceHash: input.foreignCustomerReferenceHash,
      idempotencyKey: input.idempotencyKey,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': input.idempotencyKey,
          'x-tax-authority-preparation-signature': hmac(this.secret, rawBody),
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      }).then(refuseRedirect);
    } catch {
      throw new Error('TAX_ARCA_PREPARATION_UPSTREAM_UNAVAILABLE');
    }
    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error('TAX_ARCA_PREPARATION_UPSTREAM_UNAVAILABLE');
      }
      throw new Error(`TAX_ARCA_PREPARATION_REJECTED_${response.status}`);
    }
    const raw = await readBoundedResponseBody(response);
    const signature = response.headers.get('x-tax-authority-preparation-signature') ?? '';
    if (!constantTimeEqual(signature, hmac(this.secret, raw))) {
      throw new Error('TAX_ARCA_PREPARATION_RECEIPT_UNAUTHORIZED');
    }
    let prepared: FacturaEAuthorityPrivatePreparation;
    try {
      prepared = privatePreparationSchema.parse(JSON.parse(raw) as unknown);
    } catch {
      throw new Error('TAX_ARCA_PREPARATION_RECEIPT_INVALID');
    }
    if (
      prepared.executionId !== input.executionId
      || prepared.workspaceId !== input.workspaceId
      || prepared.runId !== input.runId
      || prepared.intentHash !== input.intentHash
      || prepared.taxpayerReferenceHash !== input.taxpayerReferenceHash
      || prepared.foreignCustomerReferenceHash !== input.foreignCustomerReferenceHash
      || prepared.idempotencyKey !== input.idempotencyKey
    ) throw new Error('TAX_ARCA_PREPARATION_RECEIPT_BINDING_MISMATCH');
    const expectedHash = hashCanonical(preparationMaterial(prepared));
    if (prepared.preparationHash !== expectedHash) {
      throw new Error('TAX_ARCA_PREPARATION_RECEIPT_HASH_MISMATCH');
    }
    const nowMs = this.now().getTime();
    const preparedAtMs = Date.parse(prepared.preparedAt);
    const expiresAtMs = Date.parse(prepared.expiresAt);
    if (
      preparedAtMs > nowMs + MAX_CLOCK_SKEW_MS
      || expiresAtMs <= nowMs
      || expiresAtMs <= preparedAtMs
      || expiresAtMs - preparedAtMs > MAX_PREPARATION_TTL_MS
    ) throw new Error('TAX_ARCA_PREPARATION_RECEIPT_EXPIRED');
    return prepared;
  }
}

export function hashFacturaEAuthorityPrivatePreparation(
  value: Omit<FacturaEAuthorityPrivatePreparation, 'preparationHash'>
): string {
  return hashCanonical(preparationMaterial(value));
}

function preparationMaterial(
  value: Omit<FacturaEAuthorityPrivatePreparation, 'preparationHash'>
    | FacturaEAuthorityPrivatePreparation
) {
  return {
    version: value.version,
    executionId: value.executionId,
    workspaceId: value.workspaceId,
    runId: value.runId,
    intentHash: value.intentHash,
    taxpayerReferenceHash: value.taxpayerReferenceHash,
    foreignCustomerReferenceHash: value.foreignCustomerReferenceHash,
    representedCuitCommitment: value.representedCuitCommitment,
    idempotencyKey: value.idempotencyKey,
    requestId: value.requestId,
    invoiceNumber: value.invoiceNumber,
    issuerProfileRef: value.issuerProfileRef,
    customer: value.customer,
    currencyArcaId: value.currencyArcaId,
    language: value.language,
    commercialObservation: value.commercialObservation,
    generalObservation: value.generalObservation,
    preparedAt: value.preparedAt,
    expiresAt: value.expiresAt,
  };
}

function assertRequest(input: FacturaEAuthorityPreparationRequest): void {
  if (!input.executionId || !input.workspaceId || !input.runId) {
    throw new Error('TAX_ARCA_PREPARATION_SCOPE_REQUIRED');
  }
  if (
    !SHA256.test(input.intentHash)
    || !SHA256.test(input.taxpayerReferenceHash)
    || !SHA256.test(input.foreignCustomerReferenceHash)
  ) {
    throw new Error('TAX_ARCA_PREPARATION_HASH_INVALID');
  }
  if (!Number.isInteger(input.pointOfSale) || input.pointOfSale < 1 || input.pointOfSale > 99_998) {
    throw new Error('TAX_ARCA_PREPARATION_POINT_OF_SALE_INVALID');
  }
  if (!/^[A-Z]{3,10}$/.test(input.currency)) {
    throw new Error('TAX_ARCA_PREPARATION_CURRENCY_INVALID');
  }
  if (!/^[A-Za-z0-9._:-]{16,200}$/.test(input.idempotencyKey)) {
    throw new Error('TAX_ARCA_PREPARATION_IDEMPOTENCY_KEY_INVALID');
  }
}

function assertEndpoint(endpoint: URL): void {
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new Error('TAX_ARCA_PREPARATION_URL_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  const liveAuthority = process.env.ARCA_ENVIRONMENT === 'production';
  if (
    endpoint.protocol !== 'https:'
    && !(process.env.NODE_ENV !== 'production' && !liveAuthority && loopback)
  ) {
    throw new Error('TAX_ARCA_PREPARATION_HTTPS_REQUIRED');
  }
}

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(left) || !/^[a-f0-9]{64}$/.test(right)) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function readBoundedResponseBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) {
    await response.body?.cancel();
    throw new Error('TAX_ARCA_PREPARATION_RESPONSE_TOO_LARGE');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('TAX_ARCA_PREPARATION_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}
