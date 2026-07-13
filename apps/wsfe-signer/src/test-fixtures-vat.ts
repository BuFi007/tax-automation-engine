import { hashCanonical } from '@tax-engine/core';
import Decimal from 'decimal.js';

import { associatedFacturaType, expectedIvaImporte, type AuthorityPayload, type SignerRequest, type TaxBreakdown } from './contracts';

// Fixtures for the discriminated-IVA (class A/B) and FCE MiPyME lanes. Class C
// keeps its own fixtures in test-fixtures.ts; nothing here touches them.

const WORKSPACE = 'workspace-1';
const TAXPAYER_HASH = hashCanonical('taxpayer-1');
const RULE_IDS = ['ar-rg-5616-condicion-iva-v1', 'arca-wsfev1-domestic-v1'];
const RUN_ID = '10000000-0000-4000-8000-0000000000ab';
export const SERVICE_PERIOD = { from: '2026-07-01', to: '2026-07-11', paymentDueDate: '2026-07-11' } as const;

// A valid CUIT (same check-digit-valid value the class-C fixtures use).
export const RECEPTOR_CUIT = '27300000008';

export type ReceptorIdentity = Readonly<{ docType: 80 | 86 | 96 | 99; docNumber: string; condicionIvaId: number }>;
// RI receptor (condición 1) → class A. Monotributo (6) → class A too (RG 5616).
export const RECEPTOR_RI: ReceptorIdentity = { docType: 80, docNumber: RECEPTOR_CUIT, condicionIvaId: 1 };
export const RECEPTOR_MONOTRIBUTO: ReceptorIdentity = { docType: 80, docNumber: RECEPTOR_CUIT, condicionIvaId: 6 };
// Consumidor final → class B.
export const RECEPTOR_CONSUMIDOR_FINAL: ReceptorIdentity = { docType: 99, docNumber: '0', condicionIvaId: 5 };

// A 22-digit CBU + an alias that satisfies the 6–20 alphanumeric rule.
export const FCE_CBU = '2850590940090418135201';
export const FCE_ALIAS = 'mi.alias.fce';
export function fceEmission(overrides: Partial<{ paymentDueDate: string; emitterCbu: string; emitterAlias: string | null; transmissionMode: 'SCA' | 'ADC' }> = {}) {
  return { paymentDueDate: '2026-08-10', emitterCbu: FCE_CBU, emitterAlias: FCE_ALIAS, transmissionMode: 'SCA' as const, ...overrides };
}

export function ivaLine(alicIvaId: 3 | 4 | 5 | 6 | 8 | 9, baseImp: string) {
  return { alicIvaId, baseImp, importe: expectedIvaImporte(baseImp, alicIvaId) };
}
export function makeBreakdown(lines: ReturnType<typeof ivaLine>[], extra: Readonly<{ impTrib?: string; impOpEx?: string }> = {}): TaxBreakdown {
  const netAmount = lines.reduce((sum, line) => sum.add(line.baseImp), new Decimal(0)).toFixed(2);
  return { netAmount, ivaLineItems: lines, impTrib: extra.impTrib ?? '0', impOpEx: extra.impOpEx ?? '0' } as TaxBreakdown;
}
export function breakdownTotal(breakdown: TaxBreakdown): string {
  const iva = breakdown.ivaLineItems.reduce((sum, line) => sum.add(line.importe), new Decimal(0));
  return new Decimal(breakdown.netAmount).add(iva).add(breakdown.impTrib).add(breakdown.impOpEx).toFixed(2);
}
export function vatTotal(breakdown: TaxBreakdown): string {
  return breakdown.ivaLineItems.reduce((sum, line) => sum.add(line.importe), new Decimal(0)).toFixed(2);
}

// A canonical single-alícuota 21% breakdown: net 10000 + IVA 2100 = 12100.
export const BREAKDOWN_21 = makeBreakdown([ivaLine(5, '10000.00')]);
// Mixed 21% + 10.5%: (10000 @21% = 2100) + (5000 @10.5% = 525) → net 15000, IVA 2625, total 17625.
export const BREAKDOWN_MIXED = makeBreakdown([ivaLine(5, '10000.00'), ivaLine(4, '5000.00')]);

type InvoiceCaseOptions = Readonly<{
  documentType: 1 | 6 | 201 | 206 | 211;
  receptor: ReceptorIdentity;
  taxBreakdown: TaxBreakdown | null;
  fce?: ReturnType<typeof fceEmission> | null;
  concept?: 1 | 2 | 3;
  servicePeriod?: typeof SERVICE_PERIOD | null;
  total?: string; // required when taxBreakdown is null (class C FCE)
  intentId?: string;
  requestId?: string;
  invoiceNumber?: string;
  issueDate?: string;
  pointOfSale?: number;
}>;

export function buildVatInvoiceCase(options: InvoiceCaseOptions): Readonly<{ canonical: Record<string, unknown>; payload: AuthorityPayload; request: SignerRequest }> {
  const concept = options.concept ?? 2;
  const servicePeriod = options.servicePeriod === undefined ? (concept === 1 ? null : SERVICE_PERIOD) : options.servicePeriod;
  const fce = options.fce ?? null;
  const total = options.taxBreakdown ? breakdownTotal(options.taxBreakdown) : options.total!;
  const intentId = options.intentId ?? 'inv-vat-1';
  const requestId = options.requestId ?? '201';
  const invoiceNumber = options.invoiceNumber ?? '1';
  const issueDate = options.issueDate ?? '2026-07-11';
  const pointOfSale = options.pointOfSale ?? 4;
  const receptorReferenceHash = hashCanonical({ docType: options.receptor.docType, docNumber: options.receptor.docNumber, condicionIvaId: options.receptor.condicionIvaId });
  const canonical = {
    version: 'wsfe-invoice-intent-v1' as const,
    intentId,
    workspaceId: WORKSPACE,
    taxpayerReferenceHash: TAXPAYER_HASH,
    receptorReferenceHash,
    receptor: { docType: options.receptor.docType, condicionIvaId: options.receptor.condicionIvaId },
    documentType: options.documentType,
    concept,
    pointOfSale,
    issueDate,
    servicePeriod,
    taxBreakdown: options.taxBreakdown,
    fce,
    total: { decimal: total, currency: 'ARS' as const },
    description: 'Servicios profesionales — julio 2026',
    ruleVersionIds: RULE_IDS,
  };
  const intentHash = hashCanonical(canonical);
  const payload = {
    version: 'wsfe-authority-payload-v1',
    canonicalDocument: canonical,
    issuerProfileRef: 'vault://issuer/profile-1',
    subjectId: intentId,
    intentHash,
    requestId,
    invoiceNumber,
    documentType: options.documentType,
    concept,
    pointOfSale,
    issueDate,
    receptor: options.receptor,
    servicePeriod,
    taxBreakdown: options.taxBreakdown,
    fceEmission: fce,
    fceAdjustment: null,
    total: { decimal: total, currency: 'ARS' },
    associatedDocument: null,
  } as AuthorityPayload;
  const request = {
    version: 'motora-wsfe-boundary-v1',
    environment: 'homologation',
    workspaceId: WORKSPACE,
    runId: RUN_ID,
    requestId,
    subjectId: intentId,
    intentHash,
    authorityPayloadRef: 'vault://wsfe/payload-vat',
    expected: {
      documentType: options.documentType,
      concept,
      pointOfSale,
      issueDate,
      receptorDocType: options.receptor.docType,
      receptorCondicionIvaId: options.receptor.condicionIvaId,
      total: { decimal: total, currency: 'ARS' },
      servicePeriod,
    },
  } as SignerRequest;
  return { canonical, payload, request };
}

type AdjustmentCaseOptions = Readonly<{
  documentType: 2 | 3 | 7 | 8 | 202 | 203 | 207 | 208 | 212 | 213;
  receptor: ReceptorIdentity;
  taxBreakdown: TaxBreakdown | null;
  anulacion?: 'S' | 'N';
  concept?: 1 | 2 | 3;
  servicePeriod?: typeof SERVICE_PERIOD | null;
  total?: string;
  association?: Readonly<{ documentType: number; pointOfSale: number; invoiceNumber: string }>;
  intentId?: string;
  requestId?: string;
  invoiceNumber?: string;
  issueDate?: string;
  pointOfSale?: number;
}>;

export function buildVatAdjustmentCase(options: AdjustmentCaseOptions): Readonly<{ canonical: Record<string, unknown>; payload: AuthorityPayload; request: SignerRequest }> {
  const concept = options.concept ?? 2;
  const servicePeriod = options.servicePeriod === undefined ? (concept === 1 ? null : SERVICE_PERIOD) : options.servicePeriod;
  const isFce = options.documentType >= 201;
  const fceAdjustment = isFce ? { anulacion: options.anulacion ?? 'N' } : null;
  const total = options.taxBreakdown ? breakdownTotal(options.taxBreakdown) : options.total!;
  const intentId = options.intentId ?? 'adj-vat-1';
  const requestId = options.requestId ?? '301';
  const invoiceNumber = options.invoiceNumber ?? '1';
  const issueDate = options.issueDate ?? '2026-07-11';
  const pointOfSale = options.pointOfSale ?? 4;
  const association = options.association ?? { documentType: associatedFacturaType(options.documentType), pointOfSale: 4, invoiceNumber: '81' };
  const receptorReferenceHash = hashCanonical({ docType: options.receptor.docType, docNumber: options.receptor.docNumber, condicionIvaId: options.receptor.condicionIvaId });
  const canonical = {
    version: 'wsfe-adjustment-intent-v1' as const,
    adjustmentId: intentId,
    workspaceId: WORKSPACE,
    taxpayerReferenceHash: TAXPAYER_HASH,
    receptorReferenceHash,
    receptor: { docType: options.receptor.docType, condicionIvaId: options.receptor.condicionIvaId },
    documentType: options.documentType,
    concept,
    pointOfSale,
    issueDate,
    servicePeriod,
    taxBreakdown: options.taxBreakdown,
    fce: fceAdjustment,
    associatedDocument: association,
    total: { decimal: total, currency: 'ARS' as const },
    reason: 'Anulación parcial',
    ruleVersionIds: RULE_IDS,
  };
  const intentHash = hashCanonical(canonical);
  const payload = {
    version: 'wsfe-authority-payload-v1',
    canonicalDocument: canonical,
    issuerProfileRef: 'vault://issuer/profile-1',
    subjectId: intentId,
    intentHash,
    requestId,
    invoiceNumber,
    documentType: options.documentType,
    concept,
    pointOfSale,
    issueDate,
    receptor: options.receptor,
    servicePeriod,
    taxBreakdown: options.taxBreakdown,
    fceEmission: null,
    fceAdjustment,
    total: { decimal: total, currency: 'ARS' },
    associatedDocument: association,
  } as AuthorityPayload;
  const request = {
    version: 'motora-wsfe-boundary-v1',
    environment: 'homologation',
    workspaceId: WORKSPACE,
    runId: RUN_ID,
    requestId,
    subjectId: intentId,
    intentHash,
    authorityPayloadRef: 'vault://wsfe/payload-vat-adj',
    expected: {
      documentType: options.documentType,
      concept,
      pointOfSale,
      issueDate,
      receptorDocType: options.receptor.docType,
      receptorCondicionIvaId: options.receptor.condicionIvaId,
      total: { decimal: total, currency: 'ARS' },
      servicePeriod,
      associatedDocument: association,
    },
  } as SignerRequest;
  return { canonical, payload, request };
}
