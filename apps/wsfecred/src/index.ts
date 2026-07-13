import { timingSafeEqual } from 'node:crypto';

import { parseLifecycleCoordinates, resolveAcceptanceWindowDays } from './contracts';
import { WsfecredLifecycleService } from './service';
import { SoapWsfecredAuthorityClient } from './soap';
import { HttpWsaaTicketBroker } from './wsaa';

const LIFECYCLE_PATH = /^\/v1\/wsfecred\/invoices\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)\/lifecycle$/;

const port = Number(process.env.PORT ?? 4400);
const apiToken = requiredEnvironment('WSFECRED_API_TOKEN');
// Fail closed: production only when ARCA_ENVIRONMENT is exactly 'production';
// anything else stays on homologation.
const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
if (environment === 'production' && process.env.WSFECRED_PRODUCTION_APPROVED !== 'true') throw new Error('WSFECRED_PRODUCTION_APPROVAL_REQUIRED');
const acceptanceWindowDays = resolveAcceptanceWindowDays(process.env.FCE_ACCEPTANCE_WINDOW_DAYS);
const wsaa = new HttpWsaaTicketBroker({
  baseUrl: requiredEnvironment('WSFECRED_WSAA_BROKER_URL'),
  token: requiredEnvironment('WSFECRED_WSAA_BROKER_TOKEN'),
});
const service = new WsfecredLifecycleService(
  { environment, clientVersion: process.env.WSFECRED_CLIENT_VERSION ?? '0.1.0', acceptanceWindowDays },
  wsaa,
  new SoapWsfecredAuthorityClient(environment)
);

export const server = Bun.serve({
  port,
  async fetch(request) {
    try {
      if (!authorized(request, apiToken)) return json({ error: 'UNAUTHORIZED' }, 401);
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') return json(await service.health());
      const match = request.method === 'GET' ? LIFECYCLE_PATH.exec(url.pathname) : null;
      if (match) {
        const coordinates = parseLifecycleCoordinates({
          cuitEmisor: decodeURIComponent(match[1]!),
          pointOfSale: decodeURIComponent(match[2]!),
          comprobanteType: decodeURIComponent(match[3]!),
          invoiceNumber: decodeURIComponent(match[4]!),
        });
        const identity = {
          workspaceId: requiredHeader(request, 'x-workspace-id'),
          issuerProfileRef: requiredHeader(request, 'x-issuer-profile-ref'),
        };
        const lifecycle = await service.getLifecycle(coordinates, identity);
        if (!lifecycle) return json({ error: 'WSFECRED_COMPROBANTE_NOT_FOUND' }, 404);
        return json(lifecycle);
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

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name)?.trim();
  if (!value) throw new Error(`${name.toUpperCase().replaceAll('-', '_')}_REQUIRED`);
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
  if (code.includes('TRANSPORT') || code.includes('HTTP_REJECTED') || code.includes('SOAP_FAULT') || code.includes('BROKER_REJECTED')) return 502;
  if (code.endsWith('_REQUIRED') || code.includes('MISMATCH') || code.includes('INVALID') || code.includes('UNSUPPORTED') || code.includes('FORBIDDEN')) return 400;
  return 422;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

if (import.meta.main) {
  console.info(`WSFECRED lifecycle client listening on port ${server.port}; environment=${environment}; read-only; acceptanceWindowDays=${acceptanceWindowDays}; credentials remain in WSAA broker`);
}
