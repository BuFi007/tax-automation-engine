import { expect, test } from 'bun:test';

import { refuseRedirect } from './http';

test('refuses a 3xx or opaque redirect and passes every other response through', () => {
  const ok = new Response('ok');
  expect(refuseRedirect(ok)).toBe(ok);
  expect(() => refuseRedirect(new Response(null, { status: 307, headers: { location: 'https://attacker.test/' } })))
    .toThrow('HTTP_REDIRECT_REFUSED');
  const opaque = new Response(null);
  Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
  expect(() => refuseRedirect(opaque)).toThrow('HTTP_REDIRECT_REFUSED');
});
