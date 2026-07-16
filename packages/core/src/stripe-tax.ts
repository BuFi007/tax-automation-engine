import { createHash } from 'node:crypto';

import type { TaxEvidenceRecord } from './evidence';
import { money } from './money';
import type { EvidenceMoney, JurisdictionCode, Period } from './types';

export const STRIPE_TAX_SUPPORT_MATRIX_VERSION = 'stripe-tax-supported-countries-2026-07-15';
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
  } as const;
  const arcaDocument = input.invoiceDocumentKind?.startsWith('arca_') ?? false;
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
  issuerJurisdiction: JurisdictionCode;
  period: Period;
  observedAt: string;
  economicEventId: string;
  providerTransactionHash: string;
  providerRevision: string;
  taxAmount: EvidenceMoney;
  route: StripeTaxRoutingDecisionV1;
}>;

export function stripeTaxTransactionEvidence(input: StripeTaxTransactionEvidenceInput): TaxEvidenceRecord {
  if (input.route.stripeRole !== 'indirect_tax_calculation_evidence') throw new Error('STRIPE_TAX_CALCULATION_EVIDENCE_NOT_AUTHORIZED');
  if (!/^[a-f0-9]{64}$/.test(input.providerTransactionHash)) throw new Error('STRIPE_TAX_PROVIDER_HASH_INVALID');
  const taxAmount = money(input.taxAmount.decimal, input.taxAmount.currency);
  const idempotencyKey = sha256({ sourceId: input.sourceId, transaction: input.providerTransactionHash, revision: input.providerRevision });
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
    supersedesIdempotencyKey: null,
  };
}

function unsupported(
  base: Pick<StripeTaxRoutingDecisionV1, 'version' | 'matrixVersion' | 'matrixSourceUrl'>,
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
  'AL', 'AO', 'AM', 'AW', 'AZ', 'BS', 'BH', 'BD', 'BB', 'BY', 'BJ', 'BA', 'BF', 'KH', 'CM', 'CL', 'CO', 'CR', 'CD', 'EC', 'EG', 'ET', 'GE', 'GN', 'IS', 'IN', 'ID', 'KZ', 'KE', 'KG', 'LA', 'MY', 'MR', 'MD', 'ME', 'MA', 'NP', 'NG', 'MK', 'OM', 'PE', 'PH', 'RU', 'SA', 'SN', 'RS', 'ZA', 'KR', 'LK', 'SR', 'TW', 'TJ', 'TZ', 'TH', 'TR', 'UG', 'UA', 'UY', 'UZ', 'VN', 'ZM', 'ZW',
];
const STRIPE_CUSTOMER_COUNTRY_SUPPORT = new Map<string, 'all_products' | 'digital_only'>([
  ...ALL_PRODUCT_CUSTOMER_COUNTRIES.map(country => [country, 'all_products'] as const),
  ...DIGITAL_ONLY_CUSTOMER_COUNTRIES.map(country => [country, 'digital_only'] as const),
]);
