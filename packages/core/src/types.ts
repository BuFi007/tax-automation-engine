export type JurisdictionCode = 'AR' | 'US';

export type IsoDate = string;
export type IsoDateTime = string;

export type EvidenceMoney = Readonly<{
  decimal: string;
  currency: string;
}>;

export type Period = Readonly<{
  start: IsoDate;
  end: IsoDate;
}>;

export type TaxConsentPurpose =
  | 'tax_workspace_processing'
  | 'provider_submission'
  | 'tax_evidence_quality'
  | 'cre_attestation'
  | 'fantasmita_disclosure';

export type TaxConsentGrant = Readonly<{
  purpose: TaxConsentPurpose;
  version: string;
  scopeIds: readonly string[];
  scopeHash: string;
  grantedAt: IsoDateTime;
  revokedAt: IsoDateTime | null;
}>;

export type Freshness = Readonly<{
  state: 'fresh' | 'stale' | 'expired' | 'unknown';
  observedAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
}>;

export type Confidence = Readonly<{
  level: 'verified' | 'high' | 'medium' | 'low' | 'unknown';
  value: string | null;
  derivation: 'provider_fact' | 'deterministic_rule' | 'ai_candidate' | 'human_assertion';
}>;

export type AccountantReview = Readonly<{
  state: 'not_required' | 'unreviewed' | 'under_review' | 'approved' | 'rejected' | 'disputed';
  reviewedAt: IsoDateTime | null;
}>;

export type TaxConclusionEnvelopeV1<T> = Readonly<{
  conclusionId: string;
  value: T;
  period: Period;
  sourceReferenceIds: readonly string[];
  freshness: Freshness;
  confidence: Confidence;
  consent: Readonly<{
    purpose: TaxConsentPurpose;
    purposeVersion: string | null;
    scopeHash: string | null;
  }>;
  evidenceHash: string;
  accountantReview: AccountantReview;
  ruleVersionIds: readonly string[];
  limitations: readonly string[];
}>;

export type TaxProfileAnswer = Readonly<{
  questionId: string;
  value: string | boolean | number | readonly string[];
  confirmationState: 'user_confirmed' | 'accountant_confirmed';
}>;

export type TaxProfile = Readonly<{
  profileId: string;
  workspaceId: string;
  jurisdiction: JurisdictionCode;
  entityType: string;
  regimeId: string;
  ownerDomicileCountries: readonly string[];
  ownerTaxResidenceCountries: readonly string[];
  formationSubdivision: string | null;
  operatingSubdivisions: readonly string[];
  answers: readonly TaxProfileAnswer[];
  catalogueVersion: string;
  version: string;
  confirmationState: 'user_confirmed' | 'accountant_confirmed';
}>;

export type TaxRuleReference = Readonly<{
  id: string;
  jurisdiction: JurisdictionCode;
  effectiveFrom: IsoDate;
  effectiveTo: IsoDate | null;
  sourceUrl: string;
  title: string;
  reviewedByAccountant: boolean;
  version: string;
}>;

export type TaxObligationCategory =
  | 'invoice'
  | 'monthly_regime'
  | 'recategorization'
  | 'annual_return'
  | 'federal_income_return'
  | 'state_income_franchise_return'
  | 'sales_tax_return'
  | 'payroll_information_return'
  | 'estimated_tax'
  | 'registration'
  | 'other';

export type PreparationState =
  | 'not_started'
  | 'in_progress'
  | 'ready_for_review'
  | 'under_accountant_review'
  | 'accountant_approved'
  | 'changes_requested'
  | 'unknown';

export type SubmissionState =
  | 'not_submitted'
  | 'ready_for_submission'
  | 'submitted'
  | 'authority_receipt_pending'
  | 'accepted'
  | 'rejected'
  | 'unknown';

export type SatisfactionState =
  | 'not_due'
  | 'outstanding'
  | 'partially_satisfied'
  | 'satisfied'
  | 'unknown';

export type TaxObligation = Readonly<{
  id: string;
  jurisdiction: JurisdictionCode;
  regimeId: string;
  category: TaxObligationCategory;
  title: string;
  description: string;
  period: Period;
  dueAt: IsoDateTime | null;
  dueTimeZone: string | null;
  applicability: 'applicable' | 'not_applicable' | 'unknown' | 'needs_professional_review';
  preparationState: PreparationState;
  submissionState: SubmissionState;
  satisfactionState: SatisfactionState;
  evidenceRequirementIds: readonly string[];
  ruleVersionIds: readonly string[];
  actionId: string | null;
}>;

export type TaxEvidenceRequirement = Readonly<{
  id: string;
  obligationId: string;
  code: string;
  title: string;
  evidenceType: string;
  state: 'missing' | 'candidate' | 'needs_review' | 'accepted' | 'stale';
  owner: 'user' | 'tax_agent' | 'accountant';
  actionId: string | null;
}>;

export type TaxAuthorityReceipt = Readonly<{
  receiptId: string;
  workspaceId: string;
  providerId: string;
  obligationId: string;
  submittedAt: IsoDateTime;
  verifiedAt: IsoDateTime | null;
  status: 'submitted' | 'accepted' | 'rejected' | 'ambiguous';
  bodyHash: string;
}>;

export type TaxAgentEvent = Readonly<{
  eventId: string;
  workspaceId: string;
  actorId: string;
  action: string;
  outcome: 'succeeded' | 'failed' | 'blocked';
  correlationId: string;
  consentVersion: string | null;
  ruleVersionIds: readonly string[];
  occurredAt: IsoDateTime;
  safeMetadata: Readonly<Record<string, string | number | boolean | null>>;
}>;
