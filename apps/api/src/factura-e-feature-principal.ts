import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { taxWorkspaceIdSchema } from '@tax-engine/core';
import { z } from 'zod';

export const facturaEFeatureCapabilitySchema = z.enum([
  'factura-e:factoring-consent',
  'factura-e:feature-project',
  'factura-e:feature-head:read',
]);

const principalSchema = z.object({
  version: z.literal('factura-e-feature-principal-v1'),
  workspaceId: taxWorkspaceIdSchema,
  actorId: z.string().min(1).max(300),
  capability: facturaEFeatureCapabilitySchema,
  method: z.literal('POST'),
  path: z.string().regex(/^\/v1\/(?:internal\/)?factoring\/factura-e\/[A-Za-z0-9/_-]+$/),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type FacturaEFeatureCapability = z.infer<typeof facturaEFeatureCapabilitySchema>;
export type FacturaEFeaturePrincipalV1 = z.infer<typeof principalSchema>;
export type FacturaEFeaturePrincipalSecrets = Readonly<{
  deskConsent: string | null;
  projector: string | null;
  creReader: string | null;
  creReservation: string | null;
}>;

const MAX_TTL_MS = 120_000;

export function verifyFacturaEFeaturePrincipal(input: Readonly<{
  request: Request;
  rawBody: string;
  capability: FacturaEFeatureCapability;
  secrets: FacturaEFeaturePrincipalSecrets;
  now?: Date;
}>): FacturaEFeaturePrincipalV1 {
  const secret = secretFor(input.capability, input.secrets);
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_CONFIGURATION_REQUIRED');
  }
  const encoded = input.request.headers.get('x-tax-feature-principal');
  const signature = input.request.headers.get('x-tax-feature-principal-signature');
  if (
    !encoded
    || encoded.length > 4096
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
    || !signature
    || !/^[a-f0-9]{64}$/.test(signature)
  ) throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
  const expected = createHmac('sha256', secret).update(encoded).digest('hex');
  if (!constantTimeEqual(signature, expected)) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
  }
  let principal: FacturaEFeaturePrincipalV1;
  try {
    principal = principalSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
  }
  if (decoded !== canonicalFacturaEFeaturePrincipal(principal)) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
  }
  const url = new URL(input.request.url);
  if (
    principal.capability !== input.capability
    || principal.method !== input.request.method
    || principal.path !== url.pathname
    || principal.bodyHash !== sha256Hex(input.rawBody)
  ) throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_SCOPE_UNAUTHORIZED');
  const now = (input.now ?? new Date()).getTime();
  const expiresAt = Date.parse(principal.expiresAt);
  if (expiresAt <= now) throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_EXPIRED');
  if (expiresAt - now > MAX_TTL_MS) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED');
  }
  return principal;
}

export function createFacturaEFeaturePrincipalHeaders(input: Readonly<{
  secret: string;
  workspaceId: string;
  actorId: string;
  capability: FacturaEFeatureCapability;
  path: string;
  rawBody: string;
  expiresAt: string;
}>): Record<string, string> {
  if (Buffer.byteLength(input.secret) < 32) {
    throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_CONFIGURATION_REQUIRED');
  }
  const principal = principalSchema.parse({
    version: 'factura-e-feature-principal-v1',
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    capability: input.capability,
    method: 'POST',
    path: input.path,
    bodyHash: sha256Hex(input.rawBody),
    expiresAt: input.expiresAt,
  });
  const encoded = Buffer.from(
    canonicalFacturaEFeaturePrincipal(principal),
    'utf8'
  ).toString('base64url');
  return {
    'x-tax-feature-principal': encoded,
    'x-tax-feature-principal-signature': createHmac('sha256', input.secret)
      .update(encoded)
      .digest('hex'),
  };
}

export function canonicalFacturaEFeaturePrincipal(
  principal: FacturaEFeaturePrincipalV1
): string {
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

export function assertFacturaEFeatureSecretsDistinct(
  secrets: FacturaEFeaturePrincipalSecrets,
  otherSecrets: readonly (string | null)[] = []
): void {
  const required = [
    secrets.deskConsent,
    secrets.projector,
    secrets.creReader,
    secrets.creReservation,
  ];
  const configured = [...required, ...otherSecrets].filter(
    (value): value is string => Boolean(value)
  );
  if (
    required.some(value => !value || Buffer.byteLength(value) < 32)
    || new Set(configured).size !== configured.length
  ) throw new Error('TAX_FACTURA_E_FEATURE_PRINCIPAL_SECRETS_MUST_BE_DISTINCT');
}

function secretFor(
  capability: FacturaEFeatureCapability,
  secrets: FacturaEFeaturePrincipalSecrets
): string | null {
  if (capability === 'factura-e:factoring-consent') return secrets.deskConsent;
  if (capability === 'factura-e:feature-project') return secrets.projector;
  return secrets.creReader;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
