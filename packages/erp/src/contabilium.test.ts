import { describe, expect, test } from 'bun:test';

import { ContabiliumSandboxProvider } from './contabilium';

describe('Contabilium conformance boundary', () => {
  test('makes no production capability claim without an authorized sandbox', async () => {
    const provider = new ContabiliumSandboxProvider(null);
    const capabilities = await provider.getImportCapabilities('tenant:unconfigured');
    expect(capabilities).toHaveLength(7);
    expect(capabilities.every(capability => capability.state === 'sandbox_required')).toBe(true);
    const page = await provider.readInvoicesPage({ tenantId: 'tenant:unconfigured', cursor: null, limit: 50 });
    expect(page.records).toEqual([]);
    expect(page.capability.safeErrorCode).toBe('AUTHORIZED_SANDBOX_REQUIRED');
  });
});
