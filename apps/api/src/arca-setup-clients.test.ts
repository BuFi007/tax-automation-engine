import { expect, test } from 'bun:test';

import { HttpArcaSetupExecutorGateway } from './arca-setup-clients';

test('refuses an executor redirect as an unavailable executor', async () => {
  const gateway = new HttpArcaSetupExecutorGateway('https://executor.test', 'o'.repeat(32), 'r'.repeat(32), async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(gateway.dispatch({} as never)).rejects.toThrow(/^ARCA_SETUP_EXECUTOR_UNAVAILABLE$/);
});

test('fromEnvironment sends executor calls through the injected service binding', async () => {
  const saved = { url: process.env.ARCA_SETUP_EXECUTOR_URL, order: process.env.ARCA_SETUP_ORDER_SECRET, receipt: process.env.ARCA_SETUP_RECEIPT_SECRET };
  process.env.ARCA_SETUP_EXECUTOR_URL = 'https://arca-setup-executor.internal';
  process.env.ARCA_SETUP_ORDER_SECRET = 'o'.repeat(32);
  process.env.ARCA_SETUP_RECEIPT_SECRET = 'r'.repeat(32);
  try {
    const urls: string[] = [];
    const gateway = HttpArcaSetupExecutorGateway.fromEnvironment(async input => {
      urls.push(String(input));
      return Response.json({}, { status: 202 });
    });
    expect(await gateway!.dispatch({ executionId: 'e' } as never)).toBe('accepted');
    expect(urls).toEqual(['https://arca-setup-executor.internal/v1/orders']);
  } finally {
    for (const [name, value] of [['ARCA_SETUP_EXECUTOR_URL', saved.url], ['ARCA_SETUP_ORDER_SECRET', saved.order], ['ARCA_SETUP_RECEIPT_SECRET', saved.receipt]] as const)
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
