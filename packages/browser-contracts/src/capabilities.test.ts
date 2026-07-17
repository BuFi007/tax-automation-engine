import { describe, expect, test } from 'bun:test';

import {
  TAX_APPROVAL_ACTION_IDS_V1,
  TAX_READ_CAPABILITY_IDS_V1,
  buildTaxCapabilityManifestV1,
  taxCapabilityManifestV1Schema,
} from './capabilities';

describe('frozen Tax capability manifest', () => {
  test('publishes exactly 22 classified reads and four approval-aware actions', () => {
    const manifest = buildTaxCapabilityManifestV1();
    expect(TAX_READ_CAPABILITY_IDS_V1).toHaveLength(22);
    expect(TAX_APPROVAL_ACTION_IDS_V1).toHaveLength(4);
    expect(manifest.reads).toHaveLength(22);
    expect(manifest.approvalAwareActions).toHaveLength(4);
    expect(manifest.approvalAwareActions.every(action => action.requiresApproval)).toBe(true);
  });

  test('rejects duplicate IDs and changed trust classes', () => {
    const duplicate = structuredClone(buildTaxCapabilityManifestV1()) as any;
    duplicate.reads[1] = duplicate.reads[0];
    expect(taxCapabilityManifestV1Schema.safeParse(duplicate).success).toBe(false);

    const reclassified = structuredClone(buildTaxCapabilityManifestV1()) as any;
    reclassified.reads[0].use = 'planning_only';
    expect(taxCapabilityManifestV1Schema.safeParse(reclassified).success).toBe(false);
  });
});
