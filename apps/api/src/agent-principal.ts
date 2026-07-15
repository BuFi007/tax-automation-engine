import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { taxWorkspaceIdSchema } from '@tax-engine/core';
import { z } from 'zod';

const principalSchema = z.object({
  version: z.literal('tax-agent-principal-v1'),
  workspaceId: taxWorkspaceIdSchema,
  actorId: z.string().min(1).max(300),
  toolId: z.string().regex(/^tax_[a-z0-9_]{1,120}$/),
  method: z.literal('POST'),
  path: z.string().regex(/^\/v1\/agent\/tools\/tax_[a-z0-9_]+\/invoke$/),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(8).max(200),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type TaxAgentPrincipalV1 = z.infer<typeof principalSchema>;

const MAX_TTL_MS = 120_000;

export function verifyTaxAgentPrincipal(input: Readonly<{
  request: Request;
  rawBody: string;
  toolId: string;
  actorId: string;
  idempotencyKey: string;
  secret: string | null;
  now?: Date;
}>): TaxAgentPrincipalV1 {
  if (!input.secret || Buffer.byteLength(input.secret) < 32) {
    throw new Error('TAX_AGENT_PRINCIPAL_CONFIGURATION_REQUIRED');
  }
  const encoded = input.request.headers.get('x-tax-agent-principal');
  const suppliedSignature = input.request.headers.get('x-tax-agent-principal-signature');
  if (
    !encoded
    || encoded.length > 4096
    || !/^[A-Za-z0-9_-]+$/.test(encoded)
    || !suppliedSignature
    || !/^[a-f0-9]{64}$/.test(suppliedSignature)
  ) throw new Error('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  const expectedSignature = createHmac('sha256', input.secret)
    .update(encoded, 'utf8')
    .digest('hex');
  if (!constantTimeEqual(suppliedSignature, expectedSignature)) {
    throw new Error('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    throw new Error('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  }
  if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) {
    throw new Error('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  }
  let principal: TaxAgentPrincipalV1;
  try {
    principal = principalSchema.parse(JSON.parse(decoded) as unknown);
  } catch {
    throw new Error('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  }
  if (decoded !== canonicalTaxAgentPrincipal(principal)) {
    throw new Error('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  }
  const path = new URL(input.request.url).pathname;
  if (
    principal.toolId !== input.toolId
    || principal.actorId !== input.actorId
    || principal.idempotencyKey !== input.idempotencyKey
    || principal.method !== input.request.method
    || principal.path !== path
    || principal.bodyHash !== sha256Hex(input.rawBody)
  ) throw new Error('TAX_AGENT_PRINCIPAL_SCOPE_UNAUTHORIZED');
  const now = (input.now ?? new Date()).getTime();
  const expiresAt = Date.parse(principal.expiresAt);
  if (expiresAt <= now) throw new Error('TAX_AGENT_PRINCIPAL_EXPIRED');
  if (expiresAt - now > MAX_TTL_MS) {
    throw new Error('TAX_AGENT_PRINCIPAL_UNAUTHORIZED');
  }
  return principal;
}

export function createTaxAgentPrincipalHeaders(input: Readonly<{
  secret: string;
  workspaceId: string;
  actorId: string;
  toolId: string;
  path: string;
  rawBody: string;
  idempotencyKey: string;
  expiresAt: string;
}>): Record<string, string> {
  if (Buffer.byteLength(input.secret) < 32) {
    throw new Error('TAX_AGENT_PRINCIPAL_CONFIGURATION_REQUIRED');
  }
  const principal = principalSchema.parse({
    version: 'tax-agent-principal-v1',
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    toolId: input.toolId,
    method: 'POST',
    path: input.path,
    bodyHash: sha256Hex(input.rawBody),
    idempotencyKey: input.idempotencyKey,
    expiresAt: input.expiresAt,
  });
  const encoded = Buffer.from(
    canonicalTaxAgentPrincipal(principal),
    'utf8'
  ).toString('base64url');
  return {
    'x-tax-agent-principal': encoded,
    'x-tax-agent-principal-signature': createHmac('sha256', input.secret)
      .update(encoded, 'utf8')
      .digest('hex'),
  };
}

export function canonicalTaxAgentPrincipal(principal: TaxAgentPrincipalV1): string {
  return JSON.stringify({
    version: principal.version,
    workspaceId: principal.workspaceId,
    actorId: principal.actorId,
    toolId: principal.toolId,
    method: principal.method,
    path: principal.path,
    bodyHash: principal.bodyHash,
    idempotencyKey: principal.idempotencyKey,
    expiresAt: principal.expiresAt,
  });
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
