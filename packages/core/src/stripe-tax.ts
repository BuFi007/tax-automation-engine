import { createHash } from 'node:crypto';

import { assertTaxEvidenceBatchV1, hashTaxEvidenceConsentScope, type TaxEvidenceBatchV1, type TaxEvidenceRecord } from './evidence';
import { money } from './money';
import type { EvidenceMoney, JurisdictionCode, Period } from './types';

export const STRIPE_TAX_SUPPORT_MATRIX_VERSION = 'stripe-tax-supported-countries-2026-07-16';
export const STRIPE_TAX_SUPPORT_SOURCE_URL = 'https://docs.stripe.com/tax/supported-countries';

export type FiscalAuthorityRoute = 'arca' | 'stripe_tax_supported_jurisdiction' | 'erp' | 'manual';

export type StripeTaxRoutingInput = Readonly<{
  issuerCountry: string;
  customerCountry: string;
  productType: 'physical' | 'digital' | 'service';
  requestedAuthority: FiscalAuthorityRoute;
  invoiceDocumentKind: TaxEvidenceRecord['invoiceDocumentKind'];
  stripeLocationValidated: boolean;
  stripeRegistrationState: 'confirmed' | 'none' | 'unknown';
  customerTaxIdType: 'ar_cuit' | 'eu_vat' | 'us_ein' | 'other' | null;
}>;

export type StripeTaxRoutingDecisionV1 = Readonly<{
  version: 'stripe-tax-routing-decision-v1';
  matrixVersion: typeof STRIPE_TAX_SUPPORT_MATRIX_VERSION;
  matrixSourceUrl: typeof STRIPE_TAX_SUPPORT_SOURCE_URL;
  issuerCountry: string;
  customerCountry: string;
  productType: StripeTaxRoutingInput['productType'];
  fiscalAuthority: FiscalAuthorityRoute;
  stripeRole: 'indirect_tax_calculation_evidence' | 'payment_evidence_only' | 'not_used';
  calculationState:
    | 'eligible_registered'
    | 'eligible_no_registration'
    | 'unsupported_seller_country'
    | 'unsupported_customer_country'
    | 'unsupported_product_type'
    | 'customer_location_unverified'
    | 'not_requested';
  filingState: 'not_applicable' | 'user_responsible' | 'provider_not_configured';
  warnings: readonly string[];
}>;

export function routeStripeTaxAuthority(input: StripeTaxRoutingInput): StripeTaxRoutingDecisionV1 {
  validateCountry(input.issuerCountry);
  validateCountry(input.customerCountry);
  const base = {
    version: 'stripe-tax-routing-decision-v1' as const,
    matrixVersion: STRIPE_TAX_SUPPORT_MATRIX_VERSION,
    matrixSourceUrl: STRIPE_TAX_SUPPORT_SOURCE_URL,
    issuerCountry: input.issuerCountry,
    customerCountry: input.customerCountry,
    productType: input.productType,
  } as const;
  const arcaDocument = input.invoiceDocumentKind?.startsWith('arca_') ?? false;
  if (arcaDocument && input.issuerCountry !== 'AR') throw new Error('STRIPE_TAX_ARCA_DOCUMENT_ISSUER_MISMATCH');
  if (input.issuerCountry === 'AR' || arcaDocument) {
    return {
      ...base,
      fiscalAuthority: 'arca',
      stripeRole: 'payment_evidence_only',
      calculationState: input.requestedAuthority === 'stripe_tax_supported_jurisdiction' ? 'unsupported_seller_country' : 'not_requested',
      filingState: 'not_applicable',
      warnings: [
        'STRIPE_DOCUMENT_IS_NOT_AN_ARCA_FISCAL_INVOICE',
        ...(input.customerTaxIdType === 'ar_cuit' ? ['STRIPE_AR_CUIT_IS_DISPLAY_ONLY'] : []),
      ],
    };
  }
  if (input.requestedAuthority === 'erp') {
    return { ...base, fiscalAuthority: 'erp', stripeRole: 'payment_evidence_only', calculationState: 'not_requested', filingState: 'provider_not_configured', warnings: ['ERP_FISCAL_AUTHORITY_REQUIRES_SEPARATE_VERIFICATION'] };
  }
  if (input.requestedAuthority !== 'stripe_tax_supported_jurisdiction') {
    return { ...base, fiscalAuthority: 'manual', stripeRole: 'not_used', calculationState: 'not_requested', filingState: 'provider_not_configured', warnings: [] };
  }
  if (!STRIPE_SUPPORTED_SELLER_COUNTRIES.has(input.issuerCountry)) {
    return unsupported(base, 'unsupported_seller_country');
  }
  const customerSupport = STRIPE_CUSTOMER_COUNTRY_SUPPORT.get(input.customerCountry);
  if (!customerSupport) return unsupported(base, 'unsupported_customer_country');
  if (customerSupport === 'digital_only' && input.productType !== 'digital') {
    return unsupported(base, 'unsupported_product_type');
  }
  if (!input.stripeLocationValidated) return unsupported(base, 'customer_location_unverified');
  return {
    ...base,
    fiscalAuthority: 'stripe_tax_supported_jurisdiction',
    stripeRole: 'indirect_tax_calculation_evidence',
    calculationState: input.stripeRegistrationState === 'confirmed' ? 'eligible_registered' : 'eligible_no_registration',
    filingState: input.stripeRegistrationState === 'confirmed' ? 'user_responsible' : 'provider_not_configured',
    warnings: [
      ...(input.stripeRegistrationState === 'confirmed' ? ['FILING_AND_REMITTANCE_AUTHORITY_NOT_PROVEN'] : ['STRIPE_REGISTRATION_NOT_CONFIRMED']),
      ...(input.customerTaxIdType === 'ar_cuit' ? ['STRIPE_AR_CUIT_IS_DISPLAY_ONLY'] : []),
    ],
  };
}

export type StripeTaxTransactionEvidenceInput = Readonly<{
  workspaceId: string;
  sourceId: string;
  consentVersion: string;
  issuerJurisdiction: JurisdictionCode | null;
  period: Period;
  observedAt: string;
  economicEventId: string;
  providerTransactionHash: string;
  providerRevision: string;
  taxAmount: EvidenceMoney;
  route: StripeTaxRoutingDecisionV1;
  supersedes?: Readonly<{
    providerTransactionHash: string;
    providerRevision: string;
  }> | null;
}>;

export function stripeTaxTransactionEvidence(input: StripeTaxTransactionEvidenceInput): TaxEvidenceRecord {
  assertStripeRouteEvidenceEligible(input.route);
  if (
    input.route.stripeRole !== 'indirect_tax_calculation_evidence'
    || input.route.fiscalAuthority !== 'stripe_tax_supported_jurisdiction'
    || !input.route.calculationState.startsWith('eligible_')
  ) throw new Error('STRIPE_TAX_CALCULATION_EVIDENCE_NOT_AUTHORIZED');
  const expectedJurisdiction = input.route.issuerCountry === 'AR'
    || input.route.issuerCountry === 'US'
    || input.route.issuerCountry === 'AE'
    ? input.route.issuerCountry
    : null;
  if (expectedJurisdiction !== input.issuerJurisdiction) throw new Error('STRIPE_TAX_EVIDENCE_JURISDICTION_MISMATCH');
  if (!/^[a-f0-9]{64}$/.test(input.providerTransactionHash)) throw new Error('STRIPE_TAX_PROVIDER_HASH_INVALID');
  const taxAmount = money(input.taxAmount.decimal, input.taxAmount.currency);
  const idempotencyKey = sha256({ sourceId: input.sourceId, transaction: input.providerTransactionHash, revision: input.providerRevision });
  const supersedesIdempotencyKey = input.supersedes
    ? stripeTaxIdempotencyKey(input.sourceId, input.supersedes.providerTransactionHash, input.supersedes.providerRevision)
    : null;
  if (supersedesIdempotencyKey === idempotencyKey) throw new Error('STRIPE_TAX_SUPERSESSION_SELF_REFERENCE');
  return {
    evidenceId: `stripe-tax:${input.providerTransactionHash}`,
    workspaceId: input.workspaceId,
    revision: input.providerRevision,
    sourceId: input.sourceId,
    sourceKind: 'stripe',
    canonicalProviderId: 'stripe_tax',
    externalReferenceHash: input.providerTransactionHash,
    sourceEventHash: sha256({ transaction: input.providerTransactionHash, revision: input.providerRevision, taxAmount }),
    artifactHash: sha256({ route: input.route, transaction: input.providerTransactionHash }),
    jurisdiction: input.issuerJurisdiction,
    period: input.period,
    observedAt: input.observedAt,
    expiresAt: null,
    economicEventId: input.economicEventId,
    economicRole: 'tax',
    invoiceDocumentKind: null,
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    countingDimension: 'none',
    direction: 'neutral',
    money: taxAmount,
    normalizedMoney: taxAmount,
    fxReferenceId: null,
    partyClaimHash: null,
    accountReferenceHash: null,
    confidence: { extraction: '1', classification: '1', matching: null },
    reviewState: 'accepted',
    validityState: 'active',
    consentVersion: input.consentVersion,
    idempotencyKey,
    supersedesIdempotencyKey,
  };
}

export type StripeTaxEvidenceBatchInputV1 = Readonly<{
  batchId: string;
  workspaceId: string;
  sourceId: string;
  consentVersion: string;
  consentSourceIds: readonly string[];
  checkpoint: Readonly<{ sequence: number; revision: string; observedAt: string }>;
  mode: TaxEvidenceBatchV1['mode'];
  producedAt: string;
  transactions: readonly Omit<StripeTaxTransactionEvidenceInput, 'workspaceId' | 'sourceId' | 'consentVersion'>[];
}>;

/**
 * Converts a normalized Stripe Tax report/webhook projection into the shared
 * TaxEvidenceBatchV1 corridor. This function never accepts Stripe secrets or
 * raw customer payloads and never creates payment/settlement finality.
 */
export function buildStripeTaxEvidenceBatchV1(input: StripeTaxEvidenceBatchInputV1): TaxEvidenceBatchV1 {
  const sourceIds = [...new Set(input.consentSourceIds)].sort();
  const records = input.transactions
    .map(transaction => stripeTaxTransactionEvidence({
      ...transaction,
      workspaceId: input.workspaceId,
      sourceId: input.sourceId,
      consentVersion: input.consentVersion,
    }))
    .sort((left, right) => left.idempotencyKey.localeCompare(right.idempotencyKey));
  const batch: TaxEvidenceBatchV1 = {
    version: 'tax-evidence-batch-v1',
    batchId: input.batchId,
    workspaceId: input.workspaceId,
    source: {
      sourceId: input.sourceId,
      sourceKind: 'stripe',
      canonicalProviderId: 'stripe_tax',
      adapterSchemaVersion: 'stripe-tax-evidence-v2',
    },
    checkpoint: input.checkpoint,
    mode: input.mode,
    consent: {
      purpose: 'tax_workspace_processing',
      version: input.consentVersion,
      scopeHash: hashTaxEvidenceConsentScope(input.consentVersion, sourceIds),
      sourceIds,
    },
    capabilities: [
      { capability: 'tax_lines', state: 'available', observedAt: input.checkpoint.observedAt, safeErrorCode: null },
      { capability: 'tax_documents', state: 'partial', observedAt: input.checkpoint.observedAt, safeErrorCode: 'STRIPE_DOCUMENT_NOT_FISCAL_AUTHORITY_RECEIPT' },
    ],
    records,
    producedAt: input.producedAt,
  };
  assertTaxEvidenceBatchV1(batch);
  return batch;
}

function assertStripeRouteEvidenceEligible(route: StripeTaxRoutingDecisionV1): void {
  if (route.matrixVersion !== STRIPE_TAX_SUPPORT_MATRIX_VERSION || route.matrixSourceUrl !== STRIPE_TAX_SUPPORT_SOURCE_URL) {
    throw new Error('STRIPE_TAX_SUPPORT_MATRIX_STALE');
  }
  if (!STRIPE_SUPPORTED_SELLER_COUNTRIES.has(route.issuerCountry)) throw new Error('STRIPE_TAX_SUPPORT_MATRIX_ROUTE_INVALID');
  const customerSupport = STRIPE_CUSTOMER_COUNTRY_SUPPORT.get(route.customerCountry);
  if (!customerSupport || (customerSupport === 'digital_only' && route.productType !== 'digital')) {
    throw new Error('STRIPE_TAX_SUPPORT_MATRIX_ROUTE_INVALID');
  }
}

function stripeTaxIdempotencyKey(sourceId: string, providerTransactionHash: string, providerRevision: string): string {
  if (!/^[a-f0-9]{64}$/.test(providerTransactionHash)) throw new Error('STRIPE_TAX_PROVIDER_HASH_INVALID');
  return sha256({ sourceId, transaction: providerTransactionHash, revision: providerRevision });
}

function unsupported(
  base: Pick<StripeTaxRoutingDecisionV1, 'version' | 'matrixVersion' | 'matrixSourceUrl' | 'issuerCountry' | 'customerCountry' | 'productType'>,
  calculationState: Extract<StripeTaxRoutingDecisionV1['calculationState'], `unsupported_${string}` | 'customer_location_unverified'>,
): StripeTaxRoutingDecisionV1 {
  return { ...base, fiscalAuthority: 'manual', stripeRole: 'payment_evidence_only', calculationState, filingState: 'provider_not_configured', warnings: ['STRIPE_TAX_ROUTE_UNSUPPORTED'] };
}

function validateCountry(country: string): void {
  if (!/^[A-Z]{2}$/.test(country)) throw new Error('STRIPE_TAX_COUNTRY_INVALID');
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

const STRIPE_SUPPORTED_SELLER_COUNTRIES = new Set([
  'AU', 'AT', 'BE', 'BG', 'CA', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HK', 'HU', 'IE', 'IT', 'JP', 'LV', 'LI', 'LT', 'LU', 'MT', 'MX', 'NL', 'NZ', 'NO', 'PL', 'PT', 'PR', 'RO', 'SG', 'SK', 'SI', 'ES', 'SE', 'CH', 'AE', 'GB', 'US',
]);

const ALL_PRODUCT_CUSTOMER_COUNTRIES = [...STRIPE_SUPPORTED_SELLER_COUNTRIES];
const DIGITAL_ONLY_CUSTOMER_COUNTRIES = [
  'AL', 'AO', 'AM', 'AW', 'AZ', 'BS', 'BH', 'BD', 'BB', 'BY', 'BJ', 'BA', 'BF', 'KH', 'CM', 'CV', 'CL', 'CO', 'CR', 'CD', 'EC', 'EG', 'ET', 'GE', 'GN', 'IS', 'IN', 'ID', 'KZ', 'KE', 'KG', 'LA', 'MY', 'MR', 'MD', 'ME', 'MA', 'NP', 'NG', 'MK', 'OM', 'PE', 'PH', 'RU', 'SA', 'SN', 'RS', 'KR', 'LK', 'SR', 'TW', 'TJ', 'TZ', 'TH', 'TR', 'UG', 'UA', 'UY', 'UZ', 'VN', 'ZM', 'ZW',
];
const STRIPE_CUSTOMER_COUNTRY_SUPPORT = new Map<string, 'all_products' | 'digital_only'>([
  ...ALL_PRODUCT_CUSTOMER_COUNTRIES.map(country => [country, 'all_products'] as const),
  ['ZA', 'all_products'],
  ...DIGITAL_ONLY_CUSTOMER_COUNTRIES.map(country => [country, 'digital_only'] as const),
]);
