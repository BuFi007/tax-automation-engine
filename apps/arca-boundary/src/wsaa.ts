import { hashCanonical } from '@tax-engine/core';
import { XMLParser } from 'fast-xml-parser';
import * as forge from 'node-forge';

import type { WsaaService } from './contracts';
import { readBoundedBody } from './bounded-body';
import { fingerprintDer } from './crypto';
import type { IssuerCredential } from './store';

const ENDPOINTS = {
  homologation: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
  production: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
} as const;
const WSAA_NAMESPACE = 'http://wsaa.view.sua.dvadac.desein.afip.gov';

export type WsaaLoginTicket = Readonly<{
  token: string;
  sign: string;
  expiresAt: string;
  safeReceiptHash: string;
}>;

export interface WsaaLoginClient {
  login(input: Readonly<{ credential: IssuerCredential; service: WsaaService; now: Date }>): Promise<WsaaLoginTicket>;
}

type WsaaFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class SoapWsaaLoginClient implements WsaaLoginClient {
  readonly #parser = new XMLParser({ removeNSPrefix: true, parseTagValue: false, trimValues: true, processEntities: false });

  constructor(private readonly fetcher: WsaaFetch = (input, init) => fetch(input, init)) {}

  async login(input: Readonly<{ credential: IssuerCredential; service: WsaaService; now: Date }>): Promise<WsaaLoginTicket> {
    assertCredentialMaterial(input.credential, input.now);
    const tra = loginTicketRequest(input.service, input.now);
    const cms = signCms(tra, input.credential.certificatePem, input.credential.privateKeyPem);
    const envelope = `<?xml version="1.0" encoding="utf-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="${WSAA_NAMESPACE}"><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
    let response: Response;
    try {
      response = await this.fetcher(ENDPOINTS[input.credential.environment], {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'text/xml; charset=utf-8', soapaction: '""' },
        body: envelope,
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      throw new Error(`WSAA_TRANSPORT_FAILED_${error instanceof Error ? error.name.toUpperCase() : 'UNKNOWN'}`);
    }
    const raw = await readBoundedBody(response, 1_048_576, 'WSAA_RESPONSE_TOO_LARGE');
    const rawHash = hashCanonical(raw);
    if (!response.ok) throw new Error(`WSAA_HTTP_REJECTED_${response.status}`);
    if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error('WSAA_LOGIN_RESPONSE_UNSAFE_XML');
    const outer = xmlNode(this.#parser.parse(raw));
    const body = xmlNode(xmlNode(outer.Envelope).Body);
    if (body.Fault) throw new Error('WSAA_SOAP_FAULT');
    const loginReturn = decodeStandardXmlEntities(xmlText(xmlNode(body.loginCmsResponse).loginCmsReturn));
    if (!loginReturn) throw new Error('WSAA_LOGIN_RESPONSE_REQUIRED');
    if (/<!DOCTYPE|<!ENTITY/i.test(loginReturn)) throw new Error('WSAA_LOGIN_RESPONSE_UNSAFE_XML');
    const ticket = xmlNode(this.#parser.parse(loginReturn));
    const responseRoot = xmlNode(ticket.loginTicketResponse);
    const credentials = xmlNode(responseRoot.credentials);
    const header = xmlNode(responseRoot.header);
    const token = requiredXmlText(credentials.token, 'WSAA_TOKEN_REQUIRED');
    const sign = requiredXmlText(credentials.sign, 'WSAA_SIGN_REQUIRED');
    const expiresAt = requiredXmlText(header.expirationTime, 'WSAA_EXPIRATION_REQUIRED');
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= input.now.getTime() + 60_000) throw new Error('WSAA_TICKET_EXPIRED_OR_TOO_CLOSE');
    return {
      token,
      sign,
      expiresAt: new Date(expiresAt).toISOString(),
      safeReceiptHash: hashCanonical({ rawHash, expiresAt, tokenHash: hashCanonical(token), signHash: hashCanonical(sign) }),
    };
  }
}

export function validateIssuerCredential(input: Readonly<{
  workspaceId: string;
  issuerProfileRef: string;
  environment: 'homologation' | 'production';
  certificateHolderCuit: string;
  representedCuit: string;
  certificatePem: string;
  privateKeyPem: string;
  delegationConfirmed: boolean;
}>, now: Date): Readonly<{ credential: IssuerCredential; credentialBundleHash: string }> {
  let certificate: forge.pki.Certificate;
  let privateKey: forge.pki.rsa.PrivateKey;
  try {
    certificate = forge.pki.certificateFromPem(input.certificatePem);
    privateKey = forge.pki.privateKeyFromPem(input.privateKeyPem) as forge.pki.rsa.PrivateKey;
  } catch {
    throw new Error('WSAA_CREDENTIAL_PEM_INVALID');
  }
  const publicKey = certificate.publicKey as forge.pki.rsa.PublicKey;
  if (!publicKey.n || !privateKey.n || publicKey.n.compareTo(privateKey.n) !== 0 || publicKey.e.compareTo(privateKey.e) !== 0) {
    throw new Error('WSAA_CERTIFICATE_PRIVATE_KEY_MISMATCH');
  }
  if (publicKey.n.bitLength() < 2048) throw new Error('WSAA_CERTIFICATE_RSA_KEY_TOO_SMALL');
  if (certificate.validity.notBefore.getTime() > now.getTime() || certificate.validity.notAfter.getTime() <= now.getTime() + 60_000) {
    throw new Error('WSAA_CERTIFICATE_NOT_CURRENT');
  }
  const serialSubject = certificate.subject.attributes.find(attribute => attribute.name === 'serialNumber' || attribute.type === '2.5.4.5')?.value ?? '';
  if (String(serialSubject).trim() !== `CUIT ${input.certificateHolderCuit}`) throw new Error('WSAA_CERTIFICATE_HOLDER_CUIT_MISMATCH');
  const certificateDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certificate)).getBytes();
  const certificateFingerprint = fingerprintDer(certificateDer);
  const credential: IssuerCredential = {
    workspaceId: input.workspaceId,
    issuerProfileRef: input.issuerProfileRef,
    environment: input.environment,
    certificateHolderCuit: input.certificateHolderCuit,
    representedCuit: input.representedCuit,
    representedCuitCommitment: null,
    certificatePem: input.certificatePem,
    privateKeyPem: input.privateKeyPem,
    certificateFingerprint,
    delegationConfirmed: input.delegationConfirmed,
    active: true,
  };
  return { credential, credentialBundleHash: hashCanonical(credential) };
}

function assertCredentialMaterial(credential: IssuerCredential, now: Date): void {
  validateIssuerCredential(credential, now);
  if (!credential.active) throw new Error('WSAA_ISSUER_INACTIVE');
  if (!credential.delegationConfirmed) throw new Error('WSAA_DELEGATION_NOT_CONFIRMED');
}

function loginTicketRequest(service: WsaaService, now: Date): string {
  const uniqueId = Math.floor(now.getTime() / 1000);
  const generationTime = new Date(now.getTime() - 5 * 60_000).toISOString();
  const expirationTime = new Date(now.getTime() + 10 * 60_000).toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>${uniqueId}</uniqueId><generationTime>${generationTime}</generationTime><expirationTime>${expirationTime}</expirationTime></header><service>${service}</service></loginTicketRequest>`;
}

function signCms(content: string, certificatePem: string, privateKeyPem: string): string {
  const certificate = forge.pki.certificateFromPem(certificatePem);
  const privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
  const signed = forge.pkcs7.createSignedData();
  signed.content = forge.util.createBuffer(content, 'utf8');
  signed.addCertificate(certificate);
  signed.addSigner({
    key: privateKey,
    certificate,
    digestAlgorithm: '2.16.840.1.101.3.4.2.1',
    authenticatedAttributes: [
      { type: '1.2.840.113549.1.9.3', value: '1.2.840.113549.1.7.1' },
      { type: '1.2.840.113549.1.9.4' },
      { type: '1.2.840.113549.1.9.5', value: new Date() as unknown as string },
    ],
  });
  signed.sign({ detached: false });
  return forge.util.encode64(forge.asn1.toDer(signed.toAsn1()).getBytes());
}

type XmlValue = string | number | boolean | null | XmlNode | XmlValue[];
type XmlNode = { [key: string]: XmlValue };

function xmlNode(value: unknown): XmlNode {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as XmlNode : {};
}

function xmlText(value: XmlValue | undefined): string {
  return value === undefined || value === null ? '' : String(value).trim();
}

function requiredXmlText(value: XmlValue | undefined, code: string): string {
  const result = xmlText(value);
  if (!result) throw new Error(code);
  return result;
}

function decodeStandardXmlEntities(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}
