import { timingSafeEqual } from 'node:crypto';

import { signerRequestSchema } from './contracts';
import { WsfeSignerService } from './service';
import { SoapWsfeAuthorityClient } from './soap';
import { SignerAttemptStore } from './store';
import { HttpAuthorityPayloadVault } from './vault';
import { HttpWsaaTicketBroker } from './wsaa';

const port = Number(process.env.PORT ?? 4300);
const hostname = process.env.WSFE_SIGNER_HOST ?? '127.0.0.1';
const apiToken = requiredEnvironment('WSFE_SIGNER_API_TOKEN');
// Fail closed: the domestic authority is production only when ARCA_ENVIRONMENT
// is exactly 'production'. Anything else stays on homologation.
const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
if (environment === 'production' && process.env.WSFE_SIGNER_PRODUCTION_APPROVED !== 'true') throw new Error('WSFE_SIGNER_PRODUCTION_APPROVAL_REQUIRED');
const vault = new HttpAuthorityPayloadVault({
  baseUrl: requiredEnvironment('WSFE_SIGNER_VAULT_URL'),
  token: requiredEnvironment('WSFE_SIGNER_VAULT_TOKEN'),
});
const wsaa = new HttpWsaaTicketBroker({
  baseUrl: requiredEnvironment('WSFE_WSAA_BROKER_URL'),
  token: requiredEnvironment('WSFE_WSAA_BROKER_TOKEN'),
});
const service = new WsfeSignerService(
  { environment, signerVersion: process.env.WSFE_SIGNER_VERSION ?? '0.1.0' },
  new SignerAttemptStore(),
  vault,
  wsaa,
  new SoapWsfeAuthorityClient(environment)
);

export const server = Bun.serve({
  hostname,
  port,
  async fetch(request) {
    try {
      if (!authorized(request, apiToken)) return json({ error: 'UNAUTHORIZED' }, 401);
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json(await service.health());
      if (request.method === 'POST' && url.pathname === '/v1/wsfev1/invoices') {
        const declaredBytes = Number(request.headers.get('content-length') ?? 0);
        if (declaredBytes > 1_048_576) return json({ error: 'SIGNER_REQUEST_TOO_LARGE' }, 413);
        const raw = await request.text();
        if (Buffer.byteLength(raw) > 1_048_576) return json({ error: 'SIGNER_REQUEST_TOO_LARGE' }, 413);
        const body = signerRequestSchema.parse(JSON.parse(raw));
        const idempotencyKey = request.headers.get('idempotency-key') ?? '';
        const occurredAt = new Date().toISOString();
        return json(await service.issueInvoice(body, idempotencyKey, occurredAt));
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const code = /^[A-Z0-9_]+$/.test(message) ? message : 'INVALID_REQUEST';
      return json({ error: code }, statusFor(code));
    }
  },
});

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function authorized(request: Request, expected: string): boolean {
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '';
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

function statusFor(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('CONFLICT') || code.includes('NOT_MONOTONIC') || code.includes('NOT_SEQUENTIAL')) return 409;
  if (code.endsWith('_REQUIRED') || code.includes('MISMATCH') || code.includes('INVALID') || code.includes('FORBIDDEN')) return 400;
  return 422;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

if (import.meta.main) {
  console.info(`WSFE signer listening on ${hostname}:${server.port}; environment=${environment}; credentials remain in vault/WSAA boundaries`);
}
