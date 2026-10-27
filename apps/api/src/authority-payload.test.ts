import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import { HttpAuthorityPayloadWriter } from './authority-payload';
import type { AuthorityPayload } from '@tax-engine/wsfex-signer/contracts';

describe('trusted authority payload writer', () => {
  test('sends the canonical payload only to the HTTPS vault and verifies its receipt', async () => {
    const payload = invoicePayload();
    const writer = new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test/', token: 'writer-secret', environment: 'homologation' }, async (input, init) => {
      expect(String(input)).toBe('https://arca-boundary.test/v1/authority-payloads');
      expect(init?.redirect).toBe('manual');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer writer-secret');
      expect(new Headers(init?.headers).get('idempotency-key')).toBe('payload-idempotency-1');
      const body = JSON.parse(String(init?.body));
      expect(body.payload.canonicalDocument).toEqual(payload.canonicalDocument);
      return Response.json({
        version: 'authority-payload-store-receipt-v1', reference: 'vault://wsfex/00000000-0000-4000-8000-000000000101',
        payloadHash: hashCanonical(payload), storedAt: '2026-07-11T12:00:00.000Z', expiresAt: '2026-07-12T12:00:00.000Z',
      }, { status: 201 });
    });
    await expect(writer.store({ workspaceId: 'workspace-1', payload, expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'payload-idempotency-1' }))
      .resolves.toEqual(expect.objectContaining({ reference: 'vault://wsfex/00000000-0000-4000-8000-000000000101', payloadHash: hashCanonical(payload) }));
  });

  test('requires HTTPS and rejects a receipt for another encrypted payload', async () => {
    expect(() => new HttpAuthorityPayloadWriter({ baseUrl: 'http://arca-boundary.test', token: 'secret', environment: 'homologation' }))
      .toThrow('ARCA_BOUNDARY_HTTPS_REQUIRED');
    const writer = new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test', token: 'secret', environment: 'homologation' }, async () => Response.json({
      version: 'authority-payload-store-receipt-v1', reference: 'vault://wsfex/00000000-0000-4000-8000-000000000101',
      payloadHash: hashCanonical('different'), storedAt: '2026-07-11T12:00:00.000Z', expiresAt: '2026-07-12T12:00:00.000Z',
    }));
    await expect(writer.store({ workspaceId: 'workspace-1', payload: invoicePayload(), expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'payload-idempotency-1' }))
      .rejects.toThrow('ARCA_BOUNDARY_RECEIPT_MISMATCH');
  });

  test('pins the boundary origin and rejects URL authority or path confusion', () => {
    expect(() => new HttpAuthorityPayloadWriter({ baseUrl: 'https://user@arca-boundary.test', token: 'secret', environment: 'homologation' }))
      .toThrow('ARCA_BOUNDARY_URL_INVALID');
    expect(() => new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test/redirect', token: 'secret', environment: 'homologation' }))
      .toThrow('ARCA_BOUNDARY_URL_INVALID');
    expect(() => new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test?next=https://attacker.test', token: 'secret', environment: 'homologation' }))
      .toThrow('ARCA_BOUNDARY_URL_INVALID');
  });

  test('marks an exactly reconciled payload terminal and verifies the evidence-bound receipt', async () => {
    const reference = 'vault://wsfex/00000000-0000-4000-8000-000000000101';
    const payloadHash = hashCanonical('payload');
    const authorityIdentityHash = hashCanonical('authority-identity');
    const terminalEvidenceHash = hashCanonical('terminal-evidence');
    const writer = new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test', token: 'writer-secret', environment: 'homologation' }, async (input, init) => {
      expect(String(input)).toBe('https://arca-boundary.test/v1/authority-payloads/terminal');
      expect(init?.redirect).toBe('manual');
      expect(JSON.parse(String(init?.body))).toEqual({
        version: 'authority-payload-terminal-v1', workspaceId: 'workspace-1', reference, payloadHash,
        terminalState: 'officially_reconciled', authorityIdentityHash, terminalEvidenceHash,
      });
      return Response.json({
        version: 'authority-payload-terminal-receipt-v1', referenceHash: hashCanonical(reference),
        payloadHash, authorityIdentityHash,
        terminalState: 'officially_reconciled', retentionPolicyId: 'tax-wsfex-terminal-v1',
        retireAfter: '2026-08-11T12:00:00.000Z', terminalEvidenceHash,
      });
    });
    await expect(writer.markTerminal({
      workspaceId: 'workspace-1', reference, payloadHash, terminalState: 'officially_reconciled',
      authorityIdentityHash, terminalEvidenceHash,
    })).resolves.toEqual(expect.objectContaining({ terminalEvidenceHash, retentionPolicyId: 'tax-wsfex-terminal-v1' }));
  });

  test('cancels a chunked boundary receipt once the streaming limit is crossed', async () => {
    let cancelled = false;
    const writer = new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test', token: 'secret', environment: 'homologation' }, async () => new Response(new ReadableStream({
      pull(controller) {
        controller.enqueue(new Uint8Array(20 * 1024));
      },
      cancel() { cancelled = true; },
    })));
    await expect(writer.store({ workspaceId: 'workspace-1', payload: invoicePayload(), expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'payload-idempotency-1' }))
      .rejects.toThrow('ARCA_BOUNDARY_RESPONSE_TOO_LARGE');
    expect(cancelled).toBe(true);
  });

  test('normalizes transport failures without reflecting sensitive detail', async () => {
    const writer = new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test', token: 'secret', environment: 'homologation' }, async () => {
      throw new Error('sensitive network detail');
    });
    await expect(writer.store({ workspaceId: 'workspace-1', payload: invoicePayload(), expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'payload-idempotency-1' }))
      .rejects.toThrow('ARCA_BOUNDARY_TRANSPORT_FAILED_ERROR');
  });
});

function invoicePayload(): AuthorityPayload {
  const canonicalDocument = {
    version: 'factura-e-intent-v1' as const, intentId: 'intent-1', workspaceId: 'workspace-1',
    taxpayerReferenceHash: hashCanonical('taxpayer'), foreignCustomerReferenceHash: hashCanonical('customer'), foreignCustomerSafeLabel: 'Foreign customer',
    destinationCountry: 'US', destinationCountryArcaCode: 200, documentType: 19 as const, operationType: 2 as const, pointOfSale: 4,
    issueDate: '2026-07-11', paymentDate: '2026-07-11', sameCurrencyPayment: true,
    exchangeRate: { decimal: '1200.25', sourceReferenceId: 'fx:bna', observedForDate: '2026-07-10', authorityRuleDecisionId: 'fx-reviewed' },
    lineItems: [{ description: 'Software services', quantity: '1', unitPrice: '1000.00', total: '1000.00', unitCode: 7 }],
    total: { decimal: '1000.00', currency: 'USD' }, serviceDescription: 'Software services', paymentTerms: 'Due on receipt',
    ruleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
  };
  return {
    version: 'wsfex-authority-payload-v1', canonicalDocument, issuerProfileRef: 'issuer://workspace-1/primary',
    taxpayerReferenceHash: canonicalDocument.taxpayerReferenceHash, representedCuitCommitment: hashCanonical('represented-cuit:workspace-1'), subjectId: 'intent-1',
    intentHash: hashCanonical(canonicalDocument), requestId: '101', invoiceNumber: '6', documentType: 19, operationType: 2, pointOfSale: 4,
    issueDate: '2026-07-11', destinationCountryArcaCode: 200,
    customer: { referenceHash: canonicalDocument.foreignCustomerReferenceHash, name: 'Foreign customer', address: '123 Main', countryCuit: '50000000016', foreignTaxId: 'US-TAX' },
    currency: { safeCode: 'USD', arcaId: 'DOL', quote: '1200.25' }, sameCurrencyPayment: true, paymentDate: '2026-07-11', total: '1000.00',
    paymentTerms: 'Due on receipt', commercialObservation: null, generalObservation: null, language: 2, associatedDocument: null,
    items: [{ code: null, description: 'Software services', quantity: '1', unitCode: 7, unitPrice: '1000.00', discount: '0', total: '1000.00' }],
  };
}

test('refuses a vault redirect as a transport failure', async () => {
  const writer = new HttpAuthorityPayloadWriter({ baseUrl: 'https://arca-boundary.test', token: 'secret', environment: 'homologation' }, async () => new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } }));
  await expect(writer.store({ workspaceId: 'workspace-1', payload: invoicePayload(), expiresAt: '2026-07-12T12:00:00.000Z', idempotencyKey: 'payload-idempotency-1' }))
    .rejects.toThrow(/^ARCA_BOUNDARY_TRANSPORT_FAILED_ERROR$/);
});
