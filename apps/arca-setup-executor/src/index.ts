import {
  arcaSetupCancelSchema,
  arcaSetupOrderSchema,
  signArcaSetupMessage,
  verifyArcaSetupMessage,
} from '@tax-engine/arca-setup-contract';

import type { ExecutorEnv } from './env';
import { runProof } from './proof';

export { ArcaSetupSession } from './session';

const MAX_BODY_BYTES = 64 * 1024;

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
