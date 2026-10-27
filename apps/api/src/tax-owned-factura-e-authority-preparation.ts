import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  hashCanonical,
  type ArcaOnboardingRunV1,
  type FacturaEAgentRunV1,
} from '@tax-engine/core';
import { isValidCuit } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';

import {
  hashFacturaEAuthorityPrivatePreparation,
  type FacturaEAuthorityPreparationGateway,
  type FacturaEAuthorityPreparationRequest,
  type FacturaEAuthorityPrivatePreparation,
} from './factura-e-authority-preparation';
import type { WsfexSequenceGateway } from './wsfex';
import { refuseRedirect } from './bounded-body';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,500}$/;
const MAX_RESPONSE_BYTES = 32 * 1024;
const fiscalScopeSchema = z.union([
  z.uuid(),
  z.string().regex(/^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
]);

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const deskPrivateDataSchema = z.object({
  version: z.literal('desk-factura-e-private-data-v1'),
  executionId: z.string().min(1).max(200),
  workspaceId: z.string().min(1).max(200),
  runId: z.string().min(1).max(200),
  intentHash: z.string().regex(SHA256),
  taxpayerReferenceHash: z.string().regex(SHA256),
  foreignCustomerReferenceHash: z.string().regex(SHA256),
  idempotencyKey: z.string().min(16).max(200),
  customer: z.object({
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(300),
    countryCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit),
    foreignTaxId: z.string().min(1).max(50).nullable(),
  }).strict(),
  language: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  commercialObservation: z.string().max(4_000).nullable(),
  generalObservation: z.string().max(1_000).nullable(),
  frozenAt: z.iso.datetime({ offset: true }),
  evidenceHash: z.string().regex(SHA256),
}).strict();

type DeskPrivateData = z.infer<typeof deskPrivateDataSchema>;

const deskCommercialRequestSchema = z.object({
  version: z.literal('desk-factura-e-commercial-request-v1'),
  sourceKind: z.literal('pre_cae_commercial_request'),
  workspaceId: fiscalScopeSchema,
  runId: z.uuid(),
  ledgerInvoiceId: z.uuid(),
  idempotencyKey: z.string().min(16).max(200),
  taxpayerReferenceHash: z.string().regex(SHA256),
  foreignCustomerReferenceHash: z.string().regex(SHA256),
  customer: z.object({
    name: z.string().min(1).max(200),
    address: z.string().min(1).max(300),
    foreignTaxId: z.string().min(1).max(50),
    countryIso2: z.string().regex(/^[A-Z]{2}$/),
    countryArcaCode: z.number().int().positive(),
  }).strict(),
  requestedPointOfSale: z.number().int().positive().max(99_998),
  issueDate: z.iso.date(),
  servicePeriod: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
  paymentDate: z.iso.date(),
  amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  currency: z.literal('USD'),
  description: z.string().min(1).max(500),
  frozenManualQuote: z.object({
    decimal: z.string().regex(/^(?:[1-9]\d{0,3})(?:\.\d{1,6})?$/),
    observedForDate: z.iso.date(),
    sourceReferenceId: z.string().min(1).max(200),
  }).strict().optional(),
  sameCurrencyPayment: z.boolean(),
  frozenAt: z.iso.datetime({ offset: true }),
  evidenceHash: z.string().regex(SHA256),
}).strict();

export type FacturaECommercialRequest = z.infer<typeof deskCommercialRequestSchema>;

export interface FacturaEPrivateDataGateway {
  getFrozenPrivateData(input: FacturaEAuthorityPreparationRequest): Promise<DeskPrivateData>;
}

export class HttpDeskFacturaEPrivateDataGateway implements FacturaEPrivateDataGateway {
  constructor(
    private readonly endpoint: URL,
    private readonly secret: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    assertPrivateEndpoint(endpoint);
    if (Buffer.byteLength(secret) < 32) throw new Error('TAX_DESK_PRIVATE_DATA_HMAC_SECRET_REQUIRED');
  }

  static fromEnvironment(): HttpDeskFacturaEPrivateDataGateway | null {
    const rawEndpoint = process.env.TAX_DESK_FACTURA_E_PRIVATE_DATA_URL ?? null;
    const secret = process.env.TAX_DESK_FACTURA_E_PRIVATE_DATA_HMAC_SECRET ?? null;
    if (!rawEndpoint && !secret) return null;
    if (!rawEndpoint || !secret) throw new Error('TAX_DESK_PRIVATE_DATA_CONFIGURATION_REQUIRED');
    return new HttpDeskFacturaEPrivateDataGateway(new URL(rawEndpoint), secret);
  }

  async getFrozenPrivateData(input: FacturaEAuthorityPreparationRequest): Promise<DeskPrivateData> {
    const raw = await this.exchange({
      version: 'tax-desk-factura-e-private-data-request-v1',
      ...input,
    }, input.idempotencyKey);
    let data: DeskPrivateData;
    try {
      data = deskPrivateDataSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error('TAX_DESK_PRIVATE_DATA_RECEIPT_INVALID');
    }
    if (data.executionId !== input.executionId
      || data.workspaceId !== input.workspaceId
      || data.runId !== input.runId
      || data.intentHash !== input.intentHash
      || data.taxpayerReferenceHash !== input.taxpayerReferenceHash
      || data.foreignCustomerReferenceHash !== input.foreignCustomerReferenceHash
      || data.idempotencyKey !== input.idempotencyKey)
      throw new Error('TAX_DESK_PRIVATE_DATA_RECEIPT_BINDING_MISMATCH');
    const { evidenceHash, ...material } = data;
    if (evidenceHash !== hashCanonical(material))
      throw new Error('TAX_DESK_PRIVATE_DATA_RECEIPT_HASH_MISMATCH');
    return data;
  }

  async getFrozenCommercialRequest(input: Readonly<{
    workspaceId: string;
    runId: string;
    ledgerInvoiceId: string;
    idempotencyKey: string;
  }>): Promise<FacturaECommercialRequest> {
    const raw = await this.exchange({
      version: 'tax-desk-factura-e-commercial-request-v1',
      ...input,
    }, input.idempotencyKey);
    let data: FacturaECommercialRequest;
    try {
      data = deskCommercialRequestSchema.parse(JSON.parse(raw));
    } catch {
      throw new Error('TAX_DESK_COMMERCIAL_REQUEST_INVALID');
    }
    if (data.workspaceId !== input.workspaceId || data.runId !== input.runId
      || data.ledgerInvoiceId !== input.ledgerInvoiceId
      || data.idempotencyKey !== input.idempotencyKey
      || data.servicePeriod.start > data.servicePeriod.end
      || data.foreignCustomerReferenceHash !== hashCanonical(data.customer))
      throw new Error('TAX_DESK_COMMERCIAL_REQUEST_BINDING_MISMATCH');
    const { evidenceHash, ...material } = data;
    if (evidenceHash !== hashCanonical(material))
      throw new Error('TAX_DESK_COMMERCIAL_REQUEST_HASH_MISMATCH');
    return data;
  }

  private async exchange(body: object, idempotencyKey: string): Promise<string> {
    const rawBody = JSON.stringify(body);
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': idempotencyKey,
          'x-tax-desk-private-data-signature': hmac(this.secret, rawBody),
        },
        body: rawBody,
        signal: AbortSignal.timeout(10_000),
      }).then(refuseRedirect);
    } catch {
      throw new Error('TAX_DESK_PRIVATE_DATA_UPSTREAM_UNAVAILABLE');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`TAX_DESK_PRIVATE_DATA_REJECTED_${response.status}`);
    }
    const raw = await readBoundedBody(response);
    const signature = response.headers.get('x-tax-desk-private-data-signature') ?? '';
    if (!constantTimeEqual(signature, hmac(this.secret, raw)))
      throw new Error('TAX_DESK_PRIVATE_DATA_RECEIPT_UNAUTHORIZED');
    return raw;
  }
}

export class TaxOwnedFacturaEAuthorityPreparationGateway
  implements FacturaEAuthorityPreparationGateway {
  constructor(
    private readonly runs: Readonly<{ getRun(runId: string): FacturaEAgentRunV1 }>,
    private readonly onboardings: Readonly<{
      listArcaOnboardingRuns(workspaceId: string): readonly ArcaOnboardingRunV1[];
    }>,
    private readonly profiles: ReadonlyMap<string, string>,
    private readonly currencies: ReadonlyMap<string, string>,
    private readonly privateData: FacturaEPrivateDataGateway,
    private readonly sequences: WsfexSequenceGateway,
    private readonly environment: 'homologation' | 'production',
    private readonly now: () => Date = () => new Date()
  ) {}

  static profileRegistryFromEnvironment(): ReadonlyMap<string, string> | null {
    const raw = process.env.TAX_ARCA_ISSUER_PROFILE_REGISTRY_JSON ?? null;
    if (!raw) return null;
    return parseRegistry(raw, SAFE_REFERENCE, 'TAX_ARCA_ISSUER_PROFILE_REGISTRY_INVALID');
  }

  static currencyRegistryFromEnvironment(): ReadonlyMap<string, string> {
    const defaults = new Map([['ARS', 'PES'], ['USD', 'DOL']]);
    const raw = process.env.TAX_ARCA_CURRENCY_REGISTRY_JSON ?? null;
    if (!raw) return defaults;
    const configured = parseRegistry(raw, /^[A-Z0-9]{1,3}$/, 'TAX_ARCA_CURRENCY_REGISTRY_INVALID');
    for (const [currency, arcaId] of configured) {
      if (!/^[A-Z]{3,10}$/.test(currency)) throw new Error('TAX_ARCA_CURRENCY_REGISTRY_INVALID');
      defaults.set(currency, arcaId);
    }
    return defaults;
  }

  async prepare(input: FacturaEAuthorityPreparationRequest): Promise<FacturaEAuthorityPrivatePreparation> {
    const run = this.runs.getRun(input.runId);
    if (!run.intent || run.workspaceId !== input.workspaceId || run.intentHash !== input.intentHash
      || run.intent.taxpayerReferenceHash !== input.taxpayerReferenceHash
      || run.intent.foreignCustomerReferenceHash !== input.foreignCustomerReferenceHash
      || run.intent.pointOfSale !== input.pointOfSale)
      throw new Error('TAX_OWNED_PREPARATION_RUN_BINDING_MISMATCH');
    if (this.environment === 'production'
      && run.intent.exchangeRate?.sourceReferenceId.startsWith('manual-unverified-bna:'))
      throw new Error('TAX_PRODUCTION_VERIFIED_EXCHANGE_RATE_REQUIRED');
    const issuerProfileRef = this.profiles.get(input.workspaceId);
    if (!issuerProfileRef) throw new Error('TAX_ARCA_ISSUER_PROFILE_NOT_CONFIGURED');
    const onboarding = selectReadyOnboarding(
      this.onboardings.listArcaOnboardingRuns(input.workspaceId),
      input,
      issuerProfileRef,
      this.environment
    );
    const currencyArcaId = this.currencies.get(input.currency);
    if (!currencyArcaId) throw new Error('TAX_ARCA_CURRENCY_NOT_CONFIGURED');
    // Resolve the frozen legal data first so an unavailable Desk boundary cannot
    // strand a scarce authority sequence until its TTL elapses.
    const privateData = await this.privateData.getFrozenPrivateData(input);
    const reservation = await this.sequences.reserveSequence({
      workspaceId: input.workspaceId,
      issuerProfileRef,
      runId: input.runId,
      intentHash: input.intentHash,
      subjectId: run.intent.intentId,
      pointOfSale: input.pointOfSale,
      idempotencyKey: `sequence:${hashCanonical({
        executionId: input.executionId,
        idempotencyKey: input.idempotencyKey,
      })}`,
    });
    const now = this.now().getTime();
    const reservedAt = Date.parse(reservation.reservedAt);
    const expiresAt = Date.parse(reservation.expiresAt);
    if (reservedAt > now + 2 * 60_000 || expiresAt <= now
      || expiresAt <= reservedAt || expiresAt - reservedAt > 15 * 60_000)
      throw new Error('TAX_ARCA_SEQUENCE_RESERVATION_EXPIRED');
    if (reservation.representedCuitCommitment !== onboarding.authorityBinding?.representedCuitCommitment)
      throw new Error('TAX_ARCA_SEQUENCE_AUTHORITY_BINDING_MISMATCH');
    const preparedAt = reservation.reservedAt;
    const material = {
      version: 'factura-e-authority-private-preparation-v1' as const,
      executionId: input.executionId,
      workspaceId: input.workspaceId,
      runId: input.runId,
      intentHash: input.intentHash,
      taxpayerReferenceHash: input.taxpayerReferenceHash,
      foreignCustomerReferenceHash: input.foreignCustomerReferenceHash,
      representedCuitCommitment: reservation.representedCuitCommitment,
      idempotencyKey: input.idempotencyKey,
      requestId: reservation.requestId,
      invoiceNumber: reservation.invoiceNumber,
      issuerProfileRef,
      customer: privateData.customer,
      currencyArcaId,
      language: privateData.language,
      commercialObservation: privateData.commercialObservation,
      generalObservation: privateData.generalObservation,
      preparedAt,
      expiresAt: reservation.expiresAt,
    };
    return { ...material, preparationHash: hashFacturaEAuthorityPrivatePreparation(material) };
  }
}

function selectReadyOnboarding(
  candidates: readonly ArcaOnboardingRunV1[],
  input: FacturaEAuthorityPreparationRequest,
  issuerProfileRef: string,
  environment: 'homologation' | 'production'
): ArcaOnboardingRunV1 {
  const matches = candidates.filter(candidate =>
    candidate.status === 'ready'
    && candidate.environment === environment
    && candidate.taxpayerReferenceHash === input.taxpayerReferenceHash
    && candidate.requestedServices.includes('wsfex')
    && candidate.delegation.wsfex
    && candidate.apiVerification.wsfex
    && candidate.pointOfSale.active
    && candidate.pointOfSale.number === input.pointOfSale
    && candidate.authorityBinding?.issuerProfileReferenceHash === hashCanonical(issuerProfileRef)
    && !!candidate.authorityBinding.representedCuitCommitment
  );
  if (matches.length === 0) throw new Error('TAX_ARCA_READY_ONBOARDING_REQUIRED');
  const commitments = new Set(matches.map(candidate => candidate.authorityBinding!.representedCuitCommitment));
  if (commitments.size !== 1) throw new Error('TAX_ARCA_ONBOARDING_AUTHORITY_AMBIGUOUS');
  return [...matches].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]!;
}

function parseRegistry(raw: string, valuePattern: RegExp, code: string): ReadonlyMap<string, string> {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(code); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 10_000) throw new Error(code);
  const registry = new Map<string, string>();
  for (const [key, candidate] of entries) {
    if (!key || key.length > 200 || typeof candidate !== 'string' || !valuePattern.test(candidate))
      throw new Error(code);
    registry.set(key, candidate);
  }
  return registry;
}

function assertPrivateEndpoint(endpoint: URL): void {
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search)
    throw new Error('TAX_DESK_PRIVATE_DATA_URL_INVALID');
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:'
    && !(process.env.NODE_ENV !== 'production' && process.env.ARCA_ENVIRONMENT !== 'production' && loopback))
    throw new Error('TAX_DESK_PRIVATE_DATA_HTTPS_REQUIRED');
}

function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (!SHA256.test(left) || !SHA256.test(right)) return false;
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function readBoundedBody(response: Response): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel();
    throw new Error('TAX_DESK_PRIVATE_DATA_RESPONSE_TOO_LARGE');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('TAX_DESK_PRIVATE_DATA_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}
