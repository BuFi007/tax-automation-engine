import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { taxWorkspaceIdSchema } from '@tax-engine/core';
import { z } from 'zod';

export const taxAuthorityCapabilitySchema = z.enum([
  'factura-e:case:create',
  'factura-e:intent:create',
  'factura-e:approval:register',
  'factura-e:execute',
  'factura-e:recover',
  'factura-e:reconcile',
  'factura-e:readiness',
  'factura-e:status:read',
]);

const authorityPrincipalSchema = z
  .object({
    version: z.literal('tax-authority-principal-v1'),
    workspaceId: taxWorkspaceIdSchema,
    actorId: z.string().min(1).max(300),
    capability: taxAuthorityCapabilitySchema,
    method: z.enum(['GET', 'POST']),
    path: z.string().regex(/^\/v1\/authority\/[a-z0-9/_-]+$/),
    bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export type TaxAuthorityCapability = z.infer<typeof taxAuthorityCapabilitySchema>;
export type TaxAuthorityPrincipalV1 = z.infer<typeof authorityPrincipalSchema>;
export type TaxAuthorityPrincipalSecrets = Readonly<{
  motora: string | null;
  openAgentsApproval: string | null;
}>;

const MAX_TTL_MS = 120_000;

export function verifyTaxAuthorityPrincipal(input: Readonly<{
  request: Request;
  rawBody: string;
  capability: TaxAuthorityCapability;
  secrets: TaxAuthorityPrincipalSecrets;
  now?: Date;
}>): TaxAuthorityPrincipalV1 {
  const secret = secretFor(input.capability, input.secrets);
  if (!secret || secret.length < 32)
    throw new Error('TAX_AUTHORITY_PRINCIPAL_CONFIGURATION_REQUIRED');
  const encoded = input.request.headers.get('x-tax-authority-principal');
  const signature = input.request.headers.get('x-tax-authority-signature');
  if (
    !encoded ||
    encoded.length > 4096 ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    !signature ||
    !/^[a-f0-9]{64}$/.test(signature)
  )
    throw new Error('TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED');
  const expectedSignature = createHmac('sha256', secret).update(encoded).digest('hex');
  if (!constantTimeEqual(signature, expectedSignature))
    throw new Error('TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED');
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    throw new Error('TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED');
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded)
    throw new Error('TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED');
  let principal: TaxAuthorityPrincipalV1;
  try {
    principal = authorityPrincipalSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    throw new Error('TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED');
  }
  if (decoded !== canonicalTaxAuthorityPrincipal(principal))
    throw new Error('TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED');
  const url = new URL(input.request.url);
  if (
    principal.capability !== input.capability ||
    principal.method !== input.request.method ||
    principal.path !== url.pathname ||
    principal.bodyHash !== sha256Hex(input.rawBody)
  )
    throw new Error('TAX_AUTHORITY_PRINCIPAL_SCOPE_UNAUTHORIZED');
  const nowMs = (input.now ?? new Date()).getTime();
  const expiresAt = Date.parse(principal.expiresAt);
  if (expiresAt <= nowMs) throw new Error('TAX_AUTHORITY_PRINCIPAL_EXPIRED');
  if (expiresAt - nowMs > MAX_TTL_MS)
    throw new Error('TAX_AUTHORITY_PRINCIPAL_UNAUTHORIZED');
  return principal;
}

export function canonicalTaxAuthorityPrincipal(principal: TaxAuthorityPrincipalV1): string {
  return JSON.stringify({
    version: principal.version,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    capability: principal.capability,
    method: principal.method,
    path: principal.path,
    bodyHash: principal.bodyHash,
    expiresAt: principal.expiresAt,
  });
}

export function createTaxAuthorityPrincipalHeaders(input: Readonly<{
  secret: string;
  workspaceId: string;
  actorId: string;
  capability: TaxAuthorityCapability;
  method: 'GET' | 'POST';
  path: string;
  rawBody: string;
  expiresAt: string;
}>): Record<string, string> {
  if (input.secret.length < 32)
    throw new Error('TAX_AUTHORITY_PRINCIPAL_CONFIGURATION_REQUIRED');
  const principal = authorityPrincipalSchema.parse({
    version: 'tax-authority-principal-v1',
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    capability: input.capability,
    method: input.method,
    path: input.path,
    bodyHash: sha256Hex(input.rawBody),
    expiresAt: input.expiresAt,
  });
  const encoded = Buffer.from(canonicalTaxAuthorityPrincipal(principal), 'utf8').toString(
    'base64url'
  );
  return {
    'x-tax-authority-principal': encoded,
    'x-tax-authority-signature': createHmac('sha256', input.secret)
      .update(encoded)
      .digest('hex'),
  };
}

export function assertTaxAuthoritySecretsDistinct(
  secrets: TaxAuthorityPrincipalSecrets,
  otherSecrets: readonly (string | null)[] = []
): void {
  const configured = [secrets.motora, secrets.openAgentsApproval, ...otherSecrets].filter(
    (value): value is string => Boolean(value)
  );
  if (
    !secrets.motora ||
    secrets.motora.length < 32 ||
    !secrets.openAgentsApproval ||
    secrets.openAgentsApproval.length < 32 ||
    new Set(configured).size !== configured.length
  )
    throw new Error('TAX_AUTHORITY_PRINCIPAL_SECRETS_MUST_BE_DISTINCT');
}

function secretFor(
  capability: TaxAuthorityCapability,
  secrets: TaxAuthorityPrincipalSecrets
): string | null {
  return capability === 'factura-e:approval:register'
    ? secrets.openAgentsApproval
    : secrets.motora;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
