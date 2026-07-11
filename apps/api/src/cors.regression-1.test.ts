import { afterEach, expect, test } from 'bun:test';

import { applyCors } from './cors';

const originalCorsOrigin = process.env.CORS_ORIGIN;

afterEach(() => {
  if (originalCorsOrigin === undefined) delete process.env.CORS_ORIGIN;
  else process.env.CORS_ORIGIN = originalCorsOrigin;
});

// Regression: ISSUE-001 — the documented 127.0.0.1 dev origin was blocked
// Found by /qa on 2026-07-10
// Report: .gstack/qa-reports/qa-report-localhost-2026-07-10.md
test('allows both local Vite origins without reflecting arbitrary origins', () => {
  delete process.env.CORS_ORIGIN;
  for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
    const response = applyCors(new Response(null), new Request('http://localhost:4100/health', { headers: { origin } }));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(response.headers.get('Vary')).toContain('Origin');
  }

  const untrusted = applyCors(
    new Response(null),
    new Request('http://localhost:4100/health', { headers: { origin: 'https://untrusted.example' } })
  );
  expect(untrusted.headers.has('Access-Control-Allow-Origin')).toBe(false);
});
