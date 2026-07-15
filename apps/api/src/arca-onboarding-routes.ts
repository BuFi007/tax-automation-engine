import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { ManualArcaOnboardingCommand, ArcaOnboardingService } from './arca-onboarding';
import { readBoundedBody } from './bounded-body';
import {
  assertTaxTenantPrincipalScope,
  type TaxTenantPrincipalV2,
} from './tenant-principal';

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencySchema = z.string().min(8).max(200);
const actorSchema = z.string().min(1).max(200);
const pointOfSaleSchema = z.number().int().positive().max(99_999);
const baseMutationSchema = {
  actorId: actorSchema,
  idempotencyKey: idempotencySchema,
};

export async function handleArcaOnboardingRoute(
  request: Request,
  url: URL,
  service: ArcaOnboardingService,
  options: Readonly<{
    userApprovalToken: string | null;
    evidenceIngestToken: string | null;
    tenantPrincipal?: TaxTenantPrincipalV2 | null;
  }>,
): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/v1/reclaim/arca-onboarding/callback') {
    const sessionId = request.headers.get('x-reclaim-session-id');
    if (!sessionId) return json({ error: 'RECLAIM_SESSION_HEADER_REQUIRED' }, 400);
    const proofPayload = await boundedProofPayload(request);
    const result = await service.ingestReclaimCallback(sessionId, proofPayload, new Date().toISOString());
    return json({ data: { onboardingId: result.run.onboardingId, replayed: result.replayed, state: result.run.status } });
  }

  if (request.method === 'GET' && url.pathname === '/v1/arca-onboarding/capabilities') {
    return json({ data: service.capabilities() });
  }

  if (request.method === 'POST' && url.pathname === '/v1/arca-onboarding/runs') {
    const body = z.object({
      onboardingId: z.uuid(),
      workspaceId: z.string().min(1).max(200),
      taxpayerReferenceHash: sha256Schema,
      environment: z.enum(['homologation', 'production']),
      requestedServices: z.array(z.enum(['wsfex', 'wsfe'])).min(1).max(2),
      ...baseMutationSchema,
    }).strict().parse(await boundedJson(request));
    requireUserAuthority(request, options, body.workspaceId, body.actorId);
    return json({ data: service.createRun({ ...body, occurredAt: new Date().toISOString() }) }, 201);
  }

  if (request.method === 'GET' && url.pathname === '/v1/arca-onboarding/runs') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return json({ error: 'WORKSPACE_ID_REQUIRED' }, 400);
    requireWorkspaceAuthority(options, workspaceId);
    return json({ data: service.listRuns(workspaceId) });
  }

  const eventsMatch = url.pathname.match(/^\/v1\/arca-onboarding\/runs\/([^/]+)\/events$/);
  if (request.method === 'GET' && eventsMatch) {
    const onboardingId = decodeURIComponent(eventsMatch[1]!);
    const run = service.getRun(onboardingId);
    requireWorkspaceAuthority(options, run.workspaceId);
    return json({ data: run, events: service.listEvents(onboardingId) });
  }

  const reclaimMatch = url.pathname.match(/^\/v1\/arca-onboarding\/runs\/([^/]+)\/zk-evidence\/request$/);
  if (request.method === 'POST' && reclaimMatch) {
    const body = z.object(baseMutationSchema).strict().parse(await boundedJson(request));
    const run = service.getRun(decodeURIComponent(reclaimMatch[1]!));
    requireUserAuthority(request, options, run.workspaceId, body.actorId);
    return json({ data: await service.startReclaim({
      ...body,
      onboardingId: decodeURIComponent(reclaimMatch[1]!),
      occurredAt: new Date().toISOString(),
    }) });
  }

  const verificationMatch = url.pathname.match(/^\/v1\/arca-onboarding\/runs\/([^/]+)\/api-verification\/wsfex$/);
  if (request.method === 'POST' && verificationMatch) {
    requireTrustedToken(request, 'x-tax-evidence-ingest-token', options.evidenceIngestToken, 'EVIDENCE_INGEST');
    const body = z.object({
      ...baseMutationSchema,
      issuerProfileRef: z.string().min(1).max(500),
    }).strict().parse(await boundedJson(request));
    return json({ data: await service.verifyWsfexApi({
      onboardingId: decodeURIComponent(verificationMatch[1]!),
      issuerProfileRef: body.issuerProfileRef,
      actorId: body.actorId,
      idempotencyKey: body.idempotencyKey,
      occurredAt: new Date().toISOString(),
    }) });
  }

  const selectionMatch = url.pathname.match(/^\/v1\/arca-onboarding\/runs\/([^/]+)\/point-of-sale-selection$/);
  if (request.method === 'POST' && selectionMatch) {
    const onboardingId = decodeURIComponent(selectionMatch[1]!);
    const body = z.object({
      ...baseMutationSchema,
      exportPointOfSale: pointOfSaleSchema,
    }).strict().parse(await boundedJson(request));
    const run = service.getRun(onboardingId);
    requireUserAuthority(request, options, run.workspaceId, body.actorId);
    return json({ data: service.applyManualCommand({
      onboardingId,
      actorId: body.actorId,
      occurredAt: new Date().toISOString(),
      command: {
        kind: 'select_discovered_point_of_sale',
        exportPointOfSale: body.exportPointOfSale,
        idempotencyKey: body.idempotencyKey,
      },
    }) });
  }

  const stepMatch = url.pathname.match(/^\/v1\/arca-onboarding\/runs\/([^/]+)\/steps\/([a-z_]+)$/);
  if (request.method === 'POST' && stepMatch) {
    const onboardingId = decodeURIComponent(stepMatch[1]!);
    const step = stepMatch[2]!;
    const raw = await boundedJson(request);
    const occurredAt = new Date().toISOString();
    if (step === 'point_of_sale_discovery' || step === 'api_verification') {
      requireTrustedToken(request, 'x-tax-evidence-ingest-token', options.evidenceIngestToken, 'EVIDENCE_INGEST');
    }
    const parsed = commandForStep(step, raw);
    if (step !== 'point_of_sale_discovery' && step !== 'api_verification') {
      const run = service.getRun(onboardingId);
      requireUserAuthority(request, options, run.workspaceId, parsed.actorId);
    }
    return json({ data: service.applyManualCommand({
      onboardingId,
      actorId: parsed.actorId,
      occurredAt,
      command: parsed.command,
    }) });
  }

  const runMatch = url.pathname.match(/^\/v1\/arca-onboarding\/runs\/([^/]+)$/);
  if (request.method === 'GET' && runMatch) {
    const run = service.getRun(decodeURIComponent(runMatch[1]!));
    requireWorkspaceAuthority(options, run.workspaceId);
    return json({ data: run, nextActions: service.nextActions(run) });
  }

  return null;
}

function requireWorkspaceAuthority(
  options: Readonly<{ tenantPrincipal?: TaxTenantPrincipalV2 | null }>,
  workspaceId: string,
): void {
  if (options.tenantPrincipal) assertTaxTenantPrincipalScope(options.tenantPrincipal, workspaceId);
}

function requireUserAuthority(
  request: Request,
  options: Readonly<{
    userApprovalToken: string | null;
    tenantPrincipal?: TaxTenantPrincipalV2 | null;
  }>,
  workspaceId: string,
  actorId: string,
): void {
  if (options.tenantPrincipal) {
    assertTaxTenantPrincipalScope(options.tenantPrincipal, workspaceId, actorId);
    return;
  }
  requireTrustedToken(request, 'x-tax-user-approval-token', options.userApprovalToken, 'USER_APPROVAL');
}

function commandForStep(step: string, raw: unknown): Readonly<{ actorId: string; command: ManualArcaOnboardingCommand }> {
  switch (step) {
    case 'login_handoff': {
      const body = z.object({ ...baseMutationSchema, browserSessionReferenceHash: sha256Schema }).strict().parse(raw);
      return { actorId: body.actorId, command: { kind: 'complete_login_handoff', browserSessionReferenceHash: body.browserSessionReferenceHash, idempotencyKey: body.idempotencyKey } };
    }
    case 'service_adherence': {
      const body = z.object({
        ...baseMutationSchema,
        pointOfSaleAdministrationActive: z.literal(true),
        relationshipManagerActive: z.literal(true),
        evidenceHash: sha256Schema,
      }).strict().parse(raw);
      return { actorId: body.actorId, command: { kind: 'record_service_adherence', ...withoutActor(body) } };
    }
    case 'point_of_sale_discovery': {
      const body = z.object({
        ...baseMutationSchema,
        exportPointOfSale: pointOfSaleSchema.nullable(),
        activeExportPoints: z.array(pointOfSaleSchema).max(100).optional(),
        evidenceHash: sha256Schema,
      }).strict().parse(raw);
      return {
        actorId: body.actorId,
        command: {
          kind: 'record_point_of_sale_discovery',
          exportPointOfSale: body.exportPointOfSale,
          evidenceHash: body.evidenceHash,
          idempotencyKey: body.idempotencyKey,
          ...(body.activeExportPoints === undefined ? {} : { activeExportPoints: body.activeExportPoints }),
        },
      };
    }
    case 'point_of_sale_creation': {
      const body = z.object({ ...baseMutationSchema, exportPointOfSale: pointOfSaleSchema, evidenceHash: sha256Schema }).strict().parse(raw);
      return { actorId: body.actorId, command: { kind: 'record_point_of_sale_creation', ...withoutActor(body) } };
    }
    case 'ws_delegation': {
      const body = z.object({
        ...baseMutationSchema,
        delegatedServices: z.object({ wsfex: z.boolean(), wsfe: z.boolean() }).strict(),
        issuerProfileReferenceHash: sha256Schema,
        representedCuitCommitment: sha256Schema,
        evidenceHash: sha256Schema,
      }).strict().parse(raw);
      return { actorId: body.actorId, command: { kind: 'record_ws_delegation', ...withoutActor(body) } };
    }
    case 'api_verification': {
      const body = z.object({
        ...baseMutationSchema,
        verifiedServices: z.object({ wsfex: z.boolean(), wsfe: z.boolean() }).strict(),
        activeExportPointOfSale: pointOfSaleSchema,
        observedAt: z.iso.datetime({ offset: true }),
        wsfexReceiptHash: sha256Schema.nullable(),
        wsfeReceiptHash: sha256Schema.nullable(),
      }).strict().parse(raw);
      return { actorId: body.actorId, command: { kind: 'record_api_verification', ...withoutActor(body) } };
    }
    case 'zk_evidence':
    case 'ready':
      throw new Error('ARCA_ONBOARDING_INTERNAL_COMMAND_REQUIRED');
    default:
      throw new Error('ARCA_ONBOARDING_STEP_NOT_FOUND');
  }
}

function withoutActor<T extends { actorId: string }>(value: T): Omit<T, 'actorId'> {
  const { actorId: _actorId, ...rest } = value;
  return rest;
}

async function boundedProofPayload(request: Request): Promise<unknown> {
  const maxBytes = Number(process.env.RECLAIM_CALLBACK_MAX_BYTES ?? 52_428_800);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 52_428_800) {
    throw new Error('RECLAIM_CALLBACK_LIMIT_CONFIGURATION_INVALID');
  }
  const raw = await readBoundedBody(
    request,
    maxBytes,
    'RECLAIM_PROOF_PAYLOAD_TOO_LARGE',
  );
  return (request.headers.get('content-type') ?? '').includes('application/json') ? JSON.parse(raw) as unknown : raw;
}

async function boundedJson(request: Request): Promise<unknown> {
  return JSON.parse(await readBoundedBody(
    request,
    64 * 1024,
    'ARCA_ONBOARDING_REQUEST_TOO_LARGE',
  )) as unknown;
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

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}
