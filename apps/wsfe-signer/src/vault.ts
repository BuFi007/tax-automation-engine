import { hashCanonical } from '@tax-engine/core';
import { z } from 'zod';

import { authorityPayloadSchema, type AuthorityPayload } from './contracts';

export interface AuthorityPayloadVault {
  resolve(reference: string): Promise<Readonly<{ payload: AuthorityPayload; payloadHash: string }>>;
}

type VaultFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const vaultResponseSchema = z.object({
  payload: authorityPayloadSchema,
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export class HttpAuthorityPayloadVault implements AuthorityPayloadVault {
  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string }>,
    private readonly fetcher: VaultFetch = (input, init) => fetch(input, init)
  ) {
    if (!config.baseUrl.startsWith('https://')) throw new Error('SIGNER_VAULT_HTTPS_REQUIRED');
  }

  async resolve(reference: string): Promise<Readonly<{ payload: AuthorityPayload; payloadHash: string }>> {
    if (!reference) throw new Error('AUTHORITY_PAYLOAD_REFERENCE_REQUIRED');
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/v1/authority-payloads/resolve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 'authority-payload-resolve-v1', reference }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`SIGNER_VAULT_REJECTED_${response.status}`);
    const resolved = vaultResponseSchema.parse(await response.json());
    if (hashCanonical(resolved.payload) !== resolved.payloadHash) throw new Error('SIGNER_VAULT_PAYLOAD_HASH_MISMATCH');
    return resolved;
  }
}
