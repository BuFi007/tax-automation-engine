import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  facturaEFactoringProjectionReadResultV1Schema,
  facturaEFactoringProjectionV1Schema,
} from '@tax-engine/browser-contracts';
import { facturaENeedsConsentProjectionV1Fixture } from '@tax-engine/browser-contracts/fixtures';

import { TaxBrowserSnapshotProjector } from './browser-snapshot';
import { handleFacturaEFactoringBrowserRoute } from './factura-e-factoring-browser-routes';
import { TaxProfileStore } from './store';
import type { TaxTenantPrincipalV2 } from './tenant-principal';

const WORKSPACE_ID = 'workspace:factoring-browser-1';
const PROJECTION_KEY = 'annual:2026';
const PROJECTED_AT = '2026-07-16T12:00:00.000Z';
const projector = new TaxBrowserSnapshotProjector('factoring-browser-reference-secret-000001');

function principal(
  workspaceId = WORKSPACE_ID,
  capability: TaxTenantPrincipalV2['capability'] = 'snapshot:project',
): TaxTenantPrincipalV2 {
  return {
    version: 'tax-tenant-principal-v2',
    workspaceId,
    actorId: capability === 'snapshot:project' ? 'desk:factoring-projector' : 'user:factoring-reader',
    capability,
    expiresAt: '2026-07-16T12:05:00.000Z',
  };
}

function projection(snapshotRevision = 'snapshot:factoring_browser_2026_v1') {
  return facturaEFactoringProjectionV1Schema.parse({
    ...structuredClone(facturaENeedsConsentProjectionV1Fixture),
    workspaceRef: projector.workspaceReference(WORKSPACE_ID, PROJECTION_KEY),
    cacheIdentity: {
      ...facturaENeedsConsentProjectionV1Fixture.cacheIdentity,
      projectionKey: PROJECTION_KEY,
      snapshotRevision,
    },
  });
}

function command(value = projection(), expectedRevision: number | null = null) {
  return {
    version: 'factura-e-factoring-browser-projection-command-v1',
    expectedRevision,
    projectedAt: PROJECTED_AT,
    projection: value,
  } as const;
}

describe('durable Factura E factoring browser projection', () => {
  test('persists once, replays exactly, and returns a tenant-scoped no-store receipt', async () => {
    const store = new TaxProfileStore(':memory:');
    try {
      const url = new URL(`http://tax.test/v1/browser/factoring-projections/${encodeURIComponent(WORKSPACE_ID)}/${PROJECTION_KEY}`);
      const first = await handleFacturaEFactoringBrowserRoute(
        new Request(url, { method: 'POST', body: JSON.stringify(command()) }),
        url,
        store,
        projector,
        principal(),
      );
      expect(first?.status).toBe(201);
      expect(first?.headers.get('cache-control')).toBe('private, no-store');
      expect((await first?.json() as any).data).toMatchObject({ replayed: false, receipt: { revision: 1 } });

      const replay = await handleFacturaEFactoringBrowserRoute(
        new Request(url, { method: 'POST', body: JSON.stringify(command()) }),
        url,
        store,
        projector,
        principal(),
      );
      expect(replay?.status).toBe(200);
      expect((await replay?.json() as any).data).toMatchObject({ replayed: true, receipt: { revision: 1 } });

      const read = await handleFacturaEFactoringBrowserRoute(
        new Request(url),
        url,
        store,
        projector,
        principal(WORKSPACE_ID, 'snapshot:read'),
      );
      expect(read?.status).toBe(200);
      expect(facturaEFactoringProjectionReadResultV1Schema.parse(await read?.json())).toMatchObject({
        state: 'ready',
        receipt: { revision: 1, projection: { state: 'needs_consent' } },
      });
    } finally {
      store.close();
    }
  });

  test('requires OCC, a new source revision, and monotonic projection time', () => {
    const store = new TaxProfileStore(':memory:');
    try {
      const first = store.projectFacturaEFactoringBrowserProjection({
        workspaceId: WORKSPACE_ID,
        projectionKey: PROJECTION_KEY,
        expectedWorkspaceRef: projector.workspaceReference(WORKSPACE_ID, PROJECTION_KEY),
        expectedRevision: null,
        projectedAt: PROJECTED_AT,
        projection: projection(),
      });
      expect(first.receipt.revision).toBe(1);
      expect(() => store.projectFacturaEFactoringBrowserProjection({
        workspaceId: WORKSPACE_ID,
        projectionKey: PROJECTION_KEY,
        expectedWorkspaceRef: projector.workspaceReference(WORKSPACE_ID, PROJECTION_KEY),
        expectedRevision: null,
        projectedAt: '2026-07-16T12:01:00.000Z',
        projection: projection('snapshot:factoring_browser_2026_v2'),
      })).toThrow('FACTURA_E_FACTORING_PROJECTION_VERSION_CONFLICT');
      expect(() => store.projectFacturaEFactoringBrowserProjection({
        workspaceId: WORKSPACE_ID,
        projectionKey: PROJECTION_KEY,
        expectedWorkspaceRef: projector.workspaceReference(WORKSPACE_ID, PROJECTION_KEY),
        expectedRevision: 1,
        projectedAt: '2026-07-16T11:59:59.000Z',
        projection: projection('snapshot:factoring_browser_2026_v2'),
      })).toThrow('FACTURA_E_FACTORING_PROJECTION_STALE');
      expect(() => store.projectFacturaEFactoringBrowserProjection({
        workspaceId: WORKSPACE_ID,
        projectionKey: PROJECTION_KEY,
        expectedWorkspaceRef: projector.workspaceReference(WORKSPACE_ID, PROJECTION_KEY),
        expectedRevision: 1,
        projectedAt: '2026-07-16T12:01:00.000Z',
        projection: facturaEFactoringProjectionV1Schema.parse({
          ...projection('snapshot:factoring_browser_2026_v3'),
          cacheIdentity: {
            ...projection('snapshot:factoring_browser_2026_v3').cacheIdentity,
            caseRevision: 1,
          },
        }),
      })).toThrow('FACTURA_E_FACTORING_CASE_REVISION_STALE');
    } finally {
      store.close();
    }
  });

  test('fails closed on cross-workspace reads, forged refs, and missing projections', async () => {
    const store = new TaxProfileStore(':memory:');
    try {
      const url = new URL(`http://tax.test/v1/browser/factoring-projections/${encodeURIComponent(WORKSPACE_ID)}/${PROJECTION_KEY}`);
      await expect(handleFacturaEFactoringBrowserRoute(
        new Request(url),
        url,
        store,
        projector,
        principal('workspace:other', 'snapshot:read'),
      )).rejects.toThrow('TAX_TENANT_SCOPE_UNAUTHORIZED');

      const missing = await handleFacturaEFactoringBrowserRoute(
        new Request(url),
        url,
        store,
        projector,
        principal(WORKSPACE_ID, 'snapshot:read'),
      );
      expect(missing?.status).toBe(404);
      expect(await missing?.json()).toEqual({
        state: 'unavailable',
        code: 'FACTURA_E_FACTORING_PROJECTION_NOT_FOUND',
      });

      const forged = { ...projection(), workspaceRef: 'workspace:forged' };
      await expect(handleFacturaEFactoringBrowserRoute(
        new Request(url, { method: 'POST', body: JSON.stringify(command(forged)) }),
        url,
        store,
        projector,
        principal(),
      )).rejects.toThrow('FACTURA_E_FACTORING_WORKSPACE_REF_MISMATCH');
    } finally {
      store.close();
    }
  });

  test('survives a process restart without changing the receipt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tax-factoring-browser-'));
    const databasePath = join(directory, 'tax.sqlite');
    try {
      const first = new TaxProfileStore(databasePath);
      const saved = first.projectFacturaEFactoringBrowserProjection({
        workspaceId: WORKSPACE_ID,
        projectionKey: PROJECTION_KEY,
        expectedWorkspaceRef: projector.workspaceReference(WORKSPACE_ID, PROJECTION_KEY),
        expectedRevision: null,
        projectedAt: PROJECTED_AT,
        projection: projection(),
      }).receipt;
      first.close();

      const restarted = new TaxProfileStore(databasePath);
      expect(restarted.latestFacturaEFactoringBrowserProjection(WORKSPACE_ID, PROJECTION_KEY))
        .toEqual(saved);
      restarted.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
