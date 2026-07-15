import { describe, expect, test } from 'bun:test';

import type { LifecycleCoordinates, NormalizedLifecycle } from './contracts';
import { WsfecredLifecycleService } from './service';
import type { WsfecredAuthorityClient } from './soap';
import { coordinates, ticket } from './test-fixtures';
import type { WsaaTicketBroker, WsfecredAccessTicket } from './wsaa';

function stubBroker(overrides: Partial<WsaaTicketBroker> = {}): WsaaTicketBroker {
  return {
    getTicket: async () => ticket,
    health: async () => ({ certificateDelegationConfigured: true, wsaaReady: true }),
    ...overrides,
  };
}

function stubAuthority(getLifecycle: WsfecredAuthorityClient['getLifecycle']): WsfecredAuthorityClient {
  return { getLifecycle, dummy: async () => ({ appServer: 'OK', dbServer: 'OK', authServer: 'OK' }) };
}

const config = { environment: 'homologation' as const, clientVersion: '0.1.0', acceptanceWindowDays: 21 };

describe('WsfecredLifecycleService', () => {
  test('health mirrors the WSAA broker readiness with the pinned schema and Spanish environment', async () => {
    const service = new WsfecredLifecycleService(config, stubBroker(), stubAuthority(async () => null));
    await expect(service.health()).resolves.toEqual({
      schema: 'motora-wsfecred-health-v1',
      environment: 'homologacion',
      certificateDelegationConfigured: true,
      wsaaReady: true,
    });
  });

  test('production environment reports production and propagates a not-ready broker', async () => {
    const service = new WsfecredLifecycleService(
      { ...config, environment: 'production' },
      stubBroker({ health: async () => ({ certificateDelegationConfigured: true, wsaaReady: false }) }),
      stubAuthority(async () => null)
    );
    await expect(service.health()).resolves.toEqual(expect.objectContaining({ environment: 'production', wsaaReady: false }));
  });

  test('fetches a ticket for the querying identity and maps the ARCA tuple to a lifecycle', async () => {
    const captured: {
      coordinates?: LifecycleCoordinates;
      ticket?: WsfecredAccessTicket;
      identity?: { environment: string; workspaceId: string; issuerProfileRef: string };
    } = {};
    const normalized: NormalizedLifecycle = {
      estadoComprobante: 'Aceptado', estadoCtaCte: 'Aceptada', tipoAceptacion: 'Tacita', opcionTransferencia: 'ADC',
      fechaEmision: '2026-07-01', fechaHoraAcep: '2026-07-22T00:00:00', fechaVenAcep: '2026-07-22', codMoneda: 'PES',
      importeTotal: '15000.00', saldoAceptado: '15000.00', codCtaCte: '778899',
    };
    const service = new WsfecredLifecycleService(
      config,
      stubBroker({ getTicket: async input => { captured.identity = input; return ticket; } }),
      stubAuthority(async (t, c) => { captured.ticket = t; captured.coordinates = c; return normalized; })
    );

    const result = await service.getLifecycle(coordinates(), { workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary' });
    expect(captured.identity).toEqual({ environment: 'homologation', workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary' });
    expect(captured.ticket).toBe(ticket);
    expect(captured.coordinates).toEqual(coordinates());
    expect(result).toEqual(expect.objectContaining({ estado: 'aceptada_tacita', fchVtoAceptacion: '2026-07-22', montoAceptado: '15000.00' }));
    // Countdown estimate uses the configured window (emission 2026-07-01 + 21).
    expect(result?.raw.fchVtoAceptacionEstimado).toBe('2026-07-22');
  });

  test('returns null (a 404 upstream) when ARCA does not know the comprobante', async () => {
    const service = new WsfecredLifecycleService(config, stubBroker(), stubAuthority(async () => null));
    await expect(service.getLifecycle(coordinates(), { workspaceId: 'w', issuerProfileRef: 'i' })).resolves.toBeNull();
  });
});
