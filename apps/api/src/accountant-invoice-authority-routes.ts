import { createHmac } from 'node:crypto';
import { hashCanonical } from '@tax-engine/core';
import { z } from 'zod';
import { assertArcaFiscalBeta, type ArcaFiscalBetaConfig } from './arca-fiscal-beta';
import { readBoundedBody } from './bounded-body';
import { verifyBoundTaxTenantPrincipalForRawBody } from './tenant-principal';
import type { FacturaEAuthorityExecutionService } from './authority-execution';
import type { FacturaEAgentService } from './factura-e-agent';
import type { TaxProfileStore } from './store';

const schema = z.object({
  version: z.literal('factura-e-accountant-authority-approval-v1'),
  workspaceId: z.union([z.uuid(), z.string().regex(/^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)]),
  runId: z.uuid(), authorityExecutionId: z.uuid(), intentHash: z.string().regex(/^[a-f0-9]{64}$/),
  mandateId: z.string().min(1).max(200), idempotencyKey: z.string().min(16).max(200),
}).strict();

/** A real mandated reviewer replaces the orphan OA dependency only inside beta. */
export async function handleAccountantInvoiceAuthorityRoute(request: Request, url: URL, options: Readonly<{
  store: TaxProfileStore; agent: FacturaEAgentService; authority: FacturaEAuthorityExecutionService;
  beta: ArcaFiscalBetaConfig; principalSecret: string | null; now?: Date;
}>): Promise<Response | null> {
  if (request.method !== 'POST' || url.pathname !== '/v1/accountant-invoice-authority-approvals') return null;
  const raw = await readBoundedBody(request, 16 * 1024, 'ACCOUNTANT_INVOICE_REQUEST_TOO_LARGE');
  const now = options.now ?? new Date(); const at = now.toISOString();
  const principal = verifyBoundTaxTenantPrincipalForRawBody(request, raw, options.principalSecret, 'accountant:decision', now);
  z.uuid().parse(principal.actorId); z.uuid().parse(principal.workspaceId);
  const command = schema.parse(JSON.parse(raw) as unknown);
  assertArcaFiscalBeta(command.workspaceId, options.beta);
  const mandate = options.store.requireAccountantMandate({ mandateId: command.mandateId,
    workspaceId: command.workspaceId, accountantActorId: principal.actorId,
    scope: 'approve_invoice_intent', at });
  if (mandate.accountantOrganizationId !== principal.workspaceId)
    throw new Error('ACCOUNTANT_INVOICE_ORGANIZATION_UNAUTHORIZED');
  const binding = options.store.getFacturaETaxCaseBinding(command.runId);
  const run = options.agent.getRun(command.runId);
  if (!binding || binding.workspaceId !== command.workspaceId || binding.issuancePath !== 'wsfex_delegated'
    || run.workspaceId !== command.workspaceId || run.issuancePath !== binding.issuancePath
    || !run.intent || run.intent.workspaceId !== command.workspaceId || run.intentState !== 'frozen'
    || run.intentHash !== command.intentHash || hashCanonical(run.intent) !== command.intentHash
    || !run.accountantReviewRequired || !['user_approved','accountant_approved'].includes(run.approvalState))
    throw new Error('ACCOUNTANT_INVOICE_AUTHORITY_BINDING_CONFLICT');
  options.authority.assertAccountantApprovalTarget({ executionId: command.authorityExecutionId,
    workspaceId: command.workspaceId, runId: command.runId, intentHash: command.intentHash, actorId: principal.actorId });
  const ownerEvent = options.agent.listEvents(command.runId).find(event => event.action === 'factura_e_intent_approved' && event.actorKind === 'user'
    && event.safeMetadata.intentHash === command.intentHash);
  if (!ownerEvent || !z.uuid().safeParse(ownerEvent.actorId).success || ownerEvent.actorId === principal.actorId)
    throw new Error('TAX_AUTHORITY_SELF_APPROVAL_FORBIDDEN');
  if (run.approvalState === 'user_approved') options.agent.approveIntentByAccountant({ runId: command.runId,
    actorId: principal.actorId, intentHash: command.intentHash, idempotencyKey: command.idempotencyKey, occurredAt: at });
  // Bind final authority approval to this reviewer's exact persisted semantic decision.
  const decision = options.agent.listEvents(command.runId).find(event => event.action === 'factura_e_intent_accountant_approved' && event.actorKind === 'accountant'
    && event.actorId === principal.actorId && event.safeMetadata.intentHash === command.intentHash);
  if (!decision) throw new Error('ACCOUNTANT_INVOICE_SEMANTIC_APPROVAL_REQUIRED');
  const approvalRef = `tax_accountant_approval_${createHmac('sha256', options.principalSecret!)
    .update(JSON.stringify({ purpose: 'tax-beta-accountant-one-use-approval-v1', command, accountantActorId: principal.actorId, decisionId: decision.eventId })).digest('hex')}`;
  const authorityReceipt = options.authority.registerApproval({ executionId: command.authorityExecutionId,
    workspaceId: command.workspaceId, intentHash: command.intentHash, approvalRef, actorId: principal.actorId,
    idempotencyKey: command.idempotencyKey, occurredAt: at });
  return Response.json({ data: { version: 'factura-e-accountant-authority-approval-receipt-v1',
    workspaceId: command.workspaceId, runId: command.runId, authorityExecutionId: command.authorityExecutionId,
    intentHash: command.intentHash, approvalState: 'accountant_approved', authorityReceipt, replayed: authorityReceipt.replayed } },
  { headers: { 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
}
