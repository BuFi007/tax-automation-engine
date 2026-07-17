import { describe, expect, test } from 'bun:test';

import {
  createLateBoundFacturaEFeatureMutationFence,
  type FacturaEFeatureMutationGuard,
} from './factura-e-feature-mutation-fence';

const binding = { runId: 'run-1', workspaceId: 'workspace-1' } as const;
const NOW = new Date('2026-07-15T12:00:00.000Z');

describe('late-bound Factura E feature mutation fence', () => {
  test('is a no-op only while publication is explicitly disabled', () => {
    const fence = createLateBoundFacturaEFeatureMutationFence({
      enabled: () => false,
      currentStore: () => null,
    });
    expect(() => fence.assertMutationAllowed(binding)).not.toThrow();
  });

  test('fails closed when enabled before the durable store is composed', () => {
    const fence = createLateBoundFacturaEFeatureMutationFence({
      enabled: () => true,
      currentStore: () => null,
    });
    expect(() => fence.assertMutationAllowed(binding))
      .toThrow('TAX_FACTURA_E_FEATURE_PUBLICATION_CONFIGURATION_REQUIRED');
  });

  test('resolves the current store at mutation time and uses a trusted clock', () => {
    let current: FacturaEFeatureMutationGuard | null = null;
    const observed: unknown[] = [];
    const fence = createLateBoundFacturaEFeatureMutationFence({
      enabled: () => true,
      currentStore: () => current,
      now: () => NOW,
    });
    current = {
      assertRunMutationAllowed(actualBinding, now) {
        observed.push(actualBinding, now);
      },
    };

    fence.assertMutationAllowed(binding);
    expect(observed).toEqual([binding, NOW]);
  });
});
