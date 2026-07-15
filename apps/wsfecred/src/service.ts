import { buildLifecycleResponse, type LifecycleCoordinates, type LifecycleResponse } from './contracts';
import type { WsfecredAuthorityClient } from './soap';
import type { WsaaTicketBroker, WsfecredAccessTicket } from './wsaa';

// Read-only. This service moves no money and mutates no ARCA state — it only
// resolves the acceptance/negotiation lifecycle of an already-emitted FCE.
export class WsfecredLifecycleService {
  constructor(
    private readonly config: Readonly<{ environment: 'homologation' | 'production'; clientVersion: string; acceptanceWindowDays: number }>,
    private readonly wsaa: WsaaTicketBroker,
    private readonly authority: WsfecredAuthorityClient
  ) {}

  async health() {
    const wsaa = await this.wsaa.health(this.config.environment);
    return {
      schema: 'motora-wsfecred-health-v1' as const,
      environment: this.config.environment === 'production' ? 'production' as const : 'homologacion' as const,
      certificateDelegationConfigured: wsaa.certificateDelegationConfigured,
      wsaaReady: wsaa.wsaaReady,
    };
  }

  // The ticket's represented CUIT is the party querying on ARCA (emisor or
  // receptor); the caller selects it via issuerProfileRef. A comprobante that
  // ARCA does not know (not yet propagated to the FCE registry, or nonexistent)
  // yields null, which the HTTP layer surfaces as a 404 — never a fabricated state.
  async getLifecycle(
    coordinates: LifecycleCoordinates,
    identity: Readonly<{ workspaceId: string; issuerProfileRef: string }>
  ): Promise<LifecycleResponse | null> {
    const ticket = await this.ticket(identity);
    const normalized = await this.authority.getLifecycle(ticket, coordinates);
    if (!normalized) return null;
    return buildLifecycleResponse(coordinates, normalized, this.config.acceptanceWindowDays);
  }

  private ticket(identity: Readonly<{ workspaceId: string; issuerProfileRef: string }>): Promise<WsfecredAccessTicket> {
    return this.wsaa.getTicket({ environment: this.config.environment, workspaceId: identity.workspaceId, issuerProfileRef: identity.issuerProfileRef });
  }
}
