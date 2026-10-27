import { z } from 'zod';

import { isValidCuit } from './contracts';
import { parseBoundedJson, pinnedHttpsOrigin, readBoundedBody, refuseRedirect } from './bounded-body';

export type WsfexAccessTicket = Readonly<{
  token: string;
  sign: string;
  representedCuit: string;
  representedCuitCommitment: string;
  expiresAt: string;
}>;

export interface WsaaTicketBroker {
  getTicket(input: Readonly<{ environment: 'homologation' | 'production'; workspaceId: string; issuerProfileRef: string }>): Promise<WsfexAccessTicket>;
  health(environment: 'homologation' | 'production'): Promise<Readonly<{ certificateDelegationConfigured: boolean; wsaaReady: boolean }>>;
}

type BrokerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const ticketSchema = z.object({
  token: z.string().min(1),
  sign: z.string().min(1),
  representedCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit),
  representedCuitCommitment: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
const healthSchema = z.object({
  version: z.literal('wsaa-broker-health-v1'),
  service: z.literal('wsfex'),
  environment: z.enum(['homologation', 'production']),
  certificateDelegationConfigured: z.boolean(),
  wsaaReady: z.boolean(),
}).strict();

export class HttpWsaaTicketBroker implements WsaaTicketBroker {
  readonly #baseOrigin: string;

  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string }>,
    private readonly fetcher: BrokerFetch = (input, init) => fetch(input, init)
  ) {
    this.#baseOrigin = pinnedHttpsOrigin(config.baseUrl, 'WSAA_BROKER');
  }

  async getTicket(input: Readonly<{ environment: 'homologation' | 'production'; workspaceId: string; issuerProfileRef: string }>): Promise<WsfexAccessTicket> {
    const response = await this.fetcher(new URL('/v1/wsaa/tickets', this.#baseOrigin), {
      method: 'POST',
      redirect: 'manual',
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 'wsaa-ticket-request-v1', service: 'wsfex', ...input }),
      signal: AbortSignal.timeout(15_000),
    }).then(refuseRedirect);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`WSAA_BROKER_REJECTED_${response.status}`);
    }
    const ticket = parseBoundedJson(
      ticketSchema,
      await readBoundedBody(response, 64 * 1024, 'WSAA_BROKER_RESPONSE_TOO_LARGE'),
      'WSAA_BROKER_RESPONSE_INVALID'
    );
    if (Date.parse(ticket.expiresAt) <= Date.now() + 60_000) throw new Error('WSAA_TICKET_EXPIRED_OR_TOO_CLOSE');
    return ticket;
  }

  async health(environment: 'homologation' | 'production') {
    const endpoint = new URL('/health', this.#baseOrigin);
    endpoint.searchParams.set('service', 'wsfex');
    endpoint.searchParams.set('environment', environment);
    const response = await this.fetcher(endpoint, {
      method: 'GET',
      redirect: 'manual',
      headers: { authorization: `Bearer ${this.config.token}` },
      signal: AbortSignal.timeout(10_000),
    }).then(refuseRedirect);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`WSAA_BROKER_HEALTH_REJECTED_${response.status}`);
    }
    const health = parseBoundedJson(
      healthSchema,
      await readBoundedBody(response, 32 * 1024, 'WSAA_BROKER_HEALTH_RESPONSE_TOO_LARGE'),
      'WSAA_BROKER_HEALTH_RESPONSE_INVALID'
    );
    if (health.environment !== environment) throw new Error('WSAA_BROKER_ENVIRONMENT_MISMATCH');
    return { certificateDelegationConfigured: health.certificateDelegationConfigured, wsaaReady: health.wsaaReady };
  }
}
