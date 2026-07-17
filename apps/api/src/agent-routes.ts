import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

import { readBoundedBody } from './bounded-body';
import {
  verifyTaxAgentPrincipal,
  type TaxAgentPrincipalV1,
} from './agent-principal';

import type { FacturaEAgentService } from './factura-e-agent';
import type { AccountantMandateScope } from '@tax-engine/core';

type AccountantMandateAuthorizer = Readonly<{
  requireAccountantMandate(input: Readonly<{
    mandateId: string;
    workspaceId: string;
    accountantActorId: string;
    scope: AccountantMandateScope;
    at: string;
  }>): unknown;
}>;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const decimalSchema = z.string().regex(/^\d+(?:\.\d+)?$/);
const signedDecimalSchema = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const moneySchema = z.object({ decimal: decimalSchema, currency: z.string().regex(/^[A-Z]{3,10}$/) }).strict();
const exchangeRateSchema = z.object({
  decimal: decimalSchema,
  sourceReferenceId: z.string().min(1),
  observedForDate: z.iso.date(),
  authorityRuleDecisionId: z.string().min(1),
}).strict().nullable();
const intentSchema = z.object({
  version: z.literal('factura-e-intent-v1'),
  intentId: z.string().min(1),
  workspaceId: z.string().min(1),
  taxpayerReferenceHash: sha256Schema,
  foreignCustomerReferenceHash: sha256Schema,
  foreignCustomerSafeLabel: z.string().min(1).max(160),
  destinationCountry: z.string().regex(/^[A-Z]{2}$/),
  destinationCountryArcaCode: z.number().int().positive().max(999),
  documentType: z.literal(19),
  operationType: z.literal(2),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  paymentDate: z.iso.date(),
  sameCurrencyPayment: z.boolean(),
  exchangeRate: exchangeRateSchema,
  lineItems: z.array(z.object({
    description: z.string().min(1).max(4_000),
    quantity: decimalSchema,
    unitPrice: decimalSchema,
    total: decimalSchema,
    unitCode: z.number().int().nonnegative().max(99),
  }).strict()).min(1),
  total: moneySchema,
  serviceDescription: z.string().min(1).max(4_000),
  paymentTerms: z.string().min(1).max(1_000),
  ruleVersionIds: z.array(z.string().min(1)).min(1),
}).strict();
const evidenceProposalSchema = z.object({
  runId: z.uuid(),
  economicEventId: z.string().min(1),
  intentId: z.string().min(1),
  foreignCustomerSafeLabel: z.string().min(1).max(160),
  destinationCountry: z.string().regex(/^[A-Z]{2}$/),
  destinationCountryArcaCode: z.number().int().positive().max(999),
  pointOfSale: z.number().int().positive().max(99998),
  issueDate: z.iso.date(),
  paymentDate: z.iso.date(),
  sameCurrencyPayment: z.boolean(),
  exchangeRate: exchangeRateSchema,
  serviceDescription: z.string().min(1).max(4_000),
  paymentTerms: z.string().min(1).max(1_000),
  unitCode: z.number().int().nonnegative().max(99),
}).strict();
const adjustmentSchema = z.object({
  runId: z.uuid(),
  adjustmentId: z.string().min(1),
  documentType: z.union([z.literal(20), z.literal(21)]),
  issueDate: z.iso.date(),
  amount: moneySchema,
  reason: z.string().min(1).max(4_000),
}).strict();
const settlementCurrencySchema = z.string().regex(/^[A-Z][A-Z0-9]{2,11}$/);
const settlementEvidenceSchema = z.object({
  version: z.literal('factura-e-settlement-evidence-v1'),
  source: z.object({
    kind: z.enum([
      'circle_transfer',
      'circle_memo',
      'bridge_liquidation',
      'external_wallet_receipt',
      'reviewed_bank_match',
      'reviewed_accounting_match',
      'approved_manual_evidence',
      'recibu_payment',
      'provider_reversal',
    ]),
    provider: z.string().regex(/^[a-z][a-z0-9._-]{1,62}[a-z0-9]$/),
    identityHash: sha256Schema,
    revision: z.number().int().positive().safe(),
  }).strict(),
  sourceMoney: z.object({
    currency: settlementCurrencySchema,
    grossAmount: decimalSchema,
    feeAmount: decimalSchema,
    netAmount: decimalSchema,
  }).strict(),
  sourceEquivalentAmount: decimalSchema,
  allocationBasis: z.enum(['gross', 'net']),
  fx: z.object({
    rate: decimalSchema,
    sourceCurrency: settlementCurrencySchema,
    allocationCurrency: settlementCurrencySchema,
    evidenceHash: sha256Schema,
    verifiedAt: z.iso.datetime({ offset: true }),
  }).strict().nullable(),
  verification: z.object({
    method: z.enum(['provider_webhook', 'onchain_receipt', 'reviewed_financial_match', 'approved_manual_review']),
    evidenceHash: sha256Schema,
    verifiedAt: z.iso.datetime({ offset: true }),
  }).strict(),
}).strict();

export const facturaESettlementSchema = z.object({
  settlementReferenceHash: sha256Schema,
  asset: z.string().min(1).max(32),
  network: z.string().min(1).max(64),
  amount: moneySchema,
  observedAt: z.iso.datetime({ offset: true }),
  finalityState: z.enum(['observed', 'final', 'reversed', 'disputed']),
  fees: moneySchema.nullable(),
  reversesSettlementReferenceHash: sha256Schema.nullable(),
  evidence: settlementEvidenceSchema.nullable().optional(),
}).strict();
const intentJsonSchema = z.toJSONSchema(intentSchema);
const evidenceProposalJsonSchema = z.toJSONSchema(evidenceProposalSchema);

const invocationSchema = z.object({
  actorId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
  input: z.record(z.string(), z.unknown()),
}).strict();
const evidenceMoneySchema = z.object({ decimal: signedDecimalSchema, currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const evidenceRecordSchema = z.object({
  evidenceId: z.string().min(1),
  workspaceId: z.string().min(1),
  revision: z.string().min(1),
  sourceId: z.string().min(1),
  sourceKind: z.enum(['bank', 'wallet', 'crypto', 'stripe', 'fx', 'payroll', 'bufi_invoice', 'bufi_bill', 'accounting', 'magic_inbox', 'transaction_enrichment', 'knowledge_graph', 'financial_analytics']),
  canonicalProviderId: z.string().nullable(),
  externalReferenceHash: z.string().min(1),
  sourceEventHash: z.string().min(1),
  artifactHash: z.string().min(1),
  jurisdiction: z.enum(['AR', 'US', 'AE']).nullable(),
  period: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
  observedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  economicEventId: z.string().min(1),
  economicRole: z.enum(['invoice', 'payment', 'settlement', 'expense', 'receipt', 'accounting_entry', 'payroll_obligation', 'payroll_settlement', 'fee', 'tax', 'cash_movement', 'classification_context']),
  invoiceDocumentKind: z.enum(['arca_factura_e', 'arca_factura_a', 'arca_factura_b', 'arca_factura_c', 'arca_fce', 'arca_nota_debito_e', 'arca_nota_credito_e', 'commercial_invoice', 'unknown']).nullable().default(null),
  invoiceAdjustmentKind: z.enum(['debit', 'credit']).nullable().default(null),
  adjustsEconomicEventId: z.string().min(1).nullable().default(null),
  countingDimension: z.enum(['revenue', 'expense', 'cash', 'fee', 'tax', 'withholding', 'none']),
  direction: z.enum(['inflow', 'outflow', 'neutral']),
  money: evidenceMoneySchema.nullable(),
  normalizedMoney: evidenceMoneySchema.nullable(),
  fxReferenceId: sha256Schema.nullable(),
  partyClaimHash: z.string().nullable(),
  accountReferenceHash: z.string().nullable(),
  classificationClaim: z.object({
    version: z.literal('tax-evidence-classification-claim-v1'),
    taxonomyVersion: z.string().min(1),
    categoryId: z.string().min(1),
    businessPurposeId: z.string().min(1).nullable(),
    merchantClaimHash: sha256Schema.nullable(),
    classifierVersion: z.string().min(1),
    decisionSource: z.enum(['model_proposal', 'human_review', 'provider_rule']),
  }).strict().nullable().default(null),
  confidence: z.object({ extraction: z.string().nullable(), classification: z.string().nullable(), matching: z.string().nullable() }).strict(),
  reviewState: z.enum(['unreviewed', 'accepted', 'rejected', 'disputed']),
  validityState: z.enum(['active', 'withdrawn', 'disputed']).default('active'),
  consentVersion: z.string().min(1),
  idempotencyKey: z.string().min(1),
  supersedesIdempotencyKey: z.string().min(1).nullable().default(null),
}).strict();

export const FACTURA_E_AGENT_TOOLS = [
  tool('tax_ar_homologation_get_preflight', 'Read the redacted external-asset gates for authorized ARCA homologation. This never exposes configured values and never enables production.', {
    type: 'object', required: [], additionalProperties: false, properties: {},
  }, 'read_only'),
  tool('tax_ar_factura_e_create_case', 'Create an auditable Argentina Factura E agent case. This never issues an invoice.', {
    type: 'object', required: ['runId', 'workspaceId', 'issuancePath'], additionalProperties: false,
    properties: { runId: { type: 'string', format: 'uuid' }, workspaceId: { type: 'string' }, issuancePath: { enum: ['reclaim_copilot', 'wsfex_delegated'] } },
  }, 'automatic'),
  tool('tax_ar_factura_e_get_case', 'Read the case, its independent compliance states, and deterministic next actions.', {
    type: 'object', required: ['runId'], additionalProperties: false, properties: { runId: { type: 'string', format: 'uuid' } },
  }, 'read_only'),
  tool('tax_ar_factura_e_list_cases', 'List the latest Factura E cases for a workspace.', {
    type: 'object', required: ['workspaceId'], additionalProperties: false, properties: { workspaceId: { type: 'string' } },
  }, 'read_only'),
  tool('tax_ar_factura_e_draft_intent', 'Draft and deterministically validate the safe canonical intent. Raw Clave Fiscal and raw CUIT/TIN values are forbidden.', {
    type: 'object', required: ['runId', 'intent'], additionalProperties: false,
    properties: { runId: { type: 'string', format: 'uuid' }, intent: intentJsonSchema },
  }, 'automatic'),
  tool('tax_ar_factura_e_propose_from_evidence', 'Build a deterministic draft from accepted workspace evidence for one economic event, deduplicating matching bank, accounting, Inbox, graph, and analytics records.', evidenceProposalJsonSchema, 'automatic'),
  tool('tax_ar_factura_e_get_copilot_packet', 'Return the approved Path B field packet and ARCA handoff instructions without exposing credentials or raw tax IDs.', {
    type: 'object', required: ['runId'], additionalProperties: false, properties: { runId: { type: 'string', format: 'uuid' } },
  }, 'read_only_after_human_approval'),
  tool('tax_ar_factura_e_get_accounting_attestation_packet', 'Return the authority-backed accounting, settlement, proof-custody, and underwriting-evidence packet. This does not write to an ERP or make a credit decision.', {
    type: 'object', required: ['runId'], additionalProperties: false, properties: { runId: { type: 'string', format: 'uuid' } },
  }, 'read_only_after_authority_verification'),
  tool('tax_ar_reclaim_start', 'Start a Reclaim proof session for taxpayer readiness, an issued Factura E, or an associated export adjustment. The user authenticates directly with ARCA.', {
    type: 'object', required: ['runId', 'purpose'], additionalProperties: false,
    properties: {
      runId: { type: 'string', format: 'uuid' },
      purpose: { enum: ['arca_taxpayer_readiness', 'arca_cae_constatement', 'arca_adjustment_constatement'] },
      subjectId: { anyOf: [{ type: 'string', minLength: 1 }, { type: 'null' }] },
    },
  }, 'user_interaction_required'),
  tool('tax_ar_factura_e_request_approval', 'Freeze the validated intent candidate and request a separate human approval. This tool cannot approve it.', {
    type: 'object', required: ['runId'], additionalProperties: false, properties: { runId: { type: 'string', format: 'uuid' } },
  }, 'user_interaction_required'),
  tool('tax_ar_factura_e_prepare_adjustment', 'Prepare an immutable associated export debit note (20) or credit note (21). The adjustment freezes financing and requires a new human approval.', z.toJSONSchema(adjustmentSchema), 'automatic'),
  tool('tax_ar_factura_e_get_adjustment_copilot_packet', 'Return the approved Path B adjustment packet, including the mandatory original Factura E association.', {
    type: 'object', required: ['runId', 'adjustmentId'], additionalProperties: false,
    properties: { runId: { type: 'string', format: 'uuid' }, adjustmentId: { type: 'string' } },
  }, 'read_only_after_human_approval'),
] as const;

export async function handleAgentRoute(
  request: Request,
  url: URL,
  service: FacturaEAgentService,
  options: Readonly<{
    userApprovalToken: string | null;
    accountantApprovalToken: string | null;
    evidenceIngestToken: string | null;
    agentPrincipalSecret: string | null;
    accountantMandates?: AccountantMandateAuthorizer | null;
    /** Retired compatibility input; never authorizes an ARCA effect. */
    authorityPayloadToken?: string | null;
    legacyEvidenceAppendEnabled?: boolean;
  }>
): Promise<Response | null> {
  if (request.method === 'POST' && url.pathname === '/v1/reclaim/callback') {
    const sessionId = request.headers.get('x-reclaim-session-id');
    if (!sessionId) return json({ error: 'RECLAIM_SESSION_HEADER_REQUIRED' }, 400);
    const maxBytes = Number(process.env.RECLAIM_CALLBACK_MAX_BYTES ?? 52_428_800);
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 52_428_800) {
      throw new Error('RECLAIM_CALLBACK_LIMIT_CONFIGURATION_INVALID');
    }
    const contentType = request.headers.get('content-type') ?? '';
    let rawPayload: string;
    try {
      rawPayload = await readBoundedBody(
        request,
        maxBytes,
        'RECLAIM_PROOF_PAYLOAD_TOO_LARGE',
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'RECLAIM_PROOF_PAYLOAD_TOO_LARGE') {
        return json({ error: error.message }, 413);
      }
      throw error;
    }
    const payload = contentType.includes('application/json') ? JSON.parse(rawPayload) as unknown : rawPayload;
    const result = await service.ingestReclaimCallback(sessionId, payload, new Date().toISOString());
    return json({ data: { runId: result.run.runId, replayed: result.replayed, state: result.run.issuanceState } });
  }

  if (request.method === 'GET' && url.pathname === '/v1/agent/tools') {
    return json({ data: { capabilities: service.capabilities(), tools: FACTURA_E_AGENT_TOOLS } });
  }

  if (request.method === 'POST' && url.pathname === '/v1/evidence/append') {
    requireTrustedToken(request, 'x-tax-evidence-ingest-token', options.evidenceIngestToken, 'EVIDENCE_INGEST');
    if (process.env.NODE_ENV === 'production' || !options.legacyEvidenceAppendEnabled) {
      throw new Error('EVIDENCE_LEGACY_APPEND_DISABLED');
    }
    const body = z.object({ records: z.array(evidenceRecordSchema).min(1) }).strict().parse(await boundedJson(request));
    return json({ data: service.appendEvidence(body.records, new Date().toISOString()) });
  }

  const invocationMatch = url.pathname.match(/^\/v1\/agent\/tools\/([a-z0-9_]+)\/invoke$/);
  if (request.method === 'POST' && invocationMatch) {
    const rawBody = await readBoundedBody(
      request,
      1024 * 1024,
      'TAX_AGENT_REQUEST_TOO_LARGE',
    );
    const body = invocationSchema.parse(JSON.parse(rawBody) as unknown);
    const toolId = invocationMatch[1]!;
    const principal = verifyTaxAgentPrincipal({
      request,
      rawBody,
      toolId,
      actorId: body.actorId,
      idempotencyKey: body.idempotencyKey,
      secret: options.agentPrincipalSecret,
    });
    assertAgentInvocationScope(toolId, body, principal, service);
    return json({ data: await invokeTool(toolId, body, service) });
  }

  const runEventsMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/events$/);
  if (request.method === 'GET' && runEventsMatch) {
    const runId = decodeURIComponent(runEventsMatch[1]!);
    return json({ data: service.getRun(runId), events: service.listEvents(runId) });
  }

  const runMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)$/);
  if (request.method === 'GET' && runMatch) {
    const run = service.getRun(decodeURIComponent(runMatch[1]!));
    return json({ data: run, nextActions: service.nextActions(run) });
  }

  if (request.method === 'GET' && url.pathname === '/v1/agent/runs') {
    const workspaceId = url.searchParams.get('workspaceId');
    if (!workspaceId) return json({ error: 'WORKSPACE_ID_REQUIRED' }, 400);
    return json({ data: service.listRuns(workspaceId) });
  }

  const approvalMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/user-approval$/);
  if (request.method === 'POST' && approvalMatch) {
    requireTrustedToken(request, 'x-tax-user-approval-token', options.userApprovalToken, 'USER_APPROVAL');
    const body = z.object({
      actorId: z.string().min(1), intentHash: sha256Schema, idempotencyKey: z.string().min(8),
    }).strict().parse(await boundedJson(request, 64 * 1024));
    return json({ data: service.approveIntent({ ...body, runId: decodeURIComponent(approvalMatch[1]!), occurredAt: new Date().toISOString() }) });
  }

  const accountantApprovalMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/accountant-approval$/);
  if (request.method === 'POST' && accountantApprovalMatch) {
    requireTrustedToken(request, 'x-tax-accountant-approval-token', options.accountantApprovalToken, 'ACCOUNTANT_APPROVAL');
    const body = z.object({ actorId: z.string().min(1), mandateId: z.string().min(1), intentHash: sha256Schema, idempotencyKey: z.string().min(8) }).strict().parse(await boundedJson(request, 64 * 1024));
    const runId = decodeURIComponent(accountantApprovalMatch[1]!);
    const occurredAt = new Date().toISOString();
    requireScopedAccountantMandate(options.accountantMandates, service, runId, body, 'approve_invoice_intent', occurredAt);
    return json({ data: service.approveIntentByAccountant({ actorId: body.actorId, intentHash: body.intentHash, idempotencyKey: body.idempotencyKey, runId, occurredAt }) });
  }

  const adjustmentUserApprovalMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/adjustments\/([^/]+)\/user-approval$/);
  if (request.method === 'POST' && adjustmentUserApprovalMatch) {
    requireTrustedToken(request, 'x-tax-user-approval-token', options.userApprovalToken, 'USER_APPROVAL');
    const body = z.object({ actorId: z.string().min(1), intentHash: sha256Schema, idempotencyKey: z.string().min(8) }).strict().parse(await boundedJson(request, 64 * 1024));
    return json({ data: service.approveAdjustment({
      ...body,
      runId: decodeURIComponent(adjustmentUserApprovalMatch[1]!),
      adjustmentId: decodeURIComponent(adjustmentUserApprovalMatch[2]!),
      occurredAt: new Date().toISOString(),
    }) });
  }

  const adjustmentAccountantApprovalMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/adjustments\/([^/]+)\/accountant-approval$/);
  if (request.method === 'POST' && adjustmentAccountantApprovalMatch) {
    requireTrustedToken(request, 'x-tax-accountant-approval-token', options.accountantApprovalToken, 'ACCOUNTANT_APPROVAL');
    const body = z.object({ actorId: z.string().min(1), mandateId: z.string().min(1), intentHash: sha256Schema, idempotencyKey: z.string().min(8) }).strict().parse(await boundedJson(request, 64 * 1024));
    const runId = decodeURIComponent(adjustmentAccountantApprovalMatch[1]!);
    const occurredAt = new Date().toISOString();
    requireScopedAccountantMandate(options.accountantMandates, service, runId, body, 'approve_invoice_adjustment', occurredAt);
    return json({ data: service.approveAdjustmentByAccountant({
      actorId: body.actorId,
      intentHash: body.intentHash,
      idempotencyKey: body.idempotencyKey,
      runId,
      adjustmentId: decodeURIComponent(adjustmentAccountantApprovalMatch[2]!),
      occurredAt,
    }) });
  }

  const authorityPayloadMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/wsfex-payload$/);
  if (request.method === 'POST' && authorityPayloadMatch) {
    return json({ error: 'TAX_AUTHORITY_CORRIDOR_REQUIRED' }, 410);
  }

  const adjustmentAuthorityPayloadMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/adjustments\/([^/]+)\/wsfex-payload$/);
  if (request.method === 'POST' && adjustmentAuthorityPayloadMatch) {
    return json({ error: 'TAX_AUTHORITY_CORRIDOR_REQUIRED' }, 410);
  }

  const reclaimCancellationMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/reclaim-sessions\/([^/]+)\/cancel$/);
  if (request.method === 'POST' && reclaimCancellationMatch) {
    requireTrustedToken(request, 'x-tax-user-approval-token', options.userApprovalToken, 'USER_APPROVAL');
    const body = z.object({ actorId: z.string().min(1), idempotencyKey: z.string().min(8) }).strict().parse(await boundedJson(request, 64 * 1024));
    return json({ data: service.cancelReclaimSession({
      ...body,
      runId: decodeURIComponent(reclaimCancellationMatch[1]!),
      sessionId: decodeURIComponent(reclaimCancellationMatch[2]!),
      occurredAt: new Date().toISOString(),
    }) });
  }

  const fxMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/fx-ingress-verification$/);
  if (request.method === 'POST' && fxMatch) {
    requireTrustedToken(request, 'x-tax-accountant-approval-token', options.accountantApprovalToken, 'ACCOUNTANT_APPROVAL');
    const body = z.object({ actorId: z.string().min(1), mandateId: z.string().min(1), evidenceHash: sha256Schema, idempotencyKey: z.string().min(8) }).strict().parse(await boundedJson(request, 64 * 1024));
    const runId = decodeURIComponent(fxMatch[1]!);
    const occurredAt = new Date().toISOString();
    requireScopedAccountantMandate(options.accountantMandates, service, runId, body, 'verify_fx_ingress', occurredAt);
    return json({ data: service.verifyFxIngress({ actorId: body.actorId, evidenceHash: body.evidenceHash, idempotencyKey: body.idempotencyKey, runId, occurredAt }) });
  }

  const taxMatch = url.pathname.match(/^\/v1\/agent\/runs\/([^/]+)\/tax-declaration$/);
  if (request.method === 'POST' && taxMatch) {
    requireTrustedToken(request, 'x-tax-accountant-approval-token', options.accountantApprovalToken, 'ACCOUNTANT_APPROVAL');
    const body = z.object({ actorId: z.string().min(1), mandateId: z.string().min(1), evidenceHash: sha256Schema, idempotencyKey: z.string().min(8) }).strict().parse(await boundedJson(request, 64 * 1024));
    const runId = decodeURIComponent(taxMatch[1]!);
    const occurredAt = new Date().toISOString();
    requireScopedAccountantMandate(options.accountantMandates, service, runId, body, 'record_tax_declaration', occurredAt);
    return json({ data: service.markTaxDeclared({ actorId: body.actorId, evidenceHash: body.evidenceHash, idempotencyKey: body.idempotencyKey, runId, occurredAt }) });
  }

  return null;
}

function requireScopedAccountantMandate(
  authorizer: AccountantMandateAuthorizer | null | undefined,
  service: FacturaEAgentService,
  runId: string,
  body: Readonly<{ actorId: string; mandateId: string }>,
  scope: AccountantMandateScope,
  at: string,
): void {
  if (!authorizer) throw new Error('ACCOUNTANT_MANDATE_STORE_REQUIRED');
  const run = service.getRun(runId);
  authorizer.requireAccountantMandate({
    mandateId: body.mandateId,
    workspaceId: run.workspaceId,
    accountantActorId: body.actorId,
    scope,
    at,
  });
}

function assertAgentInvocationScope(
  toolId: string,
  body: z.infer<typeof invocationSchema>,
  principal: TaxAgentPrincipalV1,
  service: FacturaEAgentService,
): void {
  if (toolId === 'tax_ar_homologation_get_preflight') return;
  const workspaceId = body.input.workspaceId;
  if (typeof workspaceId === 'string') {
    if (workspaceId !== principal.workspaceId) {
      throw new Error('TAX_AGENT_PRINCIPAL_WORKSPACE_UNAUTHORIZED');
    }
    if (
      toolId === 'tax_ar_factura_e_create_case'
      || toolId === 'tax_ar_factura_e_list_cases'
    ) return;
  }
  const runId = body.input.runId;
  if (typeof runId !== 'string') {
    throw new Error('TAX_AGENT_PRINCIPAL_WORKSPACE_BINDING_REQUIRED');
  }
  const run = service.getRun(runId);
  if (run.workspaceId !== principal.workspaceId) {
    throw new Error('TAX_AGENT_PRINCIPAL_WORKSPACE_UNAUTHORIZED');
  }
}

async function boundedJson(request: Request, maximumBytes = 1024 * 1024): Promise<unknown> {
  return JSON.parse(await readBoundedBody(
    request,
    maximumBytes,
    'TAX_AGENT_REQUEST_TOO_LARGE',
  )) as unknown;
}

async function invokeTool(
  toolId: string,
  body: z.infer<typeof invocationSchema>,
  service: FacturaEAgentService
): Promise<unknown> {
  const occurredAt = new Date().toISOString();
  switch (toolId) {
    case 'tax_ar_homologation_get_preflight': {
      z.object({}).strict().parse(body.input);
      return service.homologationPreflight();
    }
    case 'tax_ar_factura_e_create_case': {
      const input = z.object({ runId: z.uuid(), workspaceId: z.string().min(1), issuancePath: z.enum(['reclaim_copilot', 'wsfex_delegated']) }).strict().parse(body.input);
      return service.createRun({ ...input, actorId: body.actorId, idempotencyKey: body.idempotencyKey, occurredAt });
    }
    case 'tax_ar_factura_e_get_case': {
      const input = z.object({ runId: z.uuid() }).strict().parse(body.input);
      const run = service.getRun(input.runId);
      return { run, nextActions: service.nextActions(run) };
    }
    case 'tax_ar_factura_e_list_cases': {
      const input = z.object({ workspaceId: z.string().min(1) }).strict().parse(body.input);
      return { runs: service.listRuns(input.workspaceId) };
    }
    case 'tax_ar_factura_e_draft_intent': {
      const input = z.object({ runId: z.uuid(), intent: intentSchema }).strict().parse(body.input);
      return service.draftIntent({ ...input, asOf: occurredAt.slice(0, 10), actorId: body.actorId, idempotencyKey: body.idempotencyKey, occurredAt });
    }
    case 'tax_ar_factura_e_propose_from_evidence': {
      const input = evidenceProposalSchema.parse(body.input);
      return service.proposeIntentFromEvidence({ ...input, actorId: body.actorId, idempotencyKey: body.idempotencyKey, occurredAt });
    }
    case 'tax_ar_factura_e_get_copilot_packet': {
      const input = z.object({ runId: z.uuid() }).strict().parse(body.input);
      return service.copilotPacket(input.runId);
    }
    case 'tax_ar_factura_e_get_accounting_attestation_packet': {
      const input = z.object({ runId: z.uuid() }).strict().parse(body.input);
      return service.accountingAttestationPacket(input.runId);
    }
    case 'tax_ar_reclaim_start': {
      const input = z.object({
        runId: z.uuid(),
        purpose: z.enum(['arca_taxpayer_readiness', 'arca_cae_constatement', 'arca_adjustment_constatement']),
        subjectId: z.string().min(1).nullable().optional(),
      }).strict().parse(body.input);
      return service.startReclaim({ ...input, subjectId: input.subjectId ?? null, actorId: body.actorId, idempotencyKey: body.idempotencyKey, occurredAt });
    }
    case 'tax_ar_factura_e_request_approval': {
      const input = z.object({ runId: z.uuid() }).strict().parse(body.input);
      return service.requestApproval({ ...input, actorId: body.actorId, idempotencyKey: body.idempotencyKey, occurredAt });
    }
    case 'tax_ar_factura_e_submit_wsfex':
    case 'tax_ar_factura_e_recover_wsfex': {
      throw new Error('TAX_AUTHORITY_CORRIDOR_REQUIRED');
    }
    case 'tax_ar_factura_e_submit_adjustment_wsfex':
    case 'tax_ar_factura_e_recover_adjustment_wsfex': {
      throw new Error('TAX_AUTHORITY_CORRIDOR_REQUIRED');
    }
    case 'tax_ar_factura_e_prepare_adjustment': {
      const input = adjustmentSchema.parse(body.input);
      return service.prepareAdjustment({ ...input, actorId: body.actorId, idempotencyKey: body.idempotencyKey, occurredAt });
    }
    case 'tax_ar_factura_e_get_adjustment_copilot_packet': {
      const input = z.object({ runId: z.uuid(), adjustmentId: z.string().min(1) }).strict().parse(body.input);
      return service.adjustmentCopilotPacket(input.runId, input.adjustmentId);
    }
    default:
      throw new Error('UNKNOWN_AGENT_TOOL');
  }
}

function tool(name: string, description: string, parameters: Record<string, unknown>, executionPolicy: string): Readonly<Record<string, unknown>> {
  return { type: 'function', function: { name, description, parameters }, metadata: { executionPolicy } };
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
