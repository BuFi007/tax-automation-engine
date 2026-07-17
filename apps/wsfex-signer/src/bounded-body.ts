export async function readBoundedBody(
  response: Request | Response,
  maximumBytes: number,
  errorCode: string
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1)
    throw new Error('WSFEX_BOUNDED_BODY_LIMIT_INVALID');
  const declared = response.headers.get('content-length');
  if (
    declared !== null
    && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    await response.body?.cancel();
    throw new Error(errorCode);
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
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

export function pinnedHttpsOrigin(raw: string, prefix: string): string {
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error(`${prefix}_URL_INVALID`);
  }
  if (
    endpoint.username
    || endpoint.password
    || endpoint.search
    || endpoint.hash
    || !['', '/'].includes(endpoint.pathname)
  ) throw new Error(`${prefix}_URL_INVALID`);
  if (endpoint.protocol !== 'https:') throw new Error(`${prefix}_HTTPS_REQUIRED`);
  return endpoint.origin;
}

export function parseBoundedJson<T>(
  schema: { parse(value: unknown): T },
  raw: string,
  errorCode: string
): T {
  try {
    return schema.parse(JSON.parse(raw) as unknown);
  } catch {
    throw new Error(errorCode);
  }
}
