import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { taxWorkspaceIdSchema } from '@tax-engine/core';
import { z } from 'zod';

const principalSchema = z.object({
  version: z.literal('invoice-settlement-adapter-principal-v1'),
  workspaceId: taxWorkspaceIdSchema,
  adapterId: z.literal('open-agents-invoice-settlement'),
  method: z.literal('POST'),
  path: z.literal('/v1/invoice-settlements/record'),
  bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().min(8).max(200),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export type InvoiceSettlementAdapterPrincipalV1 = z.infer<typeof principalSchema>;
const MAX_TTL_MS = 120_000;

export function verifyInvoiceSettlementAdapterPrincipal(input: Readonly<{
  request: Request;
  rawBody: string;
  idempotencyKey: string;
  secret: string | null;
  now?: Date;
}>): InvoiceSettlementAdapterPrincipalV1 {
  if (!input.secret || Buffer.byteLength(input.secret) < 32) throw new Error('INVOICE_SETTLEMENT_ADAPTER_CONFIGURATION_REQUIRED');
  const encoded = input.request.headers.get('x-invoice-settlement-principal');
  const signature = input.request.headers.get('x-invoice-settlement-principal-signature');
  if (!encoded || encoded.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(encoded) || !signature || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('INVOICE_SETTLEMENT_ADAPTER_UNAUTHORIZED');
  const expected = createHmac('sha256', input.secret).update(encoded, 'utf8').digest('hex');
  if (!constantTimeEqual(signature, expected)) throw new Error('INVOICE_SETTLEMENT_ADAPTER_UNAUTHORIZED');
  let principal: InvoiceSettlementAdapterPrincipalV1;
  try {
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    if (Buffer.from(decoded, 'utf8').toString('base64url') !== encoded) throw new Error('bad encoding');
    principal = principalSchema.parse(JSON.parse(decoded) as unknown);
    if (decoded !== JSON.stringify(principal)) throw new Error('non-canonical');
  } catch { throw new Error('INVOICE_SETTLEMENT_ADAPTER_UNAUTHORIZED'); }
  const now = (input.now ?? new Date()).getTime();
  const expiresAt = Date.parse(principal.expiresAt);
  if (principal.method !== input.request.method || principal.path !== new URL(input.request.url).pathname || principal.bodyHash !== sha256(input.rawBody) || principal.idempotencyKey !== input.idempotencyKey) throw new Error('INVOICE_SETTLEMENT_ADAPTER_SCOPE_UNAUTHORIZED');
  if (expiresAt <= now) throw new Error('INVOICE_SETTLEMENT_ADAPTER_EXPIRED');
  if (expiresAt - now > MAX_TTL_MS) throw new Error('INVOICE_SETTLEMENT_ADAPTER_UNAUTHORIZED');
  return principal;
}

function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left); const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
