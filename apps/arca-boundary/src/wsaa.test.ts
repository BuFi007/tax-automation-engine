import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as forge from 'node-forge';

import { certificateBundle, CUIT, NOW } from './test-fixtures';
import { SoapWsaaLoginClient, validateIssuerCredential } from './wsaa';

describe('official WSAA LoginCms transport', () => {
  test('builds an encapsulated signed CMS TRA and parses the ephemeral ticket', async () => {
    const validated = credential();
    let capturedUrl = '';
    let capturedBody = '';
    const client = new SoapWsaaLoginClient(async (input, init) => {
      capturedUrl = String(input);
      capturedBody = String(init?.body);
      expect(init?.redirect).toBe('error');
      expect(new Headers(init?.headers).get('soapaction')).toBe('""');
      return wsaaResponse({ token: 'token-secret', sign: 'sign-secret', expiresAt: '2026-07-11T20:00:00.000Z' });
    });
    const result = await client.login({ credential: validated.credential, service: 'wsfex', now: NOW });
    expect(capturedUrl).toBe('https://wsaahomo.afip.gov.ar/ws/services/LoginCms');
    const cmsText = capturedBody.match(/<wsaa:in0>([^<]+)<\/wsaa:in0>/)?.[1];
    expect(cmsText).toBeDefined();
    const message = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.decode64(cmsText!))) as forge.pkcs7.PkcsSignedData;
    expect(message.certificates).toHaveLength(1);
    const encapsulatedContent = ((message as any).rawCapture.content.value[0].value) as string;
    expect(encapsulatedContent).toContain('<service>wsfex</service>');
    expect(encapsulatedContent).toContain('<generationTime>2026-07-11T11:55:00.000Z</generationTime>');
    const directory = mkdtempSync(join(tmpdir(), 'wsaa-cms-test-'));
    try {
      const cmsPath = join(directory, 'login-cms.der');
      writeFileSync(cmsPath, Buffer.from(forge.util.decode64(cmsText!), 'binary'));
      const verified = Bun.spawnSync({ cmd: ['openssl', 'cms', '-verify', '-inform', 'DER', '-in', cmsPath, '-noverify'], stdout: 'pipe', stderr: 'pipe' });
      expect(verified.exitCode).toBe(0);
      expect(verified.stdout.toString()).toContain('<service>wsfex</service>');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
    expect(result).toEqual(expect.objectContaining({ token: 'token-secret', sign: 'sign-secret', expiresAt: '2026-07-11T20:00:00.000Z' }));
    expect(JSON.stringify(result)).not.toContain(validated.credential.privateKeyPem);
  });

  test('rejects a mismatched key, mismatched certificate-holder CUIT, and expired certificate before transport', () => {
    const bundle = certificateBundle();
    expect(() => validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1', environment: 'homologation', certificateHolderCuit: CUIT, representedCuit: CUIT,
      certificatePem: bundle.certificatePem, privateKeyPem: certificateBundle().privateKeyPem, delegationConfirmed: true,
    }, NOW)).toThrow('WSAA_CERTIFICATE_PRIVATE_KEY_MISMATCH');
    expect(() => validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1', environment: 'homologation', certificateHolderCuit: '20999999999', representedCuit: CUIT,
      ...bundle, delegationConfirmed: true,
    }, NOW)).toThrow('WSAA_CERTIFICATE_HOLDER_CUIT_MISMATCH');
    expect(() => validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1', environment: 'homologation', certificateHolderCuit: CUIT, representedCuit: CUIT,
      ...bundle, delegationConfirmed: true,
    }, new Date('2028-01-01T00:00:00.000Z'))).toThrow('WSAA_CERTIFICATE_NOT_CURRENT');
    expect(() => validateIssuerCredential({
      workspaceId: 'workspace-1', issuerProfileRef: 'issuer-1', environment: 'homologation', certificateHolderCuit: CUIT, representedCuit: CUIT,
      ...certificateBundle(CUIT, NOW, 1024), delegationConfirmed: true,
    }, NOW)).toThrow('WSAA_CERTIFICATE_RSA_KEY_TOO_SMALL');
  });

  test('allows one certificate holder to request a ticket used for a different represented taxpayer', () => {
    const validated = validateIssuerCredential({
      workspaceId: 'workspace-tenant', issuerProfileRef: 'issuer://workspace-tenant/bufi', environment: 'production',
      certificateHolderCuit: CUIT, representedCuit: '20999999999', ...certificateBundle(), delegationConfirmed: true,
    }, NOW);
    expect(validated.credential).toEqual(expect.objectContaining({ certificateHolderCuit: CUIT, representedCuit: '20999999999' }));
  });

  test('turns SOAP faults into safe errors without returning authority detail', async () => {
    const validated = credential();
    const client = new SoapWsaaLoginClient(async () => new Response(`
      <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>secret-code</faultcode><faultstring>sensitive authority detail</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
      { status: 200, headers: { 'content-type': 'text/xml' } }));
    try {
      await client.login({ credential: validated.credential, service: 'wsfex', now: NOW });
      throw new Error('expected SOAP fault');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('WSAA_SOAP_FAULT');
      expect(JSON.stringify(error)).not.toContain('sensitive authority detail');
    }
  });

  test('identifies an already-valid WSAA ticket without exposing the fault body', async () => {
    const validated = credential();
    const client = new SoapWsaaLoginClient(async () => new Response(
      '<Fault><faultcode>coe.alreadyAuthenticated</faultcode><faultstring>secret detail</faultstring></Fault>',
      { status: 500 }));
    await expect(client.login({ credential: validated.credential, service: 'wsfe', now: NOW }))
      .rejects.toThrow('WSAA_ALREADY_AUTHENTICATED');
  });

  test('rejects embedded DTD/entity content before parsing the WSAA ticket', async () => {
    const validated = credential();
    const unsafe = '&lt;!DOCTYPE x [&lt;!ENTITY e "secret"&gt;]&gt;&lt;loginTicketResponse&gt;&amp;e;&lt;/loginTicketResponse&gt;';
    const client = new SoapWsaaLoginClient(async () => new Response(
      `<Envelope><Body><loginCmsResponse><loginCmsReturn>${unsafe}</loginCmsReturn></loginCmsResponse></Body></Envelope>`,
      { status: 200 }
    ));
    await expect(client.login({ credential: validated.credential, service: 'wsfex', now: NOW })).rejects.toThrow('WSAA_LOGIN_RESPONSE_UNSAFE_XML');
  });

  test('cancels an oversized chunked WSAA response before buffering it', async () => {
    const validated = credential();
    let cancelled = false;
    const client = new SoapWsaaLoginClient(async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(600_000)); },
      cancel() { cancelled = true; },
    })));
    await expect(client.login({ credential: validated.credential, service: 'wsfex', now: NOW }))
      .rejects.toThrow('WSAA_RESPONSE_TOO_LARGE');
    expect(cancelled).toBe(true);
  });
});

function credential() {
  return validateIssuerCredential({
    workspaceId: 'workspace-1', issuerProfileRef: 'issuer://workspace-1/primary', environment: 'homologation', certificateHolderCuit: CUIT, representedCuit: CUIT,
    ...certificateBundle(), delegationConfirmed: true,
  }, NOW);
}

function wsaaResponse(input: Readonly<{ token: string; sign: string; expiresAt: string }>): Response {
  const ticket = `<loginTicketResponse version="1.0"><header><source>CN=WSAA</source><destination>CN=TEST</destination><uniqueId>1</uniqueId><generationTime>2026-07-11T12:00:00.000Z</generationTime><expirationTime>${input.expiresAt}</expirationTime></header><credentials><token>${input.token}</token><sign>${input.sign}</sign></credentials></loginTicketResponse>`;
  const escaped = ticket.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return new Response(`<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>${escaped}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`,
    { status: 200, headers: { 'content-type': 'text/xml' } });
}
