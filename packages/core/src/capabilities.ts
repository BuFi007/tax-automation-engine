export const TAX_READ_CAPABILITIES = {
  getTransactions: 'deterministic_actual',
  getInvoices: 'deterministic_actual',
  getPayroll: 'deterministic_actual',
  getBills: 'deterministic_actual',
  getSpending: 'consistency_check',
  getProfit: 'consistency_check',
  getRevenue: 'consistency_check',
  getCashFlow: 'consistency_check',
  getCategorySpending: 'consistency_check',
  getAccountMetrics: 'consistency_check',
  getPayrollsList: 'consistency_check',
  getBankAccounts: 'consistency_check',
  getContacts: 'reference_only',
  getCustomersList: 'reference_only',
  getCategories: 'reference_only',
  getTags: 'reference_only',
  getBurnRate: 'planning_only',
  getForecast: 'planning_only',
  getRunway: 'planning_only',
  getHealthScore: 'planning_only',
  getGrowthRate: 'planning_only',
  getRevenueForecast: 'planning_only'
} as const;

export const TAX_APPROVAL_ACTIONS = [
  'initiateTransfer',
  'createInvoice',
  'createContact',
  'executePayroll'
] as const;

export type TaxReadCapabilityId = keyof typeof TAX_READ_CAPABILITIES;
export type TaxReadUse = (typeof TAX_READ_CAPABILITIES)[TaxReadCapabilityId];
export type TaxApprovalActionId = (typeof TAX_APPROVAL_ACTIONS)[number];

export type TaxCoreCapabilityManifestV1 = Readonly<{
  version: 'tax-capabilities-v1';
  reads: readonly Readonly<{
    id: TaxReadCapabilityId;
    use: TaxReadUse;
    state: 'available' | 'partial' | 'failed' | 'stale' | 'not_applicable';
  }>[];
  approvalAwareActions: readonly Readonly<{
    id: TaxApprovalActionId;
    state: 'available' | 'disabled' | 'policy_blocked' | 'approval_required';
    requiresApproval: true;
    actionId: string | null;
  }>[];
}>;

export function buildCapabilityManifest(
  readState: TaxCoreCapabilityManifestV1['reads'][number]['state'] = 'available'
): TaxCoreCapabilityManifestV1 {
  return {
    version: 'tax-capabilities-v1',
    reads: Object.entries(TAX_READ_CAPABILITIES).map(([id, use]) => ({
      id: id as TaxReadCapabilityId,
      use,
      state: readState,
    })),
    approvalAwareActions: TAX_APPROVAL_ACTIONS.map(id => ({
      id,
      state: 'approval_required',
      requiresApproval: true,
      actionId: `action:${id}`,
    })),
  };
}
