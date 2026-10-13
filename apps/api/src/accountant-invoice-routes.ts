import { assertActiveAccountantMandate, hashCanonical } from '@tax-engine/core';
import { z } from 'zod';

import type { FacturaEAgentService } from './factura-e-agent';
import type { TaxProfileStore } from './store';
import type { TaxTenantPrincipalV2, TaxTenantPrincipalV3 } from './tenant-principal';

const clientScopeSchema = z.union([
  z.uuid(),
  z.string().regex(/^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
]);
const approvalSchema = z.object({
  workspaceId: clientScopeSchema,
  runId: z.uuid(),
  intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mandateId: z.string().min(1).max(200),
  idempotencyKey: z.string().min(16).max(200),
}).strict();

export async function handleAccountantInvoiceRoute(
  request: Request,
  url: URL,
  store: TaxProfileStore,
  agent: FacturaEAgentService,
  principal: TaxTenantPrincipalV2 | TaxTenantPrincipalV3 | null,
  now = new Date(),
  rawBody?: string,
): Promise<Response | null> {
  const listing = request.method === 'GET' && url.pathname === '/v1/accountant-invoice-review-queue';
  const approving = request.method === 'POST' && url.pathname === '/v1/accountant-invoice-approvals';
  if (!listing && !approving) return null;
  if (!principal || principal.capability !== (listing ? 'accountant:review-queue' : 'accountant:decision'))
    throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
  const approval = approving
    ? approvalSchema.parse(JSON.parse(rawBody ?? await request.text()) as unknown)
    : null;
  const clientWorkspaceId = approval?.workspaceId
    ?? clientScopeSchema.parse(url.searchParams.get('workspaceId'));
  const at = now.toISOString();
  const mandates = store.listAccountantMandatesForPortfolio(principal.actorId, principal.workspaceId)
    .filter(mandate => {
      try {
        assertActiveAccountantMandate(mandate, {
          workspaceId: clientWorkspaceId,
          accountantActorId: principal.actorId,
          scope: 'approve_invoice_intent',
          at,
        });
        return true;
      } catch {
        return false;
      }
    });
  const items = mandates.length === 0 ? [] : agent.listRuns(clientWorkspaceId).flatMap(run => {
    if (run.issuancePath !== 'wsfex_delegated' || !run.accountantReviewRequired
      || run.approvalState !== 'user_approved' || run.intentState !== 'frozen'
      || !run.intent || !run.intentHash || run.intentHash !== hashCanonical(run.intent)) return [];
    if (agent.listEvents(run.runId).some(event => event.action === 'factura_e_intent_approved'
      && event.actorId === principal.actorId)) return [];
    const binding = store.getFacturaETaxCaseBinding(run.runId);
    if (!binding || binding.workspaceId !== clientWorkspaceId || binding.issuancePath !== run.issuancePath)
      return [];
    return [{
      version: 'factura-e-accountant-review-item-v1' as const,
      workspaceId: clientWorkspaceId,
      ledgerInvoiceId: binding.ledgerInvoiceId,
      runId: run.runId,
      intentHash: run.intentHash,
      mandateId: mandates[0]!.mandateId,
      review: {
        customer: run.intent.foreignCustomerSafeLabel,
        destinationCountry: run.intent.destinationCountry,
        pointOfSale: run.intent.pointOfSale,
        issueDate: run.intent.issueDate,
        servicePeriod: run.intent.servicePeriod ?? null,
        paymentDate: run.intent.paymentDate,
        serviceDescription: run.intent.serviceDescription,
        amount: run.intent.total.decimal,
        currency: run.intent.total.currency,
        exchangeRate: run.intent.exchangeRate && {
          decimal: run.intent.exchangeRate.decimal,
          observedForDate: run.intent.exchangeRate.observedForDate,
          sourceReferenceId: run.intent.exchangeRate.sourceReferenceId,
        },
      },
    }];
  });
  if (listing) return privateJson({ data: {
    version: 'factura-e-accountant-review-queue-v1',
    accountantActorId: principal.actorId,
    accountantOrganizationId: principal.workspaceId,
    items,
  } });

  if (principal.version !== 'tax-tenant-principal-v3') throw new Error('TAX_TENANT_SCOPE_UNAUTHORIZED');
  const command = approval!;
  const item = items.find(candidate => candidate.runId === command.runId
    && candidate.intentHash === command.intentHash && candidate.mandateId === command.mandateId);
  store.requireAccountantMandate({
    mandateId: command.mandateId, workspaceId: command.workspaceId,
    accountantActorId: principal.actorId, scope: 'approve_invoice_intent', at,
  });
  if (!item) {
    const previous = agent.listEvents(command.runId).find(event =>
      event.action === 'factura_e_intent_accountant_approved'
      && event.actorId === principal.actorId
      && event.idempotencyKey === command.idempotencyKey
      && event.safeMetadata.intentHash === command.intentHash
    );
    const run = previous && agent.getRun(command.runId);
    const binding = previous && store.getFacturaETaxCaseBinding(command.runId);
    if (!run || !binding || run.workspaceId !== command.workspaceId
      || binding.workspaceId !== command.workspaceId
      || run.intentHash !== command.intentHash || run.approvalState !== 'accountant_approved')
      throw new Error('ACCOUNTANT_INVOICE_REVIEW_CHANGED');
    return privateJson({ data: {
      version: 'factura-e-accountant-approval-receipt-v1',
      workspaceId: command.workspaceId, runId: command.runId,
      intentHash: command.intentHash, approvalState: 'accountant_approved', replayed: true,
    } });
  }
  const result = agent.approveIntentByAccountant({
    runId: command.runId, actorId: principal.actorId,
    intentHash: command.intentHash, idempotencyKey: command.idempotencyKey,
    occurredAt: at,
  });
  return privateJson({ data: {
    version: 'factura-e-accountant-approval-receipt-v1',
    workspaceId: command.workspaceId,
    runId: command.runId,
    intentHash: command.intentHash,
    approvalState: result.run.approvalState,
    replayed: result.replayed,
  } });
}

function privateJson(body: unknown): Response {
  return Response.json(body, { headers: {
    'cache-control': 'private, no-store',
    vary: 'authorization, x-tax-tenant-principal, x-tax-tenant-signature',
  } });
}
