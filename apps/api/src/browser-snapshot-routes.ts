import { normalizeTaxSnapshotProjectionKey, taxWorkspaceIdSchema } from '@tax-engine/core';

import type { TaxBrowserSnapshotService } from './browser-snapshot';
import { assertTaxTenantPrincipalScope, type TaxTenantPrincipalV2 } from './tenant-principal';

export function handleTaxBrowserSnapshotRoute(
  request: Request,
  url: URL,
  service: Pick<TaxBrowserSnapshotService, 'read'>,
  tenantPrincipal: TaxTenantPrincipalV2 | null,
): Response | null {
  const match = url.pathname.match(/^\/v1\/browser\/snapshots\/([^/]+)(?:\/([^/]+))?$/);
  if (request.method !== 'GET' || !match) return null;
  const workspaceId = taxWorkspaceIdSchema.parse(decodeURIComponent(match[1]!));
  const projectionKey = normalizeTaxSnapshotProjectionKey(
    match[2] ? decodeURIComponent(match[2]) : undefined,
  );
  assertTaxTenantPrincipalScope(tenantPrincipal, workspaceId);
  const read = service.read(workspaceId, projectionKey);
  return Response.json(read.result, {
    status: read.status,
    headers: {
      'cache-control': 'private, no-store',
      vary: 'authorization, x-tax-tenant-principal, x-tax-tenant-signature',
    },
  });
}
