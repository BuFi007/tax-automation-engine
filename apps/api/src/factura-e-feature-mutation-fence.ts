import type { FacturaEMutationFence } from './factura-e-agent';

export type FacturaEFeatureMutationGuard = Readonly<{
  assertRunMutationAllowed(
    input: Readonly<{ runId: string; workspaceId: string }>,
    now: Date,
  ): void;
}>;

/**
 * Stable proxy used to break the Agent -> feature store -> Agent source-reader
 * construction cycle. The store is looked up at mutation time, so production
 * cannot silently retain the null fence captured during startup.
 */
export function createLateBoundFacturaEFeatureMutationFence(input: Readonly<{
  enabled: () => boolean;
  currentStore: () => FacturaEFeatureMutationGuard | null;
  now?: () => Date;
}>): FacturaEMutationFence {
  return {
    assertMutationAllowed(binding) {
      if (!input.enabled()) return;
      const store = input.currentStore();
      if (!store) {
        throw new Error('TAX_FACTURA_E_FEATURE_PUBLICATION_CONFIGURATION_REQUIRED');
      }
      store.assertRunMutationAllowed(binding, input.now?.() ?? new Date());
    },
  };
}
