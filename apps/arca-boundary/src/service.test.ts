import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { hashCanonical } from '@tax-engine/core';

import { ArcaBoundaryService } from './service';
import { ArcaBoundaryStore } from './store';
import { authorityPayload, certificateBundle, CUIT, NOW, WSFE_RECEPTOR_CUIT, wsfeAuthorityPayload } from './test-fixtures';
import type { WsaaLoginClient } from './wsaa';

describe('ARCA authority boundary service', () => {
  test('clones a sealed BUFI certificate only through the admin delegation path', () => {
    const fixture = boundary();
    fixture.service.provisionIssuer(provisionRequest(), NOW.toISOString());
    const receipt = fixture.service.delegateIssuerFromStoredCertificate({
      version: 'wsaa-issuer-delegation-v1',
      templateWorkspaceId: 'workspace-1', templateIssuerProfileRef: 'issuer://workspace-1/primary',
      workspaceId: 'personal:delegate', issuerProfileRef: 'issuer://delegate/primary',
      environment: 'homologation', representedCuit: WSFE_RECEPTOR_CUIT,
    }, NOW.toISOString());
    expect(receipt.representedCuitCommitment).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.service.issuerStatus('personal:delegate', 'issuer://delegate/primary', 'homologation', NOW.toISOString()))
      .toEqual(expect.objectContaining({ configured: true, representedCuitLast4: WSFE_RECEPTOR_CUIT.slice(-4) }));
    expect(() => fixture.store.getIssuer('workspace-1', 'issuer://delegate/primary', 'homologation'))
      .toThrow('WSAA_ISSUER_NOT_FOUND');
  });
  test('caps the caller-selected minimum retention horizon at seven days', () => {
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
    expect(first.representedCuitCommitment).toBe(provisioned.representedCuitCommitment);
    expect(first.representedCuitCommitment).toMatch(/^[a-f0-9]{64}$/);
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

  test('blocks an expired certificate even when the issuer and ticket remain stored', async () => {
    const fixture = boundary();
    fixture.service.provisionIssuer(provisionRequest(), NOW.toISOString());
    const request = {
      version: 'wsaa-ticket-request-v1' as const,
      service: 'wsfe' as const,
      environment: 'homologation' as const,
      workspaceId: 'workspace-1',
      issuerProfileRef: 'issuer://workspace-1/primary',
    };
    await fixture.service.getTicket(request, NOW.toISOString());
    await expect(fixture.service.getTicket(request, '2027-07-12T12:00:00.000Z'))
      .rejects.toThrow('WSAA_CERTIFICATE_NOT_CURRENT');
  });

  test('reuses an encrypted WSAA ticket after restart and drops it on issuer revocation', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'arca-wsaa-ticket-'));
    const path = join(directory, 'boundary.sqlite');
    const key = Buffer.alloc(32, 5);
    const wsaa = new FakeWsaa();
    const request = {
      version: 'wsaa-ticket-request-v1' as const,
      service: 'wsfe' as const,
      environment: 'homologation' as const,
      workspaceId: 'workspace-1',
      issuerProfileRef: 'issuer://workspace-1/primary',
    };
    try {
      const firstStore = new ArcaBoundaryStore(key, path);
      const firstService = new ArcaBoundaryService(firstStore, wsaa);
      const issuer = firstService.provisionIssuer(provisionRequest(), NOW.toISOString());
      const first = await firstService.getTicket(request, NOW.toISOString());
      firstStore.close();

      const secondStore = new ArcaBoundaryStore(key, path);
      const secondService = new ArcaBoundaryService(secondStore, wsaa);
      expect(await secondService.getTicket(request, NOW.toISOString())).toEqual(first);
      expect(wsaa.calls).toBe(1);
      const bytes = readdirSync(directory).map(file => readFileSync(join(directory, file)).toString('utf8')).join('');
      expect(bytes).not.toContain(first.token);
      expect(bytes).not.toContain(first.sign);
      expect(bytes).not.toContain(CUIT);
      secondService.revokeIssuer(issuer.issuerProfileRef, issuer.certificateFingerprint, NOW.toISOString());
      expect(secondStore.getTicket(hashCanonical({ environment: request.environment, workspaceId: request.workspaceId, issuerProfileRef: request.issuerProfileRef, service: request.service, certificateFingerprint: issuer.certificateFingerprint, representedCuitCommitment: issuer.representedCuitCommitment }), NOW.toISOString())).toBeNull();
      secondStore.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
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

test('enrolled homologation aliases reuse only the same issuer/certificate/service ticket', async () => {
  const fixture = boundary();
  const service = new ArcaBoundaryService(fixture.store,fixture.wsaa,undefined,null,new Set(['workspace-1','workspace-team','workspace-other-taxpayer']));
  service.provisionIssuer(provisionRequest(),NOW.toISOString());
  const request = {version:'wsaa-ticket-request-v1' as const,service:'wsfe' as const,environment:'homologation' as const,workspaceId:'workspace-1',issuerProfileRef:'issuer://workspace-1/primary'};
  const original = await service.getTicket(request,NOW.toISOString());
  service.delegateIssuerFromStoredCertificate({version:'wsaa-issuer-delegation-v1',templateWorkspaceId:'workspace-1',templateIssuerProfileRef:request.issuerProfileRef,workspaceId:'workspace-team',issuerProfileRef:'issuer://team',environment:'homologation',representedCuit:CUIT},NOW.toISOString());
  expect(await service.getTicket({...request,workspaceId:'workspace-team',issuerProfileRef:'issuer://team'},NOW.toISOString())).toEqual(original);
  expect(fixture.wsaa.calls).toBe(1);
  await service.getTicket({...request,service:'wsfex',workspaceId:'workspace-team',issuerProfileRef:'issuer://team'},NOW.toISOString());
  expect(fixture.wsaa.calls).toBe(2);
  service.delegateIssuerFromStoredCertificate({version:'wsaa-issuer-delegation-v1',templateWorkspaceId:'workspace-1',templateIssuerProfileRef:request.issuerProfileRef,workspaceId:'workspace-other-taxpayer',issuerProfileRef:'issuer://other-taxpayer',environment:'homologation',representedCuit:WSFE_RECEPTOR_CUIT},NOW.toISOString());
  const other = await service.getTicket({...request,workspaceId:'workspace-other-taxpayer',issuerProfileRef:'issuer://other-taxpayer'},NOW.toISOString());
  expect(other.representedCuitCommitment).not.toBe(original.representedCuitCommitment);expect(fixture.wsaa.calls).toBe(3);
  await expect(service.getTicket({...request,workspaceId:'workspace-ungranted',issuerProfileRef:'issuer://team'},NOW.toISOString())).rejects.toThrow('WSAA_ISSUER_NOT_FOUND');
});
