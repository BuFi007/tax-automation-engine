import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { SqlDatabase } from '@tax-engine/sql-store';

import { isValidCuit, nextVoucherRequestSchema, signerRequestSchema } from './contracts';
import { AfipSdkWsfeClient } from './afipsdk';
import { WsfeSignerService } from './service';
import { SoapWsfeAuthorityClient } from './soap';
import { SignerAttemptStore } from './store';
import { HttpAuthorityPayloadVault } from './vault';
import { HttpWsaaTicketBroker } from './wsaa';

type Environment = Readonly<Record<string, string | undefined>>;

/** A Service Binding (or anything with its `fetch`) to the boundary. Absent means the global `fetch`. */
export type ServiceFetcher = Readonly<{
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}>;

export type SignerOptions = Readonly<{
  env: Environment;
  /** A file path (Bun) or an injected database. */
  database: string | SqlDatabase;
  boundaryFetcher?: ServiceFetcher;
}>;

export type Signer = Readonly<{
  fetch(request: Request): Promise<Response>;
  environment: 'homologation' | 'production';
}>;

export function createWsfeSigner({ env, database, boundaryFetcher }: SignerOptions): Signer {
  const boundaryFetch = boundaryFetcher
    ? (input: string | URL | Request, init?: RequestInit) => boundaryFetcher.fetch(input, init)
    : undefined;
  const apiToken = requiredEnvironment('WSFE_SIGNER_API_TOKEN');
  // Fail closed: the domestic authority is production only when ARCA_ENVIRONMENT
  // is exactly 'production'. Anything else stays on homologation.
  const environment = env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
  if (environment === 'production' && env.WSFE_SIGNER_PRODUCTION_APPROVED !== 'true') throw new Error('WSFE_SIGNER_PRODUCTION_APPROVAL_REQUIRED');
  if (environment === 'production' && env.WSFE_HOMOLOGATION_POS_PROOF) throw new Error('WSFE_HOMOLOGATION_POS_PROOF_FORBIDDEN');
  const homologationProofSchema = z.object({
    workspaceId: z.string().min(1).max(200), issuerProfileRef: z.string().min(1).max(500),
    representedCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit),
    representedCuitCommitment: z.string().regex(/^[a-f0-9]{64}$/),
    cae: z.string().regex(/^\d{14}$/),
  }).strict();
  const homologationPointOfSaleProof = env.WSFE_HOMOLOGATION_POS_PROOF
    ? homologationProofSchema.parse(JSON.parse(env.WSFE_HOMOLOGATION_POS_PROOF)) : undefined;
  const homologationPointOfSaleProofs = env.WSFE_HOMOLOGATION_POS_PROOFS_JSON
    ? z.array(homologationProofSchema).max(100).parse(JSON.parse(env.WSFE_HOMOLOGATION_POS_PROOFS_JSON)) : undefined;
  if (environment === 'production' && homologationPointOfSaleProofs)
    throw new Error('WSFE_HOMOLOGATION_POS_PROOF_FORBIDDEN');
  if (typeof database === 'string' ? database === ':memory:' : !database.durable)
    throw new Error('WSFE_SIGNER_DURABLE_DB_REQUIRED');
  const vault = new HttpAuthorityPayloadVault({
    baseUrl: requiredEnvironment('WSFE_SIGNER_VAULT_URL'),
    token: requiredEnvironment('WSFE_SIGNER_VAULT_TOKEN'),
  }, boundaryFetch);
  const wsaa = new HttpWsaaTicketBroker({
    baseUrl: requiredEnvironment('WSFE_WSAA_BROKER_URL'),
    token: requiredEnvironment('WSFE_WSAA_BROKER_TOKEN'),
  }, boundaryFetch);
  const authorityProvider = env.WSFE_AUTHORITY_PROVIDER ?? 'direct';
  if (authorityProvider !== 'direct' && authorityProvider !== 'afipsdk') throw new Error('WSFE_AUTHORITY_PROVIDER_INVALID');
  if (authorityProvider === 'afipsdk' && env.AFIPSDK_WSAA_TICKET_TRANSFER_APPROVED !== 'true')
    throw new Error('AFIPSDK_WSAA_TICKET_TRANSFER_APPROVAL_REQUIRED');
  const authority = authorityProvider === 'afipsdk'
    ? new AfipSdkWsfeClient({ accessToken: requiredEnvironment('AFIPSDK_ACCESS_TOKEN'), environment })
    : new SoapWsfeAuthorityClient(environment);
  const service = new WsfeSignerService(
    { environment, signerVersion: env.WSFE_SIGNER_VERSION ?? '0.1.0', ...(homologationPointOfSaleProof ? { homologationPointOfSaleProof } : {}), ...(homologationPointOfSaleProofs ? { homologationPointOfSaleProofs } : {}) },
    new SignerAttemptStore(database),
    vault,
    wsaa,
    authority
  );

  async function handle(request: Request): Promise<Response> {
    try {
      if (!authorized(request, apiToken)) return json({ error: 'UNAUTHORIZED' }, 401);
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json(await service.health());
      if (request.method === 'POST' && url.pathname === '/v1/wsfev1/params/points-of-sale/discover') {
        const context = pointOfSaleDiscoveryRequestSchema.parse(await boundedJson(request));
        return json(await service.discoverPointsOfSale(context, new Date().toISOString()));
      }
      if (request.method === 'POST' && url.pathname === '/v1/wsfev1/params/points-of-sale/verify-readback') {
        const context = pointOfSaleDiscoveryRequestSchema.extend({ pointOfSale: z.literal(1) }).parse(await boundedJson(request));
        return json(await service.verifyPointOfSaleReadback(context, new Date().toISOString()));
      }
      if (request.method === 'POST' && url.pathname === '/v1/wsfev1/params/next-voucher') {
        const context = nextVoucherRequestSchema.parse(await boundedJson(request));
        return json(await service.getNextVoucher(context, new Date().toISOString()));
      }
      if (request.method === 'POST' && url.pathname === '/v1/wsfev1/invoices') {
        const declaredBytes = Number(request.headers.get('content-length') ?? 0);
        if (declaredBytes > 1_048_576) return json({ error: 'SIGNER_REQUEST_TOO_LARGE' }, 413);
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 1_048_576) return json({ error: 'SIGNER_REQUEST_TOO_LARGE' }, 413);
        const body = signerRequestSchema.parse(JSON.parse(raw));
        const idempotencyKey = request.headers.get('idempotency-key') ?? '';
        const occurredAt = new Date().toISOString();
        return json(await service.issueInvoice(body, idempotencyKey, occurredAt));
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const code = /^[A-Z0-9_]+$/.test(message) ? message : 'INVALID_REQUEST';
      return json({ error: code }, statusFor(code));
    }
  }

  function requiredEnvironment(name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name}_REQUIRED`);
    return value;
  }

  return { fetch: handle, environment };
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
  workspaceId: z.string().min(1).max(200), issuerProfileRef: z.string().min(1).max(500),
}).strict();

async function boundedJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length') ?? 0) > 4096) throw new Error('SIGNER_REQUEST_TOO_LARGE');
  const body = await request.text();
  if (Buffer.byteLength(body) > 4096) throw new Error('SIGNER_REQUEST_TOO_LARGE');
  return JSON.parse(body);
}
