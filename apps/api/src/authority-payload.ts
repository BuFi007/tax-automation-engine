import { hashCanonical } from '@tax-engine/core';
import { authorityPayloadSchema as wsfeAuthorityPayloadSchema, type AuthorityPayload as WsfeAuthorityPayload } from '@tax-engine/wsfe-signer/contracts';
import { authorityPayloadSchema as wsfexAuthorityPayloadSchema, type AuthorityPayload as WsfexAuthorityPayload } from '@tax-engine/wsfex-signer/contracts';
import { z } from 'zod';

import { readBoundedBody } from './bounded-body';

type AuthorityPayload = WsfeAuthorityPayload | WsfexAuthorityPayload;
const authorityPayloadSchema = z.union([wsfexAuthorityPayloadSchema, wsfeAuthorityPayloadSchema]);

export type AuthorityPayloadReceipt = Readonly<{
  version: 'authority-payload-store-receipt-v1';
  reference: string;
  payloadHash: string;
  storedAt: string;
  expiresAt: string;
}>;

export type AuthorityPayloadTerminalReceipt = Readonly<{
  version: 'authority-payload-terminal-receipt-v1';
  referenceHash: string;
  payloadHash: string;
  authorityIdentityHash: string;
  terminalState: 'officially_reconciled';
  retentionPolicyId: string;
  retireAfter: string;
  terminalEvidenceHash: string;
}>;

export interface AuthorityPayloadWriter {
  store(input: Readonly<{ workspaceId: string; payload: WsfexAuthorityPayload; expiresAt: string; idempotencyKey: string }>): Promise<AuthorityPayloadReceipt>;
  markTerminal(input: Readonly<{
    workspaceId: string;
    reference: string;
    payloadHash: string;
    terminalState: 'officially_reconciled';
    authorityIdentityHash: string;
    terminalEvidenceHash: string;
  }>): Promise<AuthorityPayloadTerminalReceipt>;
}

type PayloadFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const MAX_RECEIPT_BYTES = 32 * 1024;

const receiptSchema = z.object({
  version: z.literal('authority-payload-store-receipt-v1'),
  reference: z.string().regex(/^vault:\/\/(?:wsfex|wsfe)\/[0-9a-f-]{36}$/),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  storedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
const terminalReceiptSchema = z.object({
  version: z.literal('authority-payload-terminal-receipt-v1'),
  referenceHash: z.string().regex(/^[a-f0-9]{64}$/),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  authorityIdentityHash: z.string().regex(/^[a-f0-9]{64}$/),
  terminalState: z.literal('officially_reconciled'),
  retentionPolicyId: z.string().regex(/^[A-Za-z0-9._:-]{1,100}$/),
  retireAfter: z.iso.datetime({ offset: true }),
  terminalEvidenceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export class HttpAuthorityPayloadWriter implements AuthorityPayloadWriter {
  readonly #baseOrigin: string;

  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string; environment: 'homologation' | 'production' }>,
    private readonly fetcher: PayloadFetch = (input, init) => fetch(input, init)
  ) {
    const endpoint = new URL(config.baseUrl);
    if (
      endpoint.protocol !== 'https:'
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
      || !['', '/'].includes(endpoint.pathname)
    ) throw new Error(endpoint.protocol === 'https:' ? 'ARCA_BOUNDARY_URL_INVALID' : 'ARCA_BOUNDARY_HTTPS_REQUIRED');
    this.#baseOrigin = endpoint.origin;
  }

  static fromEnvironment(): HttpAuthorityPayloadWriter | null {
    const baseUrl = process.env.ARCA_BOUNDARY_URL ?? '';
    const token = process.env.ARCA_BOUNDARY_PAYLOAD_WRITE_TOKEN ?? '';
    const environment = process.env.ARCA_ENVIRONMENT === 'production' ? 'production' as const : 'homologation' as const;
    return baseUrl && token ? new HttpAuthorityPayloadWriter({ baseUrl, token, environment }) : null;
  }

  store(input: Readonly<{ workspaceId: string; payload: WsfexAuthorityPayload; expiresAt: string; idempotencyKey: string }>): Promise<AuthorityPayloadReceipt>;
  store(input: Readonly<{ workspaceId: string; payload: WsfeAuthorityPayload; expiresAt: string; idempotencyKey: string }>): Promise<AuthorityPayloadReceipt>;
  async store(input: Readonly<{ workspaceId: string; payload: AuthorityPayload; expiresAt: string; idempotencyKey: string }>): Promise<AuthorityPayloadReceipt> {
    const payload = authorityPayloadSchema.parse(input.payload);
    let response: Response;
    try {
      response = await this.fetcher(new URL('/v1/authority-payloads', this.#baseOrigin), {
        method: 'POST',
        redirect: 'error',
        headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json', 'idempotency-key': input.idempotencyKey },
        body: JSON.stringify({ version: 'authority-payload-store-v1', workspaceId: input.workspaceId, payload, expiresAt: input.expiresAt }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`ARCA_BOUNDARY_TRANSPORT_FAILED_${error instanceof Error ? error.name.toUpperCase() : 'UNKNOWN'}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 500) throw new Error('ARCA_BOUNDARY_UPSTREAM_UNAVAILABLE');
      throw new Error(`ARCA_BOUNDARY_REJECTED_${response.status}`);
    }
    const receipt = parseReceipt(
      receiptSchema,
      await readBoundedBody(response, MAX_RECEIPT_BYTES, 'ARCA_BOUNDARY_RESPONSE_TOO_LARGE'),
      'ARCA_BOUNDARY_RECEIPT_INVALID'
    );
    if (receipt.payloadHash !== hashCanonical(payload) || receipt.expiresAt !== input.expiresAt) throw new Error('ARCA_BOUNDARY_RECEIPT_MISMATCH');
    return receipt;
  }

  async markTerminal(input: Readonly<{
    workspaceId: string;
    reference: string;
    payloadHash: string;
    terminalState: 'officially_reconciled';
    authorityIdentityHash: string;
    terminalEvidenceHash: string;
  }>): Promise<AuthorityPayloadTerminalReceipt> {
    if (
      !/^vault:\/\/wsfex\/[0-9a-f-]{36}$/.test(input.reference)
      || !/^[a-f0-9]{64}$/.test(input.payloadHash)
      || !/^[a-f0-9]{64}$/.test(input.authorityIdentityHash)
      || !/^[a-f0-9]{64}$/.test(input.terminalEvidenceHash)
    ) throw new Error('ARCA_BOUNDARY_TERMINAL_INPUT_INVALID');
    let response: Response;
    try {
      response = await this.fetcher(new URL('/v1/authority-payloads/terminal', this.#baseOrigin), {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          version: 'authority-payload-terminal-v1',
          ...input,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new Error(`ARCA_BOUNDARY_TERMINAL_TRANSPORT_FAILED_${error instanceof Error ? error.name.toUpperCase() : 'UNKNOWN'}`);
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 500) throw new Error('ARCA_BOUNDARY_TERMINAL_UPSTREAM_UNAVAILABLE');
      throw new Error(`ARCA_BOUNDARY_TERMINAL_REJECTED_${response.status}`);
    }
    const receipt = parseReceipt(
      terminalReceiptSchema,
      await readBoundedBody(response, MAX_RECEIPT_BYTES, 'ARCA_BOUNDARY_TERMINAL_RESPONSE_TOO_LARGE'),
      'ARCA_BOUNDARY_TERMINAL_RECEIPT_INVALID'
    );
    if (
      receipt.referenceHash !== hashCanonical(input.reference)
      || receipt.payloadHash !== input.payloadHash
      || receipt.authorityIdentityHash !== input.authorityIdentityHash
    ) throw new Error('ARCA_BOUNDARY_TERMINAL_RECEIPT_MISMATCH');
    return receipt;
  }
}

function parseReceipt<T>(schema: z.ZodType<T>, raw: string, errorCode: string): T {
  try {
    return schema.parse(JSON.parse(raw) as unknown);
  } catch {
    throw new Error(errorCode);
  }
}
