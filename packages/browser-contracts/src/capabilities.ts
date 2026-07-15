import { z } from 'zod';

export const TAX_READ_CAPABILITY_USES_V1 = {
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
  getRevenueForecast: 'planning_only',
} as const;

export const TAX_READ_CAPABILITY_IDS_V1 = Object.keys(TAX_READ_CAPABILITY_USES_V1) as [
  keyof typeof TAX_READ_CAPABILITY_USES_V1,
  ...(keyof typeof TAX_READ_CAPABILITY_USES_V1)[],
];

export const TAX_APPROVAL_ACTION_IDS_V1 = [
  'initiateTransfer',
  'createInvoice',
  'createContact',
  'executePayroll',
] as const;

const readCapabilityIdSchema = z.enum(TAX_READ_CAPABILITY_IDS_V1);
const approvalActionIdSchema = z.enum(TAX_APPROVAL_ACTION_IDS_V1);

const readCapabilitySchema = z.object({
  id: readCapabilityIdSchema,
  use: z.enum(['deterministic_actual', 'consistency_check', 'reference_only', 'planning_only']),
  state: z.enum(['available', 'partial', 'failed', 'stale', 'not_applicable']),
}).strict();

const approvalActionSchema = z.object({
  id: approvalActionIdSchema,
  state: z.enum(['available', 'disabled', 'policy_blocked', 'approval_required']),
  requiresApproval: z.literal(true),
  actionId: z.string().min(1).max(300).nullable(),
}).strict();

export const taxCapabilityManifestV1Schema = z.object({
  version: z.literal('tax-capabilities-v1'),
  reads: z.array(readCapabilitySchema).length(22),
  approvalAwareActions: z.array(approvalActionSchema).length(4),
}).strict().superRefine((manifest, context) => {
  const readIds = manifest.reads.map(read => read.id);
  if (new Set(readIds).size !== TAX_READ_CAPABILITY_IDS_V1.length
    || TAX_READ_CAPABILITY_IDS_V1.some(id => !readIds.includes(id))) {
    context.addIssue({ code: 'custom', message: 'The exact 22-read capability manifest is required', path: ['reads'] });
  }
  for (const [index, read] of manifest.reads.entries()) {
    if (read.use !== TAX_READ_CAPABILITY_USES_V1[read.id]) {
      context.addIssue({ code: 'custom', message: 'Capability trust class does not match the frozen manifest', path: ['reads', index, 'use'] });
    }
  }
  const actionIds = manifest.approvalAwareActions.map(action => action.id);
  if (new Set(actionIds).size !== TAX_APPROVAL_ACTION_IDS_V1.length
    || TAX_APPROVAL_ACTION_IDS_V1.some(id => !actionIds.includes(id))) {
    context.addIssue({ code: 'custom', message: 'The exact four approval-aware actions are required', path: ['approvalAwareActions'] });
  }
});

export function buildTaxCapabilityManifestV1(
  state: z.infer<typeof readCapabilitySchema>['state'] = 'available',
): z.infer<typeof taxCapabilityManifestV1Schema> {
  return taxCapabilityManifestV1Schema.parse({
    version: 'tax-capabilities-v1',
    reads: TAX_READ_CAPABILITY_IDS_V1.map(id => ({
      id,
      use: TAX_READ_CAPABILITY_USES_V1[id],
      state,
    })),
    approvalAwareActions: TAX_APPROVAL_ACTION_IDS_V1.map(id => ({
      id,
      state: 'approval_required',
      requiresApproval: true,
      actionId: `action:${id}`,
    })),
  });
}

export type TaxCapabilityManifestV1 = z.infer<typeof taxCapabilityManifestV1Schema>;
