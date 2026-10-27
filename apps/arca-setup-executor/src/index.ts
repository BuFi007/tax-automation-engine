import {
  arcaSetupCancelSchema,
  arcaSetupControlSchema,
  arcaSetupOrderSchema,
  signArcaSetupMessage,
  verifyArcaSetupMessage,
} from '@tax-engine/arca-setup-contract';

import { z } from 'zod';

import { requireServiceBindings } from './bindings';
import type { ExecutorEnv } from './env';
import { runProof } from './proof';

export { ArcaSetupSession } from './session';

const MAX_BODY_BYTES = 64 * 1024;

const controlReadSchema = z.object({
  version: z.literal('arca-setup-control-read-v1'),
  executionId: z.uuid(),
  requestedAt: z.iso.datetime({ offset: true }),
}).strict();

export default {
  async fetch(request: Request, env: ExecutorEnv): Promise<Response> {
    try {
      assertConfigured(env);
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health')
        return Response.json({ status: 'ok', environment: env.ARCA_ENVIRONMENT, contract: 'arca-setup-contract-v1' });

      if (request.method === 'POST' && url.pathname === '/v1/orders') {
        const body = await boundedText(request);
        await verifyArcaSetupMessage(env.ARCA_SETUP_ORDER_SECRET, 'order', request.headers, body);
        const order = arcaSetupOrderSchema.parse(JSON.parse(body));
        return stub(env, order.executionId).fetch('https://session/order', { method: 'POST', body });
      }

      if (request.method === 'POST' && url.pathname === '/v1/cancellations') {
        const body = await boundedText(request);
        await verifyArcaSetupMessage(env.ARCA_SETUP_ORDER_SECRET, 'cancel', request.headers, body);
        const cancel = arcaSetupCancelSchema.parse(JSON.parse(body));
        const response = await stub(env, cancel.executionId).fetch('https://session/cancel', {
          method: 'POST', body: JSON.stringify({ executionId: cancel.executionId }),
        });
        if (!response.ok) return response;
        const closure = await response.json() as { sessionClosed: boolean; sessionVerifiedGone: boolean };
        const receipt = JSON.stringify({
          version: 'arca-setup-cancel-receipt-v1',
          executionId: cancel.executionId,
          sessionClosed: closure.sessionClosed,
          sessionVerifiedGone: closure.sessionVerifiedGone,
          closedAt: new Date().toISOString(),
        });
        return new Response(receipt, {
          headers: { 'content-type': 'application/json', ...(await signArcaSetupMessage(env.ARCA_SETUP_RECEIPT_SECRET, 'cancel-receipt', receipt)) },
        });
      }

      // Execution control: pause, resume, take and return control. The answer is
      // the executor's own control state, signed, so the tax engine relays what
      // the session transport actually enforces.
      if (request.method === 'POST' && (url.pathname === '/v1/control' || url.pathname === '/v1/control-state')) {
        const body = await boundedText(request);
        await verifyArcaSetupMessage(env.ARCA_SETUP_ORDER_SECRET, 'control', request.headers, body);
        const parsed = JSON.parse(body) as unknown;
        let executionId: string;
        let response: Response;
        if (url.pathname === '/v1/control') {
          const control = arcaSetupControlSchema.parse(parsed);
          executionId = control.executionId;
          response = await stub(env, executionId).fetch('https://session/control', { method: 'POST', body });
        } else {
          const read = controlReadSchema.parse(parsed);
          executionId = read.executionId;
          response = await stub(env, executionId).fetch('https://session/control-state', { method: 'POST', body: JSON.stringify({ executionId }) });
        }
        const text = await response.text();
        return new Response(text, {
          status: response.status,
          headers: { 'content-type': 'application/json', ...(await signArcaSetupMessage(env.ARCA_SETUP_RECEIPT_SECRET, 'control-state', text)) },
        });
      }

      const handoff = url.pathname.match(/^\/handoff\/([0-9a-f-]{36})$/);
      if (request.method === 'GET' && handoff) {
        const ticket = url.searchParams.get('ticket') ?? '';
        if (!ticket || ticket.length > 4096) return new Response('Not found', { status: 404 });
        return stub(env, handoff[1]!).fetch(`https://session/handoff?ticket=${encodeURIComponent(ticket)}`);
      }

      if (url.pathname.startsWith('/proof/')) {
        if (env.PROOF_ROUTES_ENABLED !== 'true' || env.ARCA_ENVIRONMENT === 'production') return new Response('Not found', { status: 404 });
        return runProof(request, env);
      }
      return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    } catch (error) {
      const code = error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message) ? error.message : 'ARCA_SETUP_EXECUTOR_REQUEST_INVALID';
      const status = code.includes('SIGNATURE') ? 401 : code.includes('CONFIGURATION') ? 503 : 400;
      return Response.json({ error: code }, { status });
    }
  },
} satisfies ExportedHandler<ExecutorEnv>;

function stub(env: ExecutorEnv, executionId: string) {
  return env.ARCA_SETUP_SESSION.get(env.ARCA_SETUP_SESSION.idFromName(executionId));
}

function assertConfigured(env: ExecutorEnv): void {
  const secrets = [env.ARCA_SETUP_ORDER_SECRET, env.ARCA_SETUP_RECEIPT_SECRET, env.ARCA_SETUP_HANDOFF_SECRET, env.ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN];
  if (secrets.some(secret => !secret || secret.length < 32) || new Set(secrets).size !== secrets.length)
    throw new Error('ARCA_SETUP_EXECUTOR_CONFIGURATION_REQUIRED');
  requireServiceBindings(env);
  if (env.ARCA_ENVIRONMENT !== 'homologation' && env.ARCA_ENVIRONMENT !== 'production')
    throw new Error('ARCA_SETUP_EXECUTOR_CONFIGURATION_REQUIRED');
}

async function boundedText(request: Request): Promise<string> {
  const declared = request.headers.get('content-length');
  if (declared && Number(declared) > MAX_BODY_BYTES) throw new Error('ARCA_SETUP_REQUEST_TOO_LARGE');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new Error('ARCA_SETUP_REQUEST_TOO_LARGE');
  return text;
}
