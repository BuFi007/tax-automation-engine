import { describe, expect, test } from 'bun:test';

import { readBoundedBody, refuseRedirect } from './bounded-body';

describe('bounded HTTP body reader', () => {
  test('reads a body at the exact limit', async () => {
    const request = new Request('http://tax.local/evidence', {
      method: 'POST',
      body: 'abcd',
    });
    expect(await readBoundedBody(request, 4, 'BODY_TOO_LARGE')).toBe('abcd');
  });

  test('rejects an oversized body without relying on Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('abcd'));
        controller.enqueue(new TextEncoder().encode('e'));
        controller.close();
      },
    });
    const request = new Request('http://tax.local/evidence', {
      method: 'POST',
      body: stream,
    });
    await expect(readBoundedBody(request, 4, 'BODY_TOO_LARGE'))
      .rejects.toThrow('BODY_TOO_LARGE');
  });

  test('rejects malformed and oversized declared lengths before reading', async () => {
    for (const declared of ['invalid', '5']) {
      const response = new Response('abcd', {
        headers: { 'content-length': declared },
      });
      await expect(readBoundedBody(response, 4, 'BODY_TOO_LARGE'))
        .rejects.toThrow('BODY_TOO_LARGE');
    }
  });
});

describe('redirect refusal', () => {
  test('refuses a 3xx or opaque redirect and passes every other response through', () => {
    const ok = new Response('ok');
    expect(refuseRedirect(ok)).toBe(ok);
    expect(() => refuseRedirect(new Response(null, { status: 302, headers: { location: 'https://attacker.test/' } })))
      .toThrow('HTTP_REDIRECT_REFUSED');
    const opaque = new Response(null);
    Object.defineProperty(opaque, 'type', { value: 'opaqueredirect' });
    expect(() => refuseRedirect(opaque)).toThrow('HTTP_REDIRECT_REFUSED');
  });
});
