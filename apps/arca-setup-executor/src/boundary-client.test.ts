import { expect, test } from 'bun:test';

import { HttpBoundaryExecutorClient } from './boundary-client';

test('refuses a boundary redirect as an unavailable boundary', async () => {
  const client = new HttpBoundaryExecutorClient('https://boundary.test', 'e'.repeat(32), async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(client.readCsr({} as never)).rejects.toThrow(/^ARCA_BOUNDARY_UNAVAILABLE$/);
});
