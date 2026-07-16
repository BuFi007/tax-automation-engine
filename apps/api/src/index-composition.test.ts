import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'bun:test';

describe('Tax API production composition contract', () => {
  test('wires the late-bound factoring fence into the live Agent service', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain(
      'const facturaEFeatureMutationFence = createLateBoundFacturaEFeatureMutationFence',
    );
    expect(source).toMatch(
      /new FacturaEAgentService\([\s\S]*?facturaEFeatureMutationFence,[\s\S]*?\);/,
    );
    expect(source).toContain('currentStore: () => facturaEFeatures');
    expect(source).toContain('TAX_FACTURA_E_FEATURE_SINGLE_WRITER');
  });

  test('does not statically import or implicitly enable fixture snapshots', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(
      /^import\s+\{[^}]*demoSnapshot[^}]*\}\s+from\s+'@tax-engine\/core'/m,
    );
    expect(source).toContain('if (!taxDemoRoutesEnabled())');
  });

  test('binds production ARCA effects to the reviewed Argentina launch policy', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain('resolveArgentinaLaunchPolicyReadiness()');
    expect(source).toContain('assertNoTaxEngineFundingAuthority()');
    expect(source).toMatch(
      /arcaProductionAuthority[\s\S]*?authorityCorridorEnabled[\s\S]*?authorityRemoteEffectsEnabled[\s\S]*?facturaEFeatureEnabled[\s\S]*?assertArgentinaProductionBoundary\(argentinaLaunchPolicy\)/,
    );
    expect(source).toContain('argentinaLaunchPolicy,');
  });
});
