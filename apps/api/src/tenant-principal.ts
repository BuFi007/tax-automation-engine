import { createHmac, timingSafeEqual } from 'node:crypto';
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
  'arca:onboard',
  'accountant:mandate',
]);
const principalSchema = z.object({
  version: z.literal('tax-tenant-principal-v2'),
  workspaceId: taxWorkspaceIdSchema,
  actorId: z.string().min(1).max(300),
  capability: capabilitySchema,
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type TaxTenantPrincipalV2 = z.infer<typeof principalSchema>;
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

export function assertTaxTenantPrincipalScope(
  principal: TaxTenantPrincipalV2 | null,
  workspaceId: string,
  actorId?: string,
): asserts principal is TaxTenantPrincipalV2 {
  if (!principal
    || principal.workspaceId !== workspaceId
    || (actorId !== undefined && principal.actorId !== actorId)) {
    throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
  }
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
  if (method === 'PUT' && /^\/v1\/snapshot-configurations\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:configure';
  if (method === 'GET' && /^\/v1\/snapshot-configurations\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:configure';
  if (method === 'GET' && /^\/v1\/snapshots\/(?!demo(?:\/|$))[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:read';
  if (method === 'GET' && /^\/v1\/browser\/snapshots\/[^/]+(?:\/[^/]+)?$/.test(pathname)) return 'snapshot:read';
  if (/^\/v1\/arca-onboarding(?:\/|$)/.test(pathname)) return 'arca:onboard';
  if (/^\/v1\/accountant-mandates(?:\/|$)/.test(pathname)) return 'accountant:mandate';
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
