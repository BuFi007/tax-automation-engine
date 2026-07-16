import { hashScope } from './consent';
import type { StaticAdapterInput } from './evidence';
import { StaticEvidenceAdapter, TaxEvidenceResolver } from './evidence';
import { buildTaxWidgetSnapshot } from './snapshot';
import type { FounderResidency, JurisdictionCode, TaxConsentGrant, TaxProfile } from './types';

const PERIOD = { start: '2026-01-01', end: '2026-12-31' } as const;
const AS_OF = '2026-07-10T12:00:00.000Z';

export function argentinaProfile(): TaxProfile {
  return {
    profileId: 'profile:ar-demo',
    workspaceId: 'workspace:demo',
    jurisdiction: 'AR',
    entityType: 'individual',
    regimeId: 'monotributo_exportador',
    ownerDomicileCountries: ['AR'],
    ownerTaxResidenceCountries: ['AR'],
    formationSubdivision: 'AR-C',
    operatingSubdivisions: ['AR-C'],
    answers: [
      { questionId: 'province', value: 'AR-C', confirmationState: 'user_confirmed' },
      { questionId: 'iibb_regime', value: 'caba_simplified', confirmationState: 'accountant_confirmed' },
      { questionId: 'exports_services', value: true, confirmationState: 'user_confirmed' },
      { questionId: 'export_pos_ready', value: true, confirmationState: 'user_confirmed' },
      { questionId: 'mipyme_certificate', value: false, confirmationState: 'user_confirmed' },
    ],
    catalogueVersion: 'ar-catalogue-2026-07-15',
    version: 'profile-v1',
    confirmationState: 'user_confirmed',
  };
}

export function unitedStatesProfile(): TaxProfile {
  return {
    profileId: 'profile:us-demo',
    workspaceId: 'workspace:demo',
    jurisdiction: 'US',
    entityType: 'llc',
    regimeId: 'llc_single_member',
    ownerDomicileCountries: ['AR'],
    ownerTaxResidenceCountries: ['AR'],
    formationSubdivision: 'US-DE',
    operatingSubdivisions: ['US-DE'],
    answers: [
      { questionId: 'founder_residency', value: 'foreign', confirmationState: 'user_confirmed' },
      { questionId: 'member_count', value: 1, confirmationState: 'user_confirmed' },
      { questionId: 'tax_classification', value: 'disregarded_entity', confirmationState: 'accountant_confirmed' },
      { questionId: 'formation_state', value: 'US-DE', confirmationState: 'user_confirmed' },
      { questionId: 'operating_states', value: ['US-DE'], confirmationState: 'user_confirmed' },
      { questionId: 'sales_states', value: ['US-CA', 'US-NY'], confirmationState: 'user_confirmed' },
      { questionId: 'has_payroll', value: false, confirmationState: 'user_confirmed' },
    ],
    catalogueVersion: 'us-catalogue-2026-07-15',
    version: 'profile-v1',
    confirmationState: 'user_confirmed',
  };
}

export async function demoSnapshot(jurisdiction: JurisdictionCode = 'AR', regimeId?: string, founderResidency: FounderResidency = 'foreign') {
  const sourceIds = ['bufi-ledger', 'quickbooks', 'magic-inbox', 'knowledge-graph', 'financial-analytics'];
  const consent: TaxConsentGrant = {
    purpose: 'tax_workspace_processing',
    version: 'consent-v1',
    scopeIds: sourceIds,
    scopeHash: hashScope(sourceIds),
    grantedAt: AS_OF,
    revokedAt: null,
  };
  const adapters = sourceIds.map(sourceId => new StaticEvidenceAdapter(adapterInput(sourceId, jurisdiction)));
  const evidence = await new TaxEvidenceResolver(adapters).resolve({
    workspaceId: 'workspace:demo',
    actorId: 'user:demo',
    connectionId: null,
    consentGrants: [consent],
    period: PERIOD,
    displayCurrency: jurisdiction === 'AR' ? 'ARS' : 'USD',
    asOf: AS_OF,
    dataScope: { mode: 'all_connected' },
  });
  const profile = demoProfile(jurisdiction, regimeId, founderResidency);
  return buildTaxWidgetSnapshot({ workspaceId: 'workspace:demo', profile, evidence });
}

function demoProfile(jurisdiction: JurisdictionCode, regimeId: string | undefined, founderResidency: FounderResidency): TaxProfile {
  const base = jurisdiction === 'AR' ? argentinaProfile() : unitedStatesProfile();
  if (jurisdiction === 'AR') {
    if (!regimeId || regimeId === base.regimeId) return base;
    if (!['responsable_inscripto', 'sociedad_mipyme'].includes(regimeId)) throw new Error('UNSUPPORTED_REGIME');
    return {
      ...base,
      profileId: `profile:ar-demo:${regimeId}`,
      regimeId,
      entityType: regimeId === 'sociedad_mipyme' ? 'company' : 'individual',
    };
  }

  const selectedRegimeId = regimeId ?? base.regimeId;
  if (!['llc_single_member', 'llc_multi_member', 's_corp', 'c_corp'].includes(selectedRegimeId)) throw new Error('UNSUPPORTED_REGIME');
  const isCorporation = selectedRegimeId === 's_corp' || selectedRegimeId === 'c_corp';
  return {
    ...base,
    profileId: `profile:us-demo:${selectedRegimeId}:${founderResidency}`,
    regimeId: selectedRegimeId,
    entityType: isCorporation ? 'corporation' : 'llc',
    ownerDomicileCountries: [founderResidency === 'local' ? 'US' : 'AR'],
    ownerTaxResidenceCountries: [founderResidency === 'local' ? 'US' : 'AR'],
    answers: base.answers.map(answer => {
      if (answer.questionId === 'member_count') return { ...answer, value: selectedRegimeId === 'llc_multi_member' ? 2 : 1 };
      if (answer.questionId === 'tax_classification') {
        const classification = selectedRegimeId === 'llc_single_member'
          ? 'disregarded_entity'
          : selectedRegimeId === 'llc_multi_member'
            ? 'partnership'
            : selectedRegimeId;
        return { ...answer, value: classification };
      }
      if (answer.questionId === 'founder_residency') return { ...answer, value: founderResidency };
      return answer;
    }),
  };
}

function adapterInput(sourceId: string, jurisdiction: JurisdictionCode): StaticAdapterInput {
  const currency = jurisdiction === 'AR' ? 'ARS' : 'USD';
  const sourceKind = sourceId === 'quickbooks' ? 'accounting' : sourceId === 'magic-inbox' ? 'magic_inbox' : sourceId === 'knowledge-graph' ? 'knowledge_graph' : sourceId === 'financial-analytics' ? 'financial_analytics' : 'bank';
  const records = sourceId === 'bufi-ledger' ? [
    record('invoice-1', sourceId, sourceKind, jurisdiction, 'event:invoice-1', 'invoice', 'revenue', 'inflow', '10000', currency),
    ...(jurisdiction === 'US'
      ? [record('settlement-1', sourceId, sourceKind, jurisdiction, 'event:invoice-1', 'settlement', 'none', 'neutral', '10000', currency)]
      : []),
    record('expense-1', sourceId, sourceKind, jurisdiction, 'event:expense-1', 'expense', 'expense', 'outflow', '2500', currency),
  ] : sourceId === 'quickbooks' ? [
    record('accounting-invoice-1', sourceId, sourceKind, jurisdiction, 'event:invoice-1', 'accounting_entry', 'none', 'neutral', '10000', currency),
  ] : sourceId === 'magic-inbox' ? [
    record('receipt-1', sourceId, sourceKind, jurisdiction, 'event:expense-1', 'receipt', 'none', 'neutral', '2500', currency),
  ] : [];
  return {
    adapterId: sourceId,
    sourceKind,
    canonicalProviderId: sourceId === 'quickbooks' ? 'quickbooks' : null,
    displaySourceId: sourceId,
    capabilities: sourceKind === 'accounting' ? ['ledger_accounts', 'invoices', 'bills', 'tax_lines', 'reconciliation'] : sourceKind === 'magic_inbox' ? ['documents', 'receipts', 'classification'] : sourceKind === 'knowledge_graph' ? ['entity_resolution'] : sourceKind === 'financial_analytics' ? ['actuals', 'cash_planning'] : ['transactions', 'payments'],
    records,
  };
}

function record(
  evidenceId: string,
  sourceId: string,
  sourceKind: StaticAdapterInput['sourceKind'],
  jurisdiction: JurisdictionCode,
  economicEventId: string,
  economicRole: StaticAdapterInput['records'][number]['economicRole'],
  countingDimension: StaticAdapterInput['records'][number]['countingDimension'],
  direction: StaticAdapterInput['records'][number]['direction'],
  decimal: string,
  currency: string
): StaticAdapterInput['records'][number] {
  return {
    evidenceId,
    revision: '1',
    sourceId,
    sourceKind,
    canonicalProviderId: sourceId === 'quickbooks' ? 'quickbooks' : null,
    externalReferenceHash: `hash:${evidenceId}`,
    sourceEventHash: `event-hash:${evidenceId}`,
    artifactHash: `artifact-hash:${evidenceId}`,
    jurisdiction,
    period: PERIOD,
    observedAt: AS_OF,
    expiresAt: null,
    economicEventId,
    economicRole,
    invoiceAdjustmentKind: null,
    adjustsEconomicEventId: null,
    countingDimension,
    direction,
    money: { decimal, currency },
    normalizedMoney: { decimal, currency },
    fxReferenceId: null,
    partyClaimHash: 'party:demo',
    accountReferenceHash: 'account:demo',
    confidence: { extraction: '1', classification: '1', matching: '1' },
    reviewState: 'accepted',
  };
}
