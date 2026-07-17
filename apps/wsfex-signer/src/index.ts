import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { WsfexSignerService } from './service';
import { sequenceReservationRequestSchema, signerRequestSchema } from './contracts';
import { SoapWsfexAuthorityClient } from './soap';
import { SignerAttemptStore } from './store';
import { HttpAuthorityPayloadVault } from './vault';
import { HttpWsaaTicketBroker } from './wsaa';
import { readBoundedBody } from './bounded-body';

const port = Number(process.env.PORT ?? 4200);
const hostname = process.env.WSFEX_SIGNER_HOST ?? '127.0.0.1';
const apiToken = requiredSecretEnvironment('WSFEX_SIGNER_API_TOKEN');
const environment = parseArcaEnvironment(process.env.ARCA_ENVIRONMENT);
const sequenceReservationsRequired = process.env.WSFEX_SEQUENCE_RESERVATIONS_REQUIRED !== 'false';
if (environment === 'production' && process.env.WSFEX_SIGNER_PRODUCTION_APPROVED !== 'true') throw new Error('WSFEX_SIGNER_PRODUCTION_APPROVAL_REQUIRED');
if (environment === 'production' && !sequenceReservationsRequired) throw new Error('WSFEX_SEQUENCE_RESERVATIONS_REQUIRED');
const signerDatabasePath = process.env.WSFEX_SIGNER_DB_PATH ?? ':memory:';
if (environment === 'production' && signerDatabasePath === ':memory:') {
  throw new Error('WSFEX_SIGNER_DURABLE_DB_REQUIRED');
}
const vault = new HttpAuthorityPayloadVault({
  baseUrl: requiredEnvironment('WSFEX_SIGNER_VAULT_URL'),
  token: requiredSecretEnvironment('WSFEX_SIGNER_VAULT_TOKEN'),
});
const wsaa = new HttpWsaaTicketBroker({
  baseUrl: requiredEnvironment('WSFEX_WSAA_BROKER_URL'),
  token: requiredSecretEnvironment('WSFEX_WSAA_BROKER_TOKEN'),
});
const service = new WsfexSignerService(
  {
    environment,
    signerVersion: process.env.WSFEX_SIGNER_VERSION ?? '0.1.0',
    sequenceReservationsRequired,
  },
  new SignerAttemptStore(signerDatabasePath),
  vault,
  wsaa,
  new SoapWsfexAuthorityClient(environment)
);

export const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    try {
      if (!authorized(request, apiToken)) return json({ error: 'UNAUTHORIZED' }, 401);
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json(await service.health());
      if (request.method === 'GET' && url.pathname === '/v1/wsfexv1/params/ctz') {
        const monId = url.searchParams.get('monId') ?? '';
        // FEXGetPARAM_Ctz is a param lookup (same value for any represented CUIT), so
        // the endpoint uses a service-level issuer profile — overridable per call.
        const workspaceId = url.searchParams.get('workspaceId') ?? process.env.WSFEX_CTZ_WORKSPACE_ID ?? '';
        const issuerProfileRef = url.searchParams.get('issuerProfileRef') ?? process.env.WSFEX_CTZ_ISSUER_PROFILE_REF ?? '';
        if (!workspaceId || !issuerProfileRef) return json({ error: 'WSFEX_CTZ_ISSUER_PROFILE_REQUIRED' }, 400);
        return json(await service.getCotizacion(monId, { workspaceId, issuerProfileRef }, new Date().toISOString()));
      }
      if (request.method === 'POST' && url.pathname === '/v1/wsfexv1/params/points-of-sale/discover') {
        const raw = await readBoundedBody(request, 16 * 1024, 'SIGNER_REQUEST_TOO_LARGE');
        const { workspaceId, issuerProfileRef } = pointOfSaleDiscoveryRequestSchema.parse(JSON.parse(raw));
        return json(await service.discoverPointsOfSale(
          { workspaceId, issuerProfileRef },
          new Date().toISOString()
        ));
      }
      if (request.method === 'POST' && url.pathname === '/v1/wsfexv1/sequence/reservations') {
        const raw = await readBoundedBody(request, 32 * 1024, 'SIGNER_REQUEST_TOO_LARGE');
        const body = sequenceReservationRequestSchema.parse(JSON.parse(raw));
        const idempotencyKey = request.headers.get('idempotency-key') ?? '';
        if (idempotencyKey !== body.idempotencyKey)
          return json({ error: 'WSFEX_IDEMPOTENCY_KEY_MISMATCH' }, 400);
        return json(await service.reserveSequence(body, new Date().toISOString()));
      }
      const action = url.pathname === '/v1/wsfex/authorize'
        ? 'authorize'
        : url.pathname === '/v1/wsfex/recover'
          ? 'recover'
          : url.pathname === '/v1/wsfex/reconcile'
            ? 'reconcile'
            : null;
      if (request.method === 'POST' && action) {
        const raw = await readBoundedBody(request, 1_048_576, 'SIGNER_REQUEST_TOO_LARGE');
        const body = signerRequestSchema.parse(JSON.parse(raw));
        const idempotencyKey = request.headers.get('idempotency-key') ?? '';
        const occurredAt = new Date().toISOString();
        const result = action === 'authorize'
          ? await service.authorize(body, idempotencyKey, occurredAt)
          : action === 'recover'
            ? await service.recover(body, idempotencyKey, occurredAt)
            : await service.reconcile(body, idempotencyKey, occurredAt);
        return json(result);
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const code = /^[A-Z0-9_]+$/.test(message) ? message : 'INVALID_REQUEST';
      return json({ error: code }, statusFor(code));
    }
  },
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function requiredSecretEnvironment(name: string): string {
  const value = requiredEnvironment(name);
  if (Buffer.byteLength(value) < 32) throw new Error(`${name}_TOO_SHORT`);
  return value;
}

function parseArcaEnvironment(
  raw: string | undefined
): 'homologation' | 'production' {
  if (raw === 'production') return 'production';
  if (raw === 'homologacion' || raw === 'homologation') return 'homologation';
  throw new Error('ARCA_ENVIRONMENT_INVALID');
}

function authorized(request: Request, expected: string): boolean {
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '';
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function statusFor(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('NOT_MONOTONIC') || code.includes('NOT_SEQUENTIAL')) return 409;
  if (code.endsWith('_REQUIRED') || code.includes('MISMATCH') || code.includes('INVALID') || code.includes('FORBIDDEN')) return 400;
  return 422;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

const pointOfSaleDiscoveryRequestSchema = z.object({
  workspaceId: z.string().min(1).max(200),
  issuerProfileRef: z.string().min(1).max(500),
}).strict();

if (import.meta.main) {
  console.info(`WSFEX signer listening on ${hostname}:${server.port}; environment=${environment}; credentials remain in vault/WSAA boundaries`);
}
