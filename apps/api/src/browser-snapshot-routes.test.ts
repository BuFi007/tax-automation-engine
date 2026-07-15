import { describe, expect, test } from 'bun:test';

import { buildTaxSnapshotProblemV1 } from '@tax-engine/browser-contracts';
import { argentinaTaxWidgetSnapshotReceiptV1Fixture } from '@tax-engine/browser-contracts/fixtures';

import { handleTaxBrowserSnapshotRoute } from './browser-snapshot-routes';
import type { TaxBrowserSnapshotRead } from './browser-snapshot';
import type { TaxTenantPrincipalV2 } from './tenant-principal';

const WORKSPACE_ID = '00000000-0000-4000-8000-000000000001';
const PRINCIPAL: TaxTenantPrincipalV2 = {
  version: 'tax-tenant-principal-v2',
  workspaceId: WORKSPACE_ID,
  actorId: 'user:owner',
  capability: 'snapshot:read',
  expiresAt: '2026-07-15T12:05:00.000Z',
};

describe('browser tax snapshot route', () => {
  test('returns the canonical success envelope without a legacy data wrapper', async () => {
    const response = route({
      status: 200,
      result: { ok: true, data: argentinaTaxWidgetSnapshotReceiptV1Fixture },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual({ ok: true, data: argentinaTaxWidgetSnapshotReceiptV1Fixture });
  });

  test('preserves canonical 404, 409, and 410 problem statuses and bodies', async () => {
    for (const code of [
      'TAX_SNAPSHOT_NOT_FOUND',
      'TAX_SNAPSHOT_STALE',
      'TAX_SNAPSHOT_EXPIRED',
    ] as const) {
      const problem = buildTaxSnapshotProblemV1(code);
      const response = route({ status: problem.status, result: { ok: false, problem } });
      expect(response.status).toBe(problem.status);
      expect(await response.json()).toEqual({ ok: false, problem });
    }
  });

  test('uses the existing snapshot principal and rejects cross-tenant reads', () => {
    expect(() => route({
      status: 200,
      result: { ok: true, data: argentinaTaxWidgetSnapshotReceiptV1Fixture },
    }, { ...PRINCIPAL, workspaceId: '00000000-0000-4000-8000-000000000002' })).toThrow(
      'TAX_TENANT_SCOPE_UNAUTHORIZED',
    );
  });
});

function route(read: TaxBrowserSnapshotRead, principal: TaxTenantPrincipalV2 = PRINCIPAL): Response {
  const request = new Request(
    `http://tax.test/v1/browser/snapshots/${WORKSPACE_ID}/${encodeURIComponent('annual:2026')}`,
  );
  const response = handleTaxBrowserSnapshotRoute(
    request,
    new URL(request.url),
    { read: () => read },
    principal,
  );
  if (!response) throw new Error('ROUTE_NOT_HANDLED');
  return response;
}
