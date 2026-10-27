import { afterEach, expect, test } from 'bun:test';

import { boundaryExecutorClient, postReceipt, requireServiceBindings, type ServiceBindingEnv } from './bindings';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function binding(calls: Request[], respond: () => Response = () => Response.json({})) {
  return { fetch: async (input: RequestInfo | URL, init?: RequestInit) => { calls.push(new Request(input, init)); return respond(); } } as unknown as Fetcher;
}

function env(boundaryCalls: Request[], taxCalls: Request[]): ServiceBindingEnv {
  return {
    ARCA_BOUNDARY: binding(boundaryCalls, () => Response.json({
      version: 'arca-setup-csr-v1', csrPem: '-----BEGIN CERTIFICATE REQUEST-----', csrHash: 'a'.repeat(64), alias: 'bufi',
    })),
    TAX: binding(taxCalls),
    ARCA_BOUNDARY_URL: 'https://arca-boundary.internal',
    TAX_RECEIPT_URL: 'https://tax-api.internal/v1/arca-setup/receipts',
    ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN: 'e'.repeat(32),
  };
}

test('boundary calls go through the ARCA_BOUNDARY binding, never the global fetch', async () => {
  globalThis.fetch = (async () => { throw new Error('GLOBAL_FETCH_USED'); }) as unknown as typeof fetch;
  const boundaryCalls: Request[] = [];
  await boundaryExecutorClient(env(boundaryCalls, [])).readCsr({} as never);
  expect(boundaryCalls).toHaveLength(1);
  expect(boundaryCalls[0]!.url).toBe('https://arca-boundary.internal/v1/setup/executor/csr');
  expect(boundaryCalls[0]!.headers.get('authorization')).toBe(`Bearer ${'e'.repeat(32)}`);
});

test('receipts go through the TAX binding at the receipt path, never the global fetch', async () => {
  globalThis.fetch = (async () => { throw new Error('GLOBAL_FETCH_USED'); }) as unknown as typeof fetch;
  const taxCalls: Request[] = [];
  const response = await postReceipt(env([], taxCalls), { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
  expect(response.ok).toBe(true);
  expect(taxCalls).toHaveLength(1);
  expect(new URL(taxCalls[0]!.url).pathname).toBe('/v1/arca-setup/receipts');
  expect(taxCalls[0]!.method).toBe('POST');
});

test('a receipt redirect from the Tax API is refused', async () => {
  const redirecting = { ...env([], []), TAX: binding([], () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } })) };
  await expect(postReceipt(redirecting, { method: 'POST', body: '{}' })).rejects.toThrow(/^HTTP_REDIRECT_REFUSED$/);
});

test('missing service bindings are a configuration error', () => {
  const complete = env([], []);
  expect(() => requireServiceBindings(complete)).not.toThrow();
  expect(() => requireServiceBindings({ ...complete, ARCA_BOUNDARY: undefined as never })).toThrow('ARCA_SETUP_EXECUTOR_CONFIGURATION_REQUIRED');
  expect(() => requireServiceBindings({ ...complete, TAX: undefined as never })).toThrow('ARCA_SETUP_EXECUTOR_CONFIGURATION_REQUIRED');
});
