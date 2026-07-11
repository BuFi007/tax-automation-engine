import type { JurisdictionCode, TaxObligation, TaxProfile, TaxRuleReference } from '../types';

export type CatalogueQuestion = Readonly<{
  id: string;
  label: string;
  kind: 'enum' | 'country' | 'subdivision' | 'multi_select' | 'boolean' | 'integer';
  required: boolean;
  options?: readonly Readonly<{ value: string; label: string }>[];
}>;

export type RegimeDefinition = Readonly<{
  id: string;
  entityTypes: readonly string[];
  label: string;
  description: string;
  requiredQuestions: readonly string[];
  ruleVersionIds: readonly string[];
}>;

export type JurisdictionCatalogue = Readonly<{
  jurisdiction: JurisdictionCode;
  version: string;
  displayName: string;
  questions: readonly CatalogueQuestion[];
  regimes: readonly RegimeDefinition[];
  rules: readonly TaxRuleReference[];
}>;

export type WorkflowBuildContext = Readonly<{
  profile: TaxProfile;
  period: Readonly<{ start: string; end: string }>;
}>;

export interface TaxJurisdictionProvider {
  readonly jurisdiction: JurisdictionCode;
  readonly catalogue: JurisdictionCatalogue;
  validateProfile(profile: TaxProfile): readonly string[];
  buildObligations(context: WorkflowBuildContext): readonly TaxObligation[];
}
