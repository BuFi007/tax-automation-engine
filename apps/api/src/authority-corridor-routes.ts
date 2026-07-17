import { z } from 'zod';

import { classifyApiError } from './api-errors';
import { readBoundedBody } from './bounded-body';
import type { FacturaEAuthorityExecutionService } from './authority-execution';
import {
  type TaxAuthorityCapability,
  type TaxAuthorityPrincipalSecrets,
  verifyTaxAuthorityPrincipal,
} from './authority-principal';

const MAX_BODY_BYTES = 16 * 1024;
const workspaceIdSchema = z.uuid();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const idempotencyKeySchema = z
  .string()
  .min(16)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);
const approvalRefSchema = z
  .string()
  .min(24)
  .max(240)
  .regex(/^oa_approval_[A-Za-z0-9_-]+$/);

const createIntentSchema = z
  .object({
    version: z.literal('factura-e-authority-intent-create-v1'),
    workspaceId: workspaceIdSchema,
    runId: z.uuid(),
    intentHash: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const registerApprovalSchema = z
  .object({
    version: z.literal('factura-e-authority-approval-register-v1'),
    workspaceId: workspaceIdSchema,
    intentHash: sha256Schema,
    approvalRef: approvalRefSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const executeSchema = z
  .object({
    version: z.literal('factura-e-authority-execute-v1'),
    workspaceId: workspaceIdSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const recoverSchema = z
  .object({
    version: z.literal('factura-e-authority-recover-v1'),
    workspaceId: workspaceIdSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const reconcileSchema = z
  .object({
    version: z.literal('factura-e-authority-reconcile-v1'),
    workspaceId: workspaceIdSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export async function handleFacturaEAuthorityCorridorRoute(
  request: Request,
  url: URL,
  service: FacturaEAuthorityExecutionService,
  options: Readonly<{
    corridorEnabled: boolean;
    secrets: TaxAuthorityPrincipalSecrets;
  }>
): Promise<Response | null> {
  const route = matchRoute(request.method, url.pathname);
  if (!route) return null;
  try {
    if (!options.corridorEnabled)
      throw new Error('TAX_AUTHORITY_CORRIDOR_CONFIGURATION_REQUIRED');
    if (route.operation === 'readiness' || route.operation === 'status') {
      const workspaceId = workspaceIdSchema.parse(
        decodeURIComponent(route.workspaceId ?? '')
      );
      const principal = verifyTaxAuthorityPrincipal({
        request,
        rawBody: '',
        capability: route.capability,
        secrets: options.secrets,
      });
      assertPrincipalWorkspace(principal.workspaceId, workspaceId);
      return route.operation === 'readiness'
        ? privateJson({ data: { workspaceId, ...service.readiness() } }, 200)
        : privateJson({ data: service.current(workspaceId) }, 200);
    }

    const rawBody = await readBoundedBody(
      request,
      MAX_BODY_BYTES,
      'TAX_AUTHORITY_REQUEST_TOO_LARGE',
    );
    const principal = verifyTaxAuthorityPrincipal({
      request,
      rawBody,
      capability: route.capability,
      secrets: options.secrets,
    });
    const occurredAt = new Date().toISOString();

    if (route.operation === 'create') {
      const body = createIntentSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      return privateJson({
        data: service.createIntent({
          ...body,
          actorId: principal.actorId,
          occurredAt,
        }),
      }, 200);
    }
    const executionId = z.uuid().parse(decodeURIComponent(route.executionId ?? ''));
    if (route.operation === 'approve') {
      const body = registerApprovalSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      return privateJson({
        data: service.registerApproval({
          ...body,
          executionId,
          actorId: principal.actorId,
          occurredAt,
        }),
      }, 200);
    }
    if (route.operation === 'execute') {
      const body = executeSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      return privateJson({
        data: await service.execute({
          ...body,
          executionId,
          actorId: principal.actorId,
          occurredAt,
        }),
      }, 200);
    }
    if (route.operation === 'recover') {
      const body = recoverSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      return privateJson({
        data: await service.recover({
          ...body,
          executionId,
          actorId: principal.actorId,
          occurredAt,
        }),
      }, 200);
    }
    const body = reconcileSchema.parse(JSON.parse(rawBody) as unknown);
    assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
    return privateJson({
      data: await service.reconcile({
        ...body,
        executionId,
        actorId: principal.actorId,
        occurredAt,
      }),
    }, 200);
  } catch (error) {
    const safe = classifyApiError(error);
    return privateJson({ error: safe.code }, safe.status);
  }
}

function matchRoute(method: string, pathname: string): Readonly<{
  operation: 'readiness' | 'status' | 'create' | 'approve' | 'execute' | 'recover' | 'reconcile';
  capability: TaxAuthorityCapability;
  workspaceId?: string;
  executionId?: string;
}> | null {
  if (method === 'POST' && pathname === '/v1/authority/factura-e/intents')
    return { operation: 'create', capability: 'factura-e:intent:create' };
  const readiness = pathname.match(/^\/v1\/authority\/factura-e\/readiness\/([^/]+)$/);
  if (method === 'GET' && readiness)
    return {
      operation: 'readiness',
      capability: 'factura-e:readiness',
      workspaceId: readiness[1]!,
    };
  const status = pathname.match(
    /^\/v1\/authority\/factura-e\/workspaces\/([^/]+)\/current$/
  );
  if (method === 'GET' && status)
    return {
      operation: 'status',
      capability: 'factura-e:status:read',
      workspaceId: status[1]!,
    };
  const mutation = pathname.match(
    /^\/v1\/authority\/factura-e\/intents\/([^/]+)\/(approvals|execute|recover|reconcile)$/
  );
  if (method !== 'POST' || !mutation) return null;
  const operation = mutation[2];
  if (operation === 'approvals')
    return {
      operation: 'approve',
      capability: 'factura-e:approval:register',
      executionId: mutation[1]!,
    };
  if (operation === 'execute')
    return {
      operation: 'execute',
      capability: 'factura-e:execute',
      executionId: mutation[1]!,
    };
  if (operation === 'reconcile')
    return {
      operation: 'reconcile',
      capability: 'factura-e:reconcile',
      executionId: mutation[1]!,
    };
  return {
    operation: 'recover',
    capability: 'factura-e:recover',
    executionId: mutation[1]!,
  };
}

function assertPrincipalWorkspace(actual: string, expected: string): void {
  if (actual !== expected)
    throw new Error('TAX_AUTHORITY_PRINCIPAL_SCOPE_UNAUTHORIZED');
}

function privateJson(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
