import { describe, expect, test } from 'bun:test';

import {
  FACTURA_E_FEATURE_RENEWAL_WINDOW_MS,
  facturaEFeatureRenewalCadenceReady,
  parseFacturaEFeaturePollInterval,
} from './factura-e-feature-worker-config';

describe('Factura E feature worker renewal cadence', () => {
  test('defaults to five seconds and accepts at most ten seconds', () => {
    expect(parseFacturaEFeaturePollInterval(undefined)).toBe(5_000);
    expect(parseFacturaEFeaturePollInterval('1000')).toBe(1_000);
    expect(parseFacturaEFeaturePollInterval('10000')).toBe(10_000);
    expect(facturaEFeatureRenewalCadenceReady(10_000)).toBe(true);
    expect(10_000).toBeLessThan(FACTURA_E_FEATURE_RENEWAL_WINDOW_MS);
  });

  test('rejects a cadence that can miss the fifteen-second renewal window', () => {
    for (const value of ['999', '10001', '14999', '15000', '60000', '5.5', 'NaN']) {
      expect(() => parseFacturaEFeaturePollInterval(value))
        .toThrow('TAX_FACTURA_E_FEATURE_POLL_INTERVAL_INVALID');
    }
    expect(facturaEFeatureRenewalCadenceReady(null)).toBe(false);
    expect(facturaEFeatureRenewalCadenceReady(15_000)).toBe(false);
  });
});
