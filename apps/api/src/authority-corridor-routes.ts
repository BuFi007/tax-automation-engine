import { z } from 'zod';
import { assertArcaFiscalBeta, assertFiscalHumanActor, type ArcaFiscalBetaConfig } from './arca-fiscal-beta';
import { ARGENTINA_FACTURA_E_RULE_IDS, hashCanonical, validateFacturaEIntent, type FacturaEIntentV1 } from '@tax-engine/core';

import { classifyApiError } from './api-errors';
import { readBoundedBody } from './bounded-body';
import type { FacturaEAuthorityExecutionService } from './authority-execution';
import type { FacturaEAgentService } from './factura-e-agent';
import type { TaxProfileStore } from './store';
import type { FacturaECommercialRequest } from './tax-owned-factura-e-authority-preparation';
import {
  type TaxAuthorityCapability,
  type TaxAuthorityPrincipalSecrets,
  verifyTaxAuthorityPrincipal,
} from './authority-principal';

const MAX_BODY_BYTES = 16 * 1024;
const workspaceIdSchema = z.union([
  z.uuid(),
  z.string().regex(/^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
]);
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
    ledgerInvoiceId: z.uuid(),
    intentHash: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const createTaxCaseSchema = z.object({
  version: z.literal('factura-e-tax-case-create-v1'),
  workspaceId: workspaceIdSchema,
  runId: z.uuid(),
  ledgerInvoiceId: z.uuid(),
  issuancePath: z.enum(['reclaim_copilot', 'wsfex_delegated']),
  idempotencyKey: idempotencyKeySchema,
}).strict();

const prepareTaxCaseSchema = z.object({
  version: z.literal('factura-e-tax-case-prepare-v1'),
  workspaceId: workspaceIdSchema,
  ledgerInvoiceId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
  manualQuote: z.object({
    decimal: z.string().regex(/^(?:[1-9]\d{0,3})(?:\.\d{1,6})?$/),
    observedForDate: z.iso.date(),
  }).strict(),
}).strict();

const authorityAttestationRequestSchema = z.object({
  version: z.literal('factura-e-invoice-authority-attestation-request-v1'),
  workspaceId: workspaceIdSchema,
  ledgerInvoiceId: z.uuid(),
  intentHash: sha256Schema,
}).strict();

const approveTaxIntentSchema = z.object({
  version: z.literal('factura-e-intent-approve-v1'),
  workspaceId: workspaceIdSchema,
  intentHash: sha256Schema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

const authorityAttestationSchema = z.object({
  version: z.literal('factura-e-invoice-authority-attestation-v1'),
  authorityExecutionId: z.uuid(),
  workspaceId: workspaceIdSchema,
  ledgerInvoiceId: z.uuid(),
  runId: z.uuid(),
  intentHash: sha256Schema,
  revision: z.number().int().positive(),
  authorityState: z.literal('officially_reconciled'),
  authorityEnvironment: z.enum(['homologation', 'production']),
  authorityProviderId: z.string().min(1).max(200),
  invoice: z.object({
    documentType: z.literal(19),
    pointOfSale: z.number().int().positive().max(99_998),
    invoiceNumber: z.string().regex(/^[1-9]\d{0,7}$/),
    cae: z.string().regex(/^\d{14}$/),
    caeExpiry: z.iso.date(),
    currencyId: z.literal('DOL'),
    currencyQuote: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
    authorizedAt: z.iso.datetime({ offset: true }),
    authorityReceiptHash: sha256Schema,
    issueDate: z.iso.date(),
    servicePeriod: z.object({ start: z.iso.date(), end: z.iso.date() }).strict(),
    paymentDate: z.iso.date(),
    destinationCountry: z.string().regex(/^[A-Z]{2}$/),
    customer: z.string().min(1).max(160),
    serviceDescription: z.string().min(1).max(4_000),
    amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/),
  }).strict(),
}).strict();

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
    beta?: ArcaFiscalBetaConfig;
    secrets: TaxAuthorityPrincipalSecrets;
    agent?: FacturaEAgentService;
    store?: TaxProfileStore;
    commercialGateway?: Readonly<{
      getFrozenCommercialRequest(input: Readonly<{
        workspaceId: string; runId: string; ledgerInvoiceId: string; idempotencyKey: string;
      }>): Promise<FacturaECommercialRequest>;
    }>;
    issuerProfiles?: ReadonlyMap<string, string>;
    environment?: 'homologation' | 'production';
  }>
): Promise<Response | null> {
  const route = matchRoute(request.method, url.pathname);
  if (!route) return null;
  try {
    if (!options.corridorEnabled)
      throw new Error('TAX_AUTHORITY_CORRIDOR_CONFIGURATION_REQUIRED');
    if (route.operation === 'case_read') {
      const runId = z.uuid().parse(decodeURIComponent(route.runId ?? ''));
      const principal = verifyTaxAuthorityPrincipal({
        request, rawBody: '', capability: route.capability, secrets: options.secrets,
      });
      if (options.beta) assertArcaFiscalBeta(principal.workspaceId, options.beta);
      if (!options.agent || !options.store)
        throw new Error('FACTURA_E_TAX_CASE_CONFIGURATION_REQUIRED');
      const binding = options.store.getFacturaETaxCaseBinding(runId);
      if (!binding) throw new Error('FACTURA_E_TAX_CASE_NOT_FOUND');
      assertPrincipalWorkspace(principal.workspaceId, binding.workspaceId);
      const run = options.agent.getRun(runId);
      if (run.workspaceId !== binding.workspaceId || run.issuancePath !== binding.issuancePath)
        throw new Error('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      if (run.intent && run.intentHash !== hashCanonical(run.intent))
        throw new Error('TAX_CASE_INTENT_HASH_MISMATCH');
      const nextAction = run.readinessState !== 'verified'
        ? 'collect_verified_evidence'
        : run.approvalState === 'pending'
          ? 'await_separate_human_approval'
          : run.approvalState === 'user_approved' && run.accountantReviewRequired
            ? 'await_accountant_approval'
          : run.intentState === 'frozen' && run.issuanceState === 'ready_for_wsfex'
            ? 'persist_authority_intent'
            : 'wait_for_tax_update';
      return privateJson({ data: {
        version: 'factura-e-tax-case-status-v1',
        runId, workspaceId: binding.workspaceId, ledgerInvoiceId: binding.ledgerInvoiceId,
        intentHash: run.intentHash, revision: run.revision, readinessState: run.readinessState,
        intentState: run.intentState, approvalState: run.approvalState,
        issuanceState: run.issuanceState, nextAction,
        review: run.intent && ['validated', 'frozen'].includes(run.intentState) ? {
          customer: run.intent.foreignCustomerSafeLabel,
          destinationCountry: run.intent.destinationCountry,
          pointOfSale: run.intent.pointOfSale,
          issueDate: run.intent.issueDate,
          servicePeriod: run.intent.servicePeriod ?? null,
          paymentDate: run.intent.paymentDate,
          serviceDescription: run.intent.serviceDescription,
          amount: run.intent.total.decimal,
          currency: run.intent.total.currency,
          sameCurrencyPayment: run.intent.sameCurrencyPayment,
        } : null,
      } }, 200);
    }
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
      if (options.beta) assertArcaFiscalBeta(principal.workspaceId, options.beta);
      assertPrincipalWorkspace(principal.workspaceId, workspaceId);
      return route.operation === 'readiness'
        ? privateJson({ data: { workspaceId, ...service.readiness() } }, 200)
        : privateJson({ data: service.current(workspaceId) }, 200);
    }
    if (route.operation === 'status_exact') {
      const executionId = z.uuid().parse(decodeURIComponent(route.executionId ?? ''));
      const principal = verifyTaxAuthorityPrincipal({
        request, rawBody: '', capability: route.capability, secrets: options.secrets,
      });
      if (options.beta) assertArcaFiscalBeta(principal.workspaceId, options.beta);
      return privateJson({ data: service.exactStatus(principal.workspaceId, executionId) }, 200);
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
    if (options.beta) {
      assertArcaFiscalBeta(principal.workspaceId, options.beta);
      assertFiscalHumanActor(principal.workspaceId, principal.actorId);
    }
    const occurredAt = new Date().toISOString();

    if (route.operation === 'case_create') {
      const body = createTaxCaseSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const { agent, store } = options;
      if (!agent || !store)
        throw new Error('FACTURA_E_TAX_CASE_CONFIGURATION_REQUIRED');
      const created = store.createFacturaETaxCaseBinding({
        ...body, actorId: principal.actorId, createdAt: occurredAt,
      }, () => agent.createRun({
        runId: body.runId, workspaceId: body.workspaceId,
        issuancePath: body.issuancePath, actorId: principal.actorId,
        idempotencyKey: body.idempotencyKey, occurredAt,
      }).run);
      return privateJson({ data: {
        version: 'factura-e-tax-case-receipt-v1',
        runId: created.run.runId, workspaceId: body.workspaceId,
        ledgerInvoiceId: body.ledgerInvoiceId, state: 'case_created',
        replayed: created.replayed, nextAction: 'collect_verified_evidence',
      } }, 200);
    }

    if (route.operation === 'case_prepare') {
      if (options.environment !== 'homologation')
        throw new Error('MANUAL_FACTURA_E_QUOTE_HOMOLOGATION_ONLY');
      const runId = z.uuid().parse(decodeURIComponent(route.runId ?? ''));
      const body = prepareTaxCaseSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const { agent, store, commercialGateway, issuerProfiles } = options;
      if (!agent || !store || !commercialGateway || !issuerProfiles)
        throw new Error('FACTURA_E_TAX_CASE_CONFIGURATION_REQUIRED');
      const binding = store.getFacturaETaxCaseBinding(runId);
      if (!binding || binding.workspaceId !== body.workspaceId
        || binding.ledgerInvoiceId !== body.ledgerInvoiceId
        || binding.issuancePath !== 'wsfex_delegated')
        throw new Error('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      const run = agent.getRun(runId);
      if (run.workspaceId !== body.workspaceId || run.issuancePath !== 'wsfex_delegated')
        throw new Error('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      const commercial = await commercialGateway.getFrozenCommercialRequest({
        workspaceId: body.workspaceId, runId, ledgerInvoiceId: body.ledgerInvoiceId,
        idempotencyKey: `commercial-request:${runId}`,
      });
      const { evidenceHash, ...commercialMaterial } = commercial;
      if (commercial.sourceKind !== 'pre_cae_commercial_request'
        || commercial.workspaceId !== body.workspaceId
        || commercial.runId !== runId
        || commercial.ledgerInvoiceId !== body.ledgerInvoiceId
        || commercial.idempotencyKey !== `commercial-request:${runId}`
        || commercial.foreignCustomerReferenceHash !== hashCanonical(commercial.customer)
        || evidenceHash !== hashCanonical(commercialMaterial)
        || commercial.sameCurrencyPayment !== false)
        throw new Error('FACTURA_E_COMMERCIAL_REQUEST_BINDING_CONFLICT');
      if (body.workspaceId.startsWith('personal:') && (
        !commercial.frozenManualQuote
        || Number(commercial.frozenManualQuote.decimal) !== Number(body.manualQuote.decimal)
        || commercial.frozenManualQuote.observedForDate !== body.manualQuote.observedForDate
        || commercial.frozenManualQuote.sourceReferenceId
          !== `manual-unverified-bna:${body.manualQuote.observedForDate}`
      )) throw new Error('PERSONAL_FACTURA_E_QUOTE_CONFLICT');
      const profileRef = issuerProfiles.get(body.workspaceId);
      if (!profileRef || !store.listArcaOnboardingRuns(body.workspaceId).some(candidate =>
        candidate.status === 'ready'
        && candidate.environment === 'homologation'
        && candidate.taxpayerReferenceHash === commercial.taxpayerReferenceHash
        && candidate.requestedServices.includes('wsfex')
        && candidate.delegation.wsfex
        && candidate.apiVerification.wsfex
        && candidate.pointOfSale.active
        && candidate.pointOfSale.number === commercial.requestedPointOfSale
        && candidate.authorityBinding?.issuerProfileReferenceHash === hashCanonical(profileRef)
        && !!candidate.authorityBinding.representedCuitCommitment
      )) throw new Error('TAX_ARCA_READY_ONBOARDING_REQUIRED');
      if (run.readinessState !== 'verified') throw new Error('ARCA_READINESS_PROOF_REQUIRED');
      const profile = store.get(body.workspaceId);
      if (!profile || profile.jurisdiction !== 'AR')
        throw new Error('CONFIRMED_ARGENTINA_TAX_PROFILE_REQUIRED');
      const expectedRegime = profile.regimeId === 'monotributo_exportador'
        ? 'monotributo'
        : profile.regimeId === 'responsable_inscripto'
          ? 'responsable_inscripto'
          : null;
      if (!expectedRegime) throw new Error('FACTURA_E_INDIVIDUAL_REGIME_REQUIRED');
      const proof = [...run.verifiedProofs].reverse().find(candidate =>
        candidate.purpose === 'arca_taxpayer_readiness'
      );
      if (!proof || !('regime' in proof.claims)
        || proof.claims.regime !== expectedRegime
        || proof.claims.exportActivityEnabled !== true
        || proof.claims.exportPointOfSale !== commercial.requestedPointOfSale)
        throw new Error('ARCA_READINESS_PROFILE_MISMATCH');
      const intent = intentFromCommercialRequest(commercial, body.manualQuote);
      const validation = validateFacturaEIntent(intent, occurredAt.slice(0, 10));
      if (!validation.valid) throw new Error(`FACTURA_E_COMMERCIAL_INTENT_INVALID_${validation.errors[0]}`);
      if (run.intentHash && run.intentHash !== validation.intentHash)
        throw new Error('FACTURA_E_TAX_CASE_INTENT_CONFLICT');
      if (!run.intent) agent.draftIntent({
        runId, intent, asOf: occurredAt.slice(0, 10), actorId: principal.actorId,
        idempotencyKey: `commercial-draft:${hashCanonical({ runId, key: body.idempotencyKey })}`,
        occurredAt,
      });
      const prepared = agent.getRun(runId);
      if (prepared.approvalState === 'not_requested') agent.requestApproval({
        runId, actorId: principal.actorId,
        idempotencyKey: `commercial-review:${hashCanonical({ runId, key: body.idempotencyKey })}`,
        occurredAt,
      });
      const current = agent.getRun(runId);
      return privateJson({ data: {
        version: 'factura-e-commercial-intent-preparation-v1',
        workspaceId: body.workspaceId, runId, ledgerInvoiceId: body.ledgerInvoiceId,
        intentHash: validation.intentHash,
        approvalState: current.approvalState,
        commercialRequestEvidenceHash: commercial.evidenceHash,
        quoteStatus: 'manual_homologation_accountant_review_required',
      } }, 200);
    }

    if (route.operation === 'case_attest') {
      const runId = z.uuid().parse(decodeURIComponent(route.runId ?? ''));
      const body = authorityAttestationRequestSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const { agent, store } = options;
      if (!agent || !store)
        throw new Error('FACTURA_E_TAX_CASE_CONFIGURATION_REQUIRED');
      const binding = store.getFacturaETaxCaseBinding(runId);
      if (!binding || binding.workspaceId !== body.workspaceId
        || binding.ledgerInvoiceId !== body.ledgerInvoiceId
        || binding.issuancePath !== 'wsfex_delegated')
        throw new Error('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      const execution = service.reconciledForRun(body.workspaceId, runId);
      if (!execution) throw new Error('TAX_AUTHORITY_ATTESTATION_NOT_READY_RETRYABLE');
      const run = agent.getRun(runId);
      if (execution.runId !== runId || execution.workspaceId !== body.workspaceId
        || execution.intentHash !== body.intentHash
        || execution.requestId !== run.authority.requestId
        || execution.authorityPayloadReferenceHash !== run.authority.payloadReferenceHash
        || execution.receiptHash !== run.authority.receiptHash
        || run.workspaceId !== body.workspaceId || run.issuancePath !== binding.issuancePath
        || run.intentState !== 'frozen' || run.issuanceState !== 'arca_authorized'
        || !run.intent || run.intent.workspaceId !== body.workspaceId
        || !run.intent.servicePeriod
        || run.intent.total.currency !== 'USD'
        || (body.workspaceId.startsWith('personal:') && run.intent.sameCurrencyPayment !== false)
        || run.intentHash !== body.intentHash || hashCanonical(run.intent) !== body.intentHash
        || !execution.authorityIdentityHash
        || !sha256Schema.safeParse(execution.authorityIdentityHash).success)
        throw new Error('TAX_AUTHORITY_ATTESTATION_BINDING_CONFLICT');
      const attestation = authorityAttestationSchema.safeParse({
        version: 'factura-e-invoice-authority-attestation-v1',
        authorityExecutionId: execution.executionId,
        workspaceId: body.workspaceId,
        ledgerInvoiceId: binding.ledgerInvoiceId,
        runId,
        intentHash: body.intentHash,
        revision: run.revision,
        authorityState: 'officially_reconciled',
        authorityEnvironment: execution.authorityEnvironment,
        authorityProviderId: execution.authorityProviderId,
        invoice: {
          documentType: run.intent.documentType,
          pointOfSale: run.intent.pointOfSale,
          invoiceNumber: run.authority.invoiceNumber,
          cae: run.authority.cae,
          caeExpiry: run.authority.caeExpiry,
          currencyId: run.authority.currencyId,
          currencyQuote: run.authority.currencyQuote,
          authorizedAt: run.authority.authorizedAt,
          authorityReceiptHash: run.authority.receiptHash,
          issueDate: run.intent.issueDate,
          servicePeriod: run.intent.servicePeriod,
          paymentDate: run.intent.paymentDate,
          destinationCountry: run.intent.destinationCountry,
          customer: run.intent.foreignCustomerSafeLabel,
          serviceDescription: run.intent.serviceDescription,
          amount: run.intent.total.decimal,
        },
      });
      if (!attestation.success) throw new Error('TAX_AUTHORITY_ATTESTATION_INCOMPLETE');
      return privateJson({ data: attestation.data }, 200);
    }

    if (route.operation === 'intent_approve') {
      const runId = z.uuid().parse(decodeURIComponent(route.runId ?? ''));
      const body = approveTaxIntentSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const { agent, store } = options;
      if (!agent || !store)
        throw new Error('FACTURA_E_TAX_CASE_CONFIGURATION_REQUIRED');
      const binding = store.getFacturaETaxCaseBinding(runId);
      if (!binding || binding.workspaceId !== body.workspaceId
        || binding.issuancePath !== 'wsfex_delegated')
        throw new Error('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      const current = agent.getRun(runId);
      if (current.workspaceId !== binding.workspaceId
        || current.issuancePath !== binding.issuancePath
        || !current.intent || current.intentHash !== body.intentHash
        || hashCanonical(current.intent) !== body.intentHash)
        throw new Error('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      const approved = agent.approveIntent({
        runId, actorId: principal.actorId, intentHash: body.intentHash,
        idempotencyKey: body.idempotencyKey, occurredAt,
      });
      return privateJson({ data: {
        version: 'factura-e-intent-approval-receipt-v1',
        runId, workspaceId: body.workspaceId, intentHash: body.intentHash,
        approvalState: approved.run.approvalState,
        issuanceState: approved.run.issuanceState,
        replayed: approved.replayed,
      } }, 200);
    }

    if (route.operation === 'create') {
      const body = createIntentSchema.parse(JSON.parse(rawBody) as unknown);
      assertPrincipalWorkspace(principal.workspaceId, body.workspaceId);
      const { agent, store } = options;
      if (!agent || !store)
        throw new Error('FACTURA_E_TAX_CASE_CONFIGURATION_REQUIRED');
      const binding = store.getFacturaETaxCaseBinding(body.runId);
      if (!binding || binding.workspaceId !== body.workspaceId
        || binding.ledgerInvoiceId !== body.ledgerInvoiceId
        || binding.issuancePath !== 'wsfex_delegated')
        throw new Error('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      const run = agent.getRun(body.runId);
      const awaitingAccountant = Boolean(options.beta && run.accountantReviewRequired
        && run.approvalState === 'user_approved' && run.issuanceState === 'not_ready');
      if (run.workspaceId !== binding.workspaceId || run.issuancePath !== binding.issuancePath
        || run.intentState !== 'frozen' || (run.issuanceState !== 'ready_for_wsfex' && !awaitingAccountant)
        || !run.intent || run.intent.workspaceId !== binding.workspaceId
        || run.intentHash !== body.intentHash || hashCanonical(run.intent) !== body.intentHash)
        throw new Error('TAX_AUTHORITY_FROZEN_APPROVED_INTENT_REQUIRED');
      const taxpayerReferenceHash = sha256Schema.parse(run.intent.taxpayerReferenceHash);
      const foreignCustomerReferenceHash = sha256Schema.parse(run.intent.foreignCustomerReferenceHash);
      return privateJson({
        data: {
          ...service.createIntent({
          workspaceId: body.workspaceId,
          runId: body.runId,
          intentHash: body.intentHash,
          idempotencyKey: body.idempotencyKey,
          actorId: principal.actorId,
          occurredAt,
          allowAwaitingAccountantReview: awaitingAccountant,
          }),
          preparationBinding: {
            version: 'factura-e-authority-preparation-binding-v1',
            ledgerInvoiceId: binding.ledgerInvoiceId,
            taxpayerReferenceHash,
            foreignCustomerReferenceHash,
          },
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

function intentFromCommercialRequest(
  commercial: FacturaECommercialRequest,
  manualQuote: z.infer<typeof prepareTaxCaseSchema>['manualQuote']
): FacturaEIntentV1 {
  if (commercial.customer.name.length > 160)
    throw new Error('FACTURA_E_CUSTOMER_LABEL_TOO_LONG');
  return {
    version: 'factura-e-intent-v1',
    intentId: commercial.ledgerInvoiceId,
    workspaceId: commercial.workspaceId,
    taxpayerReferenceHash: commercial.taxpayerReferenceHash,
    foreignCustomerReferenceHash: commercial.foreignCustomerReferenceHash,
    foreignCustomerSafeLabel: commercial.customer.name,
    destinationCountry: commercial.customer.countryIso2,
    destinationCountryArcaCode: commercial.customer.countryArcaCode,
    documentType: 19,
    operationType: 2,
    pointOfSale: commercial.requestedPointOfSale,
    issueDate: commercial.issueDate,
    servicePeriod: commercial.servicePeriod,
    paymentDate: commercial.paymentDate,
    sameCurrencyPayment: commercial.sameCurrencyPayment,
    exchangeRate: {
      decimal: manualQuote.decimal,
      sourceReferenceId: `manual-unverified-bna:${manualQuote.observedForDate}`,
      observedForDate: manualQuote.observedForDate,
      authorityRuleDecisionId: 'homologation-manual-quote-accountant-review-v1',
    },
    lineItems: [{
      description: commercial.description,
      quantity: '1', unitPrice: commercial.amount,
      total: commercial.amount, unitCode: 7,
    }],
    total: { decimal: commercial.amount, currency: commercial.currency },
    serviceDescription: commercial.description,
    paymentTerms: `Pago hasta ${commercial.paymentDate}`,
    ruleVersionIds: [...ARGENTINA_FACTURA_E_RULE_IDS],
  };
}

function matchRoute(method: string, pathname: string): Readonly<{
  operation: 'case_create' | 'case_read' | 'case_prepare' | 'case_attest' | 'intent_approve' | 'readiness' | 'status' | 'status_exact' | 'create' | 'approve' | 'execute' | 'recover' | 'reconcile';
  capability: TaxAuthorityCapability;
  workspaceId?: string;
  executionId?: string;
  runId?: string;
}> | null {
  if (method === 'POST' && pathname === '/v1/authority/factura-e/cases')
    return { operation: 'case_create', capability: 'factura-e:case:create' };
  const taxCase = pathname.match(/^\/v1\/authority\/factura-e\/cases\/([^/]+)$/);
  if (method === 'GET' && taxCase)
    return { operation: 'case_read', capability: 'factura-e:case:read', runId: taxCase[1]! };
  const prepare = pathname.match(/^\/v1\/authority\/factura-e\/cases\/([^/]+)\/prepare$/);
  if (method === 'POST' && prepare)
    return { operation: 'case_prepare', capability: 'factura-e:case:prepare', runId: prepare[1]! };
  const attestation = pathname.match(/^\/v1\/authority\/factura-e\/cases\/([^/]+)\/authority-attestation$/);
  if (method === 'POST' && attestation)
    return { operation: 'case_attest', capability: 'factura-e:authority:attest', runId: attestation[1]! };
  const intentApproval = pathname.match(/^\/v1\/authority\/factura-e\/cases\/([^/]+)\/intent-approval$/);
  if (method === 'POST' && intentApproval)
    return { operation: 'intent_approve', capability: 'factura-e:intent:approve', runId: intentApproval[1]! };
  if (method === 'POST' && pathname === '/v1/authority/factura-e/intents')
    return { operation: 'create', capability: 'factura-e:intent:create' };
  const exactStatus = pathname.match(/^\/v1\/authority\/factura-e\/intents\/([^/]+)\/status$/);
  if (method === 'GET' && exactStatus)
    return { operation: 'status_exact', capability: 'factura-e:status:read', executionId: exactStatus[1]! };
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
