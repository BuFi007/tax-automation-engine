import { hashCanonical } from '@tax-engine/core';
import { authorityPayloadSchema, type AuthorityPayload } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';

export type AuthorityPayloadReceipt = Readonly<{
  version: 'authority-payload-store-receipt-v1';
  reference: string;
  payloadHash: string;
  storedAt: string;
  expiresAt: string;
}>;

export interface AuthorityPayloadWriter {
  store(input: Readonly<{ workspaceId: string; payload: AuthorityPayload; expiresAt: string; idempotencyKey: string }>): Promise<AuthorityPayloadReceipt>;
}

type PayloadFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const receiptSchema = z.object({
  version: z.literal('authority-payload-store-receipt-v1'),
  reference: z.string().regex(/^vault:\/\/wsfex\/[0-9a-f-]{36}$/),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  storedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();

export class HttpAuthorityPayloadWriter implements AuthorityPayloadWriter {
  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string; environment: 'homologation' | 'production' }>,
    private readonly fetcher: PayloadFetch = (input, init) => fetch(input, init)
  ) {
    if (!config.baseUrl.startsWith('https://')) throw new Error('ARCA_BOUNDARY_HTTPS_REQUIRED');
  }

  static fromEnvironment(): HttpAuthorityPayloadWriter | null {
    const baseUrl = process.env.ARCA_BOUNDARY_URL ?? '';
    const token = process.env.ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN ?? '';
    const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
    return baseUrl && token ? new HttpAuthorityPayloadWriter({ baseUrl, token, environment }) : null;
  }

  async store(input: Readonly<{ workspaceId: string; payload: AuthorityPayload; expiresAt: string; idempotencyKey: string }>): Promise<AuthorityPayloadReceipt> {
    const payload = authorityPayloadSchema.parse(input.payload);
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/v1/authority-payloads`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey },
        body: JSON.stringify({ version: 'authority-payload-store-v1', workspaceId: input.workspaceId, payload, expiresAt: input.expiresAt }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`ARCA_BOUNDARY_TRANSPORT_FAILED_${error instanceof Error ? error.name.toUpperCase() : 'UNKNOWN'}`);
    }
    if (response.status >= 500) throw new Error('ARCA_BOUNDARY_UPSTREAM_UNAVAILABLE');
    if (!response.ok) throw new Error(`ARCA_BOUNDARY_REJECTED_${response.status}`);
    const receipt = receiptSchema.parse(await response.json());
    if (receipt.payloadHash !== hashCanonical(payload) || receipt.expiresAt !== input.expiresAt) throw new Error('ARCA_BOUNDARY_RECEIPT_MISMATCH');
    return receipt;
  }
}
