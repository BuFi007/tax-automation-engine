import { z } from 'zod';

const sha256Schema = z.string()
  .regex(/^[a-f0-9]{64}$/)
  .refine(value => value !== '0'.repeat(64), 'Placeholder hashes are forbidden');
const instantSchema = z.iso.datetime({ offset: true });

const approvalSchema = z.object({
  role: z.enum(['argentina_accountant', 'argentina_legal_counsel', 'security', 'product_owner']),
  decision: z.literal('approved'),
  receiptHash: sha256Schema,
  decidedAt: instantSchema,
}).strict();

export const argentinaLaunchPolicySchema = z.object({
  version: z.literal('argentina-launch-policy-v1'),
  policyId: z.string().min(1).max(120),
  policyVersion: z.string().min(1).max(80),
  decisionMemoHash: sha256Schema,
  effectiveFrom: instantSchema,
  expiresAt: instantSchema,
  boundary: z.object({
    taxDocumentIssuer: z.literal('represented_taxpayer'),
    bufiRole: z.literal('software_provider'),
    authorityCredentialCustody: z.literal('forbidden'),
    paymentIntermediation: z.literal('external_authorized_provider_only'),
    invoiceFinance: z.literal('licensed_partner_only'),
    taxPaymentExecution: z.literal('disabled'),
  }).strict(),
  sourceRuleIds: z.array(z.string().min(1)).min(4),
  approvals: z.array(approvalSchema).length(4),
}).strict();

export type ArgentinaLaunchPolicyV1 = z.infer<typeof argentinaLaunchPolicySchema>;

export type ArgentinaLaunchPolicyReadinessV1 = Readonly<{
  version: 'argentina-launch-policy-readiness-v1';
  state: 'approved_boundary' | 'blocked';
  policyId: string | null;
  policyVersion: string | null;
  decisionMemoHash: string | null;
  effectiveFrom: string | null;
  expiresAt: string | null;
  bufiRole: 'software_provider';
  taxDocumentIssuer: 'represented_taxpayer';
  credentialCustody: 'forbidden';
  paymentIntermediation: 'external_authorized_provider_only';
  invoiceFinance: 'licensed_partner_only';
  taxPaymentExecution: 'disabled';
  productionActivationAllowed: false;
  failedGateIds: readonly string[];
}>;

const REQUIRED_ROLES = [
  'argentina_accountant',
  'argentina_legal_counsel',
  'security',
  'product_owner',
] as const;
const REQUIRED_SOURCE_RULES = [
  'arca-wsfex-3.1.1',
  'arca-wsaa-architecture',
  'bcra-a8330',
  'bcra-current-exchange-rules',
] as const;

export function parseArgentinaLaunchPolicy(input: unknown): ArgentinaLaunchPolicyV1 {
  const policy = argentinaLaunchPolicySchema.parse(input);
  const roles = policy.approvals.map(approval => approval.role);
  if (new Set(roles).size !== roles.length) {
    throw new Error('ARGENTINA_LAUNCH_POLICY_DUPLICATE_APPROVAL_ROLE');
  }
  if (!REQUIRED_ROLES.every(role => roles.includes(role))) {
    throw new Error('ARGENTINA_LAUNCH_POLICY_REQUIRED_APPROVAL_MISSING');
  }
  const receiptHashes = policy.approvals.map(approval => approval.receiptHash);
  if (new Set(receiptHashes).size !== receiptHashes.length
    || receiptHashes.includes(policy.decisionMemoHash)) {
    throw new Error('ARGENTINA_LAUNCH_POLICY_APPROVAL_RECEIPTS_NOT_INDEPENDENT');
  }
  if (new Set(policy.sourceRuleIds).size !== policy.sourceRuleIds.length) {
    throw new Error('ARGENTINA_LAUNCH_POLICY_DUPLICATE_SOURCE_RULE');
  }
  if (!REQUIRED_SOURCE_RULES.every(rule => policy.sourceRuleIds.includes(rule))) {
    throw new Error('ARGENTINA_LAUNCH_POLICY_REQUIRED_SOURCE_MISSING');
  }
  if (Date.parse(policy.effectiveFrom) >= Date.parse(policy.expiresAt)) {
    throw new Error('ARGENTINA_LAUNCH_POLICY_INTERVAL_INVALID');
  }
  if (policy.approvals.some(approval => Date.parse(approval.decidedAt) > Date.parse(policy.effectiveFrom))) {
    throw new Error('ARGENTINA_LAUNCH_POLICY_EFFECTIVE_BEFORE_APPROVAL');
  }
  return policy;
}

export function argentinaLaunchPolicyReadiness(
  input: unknown | null,
  now = new Date(),
): ArgentinaLaunchPolicyReadinessV1 {
  const failedGateIds: string[] = [];
  let policy: ArgentinaLaunchPolicyV1 | null = null;
  if (input === null) {
    failedGateIds.push('signed_decision_memo_missing');
  } else {
    try {
      policy = parseArgentinaLaunchPolicy(input);
    } catch {
      failedGateIds.push('signed_decision_memo_invalid');
    }
  }
  if (policy) {
    const at = now.getTime();
    if (at < Date.parse(policy.effectiveFrom)) failedGateIds.push('policy_not_effective');
    if (at >= Date.parse(policy.expiresAt)) failedGateIds.push('policy_expired');
    for (const role of REQUIRED_ROLES) {
      if (!policy.approvals.some(approval => approval.role === role)) {
        failedGateIds.push(`${role}_approval_missing`);
      }
    }
  }
  return {
    version: 'argentina-launch-policy-readiness-v1',
    state: policy && failedGateIds.length === 0 ? 'approved_boundary' : 'blocked',
    policyId: policy?.policyId ?? null,
    policyVersion: policy?.policyVersion ?? null,
    decisionMemoHash: policy?.decisionMemoHash ?? null,
    effectiveFrom: policy?.effectiveFrom ?? null,
    expiresAt: policy?.expiresAt ?? null,
    bufiRole: 'software_provider',
    taxDocumentIssuer: 'represented_taxpayer',
    credentialCustody: 'forbidden',
    paymentIntermediation: 'external_authorized_provider_only',
    invoiceFinance: 'licensed_partner_only',
    taxPaymentExecution: 'disabled',
    productionActivationAllowed: false,
    failedGateIds,
  };
}

export function assertArgentinaProductionBoundary(
  readiness: ArgentinaLaunchPolicyReadinessV1,
): void {
  if (readiness.state !== 'approved_boundary') {
    throw new Error('ARGENTINA_LAUNCH_POLICY_APPROVAL_REQUIRED');
  }
}
