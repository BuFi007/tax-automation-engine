import { timingSafeEqual } from 'node:crypto';

import { taxWorkspaceIdSchema } from '@tax-engine/core';
import { z } from 'zod';

import { classifyApiError } from './api-errors';
import type { FacturaEFeaturePublicationStore } from './factura-e-feature-publication';
import {
  type FacturaEFeatureCapability,
  type FacturaEFeaturePrincipalSecrets,
  verifyFacturaEFeaturePrincipal,
} from './factura-e-feature-principal';
import {
  type FacturaETerminalReceiptVerifiers,
  hashDeskTaxEffectReceiptEnvelope,
  hashDeskTaxNoEffectRecoveryEnvelope,
  verifyDeskTaxEffectReceipt,
  verifyDeskTaxNoEffectRecoveryReceipt,
} from './factura-e-feature-terminal-receipt';

const MAX_BODY_BYTES = 16 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,200}$/;
const executionIdSchema = z.uuid();
const idempotencyKeySchema = z.string().min(16).max(200).regex(/^[A-Za-z0-9._:-]+$/);

const grantConsentSchema = z.object({
  version: z.literal('factura-e-factoring-consent-command-v1'),
  action: z.literal('grant'),
  workspaceId: taxWorkspaceIdSchema,
  consentVersion: z.string().regex(SAFE_REFERENCE),
  idempotencyKey: idempotencyKeySchema,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

const revokeConsentSchema = z.object({
  version: z.literal('factura-e-factoring-consent-command-v1'),
  action: z.literal('revoke'),
  workspaceId: taxWorkspaceIdSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

const projectSchema = z.object({
  version: z.literal('factura-e-feature-project-command-v1'),
  workspaceId: taxWorkspaceIdSchema,
}).strict();

const headSchema = z.object({
  version: z.literal('factura-e-feature-head-request-v1'),
  workspaceId: taxWorkspaceIdSchema,
  workspaceCommitment: z.string().regex(SHA256),
  invoiceCommitment: z.string().regex(SHA256),
}).strict();

const creHeadSchema = z.object({
  featureId: z.uuid(),
  featureHash: z.string().regex(SHA256),
  workspaceCommitment: z.string().regex(SHA256),
  invoiceCommitment: z.string().regex(SHA256),
  revision: z.number().int().positive().safe(),
  purpose: z.literal('factura_e_factoring'),
}).strict();

const reservationBaseSchema = {
  version: z.literal('factura-e-feature-reservation-command-v1'),
  operationId: z.string().regex(/^0x(?!0{64}$)[a-f0-9]{64}$/),
  idempotencyKey: idempotencyKeySchema,
};

const reserveSchema = z.object({
  ...reservationBaseSchema,
  action: z.literal('reserve'),
  featureId: z.uuid(),
  featureHash: z.string().regex(SHA256),
  featureRevision: z.number().int().positive().safe(),
  headHash: z.string().regex(SHA256),
  leaseSeconds: z.number().int().min(5).max(60),
}).strict();

const consumeSchema = z.object({
  ...reservationBaseSchema,
  action: z.literal('consume'),
  reservationId: z.uuid(),
  headHash: z.string().regex(SHA256),
}).strict();

const completeSchema = z.object({
  ...reservationBaseSchema,
  action: z.literal('complete'),
  reservationId: z.uuid(),
  headHash: z.string().regex(SHA256),
  deskEffectReceipt: z.unknown(),
}).strict();

const releaseSchema = z.object({
  ...reservationBaseSchema,
  action: z.literal('release'),
  reservationId: z.uuid(),
  headHash: z.string().regex(SHA256),
  reason: z.literal('before_consume'),
}).strict();

const recoverNoEffectSchema = z.object({
  ...reservationBaseSchema,
  action: z.literal('recover_no_effect'),
  reservationId: z.uuid(),
  headHash: z.string().regex(SHA256),
  recoveryReceipt: z.unknown(),
}).strict();

const DARK_TERMINAL_RECEIPT_VERIFIERS: FacturaETerminalReceiptVerifiers = {
  deskEffect: { enabled: false, keyId: null, publicKey: null, transportSecret: null },
  noEffectRecovery: { enabled: false, keyId: null, publicKey: null, transportSecret: null },
};

export async function handleFacturaEFeatureRoute(
  request: Request,
  url: URL,
  store: FacturaEFeaturePublicationStore | null,
  options: Readonly<{
    enabled: boolean;
    secrets: FacturaEFeaturePrincipalSecrets;
    terminalReceiptVerifiers?: FacturaETerminalReceiptVerifiers;
    now?: Date;
    allowLegacyUnsignedRestrictedHead?: boolean;
  }>
): Promise<Response | null> {
  const route = matchRoute(request.method, url.pathname);
  if (!route) return null;
  if (
    route.operation === 'head'
    && (
      process.env.NODE_ENV === 'production'
      || options.allowLegacyUnsignedRestrictedHead !== true
    )
  ) {
    return privateJson({ error: 'NOT_FOUND' }, 404);
  }
  try {
    if (!options.enabled || !store) {
      throw new Error('TAX_FACTURA_E_FEATURE_PUBLICATION_CONFIGURATION_REQUIRED');
    }
    const rawBody = await boundedBody(request);
    if (route.operation === 'creHead') {
      requireCreReader(request, options.secrets.creReader);
      const body = creHeadSchema.parse(JSON.parse(rawBody) as unknown);
      const head = await store.signRestrictedHeadByFeature(
        body,
        options.now ? () => options.now! : () => new Date()
      );
      return restrictedJson(head, 200);
    }
    if (route.operation === 'creReserve') {
      requireCreReservation(request, options.secrets.creReservation);
      const { version: _version, action: _action, ...body } = reserveSchema.parse(
        JSON.parse(rawBody) as unknown
      );
      return restrictedJson(consensusReservationReceipt(
        store.reserveForFactoring(body, options.now ?? new Date())
      ), 200);
    }
    if (route.operation === 'creConsume') {
      requireCreReservation(request, options.secrets.creReservation);
      const { version: _version, action: _action, ...body } = consumeSchema.parse(
        JSON.parse(rawBody) as unknown
      );
      return restrictedJson(consensusReservationReceipt(
        store.consumeFactoringReservation(body, options.now ?? new Date())
      ), 200);
    }
    if (route.operation === 'creComplete') {
      requireTerminalEffectPrincipal(
        request,
        options.secrets.creReservation,
        (options.terminalReceiptVerifiers ?? DARK_TERMINAL_RECEIPT_VERIFIERS)
          .deskEffect.transportSecret ?? null
      );
      const { version: _version, action: _action, ...body } = completeSchema.parse(
        JSON.parse(rawBody) as unknown
      );
      const envelope = verifyDeskTaxEffectReceipt({
        value: body.deskEffectReceipt,
        verifier: (options.terminalReceiptVerifiers ?? DARK_TERMINAL_RECEIPT_VERIFIERS)
          .deskEffect,
        now: options.now ?? new Date(),
      });
      if (
        envelope.payload.operationId !== body.operationId
        || envelope.payload.headHash !== body.headHash
        || envelope.payload.reservationId !== body.reservationId
        || envelope.payload.idempotencyKey !== body.idempotencyKey
      ) throw new Error('FACTURA_E_FEATURE_TERMINAL_EFFECT_RECEIPT_BINDING_CONFLICT');
      return restrictedJson(consensusReservationReceipt(
        store.completeFactoringReservation({
          reservationId: envelope.payload.reservationId,
          operationId: envelope.payload.operationId,
          headHash: envelope.payload.headHash,
          featureId: envelope.payload.featureId,
          featureHash: envelope.payload.featureHash,
          featureRevision: envelope.payload.featureRevision,
          reportTxHash: envelope.payload.reportTxHash,
          effectReceiptCommitment: envelope.payload.effectReceiptCommitment,
          authorityEnvelopeHash: hashDeskTaxEffectReceiptEnvelope(envelope),
          authorityKeyId: envelope.keyId,
          authorityRecordedAt: envelope.payload.recordedAt,
          idempotencyKey: body.idempotencyKey,
        }, options.now ?? new Date())
      ), 200);
    }
    if (route.operation === 'creRelease') {
      requireCreReservation(request, options.secrets.creReservation);
      const { version: _version, action: _action, ...body } = releaseSchema.parse(
        JSON.parse(rawBody) as unknown
      );
      return restrictedJson(consensusReservationReceipt(store.releaseFactoringReservation({
        reservationId: body.reservationId,
        operationId: body.operationId,
        headHash: body.headHash,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
      }, options.now ?? new Date())), 200);
    }
    if (route.operation === 'recoverNoEffect') {
      requireRecoveryPrincipal(
        request,
        (options.terminalReceiptVerifiers ?? DARK_TERMINAL_RECEIPT_VERIFIERS)
          .noEffectRecovery.transportSecret ?? null
      );
      const { version: _version, action: _action, ...body } = recoverNoEffectSchema.parse(
        JSON.parse(rawBody) as unknown
      );
      const envelope = verifyDeskTaxNoEffectRecoveryReceipt({
        value: body.recoveryReceipt,
        verifier: (options.terminalReceiptVerifiers ?? DARK_TERMINAL_RECEIPT_VERIFIERS)
          .noEffectRecovery,
        now: options.now ?? new Date(),
      });
      if (
        envelope.payload.operationId !== body.operationId
        || envelope.payload.headHash !== body.headHash
        || envelope.payload.reservationId !== body.reservationId
        || envelope.payload.idempotencyKey !== body.idempotencyKey
      ) throw new Error('FACTURA_E_FEATURE_RECOVERY_RECEIPT_BINDING_CONFLICT');
      return restrictedJson(consensusReservationReceipt(
        store.recoverFactoringReservationNoEffect({
          reservationId: envelope.payload.reservationId,
          operationId: envelope.payload.operationId,
          headHash: envelope.payload.headHash,
          featureId: envelope.payload.featureId,
          featureHash: envelope.payload.featureHash,
          featureRevision: envelope.payload.featureRevision,
          recoveryEvidenceRef: envelope.payload.recoveryEvidenceRef,
          noEffectReceiptCommitment: envelope.payload.noEffectReceiptCommitment,
          authorityEnvelopeHash: hashDeskTaxNoEffectRecoveryEnvelope(envelope),
          authorityKeyId: envelope.keyId,
          authorityRecordedAt: envelope.payload.recordedAt,
          idempotencyKey: body.idempotencyKey,
        }, options.now ?? new Date())
      ), 200);
    }
    const principal = verifyFacturaEFeaturePrincipal({
      request,
      rawBody,
      capability: route.capability,
      secrets: options.secrets,
      ...(options.now ? { now: options.now } : {}),
    });
    const executionId = executionIdSchema.parse(decodeURIComponent(route.executionId));
    const now = options.now ?? new Date();

    if (route.operation === 'consent') {
      const body = z.discriminatedUnion('action', [grantConsentSchema, revokeConsentSchema])
        .parse(JSON.parse(rawBody) as unknown);
      assertWorkspace(principal.workspaceId, body.workspaceId);
      const command = body.action === 'grant'
        ? store.grantConsent({
            executionId,
            workspaceId: body.workspaceId,
            consentVersion: body.consentVersion,
            actorId: principal.actorId,
            idempotencyKey: body.idempotencyKey,
            occurredAt: now.toISOString(),
            expiresAt: body.expiresAt,
          })
        : store.revokeConsent({
            executionId,
            workspaceId: body.workspaceId,
            actorId: principal.actorId,
            idempotencyKey: body.idempotencyKey,
            occurredAt: now.toISOString(),
          });
      const projection = await store.project(executionId, now);
      const feature = projection.state === 'not_publishable'
        ? null
        : store.currentPublicHead(executionId, body.workspaceId, now);
      return privateJson({ data: { command, projection, feature } }, 200);
    }

    if (route.operation === 'project') {
      const body = projectSchema.parse(JSON.parse(rawBody) as unknown);
      assertWorkspace(principal.workspaceId, body.workspaceId);
      const projection = await store.project(executionId, now);
      const feature = projection.state === 'not_publishable'
        ? null
        : store.currentPublicHead(executionId, body.workspaceId, now);
      return privateJson({ data: { projection, feature } }, 200);
    }

    const body = headSchema.parse(JSON.parse(rawBody) as unknown);
    assertWorkspace(principal.workspaceId, body.workspaceId);
    return restrictedJson({
      data: store.currentRestrictedHeadForWorkspace(
        executionId,
        body.workspaceId,
        body.workspaceCommitment,
        body.invoiceCommitment,
        now
      ),
    }, 200);
  } catch (error) {
    const safe = classifyApiError(error);
    return privateJson({ error: safe.code }, safe.status);
  }
}

function consensusReservationReceipt<T extends Readonly<{ replayed: boolean }>>(
  receipt: T
): T {
  // CRE aggregates byte-identical responses from multiple DON nodes. Whether
  // this node created or replayed the command is local transport metadata, not
  // part of the economic result, so the restricted endpoint canonicalizes it.
  return { ...receipt, replayed: false };
}

function matchRoute(method: string, pathname: string): Readonly<{
  operation:
    | 'consent'
    | 'project'
    | 'head'
    | 'creHead'
    | 'creReserve'
    | 'creConsume'
    | 'creComplete'
    | 'creRelease'
    | 'recoverNoEffect';
  capability: FacturaEFeatureCapability;
  executionId: string;
}> | null {
  if (method !== 'POST') return null;
  if (pathname === '/v1/factoring/factura-e-feature-head') return {
    operation: 'creHead',
    capability: 'factura-e:feature-head:read',
    executionId: '',
  };
  if (pathname === '/v1/internal/factoring/factura-e-feature-reservations/recover-no-effect') {
    return {
      operation: 'recoverNoEffect',
      capability: 'factura-e:feature-head:read',
      executionId: '',
    };
  }
  const reservationOperation = new Map<string, 'creReserve' | 'creConsume' | 'creComplete' | 'creRelease'>([
    ['/v1/factoring/factura-e-feature-reservations/reserve', 'creReserve'],
    ['/v1/factoring/factura-e-feature-reservations/consume', 'creConsume'],
    ['/v1/factoring/factura-e-feature-reservations/complete', 'creComplete'],
    ['/v1/factoring/factura-e-feature-reservations/release', 'creRelease'],
  ]).get(pathname);
  if (reservationOperation) return {
    operation: reservationOperation,
    capability: 'factura-e:feature-head:read',
    executionId: '',
  };
  const consent = pathname.match(
    /^\/v1\/factoring\/factura-e\/executions\/([^/]+)\/consent$/
  );
  if (consent) return {
    operation: 'consent',
    capability: 'factura-e:factoring-consent',
    executionId: consent[1]!,
  };
  const internal = pathname.match(
    /^\/v1\/internal\/factoring\/factura-e\/executions\/([^/]+)\/(project|head)$/
  );
  if (!internal) return null;
  return internal[2] === 'project'
    ? {
        operation: 'project',
        capability: 'factura-e:feature-project',
        executionId: internal[1]!,
      }
    : {
        operation: 'head',
        capability: 'factura-e:feature-head:read',
        executionId: internal[1]!,
      };
}

function requireCreReader(request: Request, secret: string | null): void {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_CONFIGURATION_REQUIRED');
  }
  const actual = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length
    || !timingSafeEqual(actualBytes, expectedBytes)
  ) throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
}

function requireRecoveryPrincipal(request: Request, secret: string | null): void {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED');
  }
  const actual = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length
    || !timingSafeEqual(actualBytes, expectedBytes)
  ) throw new Error('FACTURA_E_FEATURE_RECOVERY_PRINCIPAL_UNAUTHORIZED');
}

function requireCreReservation(request: Request, secret: string | null): void {
  requireAnyBearer(
    request,
    [secret],
    'TAX_FACTURA_E_FEATURE_PRINCIPAL_CONFIGURATION_REQUIRED',
    'TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED'
  );
}

function requireTerminalEffectPrincipal(
  request: Request,
  creReservationSecret: string | null,
  deskDeliverySecret: string | null
): void {
  requireAnyBearer(
    request,
    [creReservationSecret, deskDeliverySecret],
    'TAX_FACTURA_E_FEATURE_TERMINAL_RECEIPT_CONFIGURATION_REQUIRED',
    'FACTURA_E_FEATURE_TERMINAL_EFFECT_PRINCIPAL_UNAUTHORIZED'
  );
}

function requireAnyBearer(
  request: Request,
  candidates: readonly (string | null)[],
  configurationError: string,
  unauthorizedError: string
): void {
  const configured = candidates.filter(
    (candidate): candidate is string => Boolean(candidate && Buffer.byteLength(candidate) >= 32)
  );
  if (configured.length === 0) throw new Error(configurationError);
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  const accepted = configured.some(secret => {
    const expected = Buffer.from(`Bearer ${secret}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!accepted) throw new Error(unauthorizedError);
}

function assertWorkspace(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_SCOPE_UNAUTHORIZED');
  }
}

async function boundedBody(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (
    declared !== null
    && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)
  ) throw new Error('TAX_FACTURA_E_FEATURE_REQUEST_TOO_LARGE');
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error('TAX_FACTURA_E_FEATURE_REQUEST_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

function privateJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function restrictedJson(value: unknown, status: number): Response {
  const response = privateJson(value, status);
  response.headers.set('x-tax-data-classification', 'restricted-tax-to-cre');
  return response;
}
