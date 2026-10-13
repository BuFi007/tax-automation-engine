import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, DocumentType, SignerRequest } from './contracts';
import { WsfeSignerService } from './service';
import { type WsfeAuthorityClient, WsfeAmbiguousTransportError, type WsfeAuthorizationResult, type WsfeRetrievedDocument } from './soap';
import { SignerAttemptStore } from './store';
import type { AuthorityPayloadVault } from './vault';
import type { WsaaTicketBroker } from './wsaa';
import { BREAKDOWN_21, buildVatAdjustmentCase, buildVatInvoiceCase, fceEmission, RECEPTOR_CUIT, RECEPTOR_RI } from './test-fixtures-vat';

const occurredAt = '2026-07-11T12:00:00.000Z';

describe('WSFE signer service — class A / B / FCE issuance & recovery', () => {
  test('issues a Factura A once and binds the discriminated IVA in the confirmation echo', async () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    const fixture = setup({ request, payload, authorizeResults: [accepted({ documentType: 1 })], ownDocuments: [retrievedA()] });
    const result = await fixture.service.issueInvoice(request, request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'accepted', resultado: 'A', cbteTipo: 1, cbteNro: '1', cae: '71234567890123' }));
    expect(result.feCompConsultarEcho).toEqual(expect.objectContaining({ documentType: 1, invoiceNumber: '1', total: { decimal: '12100.00', currency: 'ARS' } }));
    // No receptor PII, CBU-less by nature, and no raw net/IVA leak beyond the safe echo total.
    const stored = JSON.stringify(fixture.store.get(request.requestId)!);
    expect(stored).not.toContain(RECEPTOR_CUIT);
  });

  test('issues an FCE-A factura and binds FchVtoPago on the echo', async () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 201, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, fce: fceEmission(), concept: 1 });
    const fixture = setup({ request, payload, authorizeResults: [accepted({ documentType: 201, concept: 1 })], ownDocuments: [retrievedFceA()] });
    const result = await fixture.service.issueInvoice(request, request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'accepted', cbteTipo: 201, cbteNro: '1', cae: '71234567890123' }));
  });

  test('recovers an ambiguous Factura A by binding the echoed alícuota lines', async () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    const fixture = setup({ request, payload, authorizeResults: ['ambiguous', 'ambiguous'], ownDocuments: [null, retrievedA()] });
    const first = await fixture.service.issueInvoice(request, request.requestId, occurredAt);
    expect(first.status).toBe('ambiguous');
    const recovered = await fixture.service.issueInvoice(request, request.requestId, '2026-07-11T12:01:00.000Z');
    expect(recovered).toEqual(expect.objectContaining({ status: 'accepted', reprocessed: true, cbteTipo: 1, cae: '71234567890123' }));
  });

  test('rejects a recovered Factura A whose echoed IVA lines do not match the frozen breakdown', async () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    // Aggregate net/IVA match the frozen breakdown, but the echoed alícuota id differs (5 → 4).
    const wrongIva = retrievedA({ ivaLineItems: [{ alicIvaId: 4, baseImp: '10000.00', importe: '2100.00' }] });
    const fixture = setup({ request, payload, authorizeResults: ['ambiguous'], ownDocuments: [wrongIva] });
    await expect(fixture.service.issueInvoice(request, request.requestId, occurredAt)).rejects.toThrow('WSFE_RECOVERED_IVA_MISMATCH');
  });

  test('rejects a recovered Factura A whose echoed net does not match', async () => {
    const { payload, request } = buildVatInvoiceCase({ documentType: 1, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21 });
    const wrongNet = retrievedA({ netAmount: '9000.00', total: '11100.00' });
    const fixture = setup({ request, payload, authorizeResults: ['ambiguous'], ownDocuments: [wrongNet] });
    await expect(fixture.service.issueInvoice(request, request.requestId, occurredAt)).rejects.toThrow('WSFE_RECOVERED_DOCUMENT_MISMATCH');
  });

  test('authorizes an FCE-A nota de crédito only after its FCE original (201) is confirmed authorized', async () => {
    const { payload, request } = buildVatAdjustmentCase({ documentType: 203, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, anulacion: 'N' });
    const original = retrievedA({ documentType: 201, invoiceNumber: '81' });
    const noteEcho = retrievedA({ documentType: 203, invoiceNumber: '1', associatedDocument: { documentType: 201, pointOfSale: 4, invoiceNumber: '81' } });
    const fixture = setup({ request, payload, authorizeResults: [accepted({ documentType: 203 })], ownDocuments: [noteEcho], originalDocument: original });
    await expect(fixture.service.issueInvoice(request, request.requestId, occurredAt)).resolves.toEqual(expect.objectContaining({ status: 'accepted', cbteTipo: 203, cbteNro: '1' }));
  });

  test('refuses an FCE-A nota whose associated FCE original is not authorized', async () => {
    const { payload, request } = buildVatAdjustmentCase({ documentType: 203, receptor: RECEPTOR_RI, taxBreakdown: BREAKDOWN_21, anulacion: 'N' });
    const fixture = setup({ request, payload, originalDocument: retrievedA({ documentType: 201, invoiceNumber: '81', result: 'R' }) });
    await expect(fixture.service.issueInvoice(request, request.requestId, occurredAt)).rejects.toThrow('WSFE_ASSOCIATED_DOCUMENT_NOT_AUTHORIZED');
  });
});

type AuthorizeStep = WsfeAuthorizationResult | 'ambiguous';
type RetrieveStep = WsfeRetrievedDocument | null | 'ambiguous';

function setup(options: Readonly<{
  request: SignerRequest;
  payload: AuthorityPayload;
  authorizeResults?: AuthorizeStep[];
  ownDocuments?: RetrieveStep[];
  originalDocument?: WsfeRetrievedDocument;
}>) {
  const store = new SignerAttemptStore(':memory:');
  const vault = new FakeVault(options.payload);
  const authority = new FakeAuthority(options.authorizeResults ?? [accepted()], options.ownDocuments ?? [], options.originalDocument);
  const service = new WsfeSignerService({ environment: 'homologation', signerVersion: 'test' }, store, vault, new FakeWsaa(), authority);
  return { service, store, vault, authority };
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
  readonly #authorizeResults: AuthorizeStep[];
  readonly #ownDocuments: RetrieveStep[];
  readonly #originalDocument: WsfeRetrievedDocument | undefined;
  authorizeCalls = 0;
  constructor(authorizeResults: AuthorizeStep[], ownDocuments: RetrieveStep[], originalDocument: WsfeRetrievedDocument | undefined) {
    this.#authorizeResults = [...authorizeResults];
    this.#ownDocuments = [...ownDocuments];
    this.#originalDocument = originalDocument;
  }
  async authorize(): Promise<WsfeAuthorizationResult> {
    this.authorizeCalls += 1;
    const result = this.#authorizeResults.shift() ?? accepted();
    if (result === 'ambiguous') throw new WsfeAmbiguousTransportError(hashCanonical(`ambiguous-${this.authorizeCalls}`));
    return result;
  }
  async getLastInvoiceNumber() { return '0'; }
  async getDocument(_ticket: unknown, _documentType: DocumentType, _pointOfSale: number, invoiceNumber: string) {
    if (invoiceNumber === '81') return this.#originalDocument ?? null;
    const result = this.#ownDocuments.length ? this.#ownDocuments.shift()! : null;
    if (result === 'ambiguous') throw new WsfeAmbiguousTransportError(hashCanonical('own-ambiguous'));
    return result;
  }
  async assertPointOfSaleActive() {}
  async getPointsOfSale() { return { activePoints: [4], listedCount: 1, rawResponseHash: hashCanonical('discovery') }; }
  async dummy() { return { appServer: 'OK', dbServer: 'OK', authServer: 'OK' }; }
}

function accepted(overrides: Partial<WsfeAuthorizationResult> = {}): WsfeAuthorizationResult {
  return {
    status: 'accepted', documentType: 1, pointOfSale: 4, invoiceNumber: '1', issueDate: '2026-07-11', concept: 2,
    receptorDocType: 80, receptorDocNumber: RECEPTOR_CUIT, cae: '71234567890123', caeExpiry: '2026-07-21', reprocessed: false,
    safeErrors: [], rawResponseHash: hashCanonical('accepted'), ...overrides,
  };
}
function retrievedA(overrides: Partial<WsfeRetrievedDocument> = {}): WsfeRetrievedDocument {
  return {
    documentType: 1, pointOfSale: 4, invoiceNumber: '1', issueDate: '2026-07-11', concept: 2,
    receptorDocType: 80, receptorDocNumber: RECEPTOR_CUIT, currencyId: 'PES', currencyQuote: '1',
    total: '12100.00', netAmount: '10000.00', vatAmount: '2100.00', ivaLineItems: [{ alicIvaId: 5, baseImp: '10000.00', importe: '2100.00' }],
    servicePeriod: { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' }, paymentDueDate: '2026-07-11',
    associatedDocument: null, result: 'A', cae: '71234567890123', caeExpiry: '2026-07-21', rawResponseHash: hashCanonical('retrievedA'), ...overrides,
  };
}
function retrievedFceA(overrides: Partial<WsfeRetrievedDocument> = {}): WsfeRetrievedDocument {
  return retrievedA({ documentType: 201, concept: 1, servicePeriod: null, paymentDueDate: '2026-08-10', ...overrides });
}
