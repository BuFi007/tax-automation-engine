import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { taxWorkspaceIdSchema } from '@tax-engine/core';
import { z } from 'zod';

const capabilitySchema = z.enum([
  'evidence:publish',
  'consent:publish',
  'profile:read',
  'profile:confirm',
  'snapshot:configure',
  'snapshot:project',
  'snapshot:read',
  'tax.factoring.read',
  'arca:onboard',
  'accountant:mandate',
  'accountant:portfolio',
  'accountant:decision',
]);
const principalSchema = z.object({
  version: z.literal('tax-tenant-principal-v2'),
  workspaceId: taxWorkspaceIdSchema,
  actorId: z.string().min(1).max(300),
  capability: capabilitySchema,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

const boundPrincipalSchema = z.object({
  version: z.literal('tax-tenant-principal-v3'),
  workspaceId: taxWorkspaceIdSchema,
  actorId: z.string().min(1).max(300),
  capability: capabilitySchema,
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string().startsWith('/').max(700),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type TaxTenantPrincipalV2 = z.infer<typeof principalSchema>;
export type TaxTenantPrincipalV3 = z.infer<typeof boundPrincipalSchema>;
export type TaxTenantPrincipal = TaxTenantPrincipalV2 | TaxTenantPrincipalV3;
export type TaxTenantCapability = z.infer<typeof capabilitySchema>;
export const TAX_SNAPSHOT_PROJECTOR_ACTOR_ID = 'desk:tax-snapshot-projector';
const MAX_PRINCIPAL_TTL_MS = 300_000;

/** Keep unattended projection authority out of the browser/user gateway. */
export function taxTenantPrincipalSecretForCapability(
  capability: TaxTenantCapability,
  secrets: Readonly<{
    user: string | null;
    snapshotProjector: string | null;
  }>,
): string | null {
  return capability === 'snapshot:project' ? secrets.snapshotProjector : secrets.user;
}

export function verifyTaxTenantPrincipal(
  request: Request,
  secret: string | null,
  requiredCapability: TaxTenantCapability,
  now: Date = new Date(),
): TaxTenantPrincipalV2 {
  if (!secret) throw new Error('TAX_TENANT_PRINCIPAL_CONFIGURATION_REQUIRED');
  const encoded = request.headers.get('x-tax-tenant-principal');
  const signature = request.headers.get('x-tax-tenant-signature');
  if (!encoded || !signature || !/^[a-f0-9]{64}$/.test(signature)) {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  const expected = createHmac('sha256', secret).update(encoded, 'utf8').digest('hex');
  if (!constantTimeEqual(signature, expected)) throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  let principal: TaxTenantPrincipalV2;
  try {
    principal = principalSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  const canonical = JSON.stringify({
    version: principal.version,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    capability: principal.capability,
    expiresAt: principal.expiresAt,
  });
  if (decoded !== canonical) throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  if (principal.capability !== requiredCapability) throw new Error('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
  const expiresAt = Date.parse(principal.expiresAt);
  if (expiresAt <= now.getTime()) throw new Error('TAX_TENANT_PRINCIPAL_EXPIRED');
  if (expiresAt - now.getTime() > MAX_PRINCIPAL_TTL_MS) throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  return principal;
}

/**
 * Verify a short-lived principal against the exact HTTP request. New human
 * authority corridors must use this form so a signed read or confirmation
 * cannot be replayed against another path or with another body.
 */
export async function verifyBoundTaxTenantPrincipal(
  request: Request,
  secret: string | null,
  requiredCapability: TaxTenantCapability,
  now: Date = new Date(),
): Promise<TaxTenantPrincipalV3> {
  return verifyBoundTaxTenantPrincipalWithBodyHash(
    request,
    secret,
    requiredCapability,
    await boundedRequestBodyHash(request),
    now,
  );
}

/**
 * Verify a body-bound principal after a route has performed one bounded read.
 * This avoids depending on runtime-specific Request.clone body tee behavior.
 */
export function verifyBoundTaxTenantPrincipalForRawBody(
  request: Request,
  rawBody: string,
  secret: string | null,
  requiredCapability: TaxTenantCapability,
  now: Date = new Date(),
): TaxTenantPrincipalV3 {
  if (Buffer.byteLength(rawBody, 'utf8') > 64 * 1024) {
    throw new Error('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
  }
  return verifyBoundTaxTenantPrincipalWithBodyHash(
    request,
    secret,
    requiredCapability,
    createHash('sha256').update(rawBody, 'utf8').digest('hex'),
    now,
  );
}

function verifyBoundTaxTenantPrincipalWithBodyHash(
  request: Request,
  secret: string | null,
  requiredCapability: TaxTenantCapability,
  requestBodyHash: string,
  now: Date,
): TaxTenantPrincipalV3 {
  const decoded = decodeSignedPrincipal(request, secret);
  let principal: TaxTenantPrincipalV3;
  try {
    principal = boundPrincipalSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  const canonical = JSON.stringify({
    version: principal.version,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    capability: principal.capability,
    method: principal.method,
    path: principal.path,
    bodyHash: principal.bodyHash,
    expiresAt: principal.expiresAt,
  });
  if (decoded !== canonical) throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  if (principal.capability !== requiredCapability) {
    throw new Error('TAX_TENANT_PRINCIPAL_CAPABILITY_UNAUTHORIZED');
  }
  assertPrincipalLifetime(principal.expiresAt, now);
  const url = new URL(request.url);
  if (
    principal.method !== request.method
    || principal.path !== `${url.pathname}${url.search}`
    || principal.bodyHash !== requestBodyHash
  ) {
    throw new Error('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
  }
  return principal;
}

export function assertTaxTenantPrincipalScope(
  principal: TaxTenantPrincipal | null,
  workspaceId: string,
  actorId?: string,
): asserts principal is TaxTenantPrincipalV2 {
  if (!principal
    || principal.workspaceId !== workspaceId
    || (actorId !== undefined && principal.actorId !== actorId)) {
    throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
  }
}

function decodeSignedPrincipal(request: Request, secret: string | null): string {
  if (!secret) throw new Error('TAX_TENANT_PRINCIPAL_CONFIGURATION_REQUIRED');
  const encoded = request.headers.get('x-tax-tenant-principal');
  const signature = request.headers.get('x-tax-tenant-signature');
  if (
    !encoded
    || encoded.length > 4096
    || !signature
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
    || !/^[a-f0-9]{64}$/.test(signature)
  ) {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  const expected = createHmac('sha256', secret).update(encoded, 'utf8').digest('hex');
  if (!constantTimeEqual(signature, expected)) throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
  return decoded;
}

function assertPrincipalLifetime(expiresAtInput: string, now: Date): void {
  const expiresAt = Date.parse(expiresAtInput);
  if (expiresAt <= now.getTime()) throw new Error('TAX_TENANT_PRINCIPAL_EXPIRED');
  if (expiresAt - now.getTime() > MAX_PRINCIPAL_TTL_MS) {
    throw new Error('TAX_TENANT_PRINCIPAL_UNAUTHORIZED');
  }
}

async function boundedRequestBodyHash(request: Request): Promise<string> {
  const maximumBytes = 64 * 1024;
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)) {
    throw new Error('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
  }
  if (!request.body) return createHash('sha256').update('').digest('hex');
  const reader = request.clone().body!.getReader();
  const hash = createHash('sha256');
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error('TAX_TENANT_PRINCIPAL_SCOPE_UNAUTHORIZED');
    }
    hash.update(part.value);
  }
  return hash.digest('hex');
}

export function requiredTaxTenantPrincipalCapability(
  method: string,
  pathname: string,
): TaxTenantCapability | null {
  if (method === 'POST' && pathname === '/v1/evidence/batches') return 'evidence:publish';
  if (method === 'POST' && pathname === '/v1/evidence/consent-events') return 'consent:publish';
  if (method === 'POST' && pathname === '/v1/profiles/confirm') return 'profile:confirm';
  if (method === 'GET' && /^\/v1\/profiles\/[^/]+$/.test(pathname)) return 'profile:read';
  if (method === 'POST' && pathname === '/v1/snapshots') return 'snapshot:project';
  if (method === 'POST' && /^\/v1\/snapshot-projections\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:project';
  if (method === 'POST' && /^\/v1\/browser\/factoring-projections\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:project';
  if (method === 'PUT' && /^\/v1\/snapshot-configurations\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:configure';
  if (method === 'GET' && /^\/v1\/snapshot-configurations\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:configure';
  if (method === 'GET' && /^\/v1\/snapshots\/(?!demo(?:\/|$))[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:read';
  if (method === 'GET' && /^\/v1\/browser\/snapshots\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:read';
  if (method === 'GET' && /^\/v1\/browser\/factoring-projections\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'tax.factoring.read';
  if (/^\/v1\/arca-onboarding(?:\/|$)/.test(pathname)) return 'arca:onboard';
  if (/^\/v1\/accountant-mandates(?:\/|$)/.test(pathname)) return 'accountant:mandate';
  if (method === 'GET' && pathname === '/v1/accountant-portfolio') return 'accountant:portfolio';
  if (method === 'POST' && pathname === '/v1/accountant-decisions') return 'accountant:decision';
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
