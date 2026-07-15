import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, SignerRequest } from './contracts';
import { canonicalAdjustment, canonicalInvoice, payload, request } from './test-fixtures';
import { WsfexSignerService } from './service';
import { type WsfexAuthorityClient, WsfexAmbiguousTransportError, type WsfexAuthorizationResult, type WsfexCotizacion, type WsfexRetrievedDocument } from './soap';
import { identityFor, SignerAttemptStore } from './store';
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
    const stored = fixture.store.get(attemptIdentity(fixture))!;
    expect(stored.state).toBe('accepted');
    expect(JSON.stringify(stored)).not.toContain('US-TAX-SECRET');
    expect(JSON.stringify(stored)).not.toContain('50000000016');
    expect(JSON.stringify(stored)).not.toContain('wsaa-token-secret');
    expect(JSON.stringify(stored)).not.toContain(fixture.request.authorityPayloadRef);
  });

  test('reconciles only through a fresh exact FEXGetCMP read, never the stored submit receipt', async () => {
    const fixture = setup({ recoveredDocuments: [retrieved()] });
    await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    const reconciled = await fixture.service.reconcile(
      fixture.request,
      fixture.request.requestId,
      occurredAt
    );
    expect(reconciled).toEqual(expect.objectContaining({
      status: 'accepted',
      invoiceNumber: '6',
      cae: '12345678901234',
      reprocessed: true,
    }));
    expect(fixture.authority.authorizeCalls).toBe(1);
    expect(fixture.authority.getDocumentCalls).toBe(1);
    expect(reconciled.reconciliation).toEqual(expect.objectContaining({
      source: 'FEXGetCMP',
      authorityResponseHash: hashCanonical('retrieved'),
      payloadHash: fixture.vault.payloadHash,
      representedCuitCommitment: fixture.vault.payload.representedCuitCommitment,
    }));
  });

  test('refuses to reconcile a same-total invoice with different customer or line evidence', async () => {
    const expected = retrieved();
    const fixture = setup({
      recoveredDocuments: [{
        ...expected,
        customer: { ...expected.customer, name: 'Different legal customer' },
      }],
    });
    await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    await expect(fixture.service.reconcile(
      fixture.request,
      fixture.request.requestId,
      occurredAt
    )).rejects.toThrow('WSFEX_RECOVERED_DOCUMENT_MISMATCH');
  });

  test('keeps reconciliation ambiguous when FEXGetCMP cannot see the document', async () => {
    const fixture = setup({ recoveredDocuments: [null] });
    await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    const reconciled = await fixture.service.reconcile(
      fixture.request,
      fixture.request.requestId,
      occurredAt
    );
    expect(reconciled).toEqual(expect.objectContaining({
      status: 'ambiguous',
      invoiceNumber: null,
      cae: null,
    }));
    expect(reconciled.safeErrors[0]?.code).toBe('WSFEX_DOCUMENT_NOT_YET_VISIBLE');
    expect(fixture.authority.getDocumentCalls).toBe(1);
  });

  test('rejects reusing a request id with a different opaque payload reference', async () => {
    const fixture = setup();
    await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    const conflicting = { ...fixture.request, authorityPayloadRef: 'vault://wsfex/different' };
    await expect(fixture.service.authorize(conflicting, conflicting.requestId, occurredAt)).rejects.toThrow('WSFEX_REQUEST_ID_PAYLOAD_REFERENCE_CONFLICT');
  });

  test('rejects relabeling an existing scoped attempt as a different workflow run', async () => {
    const fixture = setup();
    await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    const conflicting = { ...fixture.request, runId: '20000000-0000-4000-8000-000000000002' };
    await expect(fixture.service.authorize(conflicting, conflicting.requestId, occurredAt)).rejects.toThrow('WSFEX_REQUEST_SCOPE_RUN_CONFLICT');
  });

  test('rejects reusing one issuer-scoped ARCA request ID for a different document subject', async () => {
    const store = new SignerAttemptStore(':memory:');
    const first = setup({ store });
    const conflictingDocument = { ...canonicalInvoice(), intentId: 'invoice-2' };
    const conflictingPayload = payload({
      canonicalDocument: conflictingDocument,
      subjectId: 'invoice-2',
      intentHash: hashCanonical(conflictingDocument),
    });
    const conflictingRequest = request({
      subjectId: 'invoice-2',
      intentHash: conflictingPayload.intentHash,
      authorityPayloadRef: 'vault://wsfex/payload-2',
      authorityPayloadHash: hashCanonical(conflictingPayload),
    });
    const conflicting = setup({ request: conflictingRequest, payload: conflictingPayload, store });

    await first.service.authorize(first.request, first.request.requestId, occurredAt);
    await expect(conflicting.service.authorize(conflicting.request, conflicting.request.requestId, occurredAt))
      .rejects.toThrow('WSFEX_REQUEST_SCOPE_SUBJECT_CONFLICT');
    expect(conflicting.authority.authorizeCalls).toBe(0);
  });

  test('does not isolate one represented CUIT request ID behind workspace/profile aliases', async () => {
    const store = new SignerAttemptStore(':memory:');
    const first = setup({ store });
    const secondDocument = { ...canonicalInvoice(), workspaceId: 'workspace-2', intentId: 'invoice-2' };
    const secondPayload = payload({
      canonicalDocument: secondDocument,
      issuerProfileRef: 'vault://issuer/profile-2',
      subjectId: 'invoice-2',
      intentHash: hashCanonical(secondDocument),
    });
    const secondRequest = request({
      workspaceId: 'workspace-2',
      runId: '20000000-0000-4000-8000-000000000002',
      subjectId: 'invoice-2',
      intentHash: secondPayload.intentHash,
      authorityPayloadRef: 'vault://wsfex/payload-2',
      authorityPayloadHash: hashCanonical(secondPayload),
    });
    const second = setup({ request: secondRequest, payload: secondPayload, store });

    await expect(first.service.authorize(first.request, first.request.requestId, occurredAt))
      .resolves.toEqual(expect.objectContaining({ status: 'accepted' }));
    await expect(second.service.authorize(second.request, second.request.requestId, occurredAt))
      .rejects.toThrow('WSFEX_REQUEST_SCOPE_WORKSPACE_CONFLICT');
    expect(store.get(attemptIdentity(first))?.state).toBe('accepted');
    expect(first.authority.authorizeCalls).toBe(1);
    expect(second.authority.authorizeCalls).toBe(0);
  });

  test('records ambiguity, then recovers only by exact replay and an exact authority document match', async () => {
    const fixture = setup({ authorizeResults: ['ambiguous', 'ambiguous'], recoveredDocuments: [null, retrieved()] });
    const first = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    expect(first.status).toBe('ambiguous');
    expect(fixture.store.get(attemptIdentity(fixture))?.state).toBe('ambiguous');

    const recovered = await fixture.service.recover(fixture.request, fixture.request.requestId, '2026-07-11T12:01:00.000Z');
    expect(recovered).toEqual(expect.objectContaining({ status: 'accepted', reprocessed: true, invoiceNumber: '6', cae: '12345678901234' }));
    expect(fixture.store.get(attemptIdentity(fixture))?.state).toBe('accepted');
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

  test('binds the payload issuer selection to the WSAA represented-CUIT commitment', async () => {
    const fixture = setup({ wsaaCommitment: 'f'.repeat(64) });
    await expect(fixture.service.authorize(
      fixture.request,
      fixture.request.requestId,
      occurredAt
    )).rejects.toThrow('WSFEX_REPRESENTED_CUIT_COMMITMENT_MISMATCH');
    expect(fixture.authority.authorizeCalls).toBe(0);
  });

  test('queries again after a recovery replay rejection before promoting any denial', async () => {
    const fixture = setup({
      authorizeResults: [
        'ambiguous',
        accepted({ status: 'rejected', cae: null, caeExpiry: null }),
      ],
      recoveredDocuments: [null, null, retrieved()],
    });
    await expect(fixture.service.authorize(
      fixture.request,
      fixture.request.requestId,
      occurredAt
    )).resolves.toMatchObject({ status: 'ambiguous' });
    await expect(fixture.service.recover(
      fixture.request,
      fixture.request.requestId,
      '2026-07-11T12:01:00.000Z'
    )).resolves.toMatchObject({ status: 'accepted', reprocessed: true });
    expect(fixture.authority.authorizeCalls).toBe(2);
    expect(fixture.authority.getDocumentCalls).toBe(3);
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
      subjectId: 'credit-1', intentHash: notePayload.intentHash, requestId: '102', authorityPayloadRef: 'vault://wsfex/note-1', authorityPayloadHash: hashCanonical(notePayload),
      expected: { documentType: 21, operationType: 2, pointOfSale: 4, issueDate: '2026-07-11', total: { decimal: '100.00', currency: 'USD' }, associatedDocument: association },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload });
    fixture.authority.originalDocument = retrieved({ invoiceNumber: '81', currencyQuote: '1200.26' });
    await expect(fixture.service.authorize(noteRequest, noteRequest.requestId, occurredAt))
      .resolves.toEqual(expect.objectContaining({
        status: 'preflight_rejected',
        safeErrors: [expect.objectContaining({ code: 'WSFEX_ADJUSTMENT_CURRENCY_QUOTE_MISMATCH' })],
      }));
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
      subjectId: 'debit-1', intentHash: notePayload.intentHash, requestId: '103', authorityPayloadRef: 'vault://wsfex/note-20', authorityPayloadHash: hashCanonical(notePayload),
      expected: { documentType: 20, operationType: 2, pointOfSale: 4, issueDate: '2026-07-11', total: { decimal: '50.00', currency: 'USD' }, associatedDocument: association },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload, authorizeResults: [accepted({ requestId: '103', documentType: 20, invoiceNumber: '1', cae: '32345678901234' })] });
    await expect(fixture.service.authorize(noteRequest, noteRequest.requestId, occurredAt)).resolves.toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '1' }));
  });

  test('refuses a recovered note whose association names another represented CUIT', async () => {
    const association = { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' };
    const canonicalDocument = canonicalAdjustment({ adjustmentId: 'credit-cuit', documentType: 21, amount: '100.00', reason: 'Commercial credit' });
    const notePayload = payload({
      canonicalDocument, subjectId: 'credit-cuit', intentHash: hashCanonical(canonicalDocument), requestId: '105', invoiceNumber: '1', documentType: 21,
      paymentDate: null, sameCurrencyPayment: null, total: '100.00', paymentTerms: null, associatedDocument: association,
      items: [{ code: null, description: 'Commercial credit', quantity: '1', unitCode: 7, unitPrice: '100.00', discount: '0', total: '100.00' }],
    });
    const noteRequest = request({
      subjectId: 'credit-cuit', intentHash: notePayload.intentHash, requestId: '105', authorityPayloadRef: 'vault://wsfex/note-cuit', authorityPayloadHash: hashCanonical(notePayload),
      expected: { documentType: 21, operationType: 2, pointOfSale: 4, issueDate: '2026-07-11', total: { decimal: '100.00', currency: 'USD' }, associatedDocument: association },
    });
    const recovered = retrieved({
      documentType: 21, invoiceNumber: '1', total: '100.00', paymentTerms: null,
      paymentDate: null, sameCurrencyPayment: null, items: notePayload.items,
      associatedDocument: { ...association, representedCuit: '20999999999' },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload, authorizeResults: ['ambiguous'], recoveredDocuments: [recovered] });
    await expect(fixture.service.authorize(noteRequest, noteRequest.requestId, occurredAt))
      .rejects.toThrow('WSFEX_RECOVERED_ASSOCIATION_MISMATCH');
  });

  test('rejects a CAE when ARCA echoes a different frozen document date', async () => {
    const fixture = setup({ authorizeResults: [accepted({ issueDate: '2026-07-12' })] });
    await expect(fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt)).rejects.toThrow('WSFEX_AUTHORITY_RESPONSE_MISMATCH');
  });

  test('persists an authority rejection without creating an authorized document', async () => {
    const fixture = setup({ authorizeResults: [accepted({ status: 'rejected', cae: null, safeErrors: [{ code: '1000', message: 'ARCA WSFEX error 1000' }] })] });
    const result = await fixture.service.authorize(fixture.request, fixture.request.requestId, occurredAt);
    expect(result).toEqual(expect.objectContaining({ status: 'rejected', cae: null, authorizedDocument: null }));
    expect(fixture.store.get(attemptIdentity(fixture))?.state).toBe('rejected');
  });

  test('carries the exact frozen Moneda values submitted on direct authorization', async () => {
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
    await expect(outOfBand.service.authorize(outOfBand.request, outOfBand.request.requestId, occurredAt))
      .resolves.toEqual(expect.objectContaining({
        status: 'preflight_rejected',
        safeErrors: [expect.objectContaining({ code: 'WSFEX_MONEDA_CTZ_OUT_OF_BAND' })],
      }));
    expect(outOfBand.authority.authorizeCalls).toBe(0); // rejected in preflight, no wasted FEXAuthorize
    expect(outOfBand.store.get(attemptIdentity(outOfBand))).toBeNull();
  });

  test('allows a corrected fresh request allocation after a no-effect preflight denial', async () => {
    const store = new SignerAttemptStore(':memory:');
    const denied = setup({ store });
    denied.authority.cotizacion = { monId: 'DOL', ctz: '2000.00', date: '2026-07-10' };
    await expect(denied.service.authorize(
      denied.request,
      denied.request.requestId,
      occurredAt
    )).resolves.toMatchObject({ status: 'preflight_rejected' });
    expect(store.get(attemptIdentity(denied))).toBeNull();
    await expect(denied.service.recover(
      denied.request,
      denied.request.requestId,
      occurredAt
    )).rejects.toThrow('WSFEX_RECOVERY_ATTEMPT_NOT_FOUND');

    const correctedPayload = payload({ requestId: '102' });
    const correctedRequest = request({
      requestId: '102',
      authorityPayloadHash: hashCanonical(correctedPayload),
    });
    const corrected = setup({
      store,
      payload: correctedPayload,
      request: correctedRequest,
      authorizeResults: [accepted({ requestId: '102' })],
    });
    await expect(corrected.service.authorize(
      corrected.request,
      corrected.request.requestId,
      occurredAt
    )).resolves.toMatchObject({ status: 'accepted' });
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
      subjectId: 'credit-2', intentHash: notePayload.intentHash, requestId: '104', authorityPayloadRef: 'vault://wsfex/note-2', authorityPayloadHash: hashCanonical(notePayload),
      expected: { documentType: 21, operationType: 2, pointOfSale: 4, issueDate: '2026-07-11', total: { decimal: '100.00', currency: 'USD' }, associatedDocument: association },
    });
    const fixture = setup({ request: noteRequest, payload: notePayload, authorizeResults: [accepted({ requestId: '104', documentType: 21, invoiceNumber: '1', cae: '42345678901234' })] });
    // Wildly out of today's band — must NOT block the note, whose quote matches its authorized original.
    fixture.authority.cotizacion = { monId: 'DOL', ctz: '9999.00', date: '2026-07-10' };
    await expect(fixture.service.authorize(noteRequest, noteRequest.requestId, occurredAt)).resolves.toEqual(expect.objectContaining({ status: 'accepted', invoiceNumber: '1' }));
  });
});

describe('WSFEX point-of-sale discovery', () => {
  test('returns an authority-bound, CUIT-committed discovery receipt', async () => {
    const fixture = setup();
    fixture.authority.pointOfSaleDiscovery = {
      activePoints: [7, 4],
      rawResponseHash: hashCanonical('FEXGetPARAM_PtoVenta-response'),
    };
    const result = await fixture.service.discoverPointsOfSale(
      { workspaceId: 'workspace-1', issuerProfileRef: 'vault://issuer/profile-1' },
      occurredAt
    );
    expect(result).toEqual(expect.objectContaining({
      version: 'arca-wsfex-point-of-sale-discovery-v1',
      environment: 'homologation',
      workspaceId: 'workspace-1',
      issuerProfileReferenceHash: hashCanonical('vault://issuer/profile-1'),
      representedCuitCommitment: payload().representedCuitCommitment,
      activePoints: [4, 7],
      authorityResponseHash: hashCanonical('FEXGetPARAM_PtoVenta-response'),
      observedAt: occurredAt,
    }));
    const { evidenceHash, ...receipt } = result;
    expect(evidenceHash).toBe(hashCanonical(receipt));
    expect(JSON.stringify(result)).not.toContain('20123456786');
  });
});

type AuthorizeStep = WsfexAuthorizationResult | 'ambiguous';
type RetrieveStep = WsfexRetrievedDocument | null | 'ambiguous';

function setup(options: Readonly<{
  request?: SignerRequest;
  payload?: AuthorityPayload;
  authorizeResults?: AuthorizeStep[];
  recoveredDocuments?: RetrieveStep[];
  store?: SignerAttemptStore;
  wsaaCommitment?: string;
}> = {}) {
  const signerRequest = options.request ?? request();
  const authorityPayload = options.payload ?? payload();
  const store = options.store ?? new SignerAttemptStore(':memory:');
  const vault = new FakeVault(authorityPayload);
  const authority = new FakeAuthority(options.authorizeResults, options.recoveredDocuments);
  const service = new WsfexSignerService(
    { environment: 'homologation', signerVersion: 'test' },
    store,
    vault,
    new FakeWsaa(options.wsaaCommitment ?? authorityPayload.representedCuitCommitment),
    authority
  );
  return { service, store, vault, authority, request: signerRequest };
}

function attemptIdentity(fixture: ReturnType<typeof setup>) {
  return identityFor(fixture.request, fixture.vault.payload.representedCuitCommitment);
}

class FakeVault implements AuthorityPayloadVault {
  payloadHash: string;
  constructor(readonly payload: AuthorityPayload) { this.payloadHash = hashCanonical(payload); }
  async resolve() { return { payload: this.payload, payloadHash: this.payloadHash }; }
}

class FakeWsaa implements WsaaTicketBroker {
  constructor(private readonly representedCuitCommitment: string) {}
  async getTicket() { return { token: 'wsaa-token-secret', sign: 'wsaa-sign-secret', representedCuit: '20123456786', representedCuitCommitment: this.representedCuitCommitment, expiresAt: '2099-01-01T00:00:00.000Z' }; }
  async health() { return { certificateDelegationConfigured: true, wsaaReady: true }; }
}

class FakeAuthority implements WsfexAuthorityClient {
  authorizeCalls = 0;
  getDocumentCalls = 0;
  originalDocument: WsfexRetrievedDocument = retrieved({ invoiceNumber: '81' });
  // In band with the fixture invoice quote (1200.25) so invoice preflight passes;
  // tests override to force an error-1667 out-of-band rejection.
  cotizacion: WsfexCotizacion = { monId: 'DOL', ctz: '1200.25', date: '2026-07-10' };
  pointOfSaleDiscovery = { activePoints: [4] as readonly number[], rawResponseHash: hashCanonical('points-of-sale') };
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
    this.getDocumentCalls += 1;
    if (documentType === 19 && invoiceNumber === '81') return this.originalDocument;
    const result = this.#recoveredDocuments.shift() ?? null;
    if (result === 'ambiguous') throw new WsfexAmbiguousTransportError(hashCanonical('retrieve-ambiguous'));
    return result;
  }
  async getCotizacion(_ticket: unknown, monId: string): Promise<WsfexCotizacion> {
    return { ...this.cotizacion, monId };
  }
  async getPointsOfSale() { return this.pointOfSaleDiscovery; }
  async assertPointOfSaleActive() {}
}

function accepted(overrides: Partial<WsfexAuthorizationResult> = {}): WsfexAuthorizationResult {
  return {
    status: 'accepted', requestId: '101', documentType: 19, pointOfSale: 4, invoiceNumber: '6', issueDate: '2026-07-11',
    cae: '12345678901234', caeExpiry: '2026-07-21', reprocessed: false, safeErrors: [], rawResponseHash: hashCanonical('accepted'), ...overrides,
  };
}

function retrieved(overrides: Partial<WsfexRetrievedDocument> = {}): WsfexRetrievedDocument {
  const expected = payload();
  return {
    documentType: 19,
    operationType: 2,
    pointOfSale: 4,
    invoiceNumber: '6',
    issueDate: '2026-07-11',
    destinationCountryArcaCode: expected.destinationCountryArcaCode,
    customer: {
      name: expected.customer.name,
      address: expected.customer.address,
      countryCuit: expected.customer.countryCuit,
      foreignTaxId: expected.customer.foreignTaxId,
    },
    currencyId: 'DOL',
    currencyQuote: '1200.25',
    sameCurrencyPayment: expected.sameCurrencyPayment,
    paymentDate: expected.paymentDate,
    total: '1000.00',
    paymentTerms: expected.paymentTerms,
    commercialObservation: expected.commercialObservation,
    generalObservation: expected.generalObservation,
    language: expected.language,
    items: expected.items,
    cae: '12345678901234',
    caeExpiry: '2026-07-21',
    result: 'A',
    associatedDocument: null,
    rawResponseHash: hashCanonical('retrieved'),
    ...overrides,
  };
}
