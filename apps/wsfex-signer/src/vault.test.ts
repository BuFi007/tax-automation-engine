import { expect, test } from 'bun:test';

import { HttpAuthorityPayloadVault } from './vault';

test('refuses an authority payload vault redirect', async () => {
  const vault = new HttpAuthorityPayloadVault({ baseUrl: 'https://vault.test', token: 'secret' }, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(vault.resolve('vault://payload-1')).rejects.toThrow(/^HTTP_REDIRECT_REFUSED$/);
});
