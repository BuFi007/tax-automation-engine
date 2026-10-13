import { test, expect } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArcaIssuerProfileRegistry } from './arca-issuer-profile-registry';

test('keeps verified issuer references across restarts without replacing another binding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'arca-profiles-'));
  try {
    const path = join(dir, 'tax.sqlite');
    const defaults = new Map([['personal:owner', 'issuer://owner/first']]);
    const first = new ArcaIssuerProfileRegistry(path, defaults);
    first.bind('personal:owner', 'issuer://owner/first', '2026-09-28T12:00:00.000Z');
    const second = new ArcaIssuerProfileRegistry(path, defaults);
    expect(second.get('personal:owner')).toBe('issuer://owner/first');
    expect(() => second.bind('personal:owner', 'issuer://other', '2026-09-28T12:01:00.000Z'))
      .toThrow('ARCA_ISSUER_BINDING_REPLACEMENT_REQUIRES_DISCONNECT');
    second.unbind('personal:owner', 'issuer://owner/first');
    expect(second.get('personal:owner')).toBeUndefined();
    expect(first.get('personal:owner')).toBeUndefined();
    first.close();
    second.close();
    const third = new ArcaIssuerProfileRegistry(path, defaults);
    expect(third.get('personal:owner')).toBeUndefined();
    third.bind('personal:owner', 'issuer://owner/next', '2026-09-28T12:02:00.000Z');
    third.bind('personal:second', 'issuer://second', '2026-09-28T12:03:00.000Z');
    third.close();
    const fourth = new ArcaIssuerProfileRegistry(path, defaults);
    expect(fourth.get('personal:owner')).toBe('issuer://owner/next');
    expect(fourth.get('personal:second')).toBe('issuer://second');
    fourth.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
