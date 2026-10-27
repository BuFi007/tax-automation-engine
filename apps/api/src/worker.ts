/**
 * Cloudflare Worker entry for the Tax API. Every request runs inside one
 * SQLite-backed Durable Object (`TaxState`), so the stores keep today's
 * single-writer, synchronous semantics. The Bun entry is `index.ts`.
 */
import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';

import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';

import { createTaxApi, type ServiceFetcher, type TaxApi } from './app';

export type TaxWorkerEnv = Readonly<{
  TAX_STATE: DurableObjectNamespace<TaxState>;
  ARCA_BOUNDARY: Fetcher;
  ARCA_BOUNDARY_ADMIN: Fetcher;
  WSFE_SIGNER: Fetcher;
  WSFEX_SIGNER: Fetcher;
  /** Bound in the second deploy pass; absent until the executor exists. */
  ARCA_SETUP_EXECUTOR?: Fetcher;
  TAX_OPERATOR_PROXY_TOKEN?: string;
}> & Readonly<Record<string, unknown>>;

/** The alarm calls of `ctx.storage` that `rescheduleAlarm` uses. */
export type AlarmStorage = Readonly<{
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}>;

/**
 * Work-driven alarm: none while no loop has work, otherwise the earliest wake.
 * A pending alarm that is already earlier stays; the alarm is never set
 * unconditionally, so an idle Durable Object is evicted and bills nothing.
 */
export async function rescheduleAlarm(
  storage: AlarmStorage,
  app: Pick<TaxApi, 'nextWakeAt'>,
  now: number,
): Promise<number | null> {
  const wakeAt = app.nextWakeAt(now);
  if (wakeAt === null) {
    await storage.deleteAlarm();
    return null;
  }
  const pending = await storage.getAlarm();
  if (pending === null || pending > wakeAt) await storage.setAlarm(wakeAt);
  return wakeAt;
}

const OPERATOR_PREFIX = '/v1/operator/';
const OPERATOR_TOKEN_HEADER = 'x-bufi-operator-token';
const BOUNDARY_ADMIN_ROUTES = new Set([
  '/v1/wsaa/issuers',
  '/v1/wsaa/issuers/delegations',
  '/v1/wsaa/issuers/revoke',
  '/v1/authority-payloads/retire-eligible',
]);

export type OperatorProxyEnv = Pick<TaxWorkerEnv, 'ARCA_BOUNDARY_ADMIN' | 'WSFE_SIGNER' | 'WSFEX_SIGNER'>
  & Readonly<Record<string, unknown>>;

/**
 * Operator access that replaces the VM's private network. Only
 * `/v1/operator/arca-boundary/<admin route>` (POST) and
 * `/v1/operator/{wsfe,wsfex}-signer/health` (GET) are forwarded, and only with
 * `x-bufi-operator-token`. The target still checks its own bearer token.
 * Returns `null` for every path outside the prefix. The decision is made on
 * the parsed pathname, so dot segments (`%2e%2e` included) are resolved first.
 */
export async function operatorProxy(request: Request, env: OperatorProxyEnv): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(OPERATOR_PREFIX)) return null;
  const expected = env.TAX_OPERATOR_PROXY_TOKEN;
  if (typeof expected !== 'string' || expected.length < 32
    || Object.entries(env).some(([name, value]) => name !== 'TAX_OPERATOR_PROXY_TOKEN' && value === expected))
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  if (!sameSecret(request.headers.get(OPERATOR_TOKEN_HEADER) ?? '', expected))
    return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });

  const rest = url.pathname.slice(OPERATOR_PREFIX.length - 1);
  let target: Fetcher;
  let forwardUrl: string;
  if (rest.startsWith('/arca-boundary/') && request.method === 'POST'
    && BOUNDARY_ADMIN_ROUTES.has(rest.slice('/arca-boundary'.length))) {
    target = env.ARCA_BOUNDARY_ADMIN;
    forwardUrl = `https://arca-boundary.internal${rest.slice('/arca-boundary'.length)}`;
  } else if (request.method === 'GET' && rest === '/wsfe-signer/health') {
    target = env.WSFE_SIGNER;
    forwardUrl = 'https://wsfe-signer.internal/health';
  } else if (request.method === 'GET' && rest === '/wsfex-signer/health') {
    target = env.WSFEX_SIGNER;
    forwardUrl = 'https://wsfex-signer.internal/health';
  } else {
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }
  const forwarded = new Request(forwardUrl, request);
  forwarded.headers.delete(OPERATOR_TOKEN_HEADER);
  return target.fetch(forwarded);
}

function sameSecret(actual: string, expected: string): boolean {
  const a = createHash('sha256').update(actual).digest();
  const b = createHash('sha256').update(expected).digest();
  return actual.length > 0 && timingSafeEqual(a, b);
}

function primary(env: TaxWorkerEnv): DurableObjectStub<TaxState> {
  return env.TAX_STATE.get(env.TAX_STATE.idFromName('primary'));
}

export class TaxState extends DurableObject<TaxWorkerEnv> {
  #app: TaxApi | null = null;
  #database: DurableObjectSqlDatabase | null = null;

  #api(): TaxApi {
    if (this.#app) return this.#app;
    const env = this.env;
    const strings = Object.fromEntries(
      Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
    const fetchers: Record<string, ServiceFetcher> = {
      boundary: env.ARCA_BOUNDARY,
      wsfe: env.WSFE_SIGNER,
      wsfex: env.WSFEX_SIGNER,
      ...(env.ARCA_SETUP_EXECUTOR ? { executor: env.ARCA_SETUP_EXECUTOR } : {}),
    };
    this.#app = createTaxApi({
      env: strings,
      openDatabase: () => (this.#database ??= new DurableObjectSqlDatabase(this.ctx.storage)),
      fetchers,
    });
    return this.#app;
  }

  override async fetch(request: Request): Promise<Response> {
    const response = await this.#api().fetch(request);
    // A request can enqueue outbox rows or open a setup session.
    await this.reschedule();
    return response;
  }

  override async alarm(): Promise<void> {
    await this.#api().tick();
    await this.reschedule();
  }

  async reschedule(): Promise<void> {
    await rescheduleAlarm(this.ctx.storage, this.#api(), Date.now());
  }
}

export default {
  async fetch(request: Request, env: TaxWorkerEnv): Promise<Response> {
    return (await operatorProxy(request, env)) ?? primary(env).fetch(request);
  },
  /** Hourly watchdog: alarms are durable, this only covers a lost reschedule. */
  async scheduled(_controller: ScheduledController, env: TaxWorkerEnv): Promise<void> {
    await primary(env).reschedule();
  },
} satisfies ExportedHandler<TaxWorkerEnv>;
