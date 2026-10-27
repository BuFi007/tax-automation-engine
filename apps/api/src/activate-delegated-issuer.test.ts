import { describe, expect, test } from 'bun:test';

import { underBase } from './activate-delegated-issuer';

describe('delegated issuer activation URLs', () => {
  test('keeps the operator-proxy path of the boundary base', () => {
    const route = 'v1/wsaa/issuers/delegations';
    expect(underBase(route, new URL('https://tax.example.test/v1/operator/arca-boundary')).href)
      .toBe('https://tax.example.test/v1/operator/arca-boundary/v1/wsaa/issuers/delegations');
    expect(underBase(route, new URL('https://tax.example.test/v1/operator/arca-boundary/')).href)
      .toBe('https://tax.example.test/v1/operator/arca-boundary/v1/wsaa/issuers/delegations');
    expect(underBase(route, new URL('https://boundary.example.test')).href)
      .toBe('https://boundary.example.test/v1/wsaa/issuers/delegations');
  });
});
