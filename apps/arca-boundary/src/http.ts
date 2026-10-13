import {
  issuerDelegationRequestSchema,
  issuerPadronRequestSchema,
  issuerProvisionRequestSchema,
  issuerRevokeRequestSchema,
  issuerStatusRequestSchema,
  payloadResolveRequestSchema,
  payloadRetireRequestSchema,
  payloadRevokeRequestSchema,
  payloadStoreRequestSchema,
  payloadTerminalRequestSchema,
  ticketRequestSchema,
  wsaaServiceSchema,
} from './contracts';
import { readBoundedBody } from './bounded-body';
import { safeTokenEqual } from './crypto';
import type { ArcaBoundaryService } from './service';
import { queryIssuerPadron } from './padron';

export type BoundaryTokens = Readonly<{
  payloadWriter: string;
  payloadResolver: string;
  wsaa: string;
  status: string;
  admin: string;
  padron?: string | undefined;
  issuerRevoke?: string | undefined;
}>;

export function createBoundaryHandler(
  service: ArcaBoundaryService,
  tokens: BoundaryTokens,
  environment: 'homologation' | 'production',
  clock: () => Date = () => new Date()
) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      const occurredAt = clock().toISOString();
      if (request.method === 'GET' && url.pathname === '/health') {
        if (!authorized(request, tokens.wsaa)) return json({ error: 'UNAUTHORIZED' }, 401);
        const requestedEnvironment = url.searchParams.get('environment');
        const requestedService = wsaaServiceSchema.safeParse(url.searchParams.get('service'));
        if (!requestedService.success || requestedEnvironment !== environment) return json({ error: 'WSAA_BROKER_ENVIRONMENT_MISMATCH' }, 400);
        return json(await service.health(environment, occurredAt, requestedService.data));
      }
      if (request.method === 'GET' && url.pathname === '/v1/wsaa/issuers/status') {
        if (!authorized(request, tokens.status)) return json({ error: 'UNAUTHORIZED' }, 401);
        if (url.searchParams.size !== 3) return json({ error: 'INVALID_REQUEST' }, 400);
        const input = issuerStatusRequestSchema.parse(Object.fromEntries(url.searchParams));
        if (input.environment !== environment) return json({ error: 'WSAA_BROKER_ENVIRONMENT_MISMATCH' }, 400);
        return json(service.issuerStatus(input.workspaceId, input.issuerProfileRef, input.environment, occurredAt));
      }
      if (request.method !== 'POST') return json({ error: 'NOT_FOUND' }, 404);
      const requiredToken = tokenForPath(url.pathname, tokens);
      if (!requiredToken) return json({ error: 'NOT_FOUND' }, 404);
      if (!authorized(request, requiredToken)) return json({ error: 'UNAUTHORIZED' }, 401);
      const maximumBytes = url.pathname === '/v1/wsaa/issuers' ? 131_072 : 1_048_576;
      const raw = await readBoundedBody(request, maximumBytes, 'ARCA_BOUNDARY_REQUEST_TOO_LARGE');
      const body: unknown = JSON.parse(raw);

      if (url.pathname === '/v1/authority-payloads') {
        if (!authorized(request, tokens.payloadWriter)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = payloadStoreRequestSchema.parse(body);
        return json(service.storePayload(input, request.headers.get('idempotency-key') ?? '', occurredAt), 201);
      }
      if (url.pathname === '/v1/authority-payloads/resolve') {
        if (!authorized(request, tokens.payloadResolver)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = payloadResolveRequestSchema.parse(body);
        return json(service.resolvePayload(input.reference, occurredAt));
      }
      if (url.pathname === '/v1/authority-payloads/revoke') {
        if (!authorized(request, tokens.payloadWriter)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = payloadRevokeRequestSchema.parse(body);
        return json(service.revokePayload(input.workspaceId, input.reference, occurredAt));
      }
      if (url.pathname === '/v1/authority-payloads/terminal') {
        if (!authorized(request, tokens.payloadWriter)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = payloadTerminalRequestSchema.parse(body);
        return json(service.markPayloadTerminal(input, occurredAt));
      }
      if (url.pathname === '/v1/authority-payloads/retire-eligible') {
        if (!authorized(request, tokens.admin)) return json({ error: 'UNAUTHORIZED' }, 401);
        payloadRetireRequestSchema.parse(body);
        return json(service.retireEligiblePayloads(occurredAt));
      }
      if (url.pathname === '/v1/wsaa/tickets') {
        if (!authorized(request, tokens.wsaa)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = ticketRequestSchema.parse(body);
        if (input.environment !== environment) return json({ error: 'WSAA_BROKER_ENVIRONMENT_MISMATCH' }, 400);
        return json(await service.getTicket(input, occurredAt));
      }
      if (url.pathname === '/v1/wsaa/issuers') {
        if (!authorized(request, tokens.admin)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = issuerProvisionRequestSchema.parse(body);
        if (input.environment !== environment) return json({ error: 'WSAA_BROKER_ENVIRONMENT_MISMATCH' }, 400);
        return json(service.provisionIssuer(input, occurredAt), 201);
      }
      if (url.pathname === '/v1/wsaa/issuers/delegations') {
        if (!authorized(request, tokens.admin)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = issuerDelegationRequestSchema.parse(body);
        if (input.environment !== environment) return json({ error: 'WSAA_BROKER_ENVIRONMENT_MISMATCH' }, 400);
        return json(service.delegateIssuerFromStoredCertificate(input, occurredAt), 201);
      }
      if (url.pathname === '/v1/padron/issuer-prefill') {
        if (!tokens.padron || !authorized(request, tokens.padron)) return json({ error: 'UNAUTHORIZED' }, 401);
        if (environment !== 'homologation') return json({ error: 'ARCA_PADRON_HOMOLOGATION_ONLY' }, 400);
        const input = issuerPadronRequestSchema.parse(body);
        return json(await queryIssuerPadron(service, input, occurredAt));
      }
      if (url.pathname === '/v1/wsaa/issuers/revoke') {
        if (!authorized(request, tokens.issuerRevoke ?? tokens.admin)) return json({ error: 'UNAUTHORIZED' }, 401);
        const input = issuerRevokeRequestSchema.parse(body);
        return json(service.revokeIssuer(input.issuerProfileRef, input.certificateFingerprint, occurredAt));
      }
      return json({ error: 'NOT_FOUND' }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';
      const code = /^[A-Z0-9_]+$/.test(message) ? message : 'INVALID_REQUEST';
      return json({ error: code }, statusFor(code));
    }
  };
}

function authorized(request: Request, token: string): boolean {
  return safeTokenEqual(request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '', token);
}

function tokenForPath(path: string, tokens: BoundaryTokens): string | null {
  if (
    path === '/v1/authority-payloads'
    || path === '/v1/authority-payloads/revoke'
    || path === '/v1/authority-payloads/terminal'
  ) return tokens.payloadWriter;
  if (path === '/v1/authority-payloads/resolve') return tokens.payloadResolver;
  if (path === '/v1/authority-payloads/retire-eligible') return tokens.admin;
  if (path === '/v1/wsaa/tickets') return tokens.wsaa;
  if (path === '/v1/wsaa/issuers') return tokens.admin;
  if (path === '/v1/wsaa/issuers/delegations') return tokens.admin;
  if (path === '/v1/padron/issuer-prefill') return tokens.padron ?? null;
  if (path === '/v1/wsaa/issuers/revoke') return tokens.issuerRevoke ?? tokens.admin;
  return null;
}

function statusFor(code: string): number {
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.includes('IDEMPOTENCY_CONFLICT') || code.includes('PRECONDITION')) return 409;
  if (code.includes('EXPIRED')) return 410;
  if (code.includes('TOO_LARGE')) return 413;
  if (code.includes('TRANSPORT') || code.includes('HTTP_REJECTED') || code.includes('SOAP_FAULT')) return 502;
  return 400;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
