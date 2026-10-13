import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, SignerRequest } from './contracts';
import { canonicalAdjustment, payload, RECEPTOR_CUIT, request } from './test-fixtures';
import { WsfeSignerService } from './service';
import { type DocumentType, type WsfeAuthorityClient, WsfeAmbiguousTransportError, type WsfeAuthorizationResult, type WsfeRetrievedDocument } from './soap';
import { SignerAttemptStore } from './store';
import type { AuthorityPayloadVault } from './vault';
import type { WsaaTicketBroker } from './wsaa';

const occurredAt = '2026-07-11T12:00:00.000Z';
const association = { documentType: 11 as const, pointOfSale: 4, invoiceNumber: '81' };

describe('isolated WSFE signer service', () => {
  test('reads the next C number for the scoped issuer without authorizing a voucher', async () => {
    const fixture = setup();
    const result = await fixture.service.getNextVoucher({
      workspaceId: 'personal:user-1', issuerProfileRef: 'vault://issuer/profile-1',
      documentType: 11, pointOfSale: 4,
    }, occurredAt);
    expect(result).toEqual(expect.objectContaining({ lastInvoiceNumber: '5', nextInvoiceNumber: '6', pointOfSale: 4 }));
    expect(fixture.authority.authorizeCalls).toBe(0);
  });

  test('returns an issuer-bound C readback receipt only for the known accepted sandbox voucher', async () => {
    const proof = { workspaceId: 'workspace-1', issuerProfileRef: 'vault://issuer/profile-1', representedCuit: '20123456786', representedCuitCommitment: hashCanonical('represented-cuit'), cae: '71234567890123' };
    const fixture = setup({ homologationPointOfSaleProof: proof });
    fixture.authority.pointOfSaleError = new Error('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    fixture.authority.proofDocument = retrieved({ pointOfSale: 1, invoiceNumber: '1' });
    const context = { workspaceId: proof.workspaceId, issuerProfileRef: proof.issuerProfileRef, pointOfSale: 1 as const };
    const discovery = await fixture.service.discoverPointsOfSale(context, occurredAt);
    expect(discovery).toEqual(expect.objectContaining({ activePoints: [], listedCount: 0, representedCuitCommitment: proof.representedCuitCommitment }));
    const readback = await fixture.service.verifyPointOfSaleReadback(context, occurredAt);
    expect(readback).toEqual(expect.objectContaining({ pointOfSale: 1, documentType: 11, invoiceNumber: '1', representedCuitCommitment: proof.representedCuitCommitment }));
    fixture.authority.proofDocument = retrieved({ pointOfSale: 1, invoiceNumber: '1', cae: '99999999999999' });
    await expect(fixture.service.verifyPointOfSaleReadback(context, occurredAt)).rejects.toThrow('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    fixture.authority.proofDocument = retrieved({ pointOfSale: 1, invoiceNumber: '1' });
    fixture.authority.listedCountOverride = 1;
    await expect(fixture.service.verifyPointOfSaleReadback(context, occurredAt)).rejects.toThrow('WSFE_POINT_OF_SALE_NOT_ACTIVE');
  });
  test('accepts only the bound homologation C point after exact official voucher readback', async () => {
    const proof = { workspaceId: 'workspace-1', issuerProfileRef: 'vault://issuer/profile-1', representedCuit: '20123456786', representedCuitCommitment: hashCanonical('represented-cuit'), cae: '71234567890123' };
    const fixture = setup({ homologationPointOfSaleProof: proof, ownDocuments: [retrieved({ pointOfSale: 1, invoiceNumber: '1' })] });
    fixture.authority.pointOfSaleError = new Error('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    const check = (scope = fixture.request, document = payload({ pointOfSale: 1 })) =>
      (fixture.service as unknown as { assertPointOfSaleActive: (request: SignerRequest, payload: AuthorityPayload, ticket: { representedCuit: string; representedCuitCommitment: string }) => Promise<void> })
        .assertPointOfSaleActive(scope, document, { representedCuit: '20123456786', representedCuitCommitment: hashCanonical('represented-cuit') });
    await expect(check()).resolves.toBeUndefined();
    await expect(check({ ...fixture.request, workspaceId: 'workspace-2' })).rejects.toThrow('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    await expect(check(fixture.request, payload({ pointOfSale: 2 }))).rejects.toThrow('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    await expect(check(fixture.request, payload({ pointOfSale: 1, documentType: 13 }))).rejects.toThrow('WSFE_POINT_OF_SALE_NOT_ACTIVE');
    fixture.authority.proofDocument = retrieved({ pointOfSale: 1, invoiceNumber: '1', cae: '99999999999999' });
    await expect(check()).rejects.toThrow('WSFE_POINT_OF_SALE_NOT_ACTIVE');
  });

  test('issues once, persists only safe evidence, and idempotently returns the receipt', async () => {
    const fixture = setup();
    const first = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    const second = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);

    expect(first).toEqual(expect.objectContaining({ status: 'accepted', resultado: 'A', cbteTipo: 11, ptoVta: 4, cbteNro: '6', cae: '71234567890123', caeFchVto: '2026-07-21', reprocessed: false }));
    expect(first.feCompConsultarEcho).toEqual(expect.objectContaining({ invoiceNumber: '6', cae: '71234567890123', resultado: 'A' }));
    expect(second).toEqual(first);
    expect(fixture.authority.authorizeCalls).toBe(1);
    const stored = JSON.stringify(fixture.store.get(fixture.request.requestId)!);
    expect(stored).not.toContain(RECEPTOR_CUIT);
    expect(stored).not.toContain('20123456786');
    expect(stored).not.toContain('wsaa-token-secret');
    expect(stored).not.toContain('vault://wsfe/payload-1');
  });

  test('rejects reusing a request id with a different opaque payload reference', async () => {
    const fixture = setup();
    await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    const conflicting = { ...fixture.request, authorityPayloadRef: 'vault://wsfe/different' };
    await expect(fixture.service.issueInvoice(conflicting, conflicting.requestId, occurredAt)).rejects.toThrow('WSFE_REQUEST_ID_PAYLOAD_REFERENCE_CONFLICT');
  });

  test('fails a freeze-time sequence conflict instead of silently renumbering', async () => {
    const fixture = setup({ lastInvoice: () => '10' });
    await expect(fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt)).rejects.toThrow('WSFE_ARCA_SEQUENCE_CONFLICT');
    expect(fixture.authority.authorizeCalls).toBe(0);
  });

  test('recovers an ambiguous outcome by re-sending the byte-identical request for the same CAE (Reproceso=S)', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous', accepted({ reprocessed: true })], ownDocuments: [null, retrieved()] });
    const first = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    expect(first.status).toBe('ambiguous');
    expect(fixture.store.get(fixture.request.requestId)?.state).toBe('ambiguous');

    const recovered = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, '2026-07-11T12:01:00.000Z');
    expect(recovered).toEqual(expect.objectContaining({ status: 'accepted', reprocessed: true, cbteNro: '6', cae: '71234567890123' }));
    expect(fixture.store.get(fixture.request.requestId)?.state).toBe('accepted');
  });

  test('recovers via a FECompConsultar echo when both authorize transports stay ambiguous', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous', 'ambiguous'], ownDocuments: [null, retrieved()] });
    const first = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    expect(first.status).toBe('ambiguous');
    const recovered = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, '2026-07-11T12:01:00.000Z');
    expect(recovered).toEqual(expect.objectContaining({ status: 'accepted', reprocessed: true, cbteNro: '6', cae: '71234567890123' }));
    expect(recovered.feCompConsultarEcho).toEqual(expect.objectContaining({ invoiceNumber: '6', resultado: 'A' }));
  });

  test('keeps the outcome ambiguous when authorization and retrieval transports both fail', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous'], ownDocuments: ['ambiguous'] });
    const result = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'ambiguous', cae: null, cbteNro: null }));
  });

  test('rejects a recovered document whose echo does not match the frozen document', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous'], ownDocuments: [retrieved({ total: '999.99', netAmount: '999.99' })] });
    await expect(fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt)).rejects.toThrow('WSFE_RECOVERED_DOCUMENT_MISMATCH');
  });

  test('keeps a direct CAE (its FECAESolicitar echo already bound) but drops an unreconcilable confirmation echo', async () => {
    const fixture = setup({ ownDocuments: [retrieved({ issueDate: '2026-07-10' })] });
    const result = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'accepted', cae: '71234567890123', feCompConsultarEcho: null }));
  });

  test('recovers official readback for an accepted CAE without sending a second authorization', async () => {
    const fixture = setup({ ownDocuments: [null, retrieved()] });
    const first = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    expect(first.feCompConsultarEcho).toBeNull();
    const verified = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, '2026-07-11T12:01:00.000Z');
    expect(verified.feCompConsultarEcho).toEqual(expect.objectContaining({ cae: first.cae, invoiceNumber: '6' }));
    expect(fixture.authority.authorizeCalls).toBe(1);
  });

  test('refuses an accepted readback with a different CAE', async () => {
    const fixture = setup({ ownDocuments: [null, retrieved({ cae: '99999999999999' })] });
    await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    await expect(fixture.service.issueInvoice(fixture.request, fixture.request.requestId, '2026-07-11T12:01:00.000Z'))
      .rejects.toThrow('WSFE_ACCEPTED_READBACK_CAE_MISMATCH');
    expect(fixture.authority.authorizeCalls).toBe(1);
  });

  test('refuses recovery with a changed vault payload hash', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous'], ownDocuments: [null] });
    await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    fixture.vault.payloadHash = hashCanonical('changed-after-first-attempt');
    await expect(fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt)).rejects.toThrow('WSFE_RECOVERY_PAYLOAD_HASH_MISMATCH');
  });

  test('rejects a CAE when ARCA echoes a different frozen document date', async () => {
    const fixture = setup({ authorizeResults: [accepted({ issueDate: '2026-07-10' })] });
    await expect(fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt)).rejects.toThrow('WSFE_AUTHORITY_RESPONSE_MISMATCH');
  });

  test('persists an authority rejection without creating an authorized document', async () => {
    const fixture = setup({ authorizeResults: [accepted({ status: 'rejected', cae: null, caeExpiry: null, safeErrors: [{ code: '10016', message: 'ARCA WSFE error 10016' }] })] });
    const result = await fixture.service.issueInvoice(fixture.request, fixture.request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'rejected', resultado: 'R', cae: null, authorizedDocument: null }));
    expect(fixture.store.get(fixture.request.requestId)?.state).toBe('rejected');
  });

  test('authorizes a nota de crédito only after an exact authorized original lookup and echo', async () => {
    const canonicalDocument = canonicalAdjustment({ adjustmentId: 'credit-1', documentType: 13, amount: '5000.00', reason: 'Anulación parcial' });
    const notePayload = payload({
      canonicalDocument, subjectId: 'credit-1', intentHash: hashCanonical(canonicalDocument), requestId: '102', invoiceNumber: '1', documentType: 13,
      total: { decimal: '5000.00', currency: 'ARS' }, associatedDocument: association,
    });
    const noteRequest = request({
      subjectId: 'credit-1', intentHash: notePayload.intentHash, requestId: '102', authorityPayloadRef: 'vault://wsfe/note-1',
      expected: { documentType: 13, concept: 2, pointOfSale: 4, issueDate: '2026-07-11', receptorDocType: 80, receptorCondicionIvaId: 6, total: { decimal: '5000.00', currency: 'ARS' }, servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' }, associatedDocument: association },
    });
    const noteEcho = retrieved({ documentType: 13, invoiceNumber: '1', total: '5000.00', netAmount: '5000.00', associatedDocument: association });
    const fixture = setup({
      request: noteRequest, payload: notePayload,
      authorizeResults: [accepted({ documentType: 13, invoiceNumber: '1', cae: '72234567890123' })],
      ownDocuments: [noteEcho],
    });
    await expect(fixture.service.issueInvoice(noteRequest, noteRequest.requestId, occurredAt)).resolves.toEqual(expect.objectContaining({ status: 'accepted', cbteTipo: 13, cbteNro: '1', cae: '72234567890123' }));
  });

  test('refuses a note whose associated original is not authorized', async () => {
    const canonicalDocument = canonicalAdjustment({ adjustmentId: 'credit-2', documentType: 13, amount: '5000.00', reason: 'Anulación total' });
    const notePayload = payload({
      canonicalDocument, subjectId: 'credit-2', intentHash: hashCanonical(canonicalDocument), requestId: '103', invoiceNumber: '1', documentType: 13,
      total: { decimal: '5000.00', currency: 'ARS' }, associatedDocument: association,
    });
    const noteRequest = request({
      subjectId: 'credit-2', intentHash: notePayload.intentHash, requestId: '103', authorityPayloadRef: 'vault://wsfe/note-2',
      expected: { documentType: 13, concept: 2, pointOfSale: 4, issueDate: '2026-07-11', receptorDocType: 80, receptorCondicionIvaId: 6, total: { decimal: '5000.00', currency: 'ARS' }, servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' }, associatedDocument: association },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload, originalDocument: retrieved({ documentType: 11, invoiceNumber: '81', result: 'R' }) });
    await expect(fixture.service.issueInvoice(noteRequest, noteRequest.requestId, occurredAt)).rejects.toThrow('WSFE_ASSOCIATED_DOCUMENT_NOT_AUTHORIZED');
  });
});

type AuthorizeStep = WsfeAuthorizationResult | 'ambiguous';
type RetrieveStep = WsfeRetrievedDocument | null | 'ambiguous';

function setup(options: Readonly<{
  request?: SignerRequest;
  payload?: AuthorityPayload;
  authorizeResults?: AuthorizeStep[];
  ownDocuments?: RetrieveStep[];
  lastInvoice?: (documentType: DocumentType) => string;
  originalDocument?: WsfeRetrievedDocument;
  homologationPointOfSaleProof?: Readonly<{ workspaceId: string; issuerProfileRef: string; representedCuit: string; representedCuitCommitment: string; cae: string }>;
}> = {}) {
  const signerRequest = options.request ?? request();
  const authorityPayload = options.payload ?? payload();
  const store = new SignerAttemptStore(':memory:');
  const vault = new FakeVault(authorityPayload);
  const authority = new FakeAuthority(options.authorizeResults, options.ownDocuments, options.lastInvoice, options.originalDocument);
  const service = new WsfeSignerService(
    { environment: 'homologation', signerVersion: 'test', ...(options.homologationPointOfSaleProof ? { homologationPointOfSaleProof: options.homologationPointOfSaleProof } : {}) },
    store,
    vault,
    new FakeWsaa(),
    authority
  );
  return { service, store, vault, authority, request: signerRequest };
}

class FakeVault implements AuthorityPayloadVault {
  payloadHash: string;
  constructor(readonly payload: AuthorityPayload) { this.payloadHash = hashCanonical(payload); }
  async resolve() { return { payload: this.payload, payloadHash: this.payloadHash }; }
}

class FakeWsaa implements WsaaTicketBroker {
  async getTicket() { return { token: 'wsaa-token-secret', sign: 'wsaa-sign-secret', representedCuit: '20123456786', representedCuitCommitment: hashCanonical('represented-cuit'), expiresAt: '2099-01-01T00:00:00.000Z' }; }
  async health() { return { certificateDelegationConfigured: true, wsaaReady: true }; }
}

class FakeAuthority implements WsfeAuthorityClient {
  authorizeCalls = 0;
  pointOfSaleError: Error | null = null;
  proofDocument: WsfeRetrievedDocument | null = null;
  listedCountOverride: number | null = null;
  readonly #authorizeResults: AuthorizeStep[];
  readonly #ownDocuments: RetrieveStep[];
  readonly #lastInvoice: (documentType: DocumentType) => string;
  readonly #originalDocument: WsfeRetrievedDocument;

  constructor(
    authorizeResults: AuthorizeStep[] = [accepted()],
    ownDocuments: RetrieveStep[] = [],
    lastInvoice: (documentType: DocumentType) => string = documentType => (documentType === 11 ? '5' : '0'),
    originalDocument: WsfeRetrievedDocument = retrieved({ documentType: 11, invoiceNumber: '81' })
  ) {
    this.#authorizeResults = [...authorizeResults];
    this.#ownDocuments = [...ownDocuments];
    this.#lastInvoice = lastInvoice;
    this.#originalDocument = originalDocument;
  }

  async authorize(): Promise<WsfeAuthorizationResult> {
    this.authorizeCalls += 1;
    const result = this.#authorizeResults.shift() ?? accepted();
    if (result === 'ambiguous') throw new WsfeAmbiguousTransportError(hashCanonical(`ambiguous-${this.authorizeCalls}`));
    return result;
  }
  async getLastInvoiceNumber(_ticket: unknown, documentType: DocumentType) { return this.#lastInvoice(documentType); }
  async getDocument(_ticket: unknown, documentType: DocumentType, _pointOfSale: number, invoiceNumber: string) {
    if (documentType === 11 && invoiceNumber === '81') return this.#originalDocument;
    if (documentType === 11 && invoiceNumber === '1' && this.proofDocument) return this.proofDocument;
    const result = this.#ownDocuments.length ? this.#ownDocuments.shift()! : retrieved({ documentType, invoiceNumber });
    if (result === 'ambiguous') throw new WsfeAmbiguousTransportError(hashCanonical('own-ambiguous'));
    return result;
  }
  async assertPointOfSaleActive() { if (this.pointOfSaleError) throw this.pointOfSaleError; }
  async getPointsOfSale() { return { activePoints: this.pointOfSaleError ? [] : [4], listedCount: this.listedCountOverride ?? (this.pointOfSaleError ? 0 : 1), rawResponseHash: hashCanonical('discovery') }; }
  async dummy() { return { appServer: 'OK', dbServer: 'OK', authServer: 'OK' }; }
}

function accepted(overrides: Partial<WsfeAuthorizationResult> = {}): WsfeAuthorizationResult {
  return {
    status: 'accepted', documentType: 11, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11', concept: 2,
    receptorDocType: 80, receptorDocNumber: RECEPTOR_CUIT, cae: '71234567890123', caeExpiry: '2026-07-21', reprocessed: false,
    safeErrors: [], rawResponseHash: hashCanonical('accepted'), ...overrides,
  };
}

function retrieved(overrides: Partial<WsfeRetrievedDocument> = {}): WsfeRetrievedDocument {
  return {
    documentType: 11, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11', concept: 2,
    receptorDocType: 80, receptorDocNumber: RECEPTOR_CUIT, currencyId: 'PES', currencyQuote: '1',
    total: '15000.00', netAmount: '15000.00', vatAmount: '0', ivaLineItems: [],
    servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' }, paymentDueDate: '2026-07-11',
    associatedDocument: null, result: 'A', cae: '71234567890123', caeExpiry: '2026-07-21', rawResponseHash: hashCanonical('retrieved'), ...overrides,
  };
}
