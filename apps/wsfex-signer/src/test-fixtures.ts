import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, SignerRequest } from './contracts';

export function request(overrides: Partial<SignerRequest> = {}): SignerRequest {
  const intentHash = overrides.intentHash ?? hashCanonical(canonicalInvoice());
  return {
    version: 'motora-wsfex-boundary-v1',
    environment: 'homologation',
    workspaceId: 'workspace-1',
    runId: '10000000-0000-4000-8000-000000000001',
    requestId: '101',
    subjectId: 'invoice-1',
    intentHash,
    authorityPayloadRef: 'vault://wsfex/payload-1',
    authorityPayloadHash: hashCanonical(payload()),
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
  const canonicalDocument = canonicalInvoice();
  return {
    version: 'wsfex-authority-payload-v1',
    canonicalDocument,
    issuerProfileRef: 'vault://issuer/profile-1',
    taxpayerReferenceHash: canonicalDocument.taxpayerReferenceHash,
    representedCuitCommitment: hashCanonical('represented-cuit:20123456786'),
    subjectId: 'invoice-1',
    intentHash: hashCanonical(canonicalDocument),
    requestId: '101',
    invoiceNumber: '6',
    documentType: 19,
    operationType: 2,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    destinationCountryArcaCode: 200,
    customer: { referenceHash: canonicalDocument.foreignCustomerReferenceHash, name: 'Foreign Customer', address: '123 Main St', countryCuit: '50000000016', foreignTaxId: 'US-TAX-SECRET' },
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

export function canonicalInvoice() {
  return {
    version: 'factura-e-intent-v1' as const,
    intentId: 'invoice-1',
    workspaceId: 'workspace-1',
    taxpayerReferenceHash: hashCanonical('taxpayer-1'),
    foreignCustomerReferenceHash: hashCanonical('customer-1'),
    foreignCustomerSafeLabel: 'Foreign Customer',
    destinationCountry: 'US',
    destinationCountryArcaCode: 200,
    documentType: 19 as const,
    operationType: 2 as const,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    paymentDate: '2026-07-11',
    sameCurrencyPayment: true,
    exchangeRate: { decimal: '1200.25', sourceReferenceId: 'fx:bna', observedForDate: '2026-07-10', authorityRuleDecisionId: 'arca-fx-reviewed-v1' },
    lineItems: [{ description: 'Software services', quantity: '1', unitPrice: '1000.00', total: '1000.00', unitCode: 7 }],
    total: { decimal: '1000.00', currency: 'USD' },
    serviceDescription: 'Software services',
    paymentTerms: 'Due on receipt',
    ruleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
  };
}

export function canonicalAdjustment(input: Readonly<{ adjustmentId: string; documentType: 20 | 21; amount: string; reason: string }>) {
  return {
    version: 'factura-e-adjustment-v1' as const,
    adjustmentId: input.adjustmentId,
    documentType: input.documentType,
    associatedDocument: { documentType: 19 as const, pointOfSale: 4, invoiceNumber: '81' },
    issueDate: '2026-07-11',
    amount: { decimal: input.amount, currency: 'USD' },
    reason: input.reason,
    foreignCustomerReferenceHash: hashCanonical('customer-1'),
    destinationCountryArcaCode: 200,
    ruleVersionIds: ['ar-rg-4401-factura-e-v1', 'arca-wsfex-3.1.1', 'bcra-a8330-service-exports-v1'],
  };
}
