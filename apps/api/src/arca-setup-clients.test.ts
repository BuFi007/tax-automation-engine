import { expect, test } from 'bun:test';

import { HttpArcaSetupExecutorGateway } from './arca-setup-clients';

test('refuses an executor redirect as an unavailable executor', async () => {
  const gateway = new HttpArcaSetupExecutorGateway('https://executor.test', 'o'.repeat(32), 'r'.repeat(32), async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(gateway.dispatch({} as never)).rejects.toThrow(/^ARCA_SETUP_EXECUTOR_UNAVAILABLE$/);
});
