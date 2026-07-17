import { z } from 'zod';

import { readBoundedBody } from './bounded-body';
import { facturaESettlementSchema } from './agent-routes';
import { verifyInvoiceSettlementAdapterPrincipal } from './invoice-settlement-adapter-principal';

const requestSchema = z.object({
  idempotencyKey: z.string().min(8).max(200),
  event: z.object({
    schemaVersion: z.literal(1), eventId: z.uuid(), teamId: z.uuid(),
    invoiceId: z.uuid(),
    eventType: z.enum(['InvoiceSettlementFinalizedV1', 'InvoiceSettlementReversedV1']),
    replayKey: z.string().regex(/^[a-f0-9]{64}$/), recordedAt: z.iso.datetime({ offset: true }),
  }).strict(),
  settlement: facturaESettlementSchema,
}).strict().superRefine((value, context) => {
  const expectedState = value.event.eventType === 'InvoiceSettlementFinalizedV1' ? 'final' : 'reversed';
  if (value.settlement.finalityState !== expectedState) context.addIssue({ code: 'custom', path: ['settlement', 'finalityState'], message: 'Settlement finality must match canonical event type' });
});

export async function handleInvoiceSettlementAdapterRoute(
  request: Request, url: URL, store: Readonly<{ appendInvoiceSettlementEvent(input: InvoiceSettlementInboxEvent): { replayed: boolean } }>, secret: string | null,
): Promise<Response | null> {
  if (request.method !== 'POST' || url.pathname !== '/v1/invoice-settlements/events') return null;
  const rawBody = await readBoundedBody(request, 1024 * 1024, 'INVOICE_SETTLEMENT_REQUEST_TOO_LARGE');
  const body = requestSchema.parse(JSON.parse(rawBody) as unknown);
  const principal = verifyInvoiceSettlementAdapterPrincipal({ request, rawBody, idempotencyKey: body.idempotencyKey, secret });
  if (principal.workspaceId !== body.event.teamId) throw new Error('INVOICE_SETTLEMENT_WORKER_WORKSPACE_UNAUTHORIZED');
  const result = store.appendInvoiceSettlementEvent({
    workspaceId: body.event.teamId,
    invoiceId: body.event.invoiceId,
    eventId: body.event.eventId,
    eventType: body.event.eventType,
    replayKey: body.event.replayKey,
    recordedAt: body.event.recordedAt,
    idempotencyKey: body.idempotencyKey,
    settlement: body.settlement,
  });
  return json({ data: { eventId: body.event.eventId, replayed: result.replayed } });
}

export type InvoiceSettlementInboxEvent = Readonly<{
  workspaceId: string;
  invoiceId: string;
  eventId: string;
  eventType: 'InvoiceSettlementFinalizedV1' | 'InvoiceSettlementReversedV1';
  replayKey: string;
  recordedAt: string;
  idempotencyKey: string;
  settlement: z.infer<typeof facturaESettlementSchema>;
}>;

function json(value: unknown, status = 200): Response { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
