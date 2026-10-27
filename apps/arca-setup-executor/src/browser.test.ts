import { expect, mock, test } from 'bun:test';

// @cloudflare/playwright only loads inside workerd; the Live View call needs none of it.
mock.module('@cloudflare/playwright', () => ({ acquire: () => undefined, connect: () => undefined, sessions: () => undefined }));
const { readonlyLiveViewUrl } = await import('./browser');

test('refuses a Live View API redirect', async () => {
  const redirect = (async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } })) as unknown as typeof fetch;
  await expect(readonlyLiveViewUrl({ accountId: 'account', apiToken: 'token' }, 'session', 'target', redirect))
    .rejects.toThrow(/^HTTP_REDIRECT_REFUSED$/);
});
