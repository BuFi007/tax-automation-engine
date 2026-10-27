/**
 * Cloudflare Worker entry for the ARCA boundary. Every request runs inside one
 * SQLite-backed Durable Object (`BoundaryState`). The Worker has no public
 * surface: callers reach it only through Service Bindings, each to an
 * entrypoint that forwards an allowlisted set of routes. The Bun entry is
 * `index.ts`.
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';

import { createBoundary, type Boundary } from './app';

export type BoundaryWorkerEnv = Readonly<{
  BOUNDARY_STATE: DurableObjectNamespace<BoundaryState>;
}> & Readonly<Record<string, unknown>>;

export type BoundaryEntrypoint = 'executor' | 'signer' | 'admin';

const ALLOWED_ROUTES: Readonly<Record<BoundaryEntrypoint, ReadonlySet<string>>> = {
  executor: new Set([
    'POST /v1/setup/executor/taxpayer-match',
    'POST /v1/setup/executor/csr',
    'POST /v1/setup/executor/certificate',
  ]),
  signer: new Set([
    'POST /v1/authority-payloads/resolve',
    'POST /v1/wsaa/tickets',
    'GET /health',
  ]),
  admin: new Set([
    'POST /v1/wsaa/issuers',
    'POST /v1/wsaa/issuers/delegations',
    'POST /v1/wsaa/issuers/revoke',
    'POST /v1/authority-payloads/retire-eligible',
  ]),
};

/**
 * Whether a filtered entrypoint forwards this route. `pathname` must be
 * `new URL(request.url).pathname`, which is what `http.ts` routes on, so dot
 * segments (`%2e%2e` included) are already resolved and the decision matches
 * the route the boundary would serve.
 */
export function allowedFor(entrypoint: BoundaryEntrypoint, method: string, pathname: string): boolean {
  return ALLOWED_ROUTES[entrypoint].has(`${method} ${pathname}`);
}

function primary(env: BoundaryWorkerEnv): DurableObjectStub<BoundaryState> {
  return env.BOUNDARY_STATE.get(env.BOUNDARY_STATE.idFromName('primary'));
}

function forwardIfAllowed(entrypoint: BoundaryEntrypoint, request: Request, env: BoundaryWorkerEnv): Promise<Response> | Response {
  if (!allowedFor(entrypoint, request.method, new URL(request.url).pathname))
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  return primary(env).fetch(request);
}

export class BoundaryState extends DurableObject<BoundaryWorkerEnv> {
  #boundary: Boundary | null = null;

  override fetch(request: Request): Response | Promise<Response> {
    this.#boundary ??= createBoundary({
      env: Object.fromEntries(
        Object.entries(this.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ),
      database: new DurableObjectSqlDatabase(this.ctx.storage),
    });
    return this.#boundary.fetch(request);
  }
}

/** Bound by `arca-setup-executor`: the three setup executor routes only. */
export class ExecutorEntrypoint extends WorkerEntrypoint<BoundaryWorkerEnv> {
  override fetch(request: Request): Promise<Response> | Response {
    return forwardIfAllowed('executor', request, this.env);
  }
}

/** Bound by both signers: payload resolution, WSAA tickets and the broker health. */
export class SignerEntrypoint extends WorkerEntrypoint<BoundaryWorkerEnv> {
  override fetch(request: Request): Promise<Response> | Response {
    return forwardIfAllowed('signer', request, this.env);
  }
}

/** Bound by the Tax API, which exposes it only through its token-gated operator proxy. */
export class AdminEntrypoint extends WorkerEntrypoint<BoundaryWorkerEnv> {
  override fetch(request: Request): Promise<Response> | Response {
    return forwardIfAllowed('admin', request, this.env);
  }
}

/** Default entrypoint, bound by the Tax API: every boundary route. */
export default {
  fetch(request: Request, env: BoundaryWorkerEnv): Promise<Response> {
    return primary(env).fetch(request);
  },
} satisfies ExportedHandler<BoundaryWorkerEnv>;
