import { z } from 'zod';

import { classifyApiError } from './api-errors';
import { readBoundedBody } from './bounded-body';
import type { FacturaEAuthorityExecutionService } from './authority-execution';
import type { FacturaEAgentService } from './factura-e-agent';
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
  .regex(/^human_approval_[A-Za-z0-9_-]+$/);

const createIntentSchema = z
  .object({
    version: z.literal('factura-e-authority-intent-create-v1'),
    workspaceId: workspaceIdSchema,
    runId: z.uuid(),
    ledgerInvoiceId: z.uuid(),
    intentHash: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const createCaseSchema = z
  .object({
    version: z.literal('factura-e-tax-case-create-v1'),
    workspaceId: workspaceIdSchema,
    runId: z.uuid(),
    ledgerInvoiceId: z.uuid(),
    issuancePath: z.enum(['reclaim_copilot', 'wsfex_delegated']),
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
const approveIntentSchema = z
  .object({
    version: z.literal('factura-e-intent-approve-v1'),
    workspaceId: workspaceIdSchema,
    intentHash: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const authorityAttestationSchema = z
  .object({
    version: z.literal('factura-e-invoice-authority-attestation-request-v1'),
    workspaceId: workspaceIdSchema,
    ledgerInvoiceId: z.uuid(),
    intentHash: sha256Schema,
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
    taxCases?: FacturaEAgentService;
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

    if (route.operation === 'create_case') {
      if (!options.taxCases) throw new Error('TAX_CASE_CORRIDOR_CONFIGURATION_REQUIRED');
      const body = createCaseSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const created = options.taxCases.createRun({
        runId: body.runId,
        workspaceId: body.workspaceId,
        issuancePath: body.issuancePath,
        actorId: `motora:${principal.actorId}`,
        idempotencyKey: body.idempotencyKey,
        occurredAt,
      });
      const binding = options.taxCases.bindLedgerInvoice({
        runId: body.runId,
        ledgerInvoiceId: body.ledgerInvoiceId,
        idempotencyKey: `${body.idempotencyKey}:ledger-binding`,
        occurredAt,
      });
      return privateJson({ data: {
        version: 'factura-e-tax-case-receipt-v1',
        runId: created.run.runId,
        workspaceId: created.run.workspaceId,
        ledgerInvoiceId: body.ledgerInvoiceId,
        state: 'case_created',
        replayed: created.replayed && binding.replayed,
        nextAction: 'collect_verified_evidence',
      } }, 200);
    }

    if (route.operation === 'read_case') {
      if (!options.taxCases) throw new Error('TAX_CASE_CORRIDOR_CONFIGURATION_REQUIRED');
      const runId = z.uuid().parse(decodeURIComponent(route.executionId ?? ''));
      const run = options.taxCases.getRun(runId);
      assertPrincipalWorkspace(principal.workspaceId, run.workspaceId);
      return privateJson({ data: {
        version: 'factura-e-tax-case-status-v1', runId: run.runId, workspaceId: run.workspaceId,
        revision: run.revision, readinessState: run.readinessState, intentState: run.intentState,
        approvalState: run.approvalState, issuanceState: run.issuanceState,
        nextAction: run.intentState === 'missing' ? 'collect_verified_evidence' : run.approvalState === 'pending' ? 'await_separate_human_approval' : run.issuanceState === 'ready_for_wsfex' ? 'persist_authority_intent' : 'wait_for_tax_update',
      } }, 200);
    }
    if (route.operation === 'approve_intent') {
      if (!options.taxCases) throw new Error('TAX_CASE_CORRIDOR_CONFIGURATION_REQUIRED');
      const body = approveIntentSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const runId = z.uuid().parse(decodeURIComponent(route.executionId ?? ''));
      const current = options.taxCases.getRun(runId);
      assertPrincipalWorkspace(principal.workspaceId, current.workspaceId);
      const result = options.taxCases.approveIntent({
        runId,
        actorId: principal.actorId,
        intentHash: body.intentHash,
        idempotencyKey: body.idempotencyKey,
        occurredAt,
      });
      return privateJson({
        data: {
          version: 'factura-e-intent-approval-receipt-v1',
          runId: result.run.runId,
          workspaceId: result.run.workspaceId,
          intentHash: body.intentHash,
          approvalState: result.run.approvalState,
          issuanceState: result.run.issuanceState,
          replayed: result.replayed,
        },
      }, 200);
    }
    if (route.operation === 'attest_authority') {
      if (!options.taxCases) throw new Error('TAX_CASE_CORRIDOR_CONFIGURATION_REQUIRED');
      const body = authorityAttestationSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const runId = z.uuid().parse(decodeURIComponent(route.executionId ?? ''));
      const run = options.taxCases.getRun(runId);
      assertPrincipalWorkspace(principal.workspaceId, run.workspaceId);
      if (run.intentHash !== body.intentHash)
        throw new Error('TAX_INVOICE_AUTHORITY_BINDING_CONFLICT');
      const official = service.officialAttestationBinding({
        workspaceId: body.workspaceId,
        runId,
        intentHash: body.intentHash,
      });
      return privateJson({
        data: options.taxCases.invoiceAuthorityAttestation({
          workspaceId: body.workspaceId,
          runId,
          ledgerInvoiceId: body.ledgerInvoiceId,
          intentHash: body.intentHash,
          authorityReceiptHash: official.receiptHash,
          authorityExecutionId: official.executionId,
          authorityEnvironment: official.authorityEnvironment,
          authorityProviderId: official.authorityProviderId,
        }),
      }, 200);
    }

    if (route.operation === 'create') {
      if (!options.taxCases) throw new Error('TAX_CASE_CORRIDOR_CONFIGURATION_REQUIRED');
      const body = createIntentSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const preparationBinding = options.taxCases.authorityPreparationBinding({
        workspaceId: body.workspaceId,
        runId: body.runId,
        ledgerInvoiceId: body.ledgerInvoiceId,
        intentHash: body.intentHash,
      });
      const { ledgerInvoiceId: _ledgerInvoiceId, ...authorityIntent } = body;
      return privateJson({
        data: {
          ...service.createIntent({
            ...authorityIntent,
            actorId: principal.actorId,
            occurredAt,
          }),
          preparationBinding,
        },
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
  operation:
    | 'readiness'
    | 'status'
    | 'create_case'
    | 'read_case'
    | 'attest_authority'
    | 'approve_intent'
    | 'create'
    | 'approve'
    | 'execute'
    | 'recover'
    | 'reconcile';
  capability: TaxAuthorityCapability;
  workspaceId?: string;
  executionId?: string;
}> | null {
  if (method === 'POST' && pathname === '/v1/authority/factura-e/cases')
    return { operation: 'create_case', capability: 'factura-e:case:create' };
  const caseStatus = pathname.match(/^\/v1\/authority\/factura-e\/cases\/([^/]+)$/);
  if (method === 'GET' && caseStatus)
    return {
      operation: 'read_case',
      capability: 'factura-e:case:read',
      executionId: caseStatus[1]!,
    };
  const intentApproval = pathname.match(
    /^\/v1\/authority\/factura-e\/cases\/([^/]+)\/intent-approval$/
  );
  if (method === 'POST' && intentApproval)
    return {
      operation: 'approve_intent',
      capability: 'factura-e:intent:approve',
      executionId: intentApproval[1]!,
    };
  const authorityAttestation = pathname.match(
    /^\/v1\/authority\/factura-e\/cases\/([^/]+)\/authority-attestation$/
  );
  if (method === 'POST' && authorityAttestation)
    return {
      operation: 'attest_authority',
      capability: 'factura-e:authority:attest',
      executionId: authorityAttestation[1]!,
    };
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
