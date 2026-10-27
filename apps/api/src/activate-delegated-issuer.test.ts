import { describe, expect, test } from 'bun:test';

import { post, underBase } from './activate-delegated-issuer';

describe('delegated issuer activation URLs', () => {
  test('keeps the operator-proxy path of the boundary base', () => {
    const route = 'v1/wsaa/issuers/delegations';
    expect(underBase(route, new URL('https://tax.example.test/v1/operator/arca-boundary')).href)
      .toBe('https://tax.example.test/v1/operator/arca-boundary/v1/wsaa/issuers/delegations');
    expect(underBase(route, new URL('https://tax.example.test/v1/operator/arca-boundary/')).href)
      .toBe('https://tax.example.test/v1/operator/arca-boundary/v1/wsaa/issuers/delegations');
    expect(underBase(route, new URL('https://boundary.example.test')).href)
      .toBe('https://boundary.example.test/v1/wsaa/issuers/delegations');
  });
});

test('refuses a redirect from a real Bun fetch instead of following it', async () => {
  let followed = false;
  const server = Bun.serve({
    port: 0,
    fetch: request => new URL(request.url).pathname === '/next'
      ? (followed = true, Response.json({}))
      : new Response(null, { status: 302, headers: { location: '/next' } }),
  });
  try {
    await expect(post(new URL(`http://localhost:${server.port}/step`), 'token', {})).rejects.toThrow(/^HTTP_REDIRECT_REFUSED$/);
    expect(followed).toBe(false);
  } finally {
    await server.stop(true);
  }
});
