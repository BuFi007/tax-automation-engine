import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, SignerRequest } from './contracts';
import { canonicalAdjustment, payload, request } from './test-fixtures';
import { WsfexSignerService } from './service';
import { type WsfexAuthorityClient, WsfexAmbiguousTransportError, type WsfexAuthorizationResult, type WsfexCotizacion, type WsfexRetrievedDocument } from './soap';
import { SignerAttemptStore } from './store';
import type { AuthorityPayloadVault } from './vault';
import type { WsaaTicketBroker } from './wsaa';

const occurredAt = '2026-07-11T12:00:00.000Z';

describe('isolated WSFEX signer service', () => {
  test('authorizes once, persists only safe evidence, and idempotently returns the receipt', async () => {
    const fixture = setup();
    const first = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    const second = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);

    expect(first).toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '6', cae: '12345678901234', reprocessed: false }));
    expect(second).toEqual(first);
    expect(fixture.authority.authorizeCalls).toBe(1);
    const stored = fixture.store.get(fixture.request.requestId)!;
    expect(stored.state).toBe('accepted');
    expect(JSON.stringify(stored)).not.toContain('US-TAX-SECRET');
    expect(JSON.stringify(stored)).not.toContain('50000000016');
    expect(JSON.stringify(stored)).not.toContain('wsaa-token-secret');
    expect(JSON.stringify(stored)).not.toContain(fixture.request.authorityPayloadRef);
  });

  test('rejects reusing a request id with a different opaque payload reference', async () => {
    const fixture = setup();
    await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    const conflicting = { ...fixture.request, authorityPayloadRef: 'vault://wsfex/different' };
    await expect(fixture.service.authorize(conflicting, conflicting.requestId, occurredAt)).rejects.toThrow('WSFEX_REQUEST_ID_PAYLOAD_REFERENCE_CONFLICT');
  });

  test('records ambiguity, then recovers only by exact replay and an exact authority document match', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous', 'ambiguous'], recoveredDocuments: [null, retrieved()] });
    const first = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    expect(first.status).toBe('ambiguous');
    expect(fixture.store.get(fixture.request.requestId)?.state).toBe('ambiguous');

    const recovered = await fixture.service.recover(fixture.request, fixture.request.requestId, '2026-07-11T12:01:00.000Z');
    expect(recovered).toEqual(expect.objectContaining({ status: 'accepted', reprocessed: true, invoiceNumber: '6', cae: '12345678901234' }));
    expect(fixture.store.get(fixture.request.requestId)?.state).toBe('accepted');
  });

  test('keeps the outcome ambiguous when authorization and retrieval transports both fail', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous'], recoveredDocuments: ['ambiguous'] });
    const result = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'ambiguous', invoiceNumber: null, cae: null }));
  });

  test('refuses recovery with a changed vault payload hash', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous'], recoveredDocuments: [null] });
    await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    fixture.vault.payloadHash = hashCanonical('changed-after-first-attempt');
    await expect(fixture.service.recover(fixture.request, fixture.request.requestId, occurredAt)).rejects.toThrow('WSFEX_RECOVERY_PAYLOAD_HASH_MISMATCH');
  });

  test('requires an authorized original and the exact original currency quote for note 21', async () => {
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const canonicalDocument = canonicalAdjustment({ adjustmentId: 'credit-1', documentType: 21, amount: '100.00', reason: 'Commercial credit' });
    const notePayload = payload({
      canonicalDocument, subjectId: 'credit-1', intentHash: hashCanonical(canonicalDocument), requestId: '102', invoiceNumber: '1', documentType: 21,
      paymentDate: null, sameCurrencyPayment: null, total: '100.00', paymentTerms: null, associatedDocument: association,
      items: [{ code: null, description: 'Commercial credit', quantity: '1', unitCode: 7, unitPrice: '100.00', discount: '0', total: '100.00' }],
    });
    const noteRequest = request({
      subjectId: 'credit-1', intentHash: notePayload.intentHash, requestId: '102', authorityPayloadRef: 'vault://wsfex/note-1',
      expected: { documentType: 21, operationType: 2, pointOfSale: 4, issueDate: '2026-07-11', total: { decimal: '100.00', currency: 'USD' }, associatedDocument: association },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload });
    fixture.authority.originalDocument = retrieved({ invoiceNumber: '81', currencyQuote: '1200.26' });
    await expect(fixture.service.authorize(noteRequest, noteRequest.requestId, occurredAt)).rejects.toThrow('WSFEX_ADJUSTMENT_CURRENCY_QUOTE_MISMATCH');
  });

  test('authorizes note 20 only after exact original lookup and exact authority echo', async () => {
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const canonicalDocument = canonicalAdjustment({ adjustmentId: 'debit-1', documentType: 20, amount: '50.00', reason: 'Commercial debit' });
    const notePayload = payload({
      canonicalDocument, subjectId: 'debit-1', intentHash: hashCanonical(canonicalDocument), requestId: '103', invoiceNumber: '1', documentType: 20,
      paymentDate: null, sameCurrencyPayment: null, total: '50.00', paymentTerms: null, associatedDocument: association,
      items: [{ code: null, description: 'Commercial debit', quantity: '1', unitCode: 7, unitPrice: '50.00', discount: '0', total: '50.00' }],
    });
    const noteRequest = request({
      subjectId: 'debit-1', intentHash: notePayload.intentHash, requestId: '103', authorityPayloadRef: 'vault://wsfex/note-20',
      expected: { documentType: 20, operationType: 2, pointOfSale: 4, issueDate: '2026-07-11', total: { decimal: '50.00', currency: 'USD' }, associatedDocument: association },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload, authorizeResults: [accepted({ requestId: '103', documentType: 20, invoiceNumber: '1', cae: '32345678901234' })] });
    await expect(fixture.service.authorize(noteRequest, noteRequest.requestId, occurredAt)).resolves.toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '1' }));
  });

  test('rejects a CAE when ARCA echoes a different frozen document date', async () => {
    const fixture = setup({ authorizeResults: [accepted({ issueDate: '2026-07-12' })] });
    await expect(fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt)).rejects.toThrow('WSFEX_AUTHORITY_RESPONSE_MISMATCH');
  });

  test('persists an authority rejection without creating an authorized document', async () => {
    const fixture = setup({ authorizeResults: [accepted({ status: 'rejected', cae: null, safeErrors: [{ code: '1000', message: 'ARCA WSFEX error 1000' }] })] });
    const result = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'rejected', cae: null, authorizedDocument: null }));
    expect(fixture.store.get(fixture.request.requestId)?.state).toBe('rejected');
  });

  test('echoes the applied Moneda_ctz in the authorized document for the desk to persist', async () => {
    const fixture = setup();
    const result = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    expect(result.authorizedDocument).toEqual(expect.objectContaining({ currencyId: 'DOL', currencyQuote: '1200.25' }));
  });
});

describe('WSFEX cotización endpoint + error-1667 band', () => {
  const ctzContext = { workspaceId: 'workspace-1', issuerProfileRef: 'vault://issuer/profile-1' };

  test('returns the ARCA orientativo fail-closed, labeled and with the prior business day', async () => {
    const fixture = setup();
    const result = await fixture.service.getCotizacion('DOL', ctzContext, occurredAt);
    expect(result).toEqual({ monId: 'DOL', ctz: '1200.25', date: '2026-07-10', referenceDate: '2026-07-10', source: 'arca_orientativo' });
  });

  test('rejects an invalid monId and a non-business / future cotización date', async () => {
    const fixture = setup();
    await expect(fixture.service.getCotizacion('DOLLAR', ctzContext, occurredAt)).rejects.toThrow('WSFEX_CTZ_MON_ID_INVALID');
    fixture.authority.cotizacion = { monId: 'DOL', ctz: '1200.25', date: '2026-07-11' }; // Saturday
    await expect(fixture.service.getCotizacion('DOL', ctzContext, occurredAt)).rejects.toThrow('WSFEX_CTZ_DATE_NOT_BUSINESS_DAY');
    fixture.authority.cotizacion = { monId: 'DOL', ctz: '1200.25', date: '2026-07-20' }; // future
    await expect(fixture.service.getCotizacion('DOL', ctzContext, occurredAt)).rejects.toThrow('WSFEX_CTZ_DATE_IN_FUTURE');
  });

  test('accepts an invoice quote within the band and rejects one outside it before submit', async () => {
    const inBand = setup();
    inBand.authority.cotizacion = { monId: 'DOL', ctz: '1150.00', date: '2026-07-10' }; // ~4.4% from 1200.25
    await expect(inBand.service.authorize(inBand.request, inBand.request.requestId, occurredAt)).resolves.toEqual(expect.objectContaining({ status: 'accepted' }));

    const outOfBand = setup();
    outOfBand.authority.cotizacion = { monId: 'DOL', ctz: '2000.00', date: '2026-07-10' }; // ~40% from 1200.25
    await expect(outOfBand.service.authorize(outOfBand.request, outOfBand.request.requestId, occurredAt)).rejects.toThrow('WSFEX_MONEDA_CTZ_OUT_OF_BAND');
    expect(outOfBand.authority.authorizeCalls).toBe(0); // rejected in preflight, no wasted FEXAuthorize
  });

  test('does not apply the invoice band to an NC/ND — it inherits the original quote', async () => {
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const canonicalDocument = canonicalAdjustment({ adjustmentId: 'credit-2', documentType: 21, amount: '100.00', reason: 'Commercial credit' });
    const notePayload = payload({
      canonicalDocument, subjectId: 'credit-2', intentHash: hashCanonical(canonicalDocument), requestId: '104', invoiceNumber: '1', documentType: 21,
      paymentDate: null, sameCurrencyPayment: null, total: '100.00', paymentTerms: null, associatedDocument: association,
      items: [{ code: null, description: 'Commercial credit', quantity: '1', unitCode: 7, unitPrice: '100.00', discount: '0', total: '100.00' }],
    });
    const noteRequest = request({
      subjectId: 'credit-2', intentHash: notePayload.intentHash, requestId: '104', authorityPayloadRef: 'vault://wsfex/note-2',
      expected: { documentType: 21, operationType: 2, pointOfSale: 4, issueDate: '2026-07-11', total: { decimal: '100.00', currency: 'USD' }, associatedDocument: association },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload, authorizeResults: [accepted({ requestId: '104', documentType: 21, invoiceNumber: '1', cae: '42345678901234' })] });
    // Wildly out of today's band — must NOT block the note, whose quote matches its authorized original.
    fixture.authority.cotizacion = { monId: 'DOL', ctz: '9999.00', date: '2026-07-10' };
    await expect(fixture.service.authorize(noteRequest, noteRequest.requestId, occurredAt)).resolves.toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '1' }));
  });
});

type AuthorizeStep = WsfexAuthorizationResult | 'ambiguous';
type RetrieveStep = WsfexRetrievedDocument | null | 'ambiguous';

function setup(options: Readonly<{
  request?: SignerRequest;
  payload?: AuthorityPayload;
  authorizeResults?: AuthorizeStep[];
  recoveredDocuments?: RetrieveStep[];
}> = {}) {
  const signerRequest = options.request ?? request();
  const authorityPayload = options.payload ?? payload();
  const store = new SignerAttemptStore(':memory:');
  const vault = new FakeVault(authorityPayload);
  const authority = new FakeAuthority(options.authorizeResults, options.recoveredDocuments);
  const service = new WsfexSignerService(
    { environment: 'homologation', signerVersion: 'test' },
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
  async getTicket() { return { token: 'wsaa-token-secret', sign: 'wsaa-sign-secret', representedCuit: '20123456786', expiresAt: '2099-01-01T00:00:00.000Z' }; }
  async health() { return { certificateDelegationConfigured: true, wsaaReady: true }; }
}

class FakeAuthority implements WsfexAuthorityClient {
  authorizeCalls = 0;
  originalDocument: WsfexRetrievedDocument = retrieved({ invoiceNumber: '81' });
  // In band with the fixture invoice quote (1200.25) so invoice preflight passes;
  // tests override to force an error-1667 out-of-band rejection.
  cotizacion: WsfexCotizacion = { monId: 'DOL', ctz: '1200.25', date: '2026-07-10' };
  readonly #authorizeResults: AuthorizeStep[];
  readonly #recoveredDocuments: RetrieveStep[];

  constructor(authorizeResults: AuthorizeStep[] = [accepted()], recoveredDocuments: RetrieveStep[] = []) {
    this.#authorizeResults = [...authorizeResults];
    this.#recoveredDocuments = [...recoveredDocuments];
  }

  async authorize(): Promise<WsfexAuthorizationResult> {
    this.authorizeCalls += 1;
    const result = this.#authorizeResults.shift() ?? accepted();
    if (result === 'ambiguous') throw new WsfexAmbiguousTransportError(hashCanonical(`ambiguous-${this.authorizeCalls}`));
    return result;
  }
  async getLastRequestId() { return '100'; }
  async getLastInvoiceNumber(_ticket: unknown, documentType: 19 | 20 | 21) { return documentType === 19 ? '5' : '0'; }
  async getDocument(_ticket: unknown, documentType: 19 | 20 | 21, _pointOfSale: number, invoiceNumber: string) {
    if (documentType === 19 && invoiceNumber === '81') return this.originalDocument;
    const result = this.#recoveredDocuments.shift() ?? null;
    if (result === 'ambiguous') throw new WsfexAmbiguousTransportError(hashCanonical('retrieve-ambiguous'));
    return result;
  }
  async getCotizacion(_ticket: unknown, monId: string): Promise<WsfexCotizacion> {
    return { ...this.cotizacion, monId };
  }
  async assertPointOfSaleActive() {}
}

function accepted(overrides: Partial<WsfexAuthorizationResult> = {}): WsfexAuthorizationResult {
  return {
    status: 'accepted', requestId: '101', documentType: 19, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11',
    cae: '12345678901234', reprocessed: false, safeErrors: [], rawResponseHash: hashCanonical('accepted'), ...overrides,
  };
}

function retrieved(overrides: Partial<WsfexRetrievedDocument> = {}): WsfexRetrievedDocument {
  return {
    documentType: 19, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11', currencyId: 'DOL', currencyQuote: '1200.25',
    total: '1000.00', cae: '12345678901234', result: 'A', associatedDocument: null, rawResponseHash: hashCanonical('retrieved'), ...overrides,
  };
}
