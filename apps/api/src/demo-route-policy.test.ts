import { describe, expect, test } from 'bun:test';

import { taxDemoRoutesEnabled } from './demo-route-policy';

describe('Tax demo route policy', () => {
  test('is dark by default', () => {
    expect(taxDemoRoutesEnabled({ NODE_ENV: 'development' })).toBe(false);
  });

  test('allows an explicit local-development fixture surface', () => {
    expect(taxDemoRoutesEnabled({
      NODE_ENV: 'development',
      TAX_ENGINE_DEMO_ROUTES_ENABLED: 'true',
    })).toBe(true);
  });

  test('cannot be enabled in production, staging, test, or an unspecified environment', () => {
    for (const NODE_ENV of ['production', 'staging', 'test', undefined]) {
      expect(taxDemoRoutesEnabled({
        NODE_ENV,
        TAX_ENGINE_DEMO_ROUTES_ENABLED: 'true',
      })).toBe(false);
    }
  });
});
