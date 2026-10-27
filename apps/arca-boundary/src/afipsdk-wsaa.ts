import { hashCanonical } from '@tax-engine/core';
import { z } from 'zod';

import { readBoundedBody, refuseRedirect } from './bounded-body';
import { type WsaaLoginClient, validateIssuerCredential } from './wsaa';

const authResponse = z.object({
  token: z.string().min(1).max(200_000),
  sign: z.string().min(1).max(200_000),
  expiration: z.iso.datetime({ offset: true }),
}).passthrough();
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/** AFIP SDK authentication stays inside the credential boundary; tickets use its encrypted cache. */
export class AfipSdkWsaaLoginClient implements WsaaLoginClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetcher: Fetcher = fetch
  ) {
    if (accessToken.length < 16) throw new Error('AFIPSDK_ACCESS_TOKEN_REQUIRED');
  }

  async login(input: Parameters<WsaaLoginClient['login']>[0]) {
    validateIssuerCredential(input.credential, input.now);
    if (!input.credential.active || !input.credential.delegationConfirmed)
      throw new Error('WSAA_ISSUER_NOT_ACTIVE');
    let response: Response;
    try {
      response = await this.fetcher('https://app.afipsdk.com/api/v1/afip/auth', {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          environment: input.credential.environment === 'production' ? 'prod' : 'dev',
          tax_id: input.credential.representedCuit,
          wsid: input.service,
          cert: input.credential.certificatePem,
          key: input.credential.privateKeyPem,
        }),
      }).then(refuseRedirect);
    } catch {
      throw new Error('AFIPSDK_AUTH_TRANSPORT_FAILED');
    }
    const raw = await readBoundedBody(response, 1_048_576, 'AFIPSDK_AUTH_RESPONSE_TOO_LARGE');
    if (!response.ok) throw new Error(`AFIPSDK_AUTH_REJECTED_${response.status}`);
    let ticket: z.infer<typeof authResponse>;
    try {
      ticket = authResponse.parse(JSON.parse(raw) as unknown);
    } catch {
      throw new Error('AFIPSDK_AUTH_RESPONSE_INVALID');
    }
    if (Date.parse(ticket.expiration) <= input.now.getTime() + 60_000)
      throw new Error('AFIPSDK_AUTH_TICKET_EXPIRED');
    const expiresAt = new Date(ticket.expiration).toISOString();
    return {
      token: ticket.token,
      sign: ticket.sign,
      expiresAt,
      safeReceiptHash: hashCanonical({
        service: input.service,
        expiresAt,
        tokenHash: hashCanonical(ticket.token),
        signHash: hashCanonical(ticket.sign),
      }),
    };
  }
}
