import { hashCanonical } from '@tax-engine/core';
import { z } from 'zod';

import { authorityPayloadSchema, type AuthorityPayload } from './contracts';
import { parseBoundedJson, pinnedHttpsOrigin, readBoundedBody, refuseRedirect } from './bounded-body';

export interface AuthorityPayloadVault {
  resolve(reference: string): Promise<Readonly<{ payload: AuthorityPayload; payloadHash: string }>>;
}

type VaultFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const vaultResponseSchema = z.object({
  payload: authorityPayloadSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export class HttpAuthorityPayloadVault implements AuthorityPayloadVault {
  readonly #baseOrigin: string;

  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string }>,
    private readonly fetcher: VaultFetch = (input, init) => fetch(input, init)
  ) {
    this.#baseOrigin = pinnedHttpsOrigin(config.baseUrl, 'SIGNER_VAULT');
  }

  async resolve(reference: string): Promise<Readonly<{ payload: AuthorityPayload; payloadHash: string }>> {
    if (!reference) throw new Error('AUTHORITY_PAYLOAD_REFERENCE_REQUIRED');
    const response = await this.fetcher(new URL('/v1/authority-payloads/resolve', this.#baseOrigin), {
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 'authority-payload-resolve-v1', reference }),
      signal: AbortSignal.timeout(15_000),
    }).then(refuseRedirect);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`SIGNER_VAULT_REJECTED_${response.status}`);
    }
    const resolved = parseBoundedJson(
      vaultResponseSchema,
      await readBoundedBody(response, 1_048_576, 'SIGNER_VAULT_RESPONSE_TOO_LARGE'),
      'SIGNER_VAULT_RESPONSE_INVALID'
    );
    if (hashCanonical(resolved.payload) !== resolved.payloadHash) throw new Error('SIGNER_VAULT_PAYLOAD_HASH_MISMATCH');
    return resolved;
  }
}
