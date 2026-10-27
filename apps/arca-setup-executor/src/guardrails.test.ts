import { describe, expect, test } from 'bun:test';

import { arcaGuardrailPolicy, blockedByGuardrails, hostnameAllowed, validateGuardrailPolicy, ARCA_ALLOWED_DOMAINS } from './guardrails';

describe('ARCA session guardrails', () => {
  test('production allows ARCA only; homologation adds common-cdns unless configured', () => {
    expect(arcaGuardrailPolicy('production')).toEqual({ allowedDomains: [...ARCA_ALLOWED_DOMAINS] });
    expect(arcaGuardrailPolicy('homologation').allowedDomainSets).toEqual(['common-cdns']);
    expect(arcaGuardrailPolicy('homologation', '').allowedDomainSets).toBeUndefined();
    expect(arcaGuardrailPolicy('production', 'https://bu.finance/arca-hosts.txt').allowedDomainSets).toEqual(['https://bu.finance/arca-hosts.txt']);
  });

  test('policies that Cloudflare would reject with a 400 fail before a session starts', () => {
    for (const allowedDomains of [['https://afip.gob.ar'], ['afip.gob.ar:443'], ['afip.gob.ar/x'], ['*.*.afip.gob.ar'], ['AFIP.gob.ar']])
      expect(() => validateGuardrailPolicy({ allowedDomains })).toThrow('ARCA_GUARDRAIL_POLICY_INVALID');
    expect(() => validateGuardrailPolicy({ allowedDomains: Array.from({ length: 51 }, (_, i) => `h${i}.example.com`) })).toThrow();
    expect(() => validateGuardrailPolicy({ allowedDomains: ['a.com'], allowedDomainSets: ['common-cdns', 'https://a/1', 'https://a/2', 'https://a/3', 'https://a/4'] })).toThrow();
    expect(() => validateGuardrailPolicy({ allowedDomains: ['a.com'], allowedDomainSets: ['http://a.com/list.txt'] })).toThrow();
    expect(() => arcaGuardrailPolicy('production', 'evil-set')).toThrow();
    expect(() => validateGuardrailPolicy({ allowedDomains: [], allowedDomainSets: ['common-cdns'] })).toThrow();
    expect(validateGuardrailPolicy({ allowedDomains: [] })).toEqual({ allowedDomains: [] });
  });

  test('wildcards follow the documented matching table', () => {
    expect(hostnameAllowed('auth.afip.gob.ar', ARCA_ALLOWED_DOMAINS)).toBe(true);
    expect(hostnameAllowed('afip.gob.ar', ARCA_ALLOWED_DOMAINS)).toBe(true);
    expect(hostnameAllowed('evil-afip.gob.ar', ARCA_ALLOWED_DOMAINS)).toBe(false);
    expect(hostnameAllowed('afip.gob.ar.evil.com', ARCA_ALLOWED_DOMAINS)).toBe(false);
    expect(hostnameAllowed('example.com', ['*.example.com'])).toBe(false);
    expect(hostnameAllowed('evilexample.com', ['*example.com'])).toBe(true);
    expect(hostnameAllowed('api.v1.example.com', ['api.*.example.com'])).toBe(true);
  });

  test('only a Cloudflare guardrail 403 counts as blocked', () => {
    expect(blockedByGuardrails(403, { 'cf-mitigated': 'guardrails', 'cf-brapi-guardrails-reason': 'not-in-allowlist' })).toBe(true);
    expect(blockedByGuardrails(403, {})).toBe(false);
    expect(blockedByGuardrails(200, { 'cf-mitigated': 'guardrails' })).toBe(false);
  });
});
