import { describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashCanonical, type FacturaEIntentV1 } from '@tax-engine/core';

import { handleFacturaEAuthorityCorridorRoute } from './authority-corridor-routes';
import { handleAccountantInvoiceRoute } from './accountant-invoice-routes';
import { FacturaEAuthorityExecutionService, FacturaEAuthorityExecutionStore } from './authority-execution';
import { createTaxAuthorityPrincipalHeaders, type TaxAuthorityCapability } from './authority-principal';
import { FacturaEAgentService } from './factura-e-agent';
import { TaxProfileStore } from './store';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const otherWorkspaceId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const ledgerInvoiceId = '44444444-4444-4444-8444-444444444444';
const otherInvoiceId = '55555555-5555-4555-8555-555555555555';
const idempotencyKey = '66666666-6666-4666-8666-666666666666';
const secret = 'motora-tax-case-secret-111111111111111111111';
const optionsFor = (store: TaxProfileStore) => ({
  corridorEnabled: true,
  secrets: { motora: secret, openAgentsApproval: 'approval-secret-222222222222222222222222' },
  agent: new FacturaEAgentService(store, null, null),
  store,
});
const authorityService = {} as FacturaEAuthorityExecutionService;

function signedRequest(
  method: 'GET' | 'POST', path: string, capability: TaxAuthorityCapability,
  body: unknown = null, principalWorkspaceId = workspaceId, actorId = 'motora:creator',
): Request {
  const rawBody = body === null ? '' : JSON.stringify(body);
  return new Request(`https://tax.test${path}`, {
    method,
    headers: {
      ...createTaxAuthorityPrincipalHeaders({
        secret, workspaceId: principalWorkspaceId, actorId, capability,
        method, path, rawBody,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }),
      ...(body === null ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === null ? {} : { body: rawBody }),
  });
}

async function route(store: TaxProfileStore, request: Request): Promise<Response> {
  const response = await handleFacturaEAuthorityCorridorRoute(
    request, new URL(request.url), authorityService, optionsFor(store),
  );
  if (!response) throw new Error('Expected TaxCase route');
  return response;
}

describe('signed Workspace Factura E TaxCase corridor', () => {
  test('rejects a Personal quote that differs from the signed reservation', async () => {
    const personalScope = `personal:${workspaceId}`;
    const store = new TaxProfileStore(':memory:');
    const agent = new FacturaEAgentService(store, null, null);
    const occurredAt = new Date().toISOString();
    try {
      store.createFacturaETaxCaseBinding({
        runId, workspaceId: personalScope, ledgerInvoiceId,
        issuancePath: 'wsfex_delegated', actorId: workspaceId,
        idempotencyKey, createdAt: occurredAt,
      }, () => agent.createRun({
        runId, workspaceId: personalScope, issuancePath: 'wsfex_delegated',
        actorId: workspaceId, idempotencyKey, occurredAt,
      }).run);
      const customer = {
        name: 'Foreign customer', address: '123 Main St', foreignTaxId: 'US-TAX-ID',
        countryIso2: 'US', countryArcaCode: 200,
      };
      const snapshot = {
        version: 'desk-factura-e-commercial-request-v1' as const,
        sourceKind: 'pre_cae_commercial_request' as const,
        workspaceId: personalScope, runId, ledgerInvoiceId,
        idempotencyKey: `commercial-request:${runId}`,
        taxpayerReferenceHash: 'a'.repeat(64),
        foreignCustomerReferenceHash: hashCanonical(customer), customer,
        requestedPointOfSale: 2, issueDate: '2026-09-23',
        servicePeriod: { start: '2026-09-01', end: '2026-09-23' },
        paymentDate: '2026-10-01', amount: '100.00', currency: 'USD' as const,
        description: 'Creative services',
        frozenManualQuote: {
          decimal: '1200.25', observedForDate: '2026-09-22',
          sourceReferenceId: 'manual-unverified-bna:2026-09-22',
        },
        sameCurrencyPayment: false as const,
        frozenAt: occurredAt,
      };
      const path = `/v1/authority/factura-e/cases/${runId}/prepare`;
      const body = {
        version: 'factura-e-tax-case-prepare-v1', workspaceId: personalScope,
        ledgerInvoiceId, idempotencyKey: 'personal-prepare-123456',
        manualQuote: { decimal: '1200.26', observedForDate: '2026-09-22' },
      };
      const request = signedRequest('POST', path, 'factura-e:case:prepare', body, personalScope, workspaceId);
      const response = await handleFacturaEAuthorityCorridorRoute(
        request, new URL(request.url), authorityService,
        { ...optionsFor(store), agent, environment: 'homologation',
          commercialGateway: { getFrozenCommercialRequest: async () => ({
            ...snapshot, evidenceHash: hashCanonical(snapshot),
          }) },
          issuerProfiles: new Map([[personalScope, 'vault://issuer/test']]),
        },
      );
      expect((await response!.json() as any).error).toBe('PERSONAL_FACTURA_E_QUOTE_CONFLICT');
      expect(response?.status).toBe(409);
      expect(agent.getRun(runId).intentState).toBe('missing');
      const matchingQuote = signedRequest('POST', path, 'factura-e:case:prepare', {
        ...body, manualQuote: { decimal: '1200.25', observedForDate: '2026-09-22' },
      }, personalScope, workspaceId);
      const matchingResponse = await handleFacturaEAuthorityCorridorRoute(
        matchingQuote, new URL(matchingQuote.url), authorityService,
        { ...optionsFor(store), agent, environment: 'homologation',
          commercialGateway: { getFrozenCommercialRequest: async () => ({
            ...snapshot, evidenceHash: hashCanonical(snapshot),
          }) },
          issuerProfiles: new Map([[personalScope, 'vault://issuer/test']]),
        },
      );
      expect((await matchingResponse!.json() as any).error).not.toBe('PERSONAL_FACTURA_E_QUOTE_CONFLICT');
    } finally {
      store.close();
    }
  });

  test('prepares a reviewable intent only from the exact signed pre-CAE invoice in homologation', async () => {
    const store = new TaxProfileStore(':memory:');
    const agent = new FacturaEAgentService(store, null, null);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const occurredAt = new Date().toISOString();
    const issuerProfileRef = 'vault://issuer/test';
    const taxpayerReferenceHash = 'a'.repeat(64);
    const customer = {
      name: 'Foreign customer', address: '123 Main St', foreignTaxId: 'US-TAX-ID',
      countryIso2: 'US', countryArcaCode: 200,
    };
    const snapshot = {
      version: 'desk-factura-e-commercial-request-v1' as const,
      sourceKind: 'pre_cae_commercial_request' as const,
      workspaceId, runId, ledgerInvoiceId,
      idempotencyKey: `commercial-request:${runId}`,
      taxpayerReferenceHash,
      foreignCustomerReferenceHash: hashCanonical(customer),
      customer, requestedPointOfSale: 2, issueDate: today,
      servicePeriod: { start: today, end: today }, paymentDate: today,
      amount: '100.00', currency: 'USD' as const,
      description: 'Creative services', sameCurrencyPayment: false as const, frozenAt: occurredAt,
    };
    const commercial = { ...snapshot, evidenceHash: hashCanonical(snapshot) };
    try {
      store.confirm({
        profile: {
          profileId: 'profile-export-test', workspaceId, jurisdiction: 'AR',
          entityType: 'individual', regimeId: 'monotributo_exportador',
          ownerDomicileCountries: ['AR'], ownerTaxResidenceCountries: ['AR'],
          formationSubdivision: null, operatingSubdivisions: ['AR-C'],
          answers: [
            { questionId: 'province', value: 'AR-C', confirmationState: 'user_confirmed' },
            { questionId: 'iibb_regime', value: 'caba_simplified', confirmationState: 'accountant_confirmed' },
            { questionId: 'exports_services', value: true, confirmationState: 'user_confirmed' },
            { questionId: 'export_pos_ready', value: true, confirmationState: 'user_confirmed' },
            { questionId: 'monotributo_category', value: 'A', confirmationState: 'user_confirmed' },
          ],
          catalogueVersion: 'ar-catalogue-2026-07-16.2', version: 'profile-v0',
          confirmationState: 'user_confirmed',
        }, expectedVersion: null, actorId: 'user:owner',
        occurredAt,
      });
      store.createFacturaETaxCaseBinding({
        runId, workspaceId, ledgerInvoiceId, issuancePath: 'wsfex_delegated',
        actorId: 'motora:creator', idempotencyKey, createdAt: occurredAt,
      }, () => agent.createRun({
        runId, workspaceId, issuancePath: 'wsfex_delegated',
        actorId: 'motora:creator', idempotencyKey, occurredAt,
      }).run);
      const run = agent.getRun(runId);
      const ready = {
        ...run, revision: run.revision + 1, updatedAt: occurredAt,
        readinessState: 'verified' as const,
        verifiedProofs: [{ purpose: 'arca_taxpayer_readiness', claims: {
          regime: 'monotributo', category: 'A', exportActivityEnabled: true,
          exportPointOfSale: 2,
        } }],
      } as unknown as typeof run;
      store.appendFacturaEAgentRevision({
        run: ready, stateHash: hashCanonical(ready), commandHash: 'c'.repeat(64),
        appendedAt: occurredAt,
        event: { eventId: crypto.randomUUID(), runId, workspaceId,
          actorId: 'test', actorKind: 'system', action: 'test_readiness',
          occurredAt, idempotencyKey: 'test-readiness-123456', safeMetadata: {},
        },
      });
      const onboardingId = crypto.randomUUID();
      const onboarding = {
        onboardingId, workspaceId, revision: 1, status: 'ready',
        environment: 'homologation', taxpayerReferenceHash,
        requestedServices: ['wsfex'], delegation: { wsfex: true, wsfe: false },
        apiVerification: { wsfex: true, wsfe: false, observedAt: occurredAt },
        pointOfSale: { number: 2, active: true, source: 'discovered' },
        authorityBinding: {
          issuerProfileReferenceHash: hashCanonical(issuerProfileRef),
          representedCuitCommitment: 'd'.repeat(64),
        }, updatedAt: occurredAt,
      } as unknown as Parameters<TaxProfileStore['appendArcaOnboardingRevision']>[0]['run'];
      store.appendArcaOnboardingRevision({
        run: onboarding, stateHash: hashCanonical(onboarding), appendedAt: occurredAt,
        event: { onboardingId, workspaceId, idempotencyKey: 'test-onboarding-123456' } as Parameters<TaxProfileStore['appendArcaOnboardingRevision']>[0]['event'],
      });
      const path = `/v1/authority/factura-e/cases/${runId}/prepare`;
      const body = { version: 'factura-e-tax-case-prepare-v1', workspaceId, ledgerInvoiceId,
        idempotencyKey: 'prepare-commercial-intent-123456',
        manualQuote: { decimal: '1200.25', observedForDate: yesterday },
      };
      const corridorOptions = {
        ...optionsFor(store), agent,
        commercialGateway: { getFrozenCommercialRequest: async () => commercial },
        issuerProfiles: new Map([[workspaceId, issuerProfileRef]]),
        environment: 'homologation' as const,
      };
      const sameCurrencySnapshot = { ...snapshot, sameCurrencyPayment: true };
      const wrongCurrency = signedRequest('POST', path, 'factura-e:case:prepare', body);
      const wrongCurrencyResponse = await handleFacturaEAuthorityCorridorRoute(
        wrongCurrency, new URL(wrongCurrency.url), authorityService, {
          ...corridorOptions,
          commercialGateway: { getFrozenCommercialRequest: async () => ({
            ...sameCurrencySnapshot, evidenceHash: hashCanonical(sameCurrencySnapshot),
          }) },
        },
      );
      expect(wrongCurrencyResponse?.status).toBe(409);
      expect(agent.getRun(runId).intentState).toBe('missing');
      const wrongInvoice = signedRequest('POST', path, 'factura-e:case:prepare', {
        ...body, ledgerInvoiceId: otherInvoiceId,
      });
      const refused = await handleFacturaEAuthorityCorridorRoute(
        wrongInvoice, new URL(wrongInvoice.url), authorityService, corridorOptions,
      );
      expect(refused?.status).not.toBe(200);
      expect(agent.getRun(runId).intentState).toBe('missing');
      const production = signedRequest('POST', path, 'factura-e:case:prepare', body);
      const productionRefused = await handleFacturaEAuthorityCorridorRoute(
        production, new URL(production.url), authorityService,
        { ...corridorOptions, environment: 'production' },
      );
      expect(productionRefused?.status).not.toBe(200);
      expect(agent.getRun(runId).intentState).toBe('missing');
      const request = signedRequest('POST', path, 'factura-e:case:prepare', body);
      const response = await handleFacturaEAuthorityCorridorRoute(request, new URL(request.url), authorityService, {
        ...corridorOptions,
      });
      expect(response?.status).toBe(200);
      expect((await response!.json() as any).data).toMatchObject({
        runId, ledgerInvoiceId, commercialRequestEvidenceHash: commercial.evidenceHash,
        approvalState: 'pending', quoteStatus: 'manual_homologation_accountant_review_required',
      });
      expect(agent.getRun(runId)).toMatchObject({
        intentState: 'validated', approvalState: 'pending',
        intent: { total: { decimal: '100.00', currency: 'USD' },
          taxpayerReferenceHash, foreignCustomerReferenceHash: hashCanonical(customer),
          servicePeriod: { start: today, end: today }, sameCurrencyPayment: false,
        },
      });
      const reviewPath = `/v1/authority/factura-e/cases/${runId}`;
      const review = await route(store, signedRequest('GET', reviewPath, 'factura-e:case:read'));
      expect((await review.json() as any).data.review).toMatchObject({
        currency: 'USD', sameCurrencyPayment: false,
      });
      const intentHash = agent.getRun(runId).intentHash!;
      agent.approveIntent({ runId, actorId: 'user:owner', intentHash,
        idempotencyKey: 'user-approval-commercial-123456', occurredAt });
      const firmId = '77777777-7777-4777-8777-777777777777';
      const accountantId = '88888888-8888-4888-8888-888888888888';
      const mandateId = 'commercial-invoice-review-mandate';
      store.grantAccountantMandate({
        version: 'accountant-mandate-v1', mandateId, workspaceId,
        accountantActorId: accountantId, accountantOrganizationId: firmId,
        scopes: ['approve_invoice_intent'], grantedByActorId: 'user:owner',
        grantedAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(), revokedAt: null,
      });
      const principal = { version: 'tax-tenant-principal-v2' as const,
        workspaceId: firmId, actorId: accountantId,
        capability: 'accountant:review-queue' as const,
        expiresAt: new Date(Date.now() + 60_000).toISOString() };
      const queueUrl = new URL(`https://tax.test/v1/accountant-invoice-review-queue?workspaceId=${workspaceId}`);
      const queue = await handleAccountantInvoiceRoute(
        new Request(queueUrl), queueUrl, store, agent, principal,
      );
      expect((await queue!.json() as any).data.items).toMatchObject([{
        runId, ledgerInvoiceId, intentHash, mandateId,
        review: { amount: '100.00', exchangeRate: {
          decimal: '1200.25', sourceReferenceId: `manual-unverified-bna:${yesterday}`,
        } },
      }]);
      const foreignFirm = await handleAccountantInvoiceRoute(
        new Request(queueUrl), queueUrl, store, agent,
        { ...principal, workspaceId: otherWorkspaceId },
      );
      expect((await foreignFirm!.json() as any).data.items).toEqual([]);
      const approvalUrl = new URL('https://tax.test/v1/accountant-invoice-approvals');
      const approvalPrincipal = { ...principal, version: 'tax-tenant-principal-v3' as const,
        capability: 'accountant:decision' as const, method: 'POST' as const,
        path: approvalUrl.pathname, bodyHash: 'a'.repeat(64) };
      const command = { workspaceId, runId, intentHash, mandateId,
        idempotencyKey: 'commercial-accountant-approval-123456' };
      const approve = (body: typeof command) => handleAccountantInvoiceRoute(
        new Request(approvalUrl, { method: 'POST' }), approvalUrl, store, agent,
        approvalPrincipal, new Date(), JSON.stringify(body),
      );
      await expect(approve({ ...command, intentHash: 'a'.repeat(64) }))
        .rejects.toThrow('ACCOUNTANT_INVOICE_REVIEW_CHANGED');
      expect((await (await approve(command))!.json() as any).data).toMatchObject({
        runId, intentHash, approvalState: 'accountant_approved', replayed: false,
      });
      expect((await (await approve(command))!.json() as any).data.replayed).toBe(true);
    } finally { store.close(); }
  });
  test('persists only an exactly bound frozen intent, with exact replay and no invoice switching', async () => {
    const store = new TaxProfileStore(':memory:');
    const executionStore = new FacturaEAuthorityExecutionStore(':memory:', false);
    const agent = new FacturaEAgentService(store, null, null);
    const occurredAt = '2026-07-15T12:00:00.000Z';
    const intent: FacturaEIntentV1 = {
      version: 'factura-e-intent-v1', intentId: crypto.randomUUID(), workspaceId,
      taxpayerReferenceHash: 'a'.repeat(64),
      foreignCustomerReferenceHash: 'b'.repeat(64),
      foreignCustomerSafeLabel: 'Client', destinationCountry: 'US',
      destinationCountryArcaCode: 212, documentType: 19, operationType: 2,
      pointOfSale: 2, issueDate: '2026-07-15', servicePeriod: { start: '2026-07-01', end: '2026-07-31' }, paymentDate: '2026-08-15',
      sameCurrencyPayment: true,
      exchangeRate: {
        decimal: '1200.25', sourceReferenceId: 'test-fx',
        observedForDate: '2026-07-15', authorityRuleDecisionId: 'test-rule',
      },
      lineItems: [{ description: 'Services', quantity: '1', unitPrice: '100', total: '100', unitCode: 7 }],
      total: { decimal: '100', currency: 'USD' },
      serviceDescription: 'Services', paymentTerms: 'Net 30', ruleVersionIds: [],
    };
    try {
      const created = store.createFacturaETaxCaseBinding({
        runId, workspaceId, ledgerInvoiceId, issuancePath: 'wsfex_delegated',
        actorId: 'motora:creator', idempotencyKey, createdAt: occurredAt,
      }, () => agent.createRun({
        runId, workspaceId, issuancePath: 'wsfex_delegated',
        actorId: 'motora:creator', idempotencyKey, occurredAt,
      }).run);
      const frozen = {
        ...created.run, revision: 2, updatedAt: occurredAt,
        readinessState: 'verified' as const, intentState: 'frozen' as const,
        approvalState: 'accountant_approved' as const,
        issuanceState: 'ready_for_wsfex' as const,
        intent, intentHash: hashCanonical(intent),
      };
      store.appendFacturaEAgentRevision({
        run: frozen, stateHash: hashCanonical(frozen), commandHash: 'c'.repeat(64),
        appendedAt: occurredAt,
        event: {
          eventId: crypto.randomUUID(), runId, workspaceId, actorId: 'accountant',
          actorKind: 'accountant', action: 'test_frozen_intent', occurredAt,
          idempotencyKey: 'frozen-intent-test-123456', safeMetadata: {},
        },
      });
      const service = new FacturaEAuthorityExecutionService(
        executionStore,
        id => {
          const run = agent.getRun(id);
          return { workspaceId: run.workspaceId, intentHash: run.intentHash, issuanceState: run.issuanceState };
        },
        null, false,
      );
      const path = '/v1/authority/factura-e/intents';
      const body = {
        version: 'factura-e-authority-intent-create-v1', workspaceId, runId,
        ledgerInvoiceId, intentHash: frozen.intentHash,
        idempotencyKey: 'motora-frozen-intent-123456',
      };
      const call = async (candidate: unknown) => {
        const request = signedRequest('POST', path, 'factura-e:intent:create', candidate);
        const response = await handleFacturaEAuthorityCorridorRoute(
          request, new URL(request.url), service, optionsFor(store),
        );
        if (!response) throw new Error('Expected authority intent route');
        return response;
      };
      const first = await call(body);
      expect(first.status).toBe(200);
      const firstReceipt = (await first.json() as any).data;
      expect(firstReceipt).toEqual({
        version: 'factura-e-authority-execution-receipt-v1',
        executionId: firstReceipt.executionId, workspaceId,
        state: 'intent_persisted', replayed: false, nextAction: 'register_oa_approval',
        preparationBinding: {
          version: 'factura-e-authority-preparation-binding-v1', ledgerInvoiceId,
          taxpayerReferenceHash: intent.taxpayerReferenceHash,
          foreignCustomerReferenceHash: intent.foreignCustomerReferenceHash,
        },
      });
      const replay = await call(body);
      expect(replay.status).toBe(200);
      expect((await replay.json() as any).data).toEqual({ ...firstReceipt, replayed: true });
      service.registerApproval({
        executionId: firstReceipt.executionId, workspaceId,
        intentHash: frozen.intentHash,
        approvalRef: 'oa_approval_abcdefghijklmnopqrstuvwx',
        actorId: 'oa:separate-approver', idempotencyKey: 'oa-separate-approval-123456',
        occurredAt: '2026-07-15T12:01:00.000Z',
      });
      const laterReplay = await call(body);
      expect((await laterReplay.json() as any).data).toMatchObject({
        executionId: firstReceipt.executionId, state: 'approved',
        replayed: true, nextAction: 'execute_with_one_use_approval',
        preparationBinding: firstReceipt.preparationBinding,
      });
      const attestationPath = `/v1/authority/factura-e/cases/${runId}/authority-attestation`;
      const attestationBody = {
        version: 'factura-e-invoice-authority-attestation-request-v1',
        workspaceId, ledgerInvoiceId, intentHash: frozen.intentHash,
      };
      const attest = async (candidate: unknown) => {
        const request = signedRequest('POST', attestationPath, 'factura-e:authority:attest', candidate);
        const response = await handleFacturaEAuthorityCorridorRoute(
          request, new URL(request.url), serviceForAttestation, optionsFor(store),
        );
        if (!response) throw new Error('Expected authority attestation route');
        return response;
      };
      const officialReceiptHash = 'd'.repeat(64);
      const serviceForAttestation = new FacturaEAuthorityExecutionService(
        executionStore,
        id => {
          const run = agent.getRun(id);
          return { workspaceId: run.workspaceId, intentHash: run.intentHash, issuanceState: run.issuanceState };
        },
        {
          async prepare(input) {
            return {
              ...input, requestId: '101',
              authorityPayloadRef: 'vault://wsfex/test-authority-payload',
              authorityPayloadHash: 'e'.repeat(64),
            };
          },
          async execute() { return { status: 'authority_accepted_unverified', receiptHash: 'f'.repeat(64) }; },
          async recover() { throw new Error('NOT_USED'); },
          async reconcile(input) {
            agent.recordAuthorityCorridorReconciliation({
              runId, requestId: input.requestId,
              authorityPayloadRef: input.authorityPayloadRef,
              invoiceNumber: '6', cae: '12345678901234', caeExpiry: '2026-07-25',
              currencyId: 'DOL', currencyQuote: '1200.25',
              receiptHash: officialReceiptHash, reprocessed: null,
              actorId: 'authority:wsfex-reconciliation',
              idempotencyKey: `${input.executionId}:official-reconciliation`,
              occurredAt: '2026-07-15T12:05:00.000Z',
            });
            return {
              status: 'officially_reconciled', receiptHash: officialReceiptHash,
              authorityIdentityHash: 'a'.repeat(64),
            };
          },
        },
        true,
      );
      expect((await attest(attestationBody)).status).toBe(425);
      await serviceForAttestation.execute({
        executionId: firstReceipt.executionId, workspaceId,
        actorId: 'motora:creator', idempotencyKey: 'motora-execute-123456',
        occurredAt: '2026-07-15T12:04:00.000Z',
      });
      await serviceForAttestation.reconcile({
        executionId: firstReceipt.executionId, workspaceId,
        actorId: 'motora:creator', idempotencyKey: 'motora-reconcile-123456',
        occurredAt: '2026-07-15T12:05:00.000Z',
      });
      const attested = await attest(attestationBody);
      expect(attested.status).toBe(200);
      expect((await attested.json() as any).data).toEqual({
        version: 'factura-e-invoice-authority-attestation-v1',
        authorityExecutionId: firstReceipt.executionId,
        workspaceId, ledgerInvoiceId, runId, intentHash: frozen.intentHash,
        revision: 3, authorityState: 'officially_reconciled',
        authorityEnvironment: 'homologation', authorityProviderId: 'unconfigured',
        invoice: {
          documentType: 19, pointOfSale: 2, invoiceNumber: '6',
          cae: '12345678901234', caeExpiry: '2026-07-25',
          currencyId: 'DOL', currencyQuote: '1200.25',
          authorizedAt: '2026-07-15T12:05:00.000Z',
          authorityReceiptHash: officialReceiptHash, issueDate: '2026-07-15',
          servicePeriod: { start: '2026-07-01', end: '2026-07-31' },
          paymentDate: '2026-08-15', destinationCountry: 'US',
          customer: 'Client', serviceDescription: 'Services', amount: '100',
        },
      });
      expect((await attest({ ...attestationBody, ledgerInvoiceId: otherInvoiceId })).status).toBe(409);
      expect((await attest({ ...attestationBody, intentHash: '9'.repeat(64) })).status).toBe(409);
      const authorized = agent.getRun(runId);
      const changedReceipt = {
        ...authorized, revision: authorized.revision + 1,
        authority: { ...authorized.authority, receiptHash: '0'.repeat(64) },
      };
      store.appendFacturaEAgentRevision({
        run: changedReceipt, stateHash: hashCanonical(changedReceipt),
        commandHash: '1'.repeat(64), appendedAt: '2026-07-15T12:06:00.000Z',
        event: {
          eventId: crypto.randomUUID(), runId, workspaceId, actorId: 'test',
          actorKind: 'system', action: 'test_conflicting_receipt',
          occurredAt: '2026-07-15T12:06:00.000Z',
          idempotencyKey: 'conflicting-receipt-test-123456', safeMetadata: {},
        },
      });
      expect((await attest(attestationBody)).status).toBe(409);
      const wrongInvoice = await call({ ...body, ledgerInvoiceId: otherInvoiceId });
      expect(wrongInvoice.status).toBe(409);
      expect((await wrongInvoice.json() as any).error).toBe('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
      const wrongHash = await call({ ...body, intentHash: 'd'.repeat(64) });
      expect(wrongHash.status).toBe(400);
      expect((await wrongHash.json() as any).error).toBe('TAX_AUTHORITY_FROZEN_APPROVED_INTENT_REQUIRED');
    } finally {
      executionStore.close();
      store.close();
    }
  });

  test('persists immutable invoice binding across restart, replays exactly, and reads scoped status', async () => {
    const db = join(tmpdir(), `tax-case-${crypto.randomUUID()}.sqlite`);
    const body = {
      version: 'factura-e-tax-case-create-v1', workspaceId, runId,
      ledgerInvoiceId, issuancePath: 'wsfex_delegated', idempotencyKey,
    };
    const path = '/v1/authority/factura-e/cases';
    const store = new TaxProfileStore(db);
    try {
      const created = await route(store, signedRequest('POST', path, 'factura-e:case:create', body));
      expect(created.status).toBe(200);
      expect((await created.json() as any).data).toEqual({
        version: 'factura-e-tax-case-receipt-v1', runId, workspaceId, ledgerInvoiceId,
        state: 'case_created', replayed: false, nextAction: 'collect_verified_evidence',
      });
      store.close();
      const restarted = new TaxProfileStore(db);
      try {
        const replay = await route(restarted, signedRequest('POST', path, 'factura-e:case:create', body));
        expect((await replay.json() as any).data.replayed).toBe(true);
        const readPath = `${path}/${runId}`;
        const read = await route(restarted, signedRequest('GET', readPath, 'factura-e:case:read'));
        expect(read.status).toBe(200);
        expect((await read.json() as any).data).toEqual({
          version: 'factura-e-tax-case-status-v1', runId, workspaceId, ledgerInvoiceId,
          intentHash: null, revision: 1, readinessState: 'unverified',
          intentState: 'missing', approvalState: 'not_requested',
          issuanceState: 'not_ready', nextAction: 'collect_verified_evidence',
          review: null,
        });
        const crossTenant = await route(restarted, signedRequest(
          'GET', readPath, 'factura-e:case:read', null, otherWorkspaceId,
        ));
        expect(crossTenant.status).toBe(403);
        expect((await crossTenant.json() as any).error).toBe('TAX_AUTHORITY_PRINCIPAL_SCOPE_UNAUTHORIZED');
        for (const conflict of [
          { ...body, ledgerInvoiceId: otherInvoiceId },
          { ...body, runId: '77777777-7777-4777-8777-777777777777' },
          { ...body, idempotencyKey: '88888888-8888-4888-8888-888888888888' },
          { ...body, workspaceId: otherWorkspaceId, runId: '99999999-9999-4999-8999-999999999999' },
        ]) {
          const response = await route(restarted, signedRequest(
            'POST', path, 'factura-e:case:create', conflict, conflict.workspaceId,
          ));
          expect(response.status).toBe(409);
          expect((await response.json() as any).error).toBe('FACTURA_E_TAX_CASE_BINDING_CONFLICT');
        }
        const otherActor = await route(restarted, signedRequest(
          'POST', path, 'factura-e:case:create', body, workspaceId, 'motora:someone-else',
        ));
        expect(otherActor.status).toBe(409);
        restarted.close();
      } finally {
        restarted.close();
      }
    } finally {
      store.close();
      rmSync(db, { force: true });
      rmSync(`${db}-wal`, { force: true });
      rmSync(`${db}-shm`, { force: true });
    }
  });

  test('registers user intent approval only for the bound case and frozen hash', async () => {
    const store = new TaxProfileStore(':memory:');
    try {
      const agent = optionsFor(store).agent;
      const now = '2026-07-15T12:00:00.000Z';
      const created = store.createFacturaETaxCaseBinding({
        runId, workspaceId, ledgerInvoiceId, issuancePath: 'wsfex_delegated',
        actorId: 'motora:creator', idempotencyKey, createdAt: now,
      }, () => agent.createRun({
        runId, workspaceId, issuancePath: 'wsfex_delegated',
        actorId: 'motora:creator', idempotencyKey, occurredAt: now,
      }).run);
      const intent: FacturaEIntentV1 = {
        version: 'factura-e-intent-v1', intentId: crypto.randomUUID(), workspaceId,
        taxpayerReferenceHash: 'a'.repeat(64),
        foreignCustomerReferenceHash: 'b'.repeat(64),
        foreignCustomerSafeLabel: 'Client', destinationCountry: 'US',
        destinationCountryArcaCode: 212, documentType: 19, operationType: 2,
        pointOfSale: 2, issueDate: '2026-07-15', servicePeriod: { start: '2026-07-01', end: '2026-07-31' }, paymentDate: '2026-08-15',
        sameCurrencyPayment: true, exchangeRate: null,
        lineItems: [{ description: 'Services', quantity: '1', unitPrice: '100', total: '100', unitCode: 7 }],
        total: { decimal: '100', currency: 'USD' },
        serviceDescription: 'Services', paymentTerms: 'Net 30', ruleVersionIds: [],
      };
      const intentHash = hashCanonical(intent);
      const pending = {
        ...created.run, revision: 2, updatedAt: now,
        readinessState: 'verified' as const,
        intentState: 'validated' as const,
        intent,
        intentHash,
        approvalState: 'pending' as const,
      };
      store.appendFacturaEAgentRevision({
        run: pending, stateHash: hashCanonical(pending), commandHash: 'b'.repeat(64),
        appendedAt: now,
        event: {
          eventId: crypto.randomUUID(), runId, workspaceId,
          actorId: 'motora:creator', actorKind: 'user', action: 'test_approval_requested',
          occurredAt: now, idempotencyKey: 'test-approval-pending-123456', safeMetadata: {},
        },
      });
      const path = `/v1/authority/factura-e/cases/${runId}/intent-approval`;
      const body = {
        version: 'factura-e-intent-approve-v1', workspaceId, intentHash,
        idempotencyKey: 'user-approval-123456',
      };
      const wrongHash = await route(store, signedRequest(
        'POST', path, 'factura-e:intent:approve', { ...body, intentHash: 'c'.repeat(64) },
      ));
      expect(wrongHash.status).toBe(409);
      const wrongWorkspace = await route(store, signedRequest(
        'POST', path, 'factura-e:intent:approve', body, otherWorkspaceId,
      ));
      expect(wrongWorkspace.status).toBe(403);
      const approved = await route(store, signedRequest(
        'POST', path, 'factura-e:intent:approve', body,
      ));
      expect(approved.status).toBe(200);
      expect((await approved.json() as any).data).toEqual({
        version: 'factura-e-intent-approval-receipt-v1', runId, workspaceId,
        intentHash, approvalState: 'user_approved',
        issuanceState: 'not_ready', replayed: false,
      });
      const status = await route(store, signedRequest(
        'GET', `/v1/authority/factura-e/cases/${runId}`, 'factura-e:case:read',
      ));
      expect((await status.json() as any).data.nextAction).toBe('await_accountant_approval');
      const replay = await route(store, signedRequest(
        'POST', path, 'factura-e:intent:approve', body,
      ));
      expect((await replay.json() as any).data.replayed).toBe(true);
    } finally {
      store.close();
    }
  });

  test('rejects unsigned creation and an unbound legacy run', async () => {
    const store = new TaxProfileStore(':memory:');
    try {
      const path = '/v1/authority/factura-e/cases';
      const body = {
        version: 'factura-e-tax-case-create-v1', workspaceId, runId,
        ledgerInvoiceId, issuancePath: 'wsfex_delegated', idempotencyKey,
      };
      const unsigned = await route(store, new Request(`https://tax.test${path}`, {
        method: 'POST', body: JSON.stringify(body),
      }));
      expect(unsigned.status).toBe(403);
      optionsFor(store).agent.createRun({
        runId, workspaceId, issuancePath: 'wsfex_delegated',
        actorId: 'legacy', idempotencyKey: 'legacy-run-create-123456',
        occurredAt: new Date().toISOString(),
      });
      const collision = await route(store, signedRequest('POST', path, 'factura-e:case:create', body));
      expect(collision.status).toBe(409);
      expect(store.getFacturaETaxCaseBinding(runId)).toBeNull();
    } finally {
      store.close();
    }
  });
});
