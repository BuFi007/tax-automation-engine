import { describe, expect, test } from 'bun:test';

import { hashCanonical, type FacturaEAgentRunV1, type FacturaEIntentV1, type FacturaEProofPurpose, type ReclaimProofCustodyReceiptV1, type ReclaimSessionReferenceV1, type TaxEvidenceRecord, type VerifiedReclaimProofV1 } from '@tax-engine/core';

import { handleAgentRoute } from './agent-routes';
import { FacturaEAgentService } from './factura-e-agent';
import type { ReclaimProofVault } from './proof-vault';
import type { ReclaimGateway, ReclaimRequestResult } from './reclaim';
import { TaxProfileStore } from './store';
import type { WsfexAuthorityResult, WsfexGateway } from './wsfex';

const runId = '10000000-0000-4000-8000-000000000001';
const workspaceId = 'workspace-agent-api';
const userToken = 'user-token-kept-outside-agent';

describe('Factura E agent HTTP tools', () => {
  test('lets an agent orchestrate Path B while keeping human approval and Reclaim authority separate', async () => {
    const store = new TaxProfileStore(':memory:');
    confirmArgentinaProfile(store);
    seedFinancialEvidence(store);
    const proofVault = new FakeProofVault();
    const service = new FacturaEAgentService(store, new FakeReclaimGateway(), null, proofVault, true);
    const options = { userApprovalToken: userToken, accountantApprovalToken: 'accountant-token', evidenceIngestToken: 'evidence-token' };

    const manifest = await route(service, options, 'GET', '/v1/agent/tools');
    expect(manifest.status).toBe(200);
    const manifestJson = await manifest.json() as any;
    expect(manifestJson.data.tools).toHaveLength(17);
    expect(JSON.stringify(manifestJson)).not.toContain('approveIntent');
    const draftTool = manifestJson.data.tools.find((candidate: any) => candidate.function.name === 'tax_ar_factura_e_draft_intent');
    expect(draftTool.function.parameters.properties.intent.properties.documentType.const).toBe(19);
    const reclaimTool = manifestJson.data.tools.find((candidate: any) => candidate.function.name === 'tax_ar_reclaim_start');
    expect(reclaimTool.function.parameters.properties.purpose.enum).toEqual([
      'arca_taxpayer_readiness', 'arca_cae_constatement', 'arca_adjustment_constatement',
    ]);
    expect(reclaimTool.function.parameters.properties.subjectId).toBeDefined();
    const preflight = await invoke(service, options, 'tax_ar_homologation_get_preflight', 'read-homologation-preflight-1', {});
    expect(preflight.data).toEqual(expect.objectContaining({ state: 'blocked', productionActivationAllowed: false }));
    expect(JSON.stringify(preflight.data)).not.toContain('user-token-kept-outside-agent');

    const created = await invoke(service, options, 'tax_ar_factura_e_create_case', 'create-case-1', {
      runId, workspaceId, issuancePath: 'reclaim_copilot',
    });
    expect(created.data.run.issuanceState).toBe('not_ready');

    const readiness = await invoke(service, options, 'tax_ar_reclaim_start', 'start-readiness-1', {
      runId, purpose: 'arca_taxpayer_readiness',
    });
    expect(readiness.data.output.requestUrl).toContain('readiness-session');
    const readinessCallback = await route(service, options, 'POST', '/v1/reclaim/callback', { purpose: 'readiness' }, {
      'x-reclaim-session-id': 'readiness-session',
    });
    expect((await readinessCallback.json() as any).data.state).toBe('not_ready');

    const drafted = await invoke(service, options, 'tax_ar_factura_e_propose_from_evidence', 'draft-intent-1', {
      runId,
      economicEventId: 'event:foreign-payment-1',
      intentId: 'intent-from-evidence-1',
      foreignCustomerSafeLabel: 'Foreign customer',
      destinationCountry: 'US',
      destinationCountryArcaCode: 200,
      pointOfSale: 4,
      issueDate: new Date().toISOString().slice(0, 10),
      paymentDate: new Date().toISOString().slice(0, 10),
      sameCurrencyPayment: true,
      exchangeRate: { decimal: '1200.25', sourceReferenceId: 'fx:bna:previous-day', observedForDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), authorityRuleDecisionId: 'arca-fx-accountant-reviewed-v1' },
      serviceDescription: 'Software services used abroad',
      paymentTerms: 'Due on receipt',
      unitCode: 7,
    });
    expect(drafted.data.output.valid).toBe(true);
    expect(drafted.data.output.sourceEvidenceIds).toHaveLength(3);
    const intentHash = drafted.data.run.intentHash;
    await invoke(service, options, 'tax_ar_factura_e_request_approval', 'request-approval-1', { runId });

    const unauthorizedApproval = route(service, options, 'POST', `/v1/agent/runs/${runId}/user-approval`, {
      actorId: 'user:owner', intentHash, idempotencyKey: 'approve-user-1',
    });
    expect(unauthorizedApproval).rejects.toThrow('USER_APPROVAL_UNAUTHORIZED');

    const approval = await route(service, options, 'POST', `/v1/agent/runs/${runId}/user-approval`, {
      actorId: 'user:owner', intentHash, idempotencyKey: 'approve-user-1',
    }, { 'x-tax-user-approval-token': userToken });
    expect((await approval.json() as any).data.run.issuanceState).toBe('manual_action_required');

    const packet = await invoke(service, options, 'tax_ar_factura_e_get_copilot_packet', 'read-copilot-packet-1', { runId });
    expect(packet.data.fields).toEqual(expect.objectContaining({ documentType: 19, operationType: 2, pointOfSale: 4, total: { decimal: '1000', currency: 'USD' } }));
    expect(JSON.stringify(packet.data)).not.toContain('taxpayerReferenceHash');

    await invoke(service, options, 'tax_ar_reclaim_start', 'start-cae-1', { runId, purpose: 'arca_cae_constatement' });
    const caeCallback = await route(service, options, 'POST', '/v1/reclaim/callback', { purpose: 'cae' }, {
      'x-reclaim-session-id': 'cae-session',
    });
    expect((await caeCallback.json() as any).data.state).toBe('arca_authorized');
    let finalRun = service.getRun(runId);
    expect(finalRun.authority).toEqual(expect.objectContaining({ cae: '12345678901234', invoiceNumber: '44' }));
    expect(finalRun.fxIngressState).toBe('unverified');
    expect(finalRun.taxDeclarationState).toBe('not_ready');

    const adjustment = await invoke(service, options, 'tax_ar_factura_e_prepare_adjustment', 'prepare-adjustment-1', {
      runId,
      adjustmentId: 'credit-note-1',
      documentType: 21,
      issueDate: new Date().toISOString().slice(0, 10),
      amount: { decimal: '100.00', currency: 'USD' },
      reason: 'Commercial discount after issuance',
    });
    expect(adjustment.data.run.financeEligibility).toBe('frozen');
    const adjustmentHash = adjustment.data.output.intentHash;
    const adjustmentApproval = await route(service, options, 'POST', `/v1/agent/runs/${runId}/adjustments/credit-note-1/user-approval`, {
      actorId: 'user:owner', intentHash: adjustmentHash, idempotencyKey: 'approve-adjustment-1',
    }, { 'x-tax-user-approval-token': userToken });
    expect((await adjustmentApproval.json() as any).data.run.adjustments[0].issuanceState).toBe('manual_action_required');

    const adjustmentPacket = await invoke(service, options, 'tax_ar_factura_e_get_adjustment_copilot_packet', 'read-adjustment-packet-1', {
      runId, adjustmentId: 'credit-note-1',
    });
    expect(adjustmentPacket.data.fields).toEqual(expect.objectContaining({
      documentType: 21,
      pointOfSale: 4,
      total: { decimal: '100.00', currency: 'USD' },
      associatedDocument: { documentType: 19, pointOfSale: 4, invoiceNumber: '44' },
    }));
    expect(JSON.stringify(adjustmentPacket.data)).not.toContain('taxpayerReferenceHash');

    await invoke(service, options, 'tax_ar_reclaim_start', 'start-adjustment-cae-1', {
      runId, purpose: 'arca_adjustment_constatement', subjectId: 'credit-note-1',
    });
    const adjustmentCallback = await route(service, options, 'POST', '/v1/reclaim/callback', { rawProofMarker: 'must-never-persist' }, {
      'x-reclaim-session-id': 'adjustment-session-credit-note-1',
    });
    expect((await adjustmentCallback.json() as any).data.replayed).toBe(false);
    const adjustmentReplay = await route(service, options, 'POST', '/v1/reclaim/callback', { purpose: 'adjustment-cae' }, {
      'x-reclaim-session-id': 'adjustment-session-credit-note-1',
    });
    expect((await adjustmentReplay.json() as any).data.replayed).toBe(true);
    finalRun = service.getRun(runId);
    expect(finalRun.adjustments[0]).toEqual(expect.objectContaining({
      adjustmentId: 'credit-note-1',
      issuanceState: 'arca_authorized',
      authority: expect.objectContaining({ documentNumber: '45', cae: '22345678901234' }),
    }));
    expect(finalRun.financeEligibility).toBe('frozen');
    expect(finalRun.verifiedProofs.every(proof => proof.custodyReceipt?.opaqueReference.startsWith('vault://reclaim/'))).toBe(true);
    expect(proofVault.storedPayloads).toHaveLength(3);
    expect(JSON.stringify(finalRun)).not.toContain('must-never-persist');
    const evidencePacket = await invoke(service, options, 'tax_ar_factura_e_get_accounting_attestation_packet', 'read-accounting-attestation-1', { runId });
    expect(evidencePacket.data).toEqual(expect.objectContaining({
      invoice: expect.objectContaining({ documentType: 19, invoiceNumber: '44', cae: '12345678901234' }),
      adjustments: [expect.objectContaining({ documentType: 21, documentNumber: '45', association: { documentType: 19, pointOfSale: 4, invoiceNumber: '44' } })],
      financialLedger: expect.objectContaining({ netAuthorizedTotal: '900', hasAuthorizedDilution: true }),
      accountingHandoff: expect.objectContaining({ supportedWorkspaceProviders: ['quickbooks', 'xero', 'contaazul'], requiresApproval: true }),
      underwritingEvidence: expect.objectContaining({ state: 'frozen', paymentOutcomeOnly: true }),
    }));
    expect(JSON.stringify(evidencePacket.data)).not.toContain('must-never-persist');
    expect(store.listFacturaEAgentEvents(runId).map(event => event.action)).toEqual([
      'factura_e_run_created',
      'reclaim_verification_requested',
      'reclaim_proof_verified',
      'factura_e_intent_drafted',
      'factura_e_user_approval_requested',
      'factura_e_intent_approved',
      'reclaim_verification_requested',
      'reclaim_proof_verified',
      'factura_e_adjustment_prepared',
      'factura_e_adjustment_user_approved',
      'reclaim_verification_requested',
      'reclaim_proof_verified',
    ]);
  });

  test('runs Path A through the signer and recovers ambiguity with the exact request and payload', async () => {
    const store = new TaxProfileStore(':memory:');
    confirmArgentinaProfile(store);
    const service = new FacturaEAgentService(store, new FakeReclaimGateway(), new FakeWsfexGateway());
    const options = { userApprovalToken: userToken, accountantApprovalToken: 'accountant-token', evidenceIngestToken: 'evidence-token' };
    const pathARunId = '30000000-0000-4000-8000-000000000001';
    const base = { actorId: 'agent:tax', occurredAt: new Date().toISOString() };
    service.createRun({ ...base, runId: pathARunId, workspaceId, issuancePath: 'wsfex_delegated', idempotencyKey: 'path-a-create-1' });
    await service.startReclaim({ ...base, runId: pathARunId, purpose: 'arca_taxpayer_readiness', idempotencyKey: 'path-a-readiness-1' });
    await service.ingestReclaimCallback('readiness-session', {}, base.occurredAt);
    service.draftIntent({ ...base, runId: pathARunId, intent: { ...intent(), intentId: 'intent-path-a' }, asOf: base.occurredAt.slice(0, 10), idempotencyKey: 'path-a-draft-1' });
    service.requestApproval({ ...base, runId: pathARunId, idempotencyKey: 'path-a-request-approval-1' });
    const pending = service.getRun(pathARunId);
    service.approveIntent({ ...base, runId: pathARunId, intentHash: pending.intentHash!, idempotencyKey: 'path-a-approve-user-1' });
    expect(service.getRun(pathARunId).issuanceState).toBe('not_ready');
    service.approveIntentByAccountant({ ...base, actorId: 'accountant:1', runId: pathARunId, intentHash: pending.intentHash!, idempotencyKey: 'path-a-approve-accountant-1' });

    const submitted = await service.submitWsfex({
      ...base, runId: pathARunId, requestId: '9001', authorityPayloadRef: 'vault://authority/payload-9001', idempotencyKey: 'path-a-submit-1',
    });
    expect(submitted.run.issuanceState).toBe('ambiguous');
    expect(service.recoverWsfex({
      ...base, runId: pathARunId, requestId: '9001', authorityPayloadRef: 'vault://authority/wrong', idempotencyKey: 'path-a-recover-wrong',
    })).rejects.toThrow('WSFEX_RECOVERY_PAYLOAD_MISMATCH');
    const recovered = await service.recoverWsfex({
      ...base, runId: pathARunId, requestId: '9001', authorityPayloadRef: 'vault://authority/payload-9001', idempotencyKey: 'path-a-recover-1',
    });
    expect(recovered.run).toEqual(expect.objectContaining({
      issuanceState: 'arca_authorized',
      authority: expect.objectContaining({ requestId: '9001', invoiceNumber: '51', cae: '98765432109876', reprocessed: true }),
    }));

    const prepared = await invoke(service, options, 'tax_ar_factura_e_prepare_adjustment', 'path-a-prepare-adjustment-1', {
      runId: pathARunId,
      adjustmentId: 'path-a-debit-1',
      documentType: 20,
      issueDate: base.occurredAt.slice(0, 10),
      amount: { decimal: '25.00', currency: 'USD' },
      reason: 'Additional approved service scope',
    });
    const adjustmentHash = prepared.data.output.intentHash;
    await route(service, options, 'POST', `/v1/agent/runs/${pathARunId}/adjustments/path-a-debit-1/user-approval`, {
      actorId: 'user:owner', intentHash: adjustmentHash, idempotencyKey: 'path-a-adjustment-user-approval-1',
    }, { 'x-tax-user-approval-token': userToken });
    await route(service, options, 'POST', `/v1/agent/runs/${pathARunId}/adjustments/path-a-debit-1/accountant-approval`, {
      actorId: 'accountant:1', intentHash: adjustmentHash, idempotencyKey: 'path-a-adjustment-accountant-approval-1',
    }, { 'x-tax-accountant-approval-token': 'accountant-token' });
    const adjustmentSubmitted = await invoke(service, options, 'tax_ar_factura_e_submit_adjustment_wsfex', 'path-a-submit-adjustment-1', {
      runId: pathARunId, adjustmentId: 'path-a-debit-1', requestId: '9002', authorityPayloadRef: 'vault://authority/payload-9002',
    });
    expect(adjustmentSubmitted.data.run.adjustments[0].issuanceState).toBe('ambiguous');
    expect(invoke(service, options, 'tax_ar_factura_e_recover_adjustment_wsfex', 'path-a-recover-adjustment-wrong', {
      runId: pathARunId, adjustmentId: 'path-a-debit-1', requestId: '9002', authorityPayloadRef: 'vault://authority/wrong',
    })).rejects.toThrow('ADJUSTMENT_WSFEX_RECOVERY_PAYLOAD_MISMATCH');
    const adjustmentRecovered = await invoke(service, options, 'tax_ar_factura_e_recover_adjustment_wsfex', 'path-a-recover-adjustment-1', {
      runId: pathARunId, adjustmentId: 'path-a-debit-1', requestId: '9002', authorityPayloadRef: 'vault://authority/payload-9002',
    });
    expect(adjustmentRecovered.data.run).toEqual(expect.objectContaining({
      authority: expect.objectContaining({ invoiceNumber: '51', cae: '98765432109876' }),
      adjustments: [expect.objectContaining({
        adjustmentId: 'path-a-debit-1', issuanceState: 'arca_authorized',
        authority: expect.objectContaining({ requestId: '9002', documentNumber: '52', cae: '88765432109876', reprocessed: true }),
      })],
    }));
  });

  test('rejects oversized public Reclaim callbacks before parsing them', async () => {
    const store = new TaxProfileStore(':memory:');
    const service = new FacturaEAgentService(store, new FakeReclaimGateway(), null);
    const request = new Request('http://localhost/v1/reclaim/callback', {
      method: 'POST',
      headers: { 'x-reclaim-session-id': 'unknown', 'content-type': 'application/json', 'content-length': '60000000' },
      body: '{}',
    });
    const response = await handleAgentRoute(request, new URL(request.url), service, { userApprovalToken: userToken, accountantApprovalToken: 'accountant-token', evidenceIngestToken: 'evidence-token' });
    expect(response?.status).toBe(413);
    expect(await response?.json()).toEqual({ error: 'RECLAIM_PROOF_PAYLOAD_TOO_LARGE' });
  });

  test('persists Reclaim expiry and lets the trusted user cancel a different pending session', async () => {
    const store = new TaxProfileStore(':memory:');
    const service = new FacturaEAgentService(store, new FakeReclaimGateway(), null);
    const options = { userApprovalToken: userToken, accountantApprovalToken: 'accountant-token', evidenceIngestToken: 'evidence-token' };
    const requestedAt = '2026-07-11T12:00:00.000Z';
    const expiryRunId = '50000000-0000-4000-8000-000000000001';
    service.createRun({ runId: expiryRunId, workspaceId, issuancePath: 'reclaim_copilot', actorId: 'agent:tax', idempotencyKey: 'expiry-create-1', occurredAt: requestedAt });
    await service.startReclaim({ runId: expiryRunId, purpose: 'arca_taxpayer_readiness', actorId: 'agent:tax', idempotencyKey: 'expiry-start-1', occurredAt: requestedAt });
    expect(service.ingestReclaimCallback('readiness-session', {}, '2026-07-11T12:10:00.001Z')).rejects.toThrow('RECLAIM_SESSION_EXPIRED');
    const expired = service.getRun(expiryRunId);
    expect(expired.reclaimSessions[0]?.state).toBe('expired');
    expect(expired.readinessState).toBe('unverified');
    expect(service.nextActions(expired)).toContain('request_arca_readiness_proof');
    const expiredRevision = expired.revision;
    expect(service.ingestReclaimCallback('readiness-session', {}, '2026-07-11T12:11:00.000Z')).rejects.toThrow('RECLAIM_SESSION_EXPIRED');
    expect(service.getRun(expiryRunId).revision).toBe(expiredRevision);

    const cancelStore = new TaxProfileStore(':memory:');
    const cancelService = new FacturaEAgentService(cancelStore, new FakeReclaimGateway(), null);
    const cancelRunId = '50000000-0000-4000-8000-000000000002';
    cancelService.createRun({ runId: cancelRunId, workspaceId, issuancePath: 'reclaim_copilot', actorId: 'agent:tax', idempotencyKey: 'cancel-create-1', occurredAt: requestedAt });
    await cancelService.startReclaim({ runId: cancelRunId, purpose: 'arca_taxpayer_readiness', actorId: 'agent:tax', idempotencyKey: 'cancel-start-1', occurredAt: requestedAt });
    expect(route(cancelService, options, 'POST', `/v1/agent/runs/${cancelRunId}/reclaim-sessions/readiness-session/cancel`, {
      actorId: 'user:owner', idempotencyKey: 'cancel-reclaim-session-1',
    })).rejects.toThrow('USER_APPROVAL_UNAUTHORIZED');
    const cancelledResponse = await route(cancelService, options, 'POST', `/v1/agent/runs/${cancelRunId}/reclaim-sessions/readiness-session/cancel`, {
      actorId: 'user:owner', idempotencyKey: 'cancel-reclaim-session-1',
    }, { 'x-tax-user-approval-token': userToken });
    const cancelled = (await cancelledResponse.json() as any).data.run;
    expect(cancelled.reclaimSessions[0].state).toBe('cancelled');
    expect(cancelled.readinessState).toBe('unverified');
  });

  test('keeps evidence ingestion on a connector credential unavailable to the agent', async () => {
    const store = new TaxProfileStore(':memory:');
    const service = new FacturaEAgentService(store, null, null);
    const options = { userApprovalToken: userToken, accountantApprovalToken: 'accountant-token', evidenceIngestToken: 'evidence-token' };
    const body = { records: financialEvidenceRecords() };
    expect(route(service, options, 'POST', '/v1/evidence/append', body)).rejects.toThrow('EVIDENCE_INGEST_UNAUTHORIZED');
    const response = await route(service, options, 'POST', '/v1/evidence/append', body, { 'x-tax-evidence-ingest-token': 'evidence-token' });
    expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.data).toEqual(expect.objectContaining({ appended: 3, graphRevision: expect.any(String) }));
  });
});

class FakeReclaimGateway implements ReclaimGateway {
  async createRequest(run: FacturaEAgentRunV1, purpose: FacturaEProofPurpose, occurredAt: string, subjectId: string | null = null): Promise<ReclaimRequestResult> {
    const adjustment = purpose === 'arca_adjustment_constatement'
      ? run.adjustments.find(candidate => candidate.adjustmentId === subjectId) ?? null
      : null;
    const subject = purpose === 'arca_taxpayer_readiness'
      ? { id: null, hash: null }
      : purpose === 'arca_cae_constatement'
        ? { id: run.intent?.intentId ?? null, hash: run.intentHash }
        : { id: adjustment?.adjustmentId ?? null, hash: adjustment?.intentHash ?? null };
    const sessionId = purpose === 'arca_taxpayer_readiness'
      ? 'readiness-session'
      : purpose === 'arca_cae_constatement'
        ? 'cae-session'
        : `adjustment-session-${subjectId}`;
    const session: ReclaimSessionReferenceV1 = {
      sessionId,
      purpose,
      providerId: purpose === 'arca_taxpayer_readiness' ? 'provider-readiness' : 'provider-cae',
      providerVersion: '1.0.0',
      contextHash: hashCanonical({ runId: run.runId, purpose, subjectId: subject.id, subjectHash: subject.hash }),
      subjectId: subject.id,
      subjectHash: subject.hash,
      requestedAt: occurredAt,
      expiresAt: new Date(Date.parse(occurredAt) + 600_000).toISOString(),
      state: 'pending',
    };
    return { session, requestUrl: `https://proof.test/${sessionId}`, requestConfig: JSON.stringify({ sessionId }), statusUrl: `https://proof.test/${sessionId}/status` };
  }

  async verifyCallback(run: FacturaEAgentRunV1, session: ReclaimSessionReferenceV1, _proofPayload: unknown, occurredAt: string): Promise<VerifiedReclaimProofV1> {
    if (Date.parse(occurredAt) > Date.parse(session.expiresAt)) throw new Error('RECLAIM_SESSION_EXPIRED');
    const claims = session.purpose === 'arca_taxpayer_readiness'
      ? { regime: 'monotributo' as const, category: 'H', exportActivityEnabled: true as const, exportPointOfSaleActive: true as const, exportPointOfSale: 4 }
      : session.purpose === 'arca_cae_constatement'
        ? {
            documentType: 19 as const, pointOfSale: 4, invoiceNumber: '44', cae: '12345678901234', issuedAt: occurredAt.slice(0, 10),
            total: { decimal: '1000.00', currency: 'USD' }, associatedDocumentType: null, associatedPointOfSale: null, associatedInvoiceNumber: null,
          }
        : adjustmentClaims(run, session, occurredAt);
    return {
      proofHash: hashCanonical(`${session.sessionId}:proof`),
      sessionId: session.sessionId,
      purpose: session.purpose,
      providerId: session.providerId,
      providerVersion: session.providerVersion,
      verifiedAt: occurredAt,
      attestation: { teeRequired: false, teeVerified: false },
      custodyReceipt: null,
      claims,
    };
  }
}

function adjustmentClaims(run: FacturaEAgentRunV1, session: ReclaimSessionReferenceV1, occurredAt: string): VerifiedReclaimProofV1['claims'] {
  const adjustment = run.adjustments.find(candidate => candidate.adjustmentId === session.subjectId);
  if (!adjustment) throw new Error('ADJUSTMENT_NOT_FOUND');
  return {
    documentType: adjustment.documentType,
    pointOfSale: adjustment.associatedDocument.pointOfSale,
    invoiceNumber: '45',
    cae: '22345678901234',
    issuedAt: occurredAt.slice(0, 10),
    total: adjustment.amount,
    associatedDocumentType: 19,
    associatedPointOfSale: adjustment.associatedDocument.pointOfSale,
    associatedInvoiceNumber: adjustment.associatedDocument.invoiceNumber,
  };
}

class FakeProofVault implements ReclaimProofVault {
  readonly storedPayloads: unknown[] = [];

  async storeVerifiedProof(input: { proof: VerifiedReclaimProofV1; proofPayload: unknown }): Promise<ReclaimProofCustodyReceiptV1> {
    this.storedPayloads.push(input.proofPayload);
    return {
      version: 'reclaim-proof-custody-receipt-v1',
      opaqueReference: `vault://reclaim/${input.proof.proofHash}`,
      artifactHash: input.proof.proofHash,
      encryptionVersion: 'envelope-aes256-v1',
      retentionPolicyId: 'tax-authority-evidence-v1',
      storedAt: input.proof.verifiedAt,
    };
  }
}

class FakeWsfexGateway implements WsfexGateway {
  readonly providerId = 'fake-wsfex';

  async authorize(input: { requestId: string }): Promise<WsfexAuthorityResult> {
    return { providerId: this.providerId, requestId: input.requestId, status: 'ambiguous', invoiceNumber: null, cae: null, reprocessed: null, receiptHash: hashCanonical('ambiguous') };
  }

  async recover(input: { requestId: string }): Promise<WsfexAuthorityResult> {
    return { providerId: this.providerId, requestId: input.requestId, status: 'accepted', invoiceNumber: '51', cae: '98765432109876', reprocessed: true, receiptHash: hashCanonical('accepted') };
  }

  async authorizeAdjustment(input: { requestId: string }): Promise<WsfexAuthorityResult> {
    return { providerId: this.providerId, requestId: input.requestId, status: 'ambiguous', invoiceNumber: null, cae: null, reprocessed: null, receiptHash: hashCanonical('adjustment-ambiguous') };
  }

  async recoverAdjustment(input: { requestId: string }): Promise<WsfexAuthorityResult> {
    return { providerId: this.providerId, requestId: input.requestId, status: 'accepted', invoiceNumber: '52', cae: '88765432109876', reprocessed: true, receiptHash: hashCanonical('adjustment-accepted') };
  }
}

async function invoke(
  service: FacturaEAgentService,
  options: { userApprovalToken: string; accountantApprovalToken: string; evidenceIngestToken: string },
  toolId: string,
  idempotencyKey: string,
  input: Record<string, unknown>
): Promise<any> {
  const response = await route(service, options, 'POST', `/v1/agent/tools/${toolId}/invoke`, { actorId: 'agent:tax', idempotencyKey, input });
  expect(response.status).toBe(200);
  return response.json();
}

async function route(
  service: FacturaEAgentService,
  options: { userApprovalToken: string; accountantApprovalToken: string; evidenceIngestToken: string },
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<Response> {
  const request = new Request(`http://localhost${path}`, body === undefined
    ? { method, headers }
    : { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const response = await handleAgentRoute(request, new URL(request.url), service, options);
  if (!response) throw new Error('ROUTE_NOT_HANDLED');
  return response;
}

function intent(): FacturaEIntentV1 {
  return {
    version: 'factura-e-intent-v1', intentId: 'intent-api-1', workspaceId,
    taxpayerReferenceHash: hashCanonical('taxpayer'), foreignCustomerReferenceHash: hashCanonical('customer'), foreignCustomerSafeLabel: 'Foreign customer',
    destinationCountry: 'US', destinationCountryArcaCode: 200, documentType: 19, operationType: 2, pointOfSale: 4,
    issueDate: new Date().toISOString().slice(0, 10), paymentDate: new Date().toISOString().slice(0, 10), sameCurrencyPayment: true,
    exchangeRate: { decimal: '1200.25', sourceReferenceId: 'fx:bna:previous-day', observedForDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10), authorityRuleDecisionId: 'arca-fx-accountant-reviewed-v1' },
    lineItems: [{ description: 'Software services', quantity: '1', unitPrice: '1000.00', total: '1000.00', unitCode: 7 }],
    total: { decimal: '1000.00', currency: 'USD' }, serviceDescription: 'Software services used abroad', paymentTerms: 'Due on receipt',
    ruleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
  };
}

function confirmArgentinaProfile(store: TaxProfileStore): void {
  store.confirm({
    profile: {
      profileId: 'profile-agent-api',
      workspaceId,
      jurisdiction: 'AR',
      entityType: 'individual',
      regimeId: 'monotributo_exportador',
      ownerDomicileCountries: ['AR'],
      ownerTaxResidenceCountries: ['AR'],
      formationSubdivision: null,
      operatingSubdivisions: ['AR-C'],
      answers: [
        { questionId: 'province', value: 'AR-C', confirmationState: 'user_confirmed' },
        { questionId: 'exports_services', value: true, confirmationState: 'user_confirmed' },
        { questionId: 'export_pos_ready', value: true, confirmationState: 'user_confirmed' },
      ],
      catalogueVersion: 'ar-catalogue-2026-07-11',
      version: 'profile-v0',
      confirmationState: 'user_confirmed',
    },
    expectedVersion: null,
    actorId: 'user:owner',
    occurredAt: new Date().toISOString(),
  });
}

function seedFinancialEvidence(store: TaxProfileStore): void {
  store.appendEvidence(financialEvidenceRecords(), new Date().toISOString());
}

function financialEvidenceRecords(): TaxEvidenceRecord[] {
  const partyClaimHash = hashCanonical('foreign-customer');
  const common = {
    workspaceId,
    revision: '1',
    externalReferenceHash: hashCanonical('external-payment-1'),
    sourceEventHash: hashCanonical('source-event-1'),
    jurisdiction: 'AR' as const,
    period: { start: new Date().toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) },
    observedAt: new Date().toISOString(),
    expiresAt: null,
    economicEventId: 'event:foreign-payment-1',
    countingDimension: 'revenue' as const,
    direction: 'inflow' as const,
    money: { decimal: '1000.00', currency: 'USD' },
    normalizedMoney: null,
    fxReferenceId: null,
    partyClaimHash,
    accountReferenceHash: hashCanonical('account'),
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted' as const,
    consentVersion: 'consent-v1',
  };
  return [
    { ...common, evidenceId: 'bank-payment', sourceId: 'foreign-bank', sourceKind: 'bank', canonicalProviderId: null, artifactHash: hashCanonical('bank-artifact'), economicRole: 'payment', idempotencyKey: 'evidence-bank-payment' },
    { ...common, evidenceId: 'quickbooks-invoice', sourceId: 'quickbooks', sourceKind: 'accounting', canonicalProviderId: 'quickbooks', artifactHash: hashCanonical('quickbooks-artifact'), economicRole: 'invoice', idempotencyKey: 'evidence-quickbooks-invoice' },
    { ...common, evidenceId: 'analytics-payment', sourceId: 'financial-analytics', sourceKind: 'financial_analytics', canonicalProviderId: null, artifactHash: hashCanonical('analytics-artifact'), economicRole: 'payment', idempotencyKey: 'evidence-analytics-payment' },
  ];
}
