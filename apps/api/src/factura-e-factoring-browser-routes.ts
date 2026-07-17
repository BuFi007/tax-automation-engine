import {
  facturaEFactoringProjectionReadResultV1Schema,
  facturaEFactoringProjectionV1Schema,
} from '@tax-engine/browser-contracts';
import { normalizeTaxSnapshotProjectionKey, taxWorkspaceIdSchema } from '@tax-engine/core';
import { z } from 'zod';

import type { TaxBrowserSnapshotProjector } from './browser-snapshot';
import { readBoundedBody } from './bounded-body';
import type { TaxProfileStore } from './store';
import { assertTaxTenantPrincipalScope, type TaxTenantPrincipalV2 } from './tenant-principal';

const projectionCommandSchema = z.object({
  version: z.literal('factura-e-factoring-browser-projection-command-v1'),
  expectedRevision: z.number().int().positive().nullable(),
  projectedAt: z.iso.datetime({ offset: true }),
  projection: facturaEFactoringProjectionV1Schema,
}).strict();

type FactoringProjectionStore = Pick<
  TaxProfileStore,
  'latestFacturaEFactoringBrowserProjection' | 'projectFacturaEFactoringBrowserProjection'
>;

export async function handleFacturaEFactoringBrowserRoute(
  request: Request,
  url: URL,
  store: FactoringProjectionStore,
  projector: TaxBrowserSnapshotProjector | null,
  tenantPrincipal: TaxTenantPrincipalV2 | null,
): Promise<Response | null> {
  const match = url.pathname.match(
    /^\/v1\/browser\/factoring-projections\/([^/]+)(?:\/([^/]+))?$/,
  );
  if (!match || (request.method !== 'GET' && request.method !== 'POST')) return null;

  const workspaceId = taxWorkspaceIdSchema.parse(decodeURIComponent(match[1]!));
  const projectionKey = normalizeTaxSnapshotProjectionKey(
    match[2] ? decodeURIComponent(match[2]) : undefined,
  );
  assertTaxTenantPrincipalScope(tenantPrincipal, workspaceId);
  if (!projector) throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED');
  const expectedWorkspaceRef = projector.workspaceReference(workspaceId, projectionKey);

  if (request.method === 'POST') {
    const command = projectionCommandSchema.parse(JSON.parse(await readBoundedBody(
      request,
      64 * 1024,
      'FACTURA_E_FACTORING_PROJECTION_REQUEST_TOO_LARGE',
    )) as unknown);
    const result = store.projectFacturaEFactoringBrowserProjection({
      workspaceId,
      projectionKey,
      expectedWorkspaceRef,
      expectedRevision: command.expectedRevision,
      projectedAt: command.projectedAt,
      projection: command.projection,
    });
    return privateJson({ data: result }, result.replayed ? 200 : 201);
  }

  const receipt = store.latestFacturaEFactoringBrowserProjection(workspaceId, projectionKey);
  if (!receipt) {
    return privateJson(facturaEFactoringProjectionReadResultV1Schema.parse({
      state: 'unavailable',
      code: 'FACTURA_E_FACTORING_PROJECTION_NOT_FOUND',
    }), 404);
  }
  if (receipt.projection.workspaceRef !== expectedWorkspaceRef) {
    throw new Error('FACTURA_E_FACTORING_WORKSPACE_REF_MISMATCH');
  }
  return privateJson(facturaEFactoringProjectionReadResultV1Schema.parse({
    state: 'ready',
    receipt,
  }), 200);
}

function privateJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      vary: 'authorization, x-tax-tenant-principal, x-tax-tenant-signature',
    },
  });
}
