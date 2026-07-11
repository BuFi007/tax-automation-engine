import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, SignerRequest } from './contracts';

export function request(overrides: Partial<SignerRequest> = {}): SignerRequest {
  const intentHash = overrides.intentHash ?? hashCanonical('invoice-intent');
  return {
    version: 'motora-wsfex-boundary-v1',
    environment: 'homologation',
    workspaceId: 'workspace-1',
    runId: '10000000-0000-4000-8000-000000000001',
    requestId: '101',
    subjectId: 'invoice-1',
    intentHash,
    authorityPayloadRef: 'vault://wsfex/payload-1',
    expected: {
      documentType: 19,
      operationType: 2,
      pointOfSale: 4,
      issueDate: '2026-07-11',
      total: { decimal: '1000.00', currency: 'USD' },
    },
    ...overrides,
  } as SignerRequest;
}

export function payload(overrides: Partial<AuthorityPayload> = {}): AuthorityPayload {
  return {
    version: 'wsfex-authority-payload-v1',
    issuerProfileRef: 'vault://issuer/profile-1',
    subjectId: 'invoice-1',
    intentHash: hashCanonical('invoice-intent'),
    requestId: '101',
    invoiceNumber: '6',
    documentType: 19,
    operationType: 2,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    destinationCountryArcaCode: 200,
    customer: { name: 'Foreign Customer', address: '123 Main St', countryCuit: '50000000016', foreignTaxId: 'US-TAX-SECRET' },
    currency: { safeCode: 'USD', arcaId: 'DOL', quote: '1200.25' },
    sameCurrencyPayment: true,
    paymentDate: '2026-07-11',
    total: '1000.00',
    paymentTerms: 'Due on receipt',
    commercialObservation: null,
    generalObservation: null,
    language: 2,
    associatedDocument: null,
    items: [{ code: null, description: 'Software services', quantity: '1', unitCode: 7, unitPrice: '1000.00', discount: '0', total: '1000.00' }],
    ...overrides,
  } as AuthorityPayload;
}
