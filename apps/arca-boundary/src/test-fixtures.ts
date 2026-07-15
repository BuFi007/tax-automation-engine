import { hashCanonical } from '@tax-engine/core';
import type { AuthorityPayload as WsfeAuthorityPayload } from '@tax-engine/wsfe-signer/contracts';
import type { AuthorityPayload } from '@tax-engine/wsfex-signer/contracts';
import * as forge from 'node-forge';

export const NOW = new Date('2026-07-11T12:00:00.000Z');
export const CUIT = '20123456786';
// Distinct, greppable receptor identity so "no domestic PII in the DB" is provable.
export const WSFE_RECEPTOR_CUIT = '27300000008';

export function authorityPayload(overrides: Partial<AuthorityPayload> = {}): AuthorityPayload {
  const canonicalDocument = canonicalInvoice();
  return {
    version: 'wsfex-authority-payload-v1',
    canonicalDocument,
    issuerProfileRef: 'issuer://workspace-1/primary',
    subjectId: 'intent-1',
    intentHash: hashCanonical(canonicalDocument),
    requestId: '101',
    invoiceNumber: '6',
    documentType: 19,
    operationType: 2,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    destinationCountryArcaCode: 200,
    customer: { referenceHash: canonicalDocument.foreignCustomerReferenceHash, name: 'Sensitive Foreign Customer', address: 'Secret address 123', countryCuit: '50000000016', foreignTaxId: 'FOREIGN-TAX-SECRET' },
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

function canonicalInvoice() {
  return {
    version: 'factura-e-intent-v1' as const,
    intentId: 'intent-1',
    workspaceId: 'workspace-1',
    taxpayerReferenceHash: hashCanonical('taxpayer-1'),
    foreignCustomerReferenceHash: hashCanonical('customer-1'),
    foreignCustomerSafeLabel: 'Sensitive Foreign Customer',
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

export function wsfeAuthorityPayload(overrides: Partial<WsfeAuthorityPayload> = {}): WsfeAuthorityPayload {
  const receptor = { docType: 80 as const, docNumber: WSFE_RECEPTOR_CUIT, condicionIvaId: 6 as const };
  const servicePeriod = { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' };
  const canonicalDocument = {
    version: 'factura-c-intent-v1' as const,
    intentId: 'intent-c-1',
    workspaceId: 'workspace-1',
    taxpayerReferenceHash: hashCanonical('taxpayer-c-1'),
    receptorReferenceHash: hashCanonical(receptor),
    receptor: { docType: receptor.docType, condicionIvaId: receptor.condicionIvaId },
    documentType: 11 as const,
    concept: 2 as const,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    servicePeriod,
    total: { decimal: '15000.00', currency: 'ARS' as const },
    description: 'Servicios de software — Sensitive Domestic Client',
    ruleVersionIds: ['ar-rg-5616-condicion-iva-v1', 'arca-wsfev1-domestic-v1'],
  };
  return {
    version: 'wsfe-authority-payload-v1',
    canonicalDocument,
    issuerProfileRef: 'issuer://workspace-1/primary',
    subjectId: 'intent-c-1',
    intentHash: hashCanonical(canonicalDocument),
    requestId: '201',
    invoiceNumber: '6',
    documentType: 11,
    concept: 2,
    pointOfSale: 4,
    issueDate: '2026-07-11',
    receptor,
    servicePeriod,
    total: { decimal: '15000.00', currency: 'ARS' },
    associatedDocument: null,
    ...overrides,
  } as WsfeAuthorityPayload;
}

export function certificateBundle(cuit = CUIT, now = NOW, bits = 2048) {
  const keys = forge.pki.rsa.generateKeyPair({ bits, e: 0x10001 });
  const certificate = forge.pki.createCertificate();
  certificate.publicKey = keys.publicKey;
  certificate.serialNumber = '01';
  certificate.validity.notBefore = new Date(now.getTime() - 24 * 60 * 60_000);
  certificate.validity.notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60_000);
  const attributes = [
    { name: 'commonName', value: 'Motora ARCA test issuer' },
    { name: 'serialNumber', value: `CUIT ${cuit}` },
  ];
  certificate.setSubject(attributes);
  certificate.setIssuer(attributes);
  certificate.setExtensions([{ name: 'basicConstraints', cA: false }]);
  certificate.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certificatePem: forge.pki.certificateToPem(certificate),
    privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}
