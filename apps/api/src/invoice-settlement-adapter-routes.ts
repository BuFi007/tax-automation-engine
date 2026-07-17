import { z } from 'zod';

import { readBoundedBody } from './bounded-body';
import { facturaESettlementSchema } from './agent-routes';
import type { FacturaEAgentService } from './factura-e-agent';
import { verifyInvoiceSettlementAdapterPrincipal } from './invoice-settlement-adapter-principal';

const requestSchema = z.object({
  runId: z.uuid(),
  idempotencyKey: z.string().min(8).max(200),
  event: z.object({
    schemaVersion: z.literal(1), eventId: z.uuid(), teamId: z.uuid(),
    eventType: z.enum(['InvoiceSettlementFinalizedV1', 'InvoiceSettlementReversedV1']),
    replayKey: z.string().regex(/^[a-f0-9]{64}$/), recordedAt: z.iso.datetime({ offset: true }),
  }).strict(),
  settlement: facturaESettlementSchema,
}).strict().superRefine((value, context) => {
  const expectedState = value.event.eventType === 'InvoiceSettlementFinalizedV1' ? 'final' : 'reversed';
  if (value.settlement.finalityState !== expectedState) context.addIssue({ code: 'custom', path: ['settlement', 'finalityState'], message: 'Settlement finality must match canonical event type' });
});

export async function handleInvoiceSettlementAdapterRoute(
  request: Request, url: URL, service: FacturaEAgentService, secret: string | null,
): Promise<Response | null> {
  if (request.method !== 'POST' || url.pathname !== '/v1/invoice-settlements/record') return null;
  const rawBody = await readBoundedBody(request, 1024 * 1024, 'INVOICE_SETTLEMENT_REQUEST_TOO_LARGE');
  const body = requestSchema.parse(JSON.parse(rawBody) as unknown);
  const principal = verifyInvoiceSettlementAdapterPrincipal({ request, rawBody, idempotencyKey: body.idempotencyKey, secret });
  if (principal.workspaceId !== body.event.teamId) throw new Error('INVOICE_SETTLEMENT_ADAPTER_WORKSPACE_UNAUTHORIZED');
  const run = service.getRun(body.runId);
  if (run.workspaceId !== body.event.teamId) throw new Error('INVOICE_SETTLEMENT_RUN_WORKSPACE_MISMATCH');
  const result = service.recordSettlement({
    runId: body.runId, settlement: body.settlement, idempotencyKey: body.idempotencyKey,
    actorId: 'system:invoice-settlement-adapter', occurredAt: body.event.recordedAt,
  });
  return json({ data: { run: result.run, replayed: result.replayed } });
}

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
