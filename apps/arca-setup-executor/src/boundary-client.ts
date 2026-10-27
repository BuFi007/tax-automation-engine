import { z } from 'zod';

import type { BoundaryExecutorClient } from './operations';
import { refuseRedirect } from './http';

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const matchSchema = z.object({
  version: z.literal('arca-setup-taxpayer-match-result-v1'),
  matched: z.boolean(),
  matchIndex: z.number().int().nonnegative().nullable(),
  representedCuitCommitment: sha256.nullable(),
  loginIdentityHash: sha256,
}).strict();
const csrSchema = z.object({
  version: z.literal('arca-setup-csr-v1'),
  csrPem: z.string().includes('BEGIN CERTIFICATE REQUEST'),
  csrHash: sha256,
  alias: z.string(),
}).strict();
const importSchema = z.object({
  version: z.literal('arca-setup-certificate-import-receipt-v1'),
  certificateFingerprint: sha256,
  validFrom: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }),
  chainVerified: z.boolean(),
}).strict();

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** Executor-scoped calls to the ARCA boundary. The token cannot provision or read keys. */
export class HttpBoundaryExecutorClient implements BoundaryExecutorClient {
  readonly #origin: string;

  constructor(baseUrl: string, private readonly token: string, private readonly fetcher: Fetcher = (input, init) => fetch(input, init)) {
    const url = new URL(baseUrl);
    const local = ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password)
      throw new Error('ARCA_BOUNDARY_URL_INVALID');
    if (token.length < 32) throw new Error('ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN_REQUIRED');
    this.#origin = url.origin;
  }

  matchTaxpayer(input: Parameters<BoundaryExecutorClient['matchTaxpayer']>[0]) {
    return this.post('/v1/setup/executor/taxpayer-match', { version: 'arca-setup-taxpayer-match-v1', ...input, candidates: [...input.candidates] }, matchSchema);
  }

  readCsr(input: Parameters<BoundaryExecutorClient['readCsr']>[0]) {
    return this.post('/v1/setup/executor/csr', { version: 'arca-setup-csr-read-v1', ...input }, csrSchema);
  }

  importCertificate(input: Parameters<BoundaryExecutorClient['importCertificate']>[0]) {
    return this.post('/v1/setup/executor/certificate', { version: 'arca-setup-certificate-import-v1', ...input }, importSchema);
  }

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.#origin), {
        method: 'POST',
        redirect: 'manual',
        headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      }).then(refuseRedirect);
    } catch {
      throw new Error('ARCA_BOUNDARY_UNAVAILABLE');
    }
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (!response.ok) {
      const code = typeof payload?.error === 'string' && /^[A-Z0-9_]{3,120}$/.test(payload.error) ? payload.error : 'ARCA_BOUNDARY_REJECTED';
      throw new Error(code);
    }
    return schema.parse(payload);
  }
}
