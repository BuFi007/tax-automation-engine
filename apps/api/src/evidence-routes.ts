import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { normalizeTaxSnapshotProjectionKey, taxWorkspaceIdSchema } from '@tax-engine/core';

import type { TaxEvidenceWorkspaceService } from './evidence-workspace';
import { readBoundedBody } from './bounded-body';
import {
  assertTaxTenantPrincipalScope,
  TAX_SNAPSHOT_PROJECTOR_ACTOR_ID,
  type TaxTenantPrincipalV2,
} from './tenant-principal';

const projectionSchema = z.object({
  workspaceId: taxWorkspaceIdSchema,
  projectionKey: z.string().optional(),
  actorId: z.string().min(1).max(300),
  period: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
  displayCurrency: z.string().regex(/^[A-Z]{3}$/),
  asOf: z.iso.datetime({ offset: true }),
  dataScope: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('all_connected') }).strict(),
    z.object({
      mode: z.literal('selected'),
      sourceIds: z.array(z.string().min(1).max(300)).min(1),
      includeKnowledgeGraph: z.boolean(),
    }).strict(),
  ]),
}).strict();
const snapshotConfigurationSchema = projectionSchema
  .omit({ asOf: true, projectionKey: true })
  .extend({ expectedConfigHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() })
  .strict();

export async function handleTaxEvidenceRoute(
  request: Request,
  url: URL,
  service: TaxEvidenceWorkspaceService,
  options: Readonly<{
    evidenceIngestToken: string | null;
    consentEventToken: string | null;
    snapshotProjectorToken: string | null;
    tenantPrincipal: TaxTenantPrincipalV2 | null;
  }>,
): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/v1/evidence/consent-events') {
    requireTrustedToken(request, 'x-tax-consent-event-token', options.consentEventToken, 'EVIDENCE_CONSENT_EVENT');
    const body = await boundedJson(request, 262_144, 'EVIDENCE_CONSENT_EVENT_TOO_LARGE');
    const authority = z.object({ workspaceId: taxWorkspaceIdSchema, actorReferenceHash: z.string().regex(/^[a-f0-9]{64}$/) }).passthrough().parse(body);
    assertTaxTenantPrincipalScope(options.tenantPrincipal, authority.workspaceId, 'desk:tax-consent-authority');
    return json({ data: service.ingestConsentEvent(body) });
  }
  if (request.method === 'POST' && url.pathname === '/v1/evidence/batches') {
    requireTrustedToken(request, 'x-tax-evidence-ingest-token', options.evidenceIngestToken, 'EVIDENCE_INGEST');
    const body = await boundedJson(request, evidenceBatchMaximumBytes(), 'EVIDENCE_BATCH_TOO_LARGE');
    const envelope = z.object({ workspaceId: taxWorkspaceIdSchema }).passthrough().parse(body);
    assertTaxTenantPrincipalScope(options.tenantPrincipal, envelope.workspaceId, 'desk:tax-evidence-publisher');
    return json({ data: service.ingestBatch(body, new Date().toISOString()) });
  }
  if (request.method === 'POST' && url.pathname === '/v1/snapshots') {
    const body = projectionSchema.parse(await boundedJson(request, 262_144, 'TAX_SNAPSHOT_REQUEST_TOO_LARGE'));
    assertTaxTenantPrincipalScope(options.tenantPrincipal, body.workspaceId, body.actorId);
    const { projectionKey, ...projection } = body;
    return json({ data: await service.projectSnapshot({
      ...projection,
      ...(projectionKey === undefined ? {} : { projectionKey }),
    }) });
  }
  const configuredProjectionMatch = url.pathname.match(
    /^\/v1\/snapshot-projections\/([^/]+)(?:\/([^/]+))?$/,
  );
  if (request.method === 'POST' && configuredProjectionMatch) {
    requireTrustedToken(
      request,
      'x-tax-snapshot-projector-token',
      options.snapshotProjectorToken,
      'TAX_SNAPSHOT_PROJECTOR',
    );
    const workspaceId = taxWorkspaceIdSchema.parse(
      decodeURIComponent(configuredProjectionMatch[1]!),
    );
    const projectionKey = normalizeTaxSnapshotProjectionKey(
      configuredProjectionMatch[2]
        ? decodeURIComponent(configuredProjectionMatch[2])
        : undefined,
    );
    assertTaxTenantPrincipalScope(
      options.tenantPrincipal,
      workspaceId,
      TAX_SNAPSHOT_PROJECTOR_ACTOR_ID,
    );
    const projected = await service.projectConfiguredSnapshot({
      workspaceId,
      projectionKey,
      actorId: TAX_SNAPSHOT_PROJECTOR_ACTOR_ID,
    });
    // The unattended worker needs only a bounded commit receipt. The full
    // internal snapshot remains inside Tax and is read through the browser-safe
    // projection boundary.
    return json({
      data: {
        version: 'tax-snapshot-projection-ack-v1',
        workspaceId,
        projectionKey: projected.projectionKey,
        snapshotHash: projected.snapshotHash,
        evidenceGeneration: projected.evidenceGeneration,
        replayed: projected.replayed,
      },
    });
  }
  const configurationMatch = url.pathname.match(/^\/v1\/snapshot-configurations\/([^/]+)(?:\/([^/]+))?$/);
  if (request.method === 'GET' && configurationMatch) {
    const workspaceId = taxWorkspaceIdSchema.parse(decodeURIComponent(configurationMatch[1]!));
    const projectionKey = normalizeTaxSnapshotProjectionKey(
      configurationMatch[2] ? decodeURIComponent(configurationMatch[2]) : undefined,
    );
    assertTaxTenantPrincipalScope(options.tenantPrincipal, workspaceId);
    return json({
      data: service.getSnapshotProjectionConfiguration(workspaceId, projectionKey),
    });
  }
  if (request.method === 'PUT' && configurationMatch) {
    const body = snapshotConfigurationSchema.omit({ workspaceId: true }).parse(
      await boundedJson(request, 262_144, 'TAX_SNAPSHOT_CONFIG_REQUEST_TOO_LARGE'),
    );
    const workspaceId = taxWorkspaceIdSchema.parse(decodeURIComponent(configurationMatch[1]!));
    const projectionKey = normalizeTaxSnapshotProjectionKey(
      configurationMatch[2] ? decodeURIComponent(configurationMatch[2]) : undefined,
    );
    assertTaxTenantPrincipalScope(options.tenantPrincipal, workspaceId, body.actorId);
    return json({ data: service.configureSnapshotProjection({
      ...body,
      workspaceId,
      projectionKey,
    }) });
  }
  const snapshotMatch = url.pathname.match(/^\/v1\/snapshots\/([^/]+)(?:\/([^/]+))?$/);
  if (request.method === 'GET' && snapshotMatch && snapshotMatch[1] !== 'demo') {
    const workspaceId = taxWorkspaceIdSchema.parse(decodeURIComponent(snapshotMatch[1]!));
    const projectionKey = normalizeTaxSnapshotProjectionKey(
      snapshotMatch[2] ? decodeURIComponent(snapshotMatch[2]) : undefined,
    );
    assertTaxTenantPrincipalScope(options.tenantPrincipal, workspaceId);
    return json({ data: service.latestSnapshot(workspaceId, projectionKey) });
  }
  return null;
}

function evidenceBatchMaximumBytes(): number {
  const hardMaximumBytes = 5_242_880;
  const configured = process.env.TAX_EVIDENCE_BATCH_MAX_BYTES;
  if (configured === undefined) return hardMaximumBytes;
  const maximumBytes = Number(configured);
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > hardMaximumBytes) {
    throw new Error('EVIDENCE_BATCH_LIMIT_CONFIGURATION_INVALID');
  }
  return maximumBytes;
}

function requireTrustedToken(request: Request, header: string, expected: string | null, purpose: string): void {
  if (!expected) throw new Error(`${purpose}_CONFIGURATION_REQUIRED`);
  const actual = request.headers.get(header);
  if (!actual || !constantTimeEqual(actual, expected)) throw new Error(`${purpose}_UNAUTHORIZED`);
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

async function boundedJson(request: Request, maximumBytes: number, errorCode: string): Promise<unknown> {
  const raw = await readBoundedBody(request, maximumBytes, errorCode);
  return JSON.parse(raw) as unknown;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
