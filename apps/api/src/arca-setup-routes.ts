import { timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { ArcaSetupAutomationService } from './arca-setup-automation';
import { readBoundedBody } from './bounded-body';
import { assertTaxTenantPrincipalScope, type TaxTenantPrincipalV3 } from './tenant-principal';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencyKey = z.string().min(8).max(200);
const actorId = z.string().min(1).max(300);

/**
 * Customer routes for automated ARCA connection. Every call carries a
 * request-bound `tax-tenant-principal-v3` for `arca:onboard`, minted by the
 * trusted host (Motora) for this exact method, path and body.
 */
const START_PATH = /^\/v1\/arca-onboarding\/runs\/([^/]+)\/automation$/;
const ACTION_PATH = /^\/v1\/arca-onboarding\/automation\/([0-9a-f-]{36})\/(authorization|handoff-link|decision|retry|cancel)$/;
const READ_PATH = /^\/v1\/arca-onboarding\/automation\/([0-9a-f-]{36})$/;

export function isArcaSetupUserPath(pathname: string): boolean {
  return START_PATH.test(pathname) || ACTION_PATH.test(pathname) || READ_PATH.test(pathname);
}

/**
 * `rawBody` is the single bounded read the principal was verified against
 * (`verifyBoundTaxTenantPrincipalForRawBody`), so the handler parses exactly the
 * bytes that were signed.
 */
export async function handleArcaSetupUserRoute(
  request: Request,
  url: URL,
  service: ArcaSetupAutomationService | null,
  principal: TaxTenantPrincipalV3,
  rawBody: string,
): Promise<Response | null> {
  const start = url.pathname.match(START_PATH);
  const action = url.pathname.match(ACTION_PATH);
  const read = url.pathname.match(READ_PATH);
  if (!start && !action && !read) return null;
  if (!service) return json({ error: 'ARCA_SETUP_AUTOMATION_CONFIGURATION_REQUIRED' }, 503);

  if (start && request.method === 'GET') {
    const onboardingId = decodeURIComponent(start[1]!);
    const progress = service.statusForOnboarding(onboardingId);
    if (progress) assertTaxTenantPrincipalScope(principal, progress.workspaceId);
    return json({ data: progress });
  }
  if (start && request.method === 'POST') {
    const body = z.object({
      workspaceId: z.string().min(1).max(200),
      actorId,
      mode: z.enum(['provider_delegation', 'customer_certificate']).optional(),
      idempotencyKey,
    }).strict().parse(JSON.parse(rawBody));
    assertTaxTenantPrincipalScope(principal, body.workspaceId, body.actorId);
    return json({ data: await service.start({
      onboardingId: decodeURIComponent(start[1]!),
      workspaceId: body.workspaceId,
      startedBy: { kind: 'user', actorId: body.actorId },
      ...(body.mode ? { mode: body.mode } : {}),
      idempotencyKey: body.idempotencyKey,
    }) }, 201);
  }
  if (read && request.method === 'GET') {
    const progress = service.status(read[1]!);
    assertTaxTenantPrincipalScope(principal, progress.workspaceId);
    return json({ data: progress });
  }
  if (!action || request.method !== 'POST') return null;
  const executionId = action[1]!;
  const execution = service.get(executionId);
  const raw: unknown = JSON.parse(rawBody);
  switch (action[2]) {
    case 'authorization': {
      const body = z.object({
        actorId,
        idempotencyKey,
        allowPointOfSaleCreation: z.boolean(),
        allowCertificateReplacement: z.boolean(),
        billingReferenceHash: sha256.nullable(),
        consentTextHash: sha256,
      }).strict().parse(raw);
      assertTaxTenantPrincipalScope(principal, execution.workspaceId, body.actorId);
      return json({ data: await service.authorize({
        executionId,
        actorId: body.actorId,
        consent: {
          allowPointOfSaleCreation: body.allowPointOfSaleCreation,
          allowCertificateReplacement: body.allowCertificateReplacement,
          billingReferenceHash: body.billingReferenceHash,
          consentTextHash: body.consentTextHash,
        },
        idempotencyKey: body.idempotencyKey,
      }) });
    }
    case 'handoff-link': {
      const body = z.object({ actorId }).strict().parse(raw);
      assertTaxTenantPrincipalScope(principal, execution.workspaceId, body.actorId);
      // The link is a credential for the hosted tab: private, never cached, UI channel only.
      return json({ data: await service.handoffLink({ executionId, actorId: body.actorId, purpose: 'customer_authentication' }) }, 200, true);
    }
    case 'decision': {
      const body = z.object({
        actorId,
        idempotencyKey,
        decision: z.enum(['export_point_of_sale', 'domestic_point_of_sale', 'certificate_replacement']),
        value: z.union([z.number().int().min(1).max(99_998), z.enum(['replace', 'keep'])]),
        expectedRevision: z.number().int().positive(),
      }).strict().parse(raw);
      assertTaxTenantPrincipalScope(principal, execution.workspaceId, body.actorId);
      return json({ data: await service.decide({ executionId, ...body }) });
    }
    case 'retry': {
      const body = z.object({ actorId, idempotencyKey }).strict().parse(raw);
      assertTaxTenantPrincipalScope(principal, execution.workspaceId, body.actorId);
      return json({ data: await service.retry({ executionId, ...body }) });
    }
    case 'cancel': {
      const body = z.object({ actorId, idempotencyKey }).strict().parse(raw);
      assertTaxTenantPrincipalScope(principal, execution.workspaceId, body.actorId);
      return json({ data: await service.cancel({ executionId, actorId: body.actorId, reason: 'customer_cancelled', idempotencyKey: body.idempotencyKey }) });
    }
  }
  return null;
}

/** Executor receipts: authenticated by the receipt HMAC, not by an API key. */
export async function handleArcaSetupReceiptRoute(
  request: Request,
  url: URL,
  service: ArcaSetupAutomationService | null,
): Promise<Response | null> {
  if (request.method !== 'POST' || url.pathname !== '/v1/arca-setup/receipts') return null;
  if (!service) return json({ error: 'ARCA_SETUP_AUTOMATION_CONFIGURATION_REQUIRED' }, 503);
  const body = await readBoundedBody(request, 256 * 1024, 'ARCA_SETUP_RECEIPT_TOO_LARGE');
  try {
    return json({ data: await service.ingestReceipt(body, request.headers) });
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'ARCA_SETUP_RECEIPT_INVALID';
    if (code === 'ARCA_SETUP_SIGNATURE_INVALID') return json({ error: code }, 401);
    // A decided-against receipt must not be resent forever.
    return json({ error: code }, code.includes('MISMATCH') || code.includes('CONFLICT') || code.includes('TERMINAL') ? 409 : 400);
  }
}

/** BUFI operators accept designations under BUFI's own ARCA authority. */
export async function handleArcaSetupProviderRoute(
  request: Request,
  url: URL,
  service: ArcaSetupAutomationService | null,
  operatorToken: string | null,
): Promise<Response | null> {
  if (!url.pathname.startsWith('/v1/arca-setup/provider')) return null;
  if (!service) return json({ error: 'ARCA_SETUP_AUTOMATION_CONFIGURATION_REQUIRED' }, 503);
  if (!operatorToken || operatorToken.length < 32) return json({ error: 'ARCA_SETUP_PROVIDER_OPERATOR_CONFIGURATION_REQUIRED' }, 503);
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/, '') ?? '';
  if (!constantTimeEqual(supplied, operatorToken)) return json({ error: 'UNAUTHORIZED' }, 401);
  if (request.method === 'GET' && url.pathname === '/v1/arca-setup/provider/queue') return json({ data: service.providerQueue() });
  const match = url.pathname.match(/^\/v1\/arca-setup\/provider\/([0-9a-f-]{36})\/(accept|handoff-link)$/);
  if (request.method !== 'POST' || !match) return json({ error: 'NOT_FOUND' }, 404);
  const body = z.object({ operatorId: actorId, idempotencyKey: idempotencyKey.optional() }).strict().parse(await boundedJson(request));
  if (match[2] === 'accept')
    return json({ data: await service.dispatchProviderAcceptance({ executionId: match[1]!, operatorId: body.operatorId, idempotencyKey: body.idempotencyKey ?? body.operatorId }) });
  return json({ data: await service.handoffLink({ executionId: match[1]!, actorId: `operator:${body.operatorId}`, purpose: 'provider_authentication' }) }, 200, true);
}

async function boundedJson(request: Request): Promise<unknown> {
  return JSON.parse(await readBoundedBody(request, 64 * 1024, 'ARCA_SETUP_REQUEST_TOO_LARGE')) as unknown;
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(value: unknown, status = 200, sensitive = false): Response {
  return Response.json(value, {
    status,
    headers: sensitive
      ? { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }
      : { 'cache-control': 'private, no-store' },
  });
}
