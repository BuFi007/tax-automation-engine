export async function readBoundedBody(
  message: Request | Response,
  maximumBytes: number,
  errorCode: string,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('BOUNDED_BODY_LIMIT_INVALID');
  }
  const declared = message.headers.get('content-length');
  if (
    declared !== null
    && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    await message.body?.cancel();
    throw new Error(errorCode);
  }
  if (!message.body) return '';
  const reader = message.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        throw new Error(errorCode);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

/**
 * workerd rejects `redirect: 'error'`, so callers fetch with `redirect: 'manual'`
 * and pass the response here: a 3xx (or an opaque redirect) fails the call the
 * way 'error' did, inside the caller's own transport error handling.
 */
export function refuseRedirect(response: Response): Response {
  if (response.type !== 'opaqueredirect' && (response.status < 300 || response.status > 399)) return response;
  void response.body?.cancel();
  throw new Error('HTTP_REDIRECT_REFUSED');
}
