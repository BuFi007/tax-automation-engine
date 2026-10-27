import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
  WorkerEntrypoint: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));

let worker: typeof import('./worker');
beforeAll(async () => {
  worker = await import('./worker');
});

type Entrypoint = import('./worker').BoundaryEntrypoint;

const ROUTES: Readonly<Record<Entrypoint, readonly (readonly [string, string])[]>> = {
  executor: [
    ['POST', '/v1/setup/executor/taxpayer-match'],
    ['POST', '/v1/setup/executor/csr'],
    ['POST', '/v1/setup/executor/certificate'],
  ],
  signer: [
    ['POST', '/v1/authority-payloads/resolve'],
    ['POST', '/v1/wsaa/tickets'],
    ['GET', '/health'],
  ],
  admin: [
    ['POST', '/v1/wsaa/issuers'],
    ['POST', '/v1/wsaa/issuers/delegations'],
    ['POST', '/v1/wsaa/issuers/revoke'],
    ['POST', '/v1/authority-payloads/retire-eligible'],
  ],
};

/** Every route `http.ts` serves, so each entrypoint is checked against all the others. */
const ALL_ROUTES: readonly (readonly [string, string])[] = [
  ...ROUTES.executor,
  ...ROUTES.signer,
  ...ROUTES.admin,
  ['GET', '/v1/wsaa/issuers/status'],
  ['POST', '/v1/authority-payloads'],
  ['POST', '/v1/authority-payloads/revoke'],
  ['POST', '/v1/authority-payloads/terminal'],
  ['POST', '/v1/padron/issuer-prefill'],
  ['POST', '/v1/setup/sessions'],
  ['POST', '/v1/setup/sessions/enrollment'],
  ['POST', '/v1/setup/sessions/provision'],
  ['POST', '/v1/setup/sessions/status'],
];

function pathname(path: string): string {
  return new URL(`https://arca-boundary.internal${path}`).pathname;
}

describe('allowedFor', () => {
  for (const entrypoint of ['executor', 'signer', 'admin'] as const) {
    test(`${entrypoint}: exactly its own routes`, () => {
      const own = new Set(ROUTES[entrypoint].map(([method, path]) => `${method} ${path}`));
      for (const [method, path] of ALL_ROUTES)
        expect([method, path, worker.allowedFor(entrypoint, method, path)])
          .toEqual([method, path, own.has(`${method} ${path}`)]);
    });

    test(`${entrypoint}: an allowed path with another method is refused`, () => {
      for (const [method, path] of ROUTES[entrypoint]) {
        const other = method === 'POST' ? 'GET' : 'POST';
        expect(worker.allowedFor(entrypoint, other, path)).toBe(false);
      }
    });
  }

  test('encoded dot segments are judged on the normalised pathname', () => {
    // WHATWG resolves %2e%2e as `..`, exactly as http.ts sees it.
    expect(pathname('/v1/setup/executor/%2e%2e/wsaa/tickets')).toBe('/v1/setup/wsaa/tickets');
    expect(pathname('/v1/setup/executor/%2E%2E/%2E%2E/wsaa/tickets')).toBe('/v1/wsaa/tickets');
    for (const path of [
      '/v1/setup/executor/%2e%2e/wsaa/tickets',
      '/v1/setup/executor/%2E%2E/csr',
      '/v1/setup/executor/..%2fwsaa/tickets',
      '/v1/setup/executor/csr/..',
    ]) expect(worker.allowedFor('executor', 'POST', pathname(path))).toBe(false);
    // A traversal that lands on a signer route is a signer route, not an executor one.
    const landed = pathname('/v1/setup/executor/%2E%2E/%2E%2E/wsaa/tickets');
    expect(worker.allowedFor('executor', 'POST', landed)).toBe(false);
    expect(worker.allowedFor('signer', 'POST', landed)).toBe(true);
    expect(worker.allowedFor('signer', 'POST', pathname('/v1/wsaa/tickets%2f..%2fissuers'))).toBe(false);
    expect(worker.allowedFor('admin', 'POST', pathname('/v1/wsaa/issuers/%2e'))).toBe(false);
  });

  test('a trailing slash or a different case is not the route', () => {
    expect(worker.allowedFor('signer', 'POST', '/v1/wsaa/tickets/')).toBe(false);
    expect(worker.allowedFor('signer', 'GET', '/HEALTH')).toBe(false);
    expect(worker.allowedFor('admin', 'post', '/v1/wsaa/issuers')).toBe(false);
  });
});

describe('filtered entrypoints', () => {
  function env(seen: Request[]) {
    const stub = {
      async fetch(request: Request) {
        seen.push(request);
        return Response.json({ path: new URL(request.url).pathname });
      },
    };
    return {
      BOUNDARY_STATE: { idFromName: (name: string) => name, get: () => stub },
    } as unknown as import('./worker').BoundaryWorkerEnv;
  }

  test('an allowed route reaches the Durable Object, anything else is a 404 that never does', async () => {
    const seen: Request[] = [];
    const signer = new worker.SignerEntrypoint({} as never, env(seen));
    const allowed = await signer.fetch(new Request('https://arca-boundary.internal/v1/wsaa/tickets', { method: 'POST' }));
    expect(await allowed.json() as unknown).toEqual({ path: '/v1/wsaa/tickets' });

    const refused = await signer.fetch(new Request('https://arca-boundary.internal/v1/wsaa/issuers', { method: 'POST' }));
    expect(refused.status).toBe(404);
    const executor = new worker.ExecutorEntrypoint({} as never, env(seen));
    const traversal = await executor.fetch(new Request(
      'https://arca-boundary.internal/v1/setup/executor/%2e%2e/%2e%2e/wsaa/tickets', { method: 'POST' }));
    expect(traversal.status).toBe(404);
    expect(seen.map(request => new URL(request.url).pathname)).toEqual(['/v1/wsaa/tickets']);
  });
});
