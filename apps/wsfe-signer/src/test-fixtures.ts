import { hashCanonical } from '@tax-engine/core';

import type { AuthorityPayload, SignerRequest } from './contracts';

// Distinct from the represented CUIT so "no receptor PII persisted" is provable.
export const RECEPTOR_CUIT = '27300000008';
const RECEPTOR_REFERENCE_HASH = hashCanonical({ docType: 80, docNumber: RECEPTOR_CUIT, condicionIvaId: 6 });
const RULE_VERSION_IDS = ['ar-rg-5616-condicion-iva-v1', 'arca-wsfev1-domestic-v1', 'ar-monotributo-factura-c-v1'];
const SERVICE_PERIOD = { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' } as const;

export function request(overrides: Partial<SignerRequest> = {}): SignerRequest {
  const intentHash = overrides.intentHash ?? hashCanonical(canonicalInvoice());
  return {
    version: 'motora-wsfe-boundary-v1',
    environment: 'homologation',
    workspaceId: 'workspace-1',
    runId: '10000000-0000-4000-8000-000000000001',
    requestId: '101',
    subjectId: 'invoice-1',
    intentHash,
    authorityPayloadRef: 'vault://wsfe/payload-1',
    expected: {
      documentType: 11,
      concept: 2,
      pointOfSale: 4,
      issueDate: '2026-07-11',
      receptorDocType: 80,
      receptorCondicionIvaId: 6,
      total: { decimal: '15000.00', currency: 'ARS' },
      servicePeriod: SERVICE_PERIOD,
    },
    ...overrides,
  } as SignerRequest;
}

export function payload(overrides: Partial<AuthorityPayload> = {}): AuthorityPayload {
  const canonicalDocument = canonicalInvoice();
  return {
    version: 'wsfe-authority-payload-v1',
    canonicalDocument,
    issuerProfileRef: 'vault://issuer/profile-1',
    subjectId: 'invoice-1',
    intentHash: hashCanonical(canonicalDocument),
    requestId: '101',
    invoiceNumber: '6',
    documentType: 11,
    concept: 2,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    receptor: { docType: 80, docNumber: RECEPTOR_CUIT, condicionIvaId: 6 },
    servicePeriod: SERVICE_PERIOD,
    total: { decimal: '15000.00', currency: 'ARS' },
    associatedDocument: null,
    ...overrides,
  } as AuthorityPayload;
}

export function canonicalInvoice() {
  return {
    version: 'factura-c-intent-v1' as const,
    intentId: 'invoice-1',
    workspaceId: 'workspace-1',
    taxpayerReferenceHash: hashCanonical('taxpayer-1'),
    receptorReferenceHash: RECEPTOR_REFERENCE_HASH,
    receptor: { docType: 80 as const, condicionIvaId: 6 as const },
    documentType: 11 as const,
    concept: 2 as const,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    servicePeriod: SERVICE_PERIOD,
    total: { decimal: '15000.00', currency: 'ARS' as const },
    description: 'Servicios de software — julio 2026',
    ruleVersionIds: RULE_VERSION_IDS,
  };
}

export function canonicalAdjustment(input: Readonly<{ adjustmentId: string; documentType: 12 | 13; amount: string; reason: string }>) {
  return {
    version: 'factura-c-adjustment-v1' as const,
    adjustmentId: input.adjustmentId,
    workspaceId: 'workspace-1',
    taxpayerReferenceHash: hashCanonical('taxpayer-1'),
    receptorReferenceHash: RECEPTOR_REFERENCE_HASH,
    receptor: { docType: 80 as const, condicionIvaId: 6 as const },
    documentType: input.documentType,
    concept: 2 as const,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    servicePeriod: SERVICE_PERIOD,
    associatedDocument: { documentType: 11 as const, pointOfSale: 4, invoiceNumber: '81' },
    total: { decimal: input.amount, currency: 'ARS' as const },
    reason: input.reason,
    ruleVersionIds: RULE_VERSION_IDS,
  };
}
