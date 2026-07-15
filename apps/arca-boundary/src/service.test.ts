import { describe, expect, test } from 'bun:test';

import { hashCanonical } from '@tax-engine/core';

import { ArcaBoundaryService } from './service';
import { ArcaBoundaryStore } from './store';
import { authorityPayload, certificateBundle, CUIT, NOW, wsfeAuthorityPayload } from './test-fixtures';
import type { WsaaLoginClient } from './wsaa';

describe('ARCA authority boundary service', () => {
  test('limits raw payload retention to seven days', () => {
    const service = boundary().service;
    const request = {
      version: 'authority-payload-store-v1' as const,
      workspaceId: 'workspace-1',
      payload: authorityPayload(),
      expiresAt: '2026-07-18T12:00:00.001Z',
    };
    expect(() => service.storePayload(request, 'payload-1', NOW.toISOString())).toThrow('AUTHORITY_PAYLOAD_RETENTION_TOO_LONG');
    const receipt = service.storePayload({ ...request, expiresAt: '2026-07-18T12:00:00.000Z' }, 'payload-2', NOW.toISOString());
    expect(service.resolvePayload(receipt.reference, NOW.toISOString()).payloadHash).toBe(hashCanonical(request.payload));
    expect(() => service.storePayload({ ...request, workspaceId: 'workspace-other', expiresAt: '2026-07-12T12:00:00.000Z' }, 'payload-3', NOW.toISOString()))
      .toThrow('AUTHORITY_PAYLOAD_WORKSPACE_MISMATCH');
  });

  test('stores and resolves a domestic WSFE payload and binds it to its workspace', () => {
    const service = boundary().service;
    const request = {
      version: 'authority-payload-store-v1' as const,
      workspaceId: 'workspace-1',
      payload: wsfeAuthorityPayload(),
      expiresAt: '2026-07-12T12:00:00.000Z',
    };
    const receipt = service.storePayload(request, 'wsfe-store-1', NOW.toISOString());
    expect(receipt.reference).toMatch(/^vault:\/\/wsfe\//);
    expect(service.resolvePayload(receipt.reference, NOW.toISOString())).toEqual({ payload: request.payload, payloadHash: hashCanonical(request.payload) });
    expect(() => service.storePayload({ ...request, workspaceId: 'workspace-other' }, 'wsfe-store-2', NOW.toISOString()))
      .toThrow('AUTHORITY_PAYLOAD_WORKSPACE_MISMATCH');
  });

  test('provisions a delegated issuer, single-flights tickets, caches them, and actively probes health', async () => {
    const fixture = boundary();
    const provisioned = fixture.service.provisionIssuer(provisionRequest(), NOW.toISOString());
    expect(provisioned).toEqual(expect.objectContaining({ environment: 'homologation', delegationConfirmed: true }));
    const ticketRequest = {
      version: 'wsaa-ticket-request-v1' as const,
      service: 'wsfex' as const,
      environment: 'homologation' as const,
      workspaceId: 'workspace-1',
      issuerProfileRef: 'issuer://workspace-1/primary',
    };
    const [first, concurrent] = await Promise.all([
      fixture.service.getTicket(ticketRequest, NOW.toISOString()),
      fixture.service.getTicket(ticketRequest, NOW.toISOString()),
    ]);
    const cached = await fixture.service.getTicket(ticketRequest, NOW.toISOString());
    expect(first).toEqual(concurrent);
    expect(cached).toEqual(first);
    expect(fixture.wsaa.calls).toBe(1);
    await expect(fixture.service.getTicket({ ...ticketRequest, workspaceId: 'workspace-other' }, NOW.toISOString())).rejects.toThrow('WSAA_ISSUER_NOT_FOUND');
    await expect(fixture.service.health('homologation', NOW.toISOString())).resolves.toEqual({
      version: 'wsaa-broker-health-v1', service: 'wsfex', environment: 'homologation', certificateDelegationConfigured: true, wsaaReady: true,
    });
    expect(fixture.wsaa.calls).toBe(1);
    expect(fixture.service.revokeIssuer(provisioned.issuerProfileRef, provisioned.certificateFingerprint, NOW.toISOString())).toEqual({ revoked: true });
    await expect(fixture.service.health('homologation', NOW.toISOString())).resolves.toEqual({
      version: 'wsaa-broker-health-v1', service: 'wsfex', environment: 'homologation', certificateDelegationConfigured: false, wsaaReady: false,
    });
    await expect(fixture.service.getTicket(ticketRequest, NOW.toISOString())).rejects.toThrow('WSAA_ISSUER_NOT_FOUND');
  });

  test('reports safe not-ready health without configured delegation and binds tickets to workspace', async () => {
    const fixture = boundary();
    await expect(fixture.service.health('homologation', NOW.toISOString())).resolves.toEqual({
      version: 'wsaa-broker-health-v1', service: 'wsfex', environment: 'homologation', certificateDelegationConfigured: false, wsaaReady: false,
    });
    fixture.service.provisionIssuer(provisionRequest(), NOW.toISOString());
    await expect(fixture.service.getTicket({
      version: 'wsaa-ticket-request-v1', service: 'wsfex', environment: 'homologation', workspaceId: 'workspace-other', issuerProfileRef: 'issuer://workspace-1/primary',
    }, NOW.toISOString())).rejects.toThrow('WSAA_ISSUER_NOT_FOUND');
  });
});

class FakeWsaa implements WsaaLoginClient {
  calls = 0;
  async login() {
    this.calls += 1;
    await Promise.resolve();
    return { token: 'ephemeral-token-secret', sign: 'ephemeral-sign-secret', expiresAt: '2026-07-11T20:00:00.000Z', safeReceiptHash: hashCanonical(`ticket-${this.calls}`) };
  }
}

function boundary() {
  const wsaa = new FakeWsaa();
  const store = new ArcaBoundaryStore(Buffer.alloc(32, 5), ':memory:');
  return { wsaa, store, service: new ArcaBoundaryService(store, wsaa) };
}

function provisionRequest() {
  return {
    version: 'wsaa-issuer-provision-v1' as const,
    workspaceId: 'workspace-1',
    issuerProfileRef: 'issuer://workspace-1/primary',
    environment: 'homologation' as const,
    certificateHolderCuit: CUIT,
    representedCuit: CUIT,
    ...certificateBundle(),
    delegationConfirmed: true,
    replaceCertificateFingerprint: null,
  };
}
