import { z } from 'zod';

import { isValidCuit } from './contracts';

export type WsfecredAccessTicket = Readonly<{
  token: string;
  sign: string;
  representedCuit: string;
  expiresAt: string;
}>;

export interface WsaaTicketBroker {
  getTicket(input: Readonly<{ environment: 'homologation' | 'production'; workspaceId: string; issuerProfileRef: string }>): Promise<WsfecredAccessTicket>;
  health(environment: 'homologation' | 'production'): Promise<Readonly<{ certificateDelegationConfigured: boolean; wsaaReady: boolean }>>;
}

type BrokerFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const ticketSchema = z.object({
  token: z.string().min(1),
  sign: z.string().min(1),
  representedCuit: z.string().regex(/^\d{11}$/).refine(isValidCuit),
  expiresAt: z.iso.datetime({ offset: true }),
}).strict();
const healthSchema = z.object({
  version: z.literal('wsaa-broker-health-v1'),
  service: z.literal('wsfecred'),
  environment: z.enum(['homologation', 'production']),
  certificateDelegationConfigured: z.boolean(),
  wsaaReady: z.boolean(),
}).strict();

// The WSAA credential/broker is shared with the Factura E and Factura C signers;
// only the ARCA ticket service literal differs. 'wsfecred' scopes tickets to the
// Factura de Crédito Electrónica MiPyMEs web service (manual v2.0.3 §2.3). This
// client never sees the certificate or private key — the broker owns them.
export class HttpWsaaTicketBroker implements WsaaTicketBroker {
  constructor(
    private readonly config: Readonly<{ baseUrl: string; token: string }>,
    private readonly fetcher: BrokerFetch = (input, init) => fetch(input, init)
  ) {
    if (!config.baseUrl.startsWith('https://')) throw new Error('WSAA_BROKER_HTTPS_REQUIRED');
  }

  async getTicket(input: Readonly<{ environment: 'homologation' | 'production'; workspaceId: string; issuerProfileRef: string }>): Promise<WsfecredAccessTicket> {
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/v1/wsaa/tickets`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: 'wsaa-ticket-request-v1', service: 'wsfecred', ...input }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`WSAA_BROKER_REJECTED_${response.status}`);
    const ticket = ticketSchema.parse(await response.json());
    if (Date.parse(ticket.expiresAt) <= Date.now() + 60_000) throw new Error('WSAA_TICKET_EXPIRED_OR_TOO_CLOSE');
    return ticket;
  }

  async health(environment: 'homologation' | 'production') {
    const response = await this.fetcher(`${this.config.baseUrl.replace(/\/$/, '')}/health?service=wsfecred&environment=${environment}`, {
      method: 'GET',
      headers: { authorization: `Bearer ${this.config.token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`WSAA_BROKER_HEALTH_REJECTED_${response.status}`);
    const health = healthSchema.parse(await response.json());
    if (health.environment !== environment) throw new Error('WSAA_BROKER_ENVIRONMENT_MISMATCH');
    return { certificateDelegationConfigured: health.certificateDelegationConfigured, wsaaReady: health.wsaaReady };
  }
}
