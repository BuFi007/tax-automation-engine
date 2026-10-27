import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(readonly ctx: unknown, readonly env: unknown) {}
  },
}));

let worker: typeof import('./worker');
beforeAll(async () => {
  worker = await import('./worker');
});

function fakeAlarmStorage(pending: number | null) {
  const calls: string[] = [];
  let alarm = pending;
  return {
    calls,
    get alarm() { return alarm; },
    async getAlarm() { calls.push('get'); return alarm; },
    async setAlarm(time: number) { calls.push(`set:${time}`); alarm = time; },
    async deleteAlarm() { calls.push('delete'); alarm = null; },
  };
}

describe('work-driven alarm', () => {
  test('no pending work deletes the alarm and never sets one', async () => {
    const storage = fakeAlarmStorage(5_000);
    expect(await worker.rescheduleAlarm(storage, { nextWakeAt: () => null }, 1_000)).toBeNull();
    expect(storage.calls).toEqual(['delete']);
    expect(storage.alarm).toBeNull();
  });

  test('pending work with no alarm sets it at the earliest wake', async () => {
    const storage = fakeAlarmStorage(null);
    expect(await worker.rescheduleAlarm(storage, { nextWakeAt: now => now + 30_000 }, 1_000)).toBe(31_000);
    expect(storage.calls).toEqual(['get', 'set:31000']);
  });

  test('an earlier pending alarm is kept, a later one is moved forward', async () => {
    const earlier = fakeAlarmStorage(10_000);
    await worker.rescheduleAlarm(earlier, { nextWakeAt: () => 20_000 }, 1_000);
    expect(earlier.calls).toEqual(['get']);
    expect(earlier.alarm).toBe(10_000);

    const later = fakeAlarmStorage(90_000);
    await worker.rescheduleAlarm(later, { nextWakeAt: () => 20_000 }, 1_000);
    expect(later.calls).toEqual(['get', 'set:20000']);
  });
});

describe('operator proxy', () => {
  const TOKEN = 'operator-proxy-token-for-tests-0123456789';
  function recordingFetcher(name: string, seen: Request[]) {
    return {
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const request = new Request(input, init);
        seen.push(request);
        return Response.json({ target: name, path: new URL(request.url).pathname });
      },
    } as unknown as Fetcher;
  }
  function env(seen: Request[], extra: Record<string, unknown> = {}) {
    return {
      ARCA_BOUNDARY_ADMIN: recordingFetcher('boundary-admin', seen),
      WSFE_SIGNER: recordingFetcher('wsfe', seen),
      WSFEX_SIGNER: recordingFetcher('wsfex', seen),
      TAX_OPERATOR_PROXY_TOKEN: TOKEN,
      ...extra,
    };
  }
  function request(path: string, init: RequestInit = {}, token: string | null = TOKEN) {
    const headers = new Headers(init.headers);
    if (token !== null) headers.set('x-bufi-operator-token', token);
    return new Request(`https://tax.example.test${path}`, { ...init, headers });
  }

  test('paths outside the prefix are not handled', async () => {
    const seen: Request[] = [];
    expect(await worker.operatorProxy(request('/health'), env(seen))).toBeNull();
    expect(await worker.operatorProxy(request('/v1/operator'), env(seen))).toBeNull();
    expect(seen).toEqual([]);
  });

  test('a missing or wrong token is refused with 401 before any forward', async () => {
    const seen: Request[] = [];
    for (const token of [null, '', 'wrong-token-of-sufficient-length-0123456789']) {
      const response = await worker.operatorProxy(
        request('/v1/operator/arca-boundary/v1/wsaa/issuers', { method: 'POST', body: '{}' }, token),
        env(seen),
      );
      expect(response?.status).toBe(401);
    }
    expect(seen).toEqual([]);
  });

  test('the proxy is off when its token is missing, short or shared with another secret', async () => {
    const seen: Request[] = [];
    for (const extra of [
      { TAX_OPERATOR_PROXY_TOKEN: undefined },
      { TAX_OPERATOR_PROXY_TOKEN: 'short' },
      { TAX_ENGINE_API_KEY: TOKEN },
    ]) {
      const response = await worker.operatorProxy(
        request('/v1/operator/arca-boundary/v1/wsaa/issuers', { method: 'POST', body: '{}' }),
        env(seen, extra),
      );
      expect(response?.status).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  test('forwards only the four admin routes to the boundary admin entrypoint, without the proxy token', async () => {
    for (const route of [
      '/v1/wsaa/issuers',
      '/v1/wsaa/issuers/delegations',
      '/v1/wsaa/issuers/revoke',
      '/v1/authority-payloads/retire-eligible',
    ]) {
      const seen: Request[] = [];
      const response = await worker.operatorProxy(
        request(`/v1/operator/arca-boundary${route}?x=1`, {
          method: 'POST', body: '{"a":1}', headers: { authorization: 'Bearer boundary-admin' },
        }),
        env(seen),
      );
      expect(response?.status).toBe(200);
      expect(await response!.json() as unknown).toEqual({ target: 'boundary-admin', path: route });
      expect(seen).toHaveLength(1);
      expect(new URL(seen[0]!.url).search).toBe('');
      expect(seen[0]!.method).toBe('POST');
      expect(seen[0]!.headers.get('authorization')).toBe('Bearer boundary-admin');
      expect(seen[0]!.headers.get('x-bufi-operator-token')).toBeNull();
      expect(await seen[0]!.text()).toBe('{"a":1}');
    }
  });

  test('forwards a GET /health to each signer', async () => {
    for (const [signer, target] of [['wsfe-signer', 'wsfe'], ['wsfex-signer', 'wsfex']] as const) {
      const seen: Request[] = [];
      const response = await worker.operatorProxy(request(`/v1/operator/${signer}/health`), env(seen));
      expect(await response!.json() as unknown).toEqual({ target, path: '/health' });
    }
  });

  test('every other path or method under the prefix is 404 and never forwarded', async () => {
    const seen: Request[] = [];
    for (const [path, method] of [
      ['/v1/operator/arca-boundary/v1/wsaa/tickets', 'POST'],
      ['/v1/operator/arca-boundary/v1/authority-payloads/resolve', 'POST'],
      ['/v1/operator/arca-boundary/v1/setup/executor/csr', 'POST'],
      ['/v1/operator/arca-boundary/health', 'GET'],
      ['/v1/operator/arca-boundary/v1/wsaa/issuers', 'GET'],
      ['/v1/operator/arca-boundary/v1/wsaa/issuers/status', 'GET'],
      ['/v1/operator/wsfe-signer/health', 'POST'],
      ['/v1/operator/wsfe-signer/v1/invoices', 'POST'],
      ['/v1/operator/wsfex-signer/', 'GET'],
      ['/v1/operator/unknown/health', 'GET'],
    ] as const) {
      const response = await worker.operatorProxy(
        request(path, method === 'POST' ? { method, body: '{}' } : { method }),
        env(seen),
      );
      expect(response?.status).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  test('encoded dot segments are resolved before the decision and cannot escape the prefix', async () => {
    const seen: Request[] = [];
    for (const path of [
      '/v1/operator/arca-boundary/v1/wsaa/issuers/%2e%2e/tickets',
      '/v1/operator/arca-boundary/v1/wsaa/issuers/%2E%2E/tickets',
      '/v1/operator/arca-boundary/v1/wsaa/issuers/..%2ftickets',
      '/v1/operator/arca-boundary/v1/wsaa/issuers/%2e%2e%2ftickets',
      '/v1/operator/arca-boundary/%2e%2e/wsfe-signer/health',
    ]) {
      const response = await worker.operatorProxy(request(path, { method: 'POST', body: '{}' }), env(seen));
      expect(response?.status).toBe(404);
    }
    // Climbing out of the prefix leaves the proxy entirely.
    const escaped = await worker.operatorProxy(
      request('/v1/operator/%2e%2e/%2e%2e/v1/wsaa/issuers', { method: 'POST', body: '{}' }),
      env(seen),
    );
    expect(escaped).toBeNull();
    expect(seen).toEqual([]);
  });
});

describe('Tax API on a Durable Object database', () => {
  test('an idle API asks for no alarm, so the Durable Object can be evicted', async () => {
    const { createTaxApi } = await import('./app');
    const { DurableObjectSqlDatabase } = await import('@tax-engine/sql-store/durable-object');
    const { createFakeDurableObjectStorage } = await import('@tax-engine/sql-store/testing');
    const storage = createFakeDurableObjectStorage();
    try {
      const database = new DurableObjectSqlDatabase(storage);
      const api = createTaxApi({ env: { ARCA_ENVIRONMENT: 'homologation' }, openDatabase: () => database });
      expect(api.nextWakeAt(Date.now())).toBeNull();
      const health = await api.fetch(new Request('https://tax.example.test/health'));
      expect(health.status).toBe(200);
      const alarms = fakeAlarmStorage(null);
      expect(await worker.rescheduleAlarm(alarms, api, Date.now())).toBeNull();
      expect(alarms.alarm).toBeNull();
    } finally {
      storage.close();
    }
  });
});
