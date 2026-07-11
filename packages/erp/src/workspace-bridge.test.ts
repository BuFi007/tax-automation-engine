import { expect, test } from 'bun:test';

import { WorkspaceAccountingBridgeProvider } from './workspace-bridge';

test('workspace bridge reuses normalized connector data without credentials', async () => {
  const provider = new WorkspaceAccountingBridgeProvider({
    providerId: 'quickbooks',
    tenantId: 'tenant:1',
    sourceRevision: 'revision:1',
    observedAt: '2026-07-10T00:00:00.000Z',
    invoices: [{
      externalId: 'invoice:1',
      sourceRevision: 'revision:1',
      number: 'INV-1',
      counterpartyExternalId: 'customer:1',
      issuedAt: '2026-07-01',
      dueAt: null,
      settledAt: null,
      total: { decimal: '100', currency: 'USD' },
      taxLines: [],
      paymentExternalIds: [],
      taxDocumentExternalIds: [],
    }],
    bills: [],
    payments: [],
    taxDocuments: [],
    capabilities: ['invoices'],
  });
  const page = await provider.readInvoicesPage({ tenantId: 'tenant:1', cursor: null, limit: 50 });
  expect(page.records).toHaveLength(1);
  expect(page.checkpoint.sourceRevision).toBe('revision:1');
  expect(JSON.stringify(page)).not.toContain('token');
  await expect(provider.readInvoicesPage({ tenantId: 'other', cursor: null, limit: 50 })).rejects.toThrow('TENANT_SCOPE_MISMATCH');
});
