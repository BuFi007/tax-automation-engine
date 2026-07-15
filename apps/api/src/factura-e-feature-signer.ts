import {
  createHmac,
  createPublicKey,
  randomUUID,
  verify,
  type KeyObject,
} from 'node:crypto';

import { z } from 'zod';

import type { FacturaEFeatureSigningGateway } from '@tax-engine/core';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_REFERENCE = /^[A-Za-z0-9._:/-]{1,200}$/;
const MAX_RESPONSE_BYTES = 16 * 1024;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const receiptSchema = z.object({
  version: z.literal('factura-e-feature-signature-receipt-v1'),
  digestHex: z.string().regex(SHA256),
  keyVersion: z.string().regex(SAFE_REFERENCE),
  algorithm: z.literal('Ed25519'),
  signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();

export class HttpFacturaEFeatureSigningGateway implements FacturaEFeatureSigningGateway {
  readonly #publicKey: KeyObject;
  readonly #endpoint: URL;

  constructor(
    endpoint: URL,
    readonly keyVersion: string,
    private readonly secret: string,
    publicKeyPem: string,
    private readonly fetchImpl: FetchLike = fetch
  ) {
    this.#endpoint = new URL(endpoint.href);
    assertEndpoint(this.#endpoint);
    if (!SAFE_REFERENCE.test(keyVersion)) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_KEY_VERSION_INVALID');
    }
    if (Buffer.byteLength(secret) < 32) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_SECRET_REQUIRED');
    }
    if (/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/.test(publicKeyPem)) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_PUBLIC_KEY_INVALID');
    }
    try {
      this.#publicKey = createPublicKey(publicKeyPem);
    } catch {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_PUBLIC_KEY_INVALID');
    }
    if (this.#publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_PUBLIC_KEY_INVALID');
    }
  }

  static fromEnvironment(): HttpFacturaEFeatureSigningGateway | null {
    const endpoint = process.env.TAX_FACTURA_E_FEATURE_SIGNER_URL ?? null;
    const keyVersion = process.env.TAX_FACTURA_E_FEATURE_SIGNER_KEY_VERSION ?? null;
    const secret = process.env.TAX_FACTURA_E_FEATURE_SIGNER_HMAC_SECRET ?? null;
    const publicKeyPem = process.env.TAX_FACTURA_E_FEATURE_SIGNER_PUBLIC_KEY_PEM ?? null;
    if (!endpoint && !keyVersion && !secret && !publicKeyPem) return null;
    if (!endpoint || !keyVersion || !secret || !publicKeyPem) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_CONFIGURATION_REQUIRED');
    }
    return new HttpFacturaEFeatureSigningGateway(
      new URL(endpoint),
      keyVersion,
      secret,
      publicKeyPem
    );
  }

  async signDigest(digestHex: string): Promise<string> {
    if (!SHA256.test(digestHex)) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_DIGEST_INVALID');
    }
    const requestId = randomUUID();
    const rawBody = JSON.stringify({
      version: 'factura-e-feature-signature-request-v1',
      requestId,
      keyVersion: this.keyVersion,
      digestHex,
      algorithm: 'Ed25519',
    });
    let response: Response;
    try {
      response = await this.fetchImpl(this.#endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tax-feature-request-id': requestId,
          'x-tax-feature-request-signature': createHmac('sha256', this.secret)
            .update(rawBody)
            .digest('hex'),
        },
        body: rawBody,
        signal: AbortSignal.timeout(5_000),
        redirect: 'error',
      });
    } catch {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_UPSTREAM_UNAVAILABLE');
    }
    if (!response.ok) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_UPSTREAM_UNAVAILABLE');
    }
    assertResponseOrigin(response, this.#endpoint);
    const raw = await boundedResponseText(response);
    let receipt: z.infer<typeof receiptSchema>;
    try {
      receipt = receiptSchema.parse(JSON.parse(raw) as unknown);
    } catch {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_RECEIPT_INVALID');
    }
    if (receipt.digestHex !== digestHex || receipt.keyVersion !== this.keyVersion) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_RECEIPT_MISMATCH');
    }
    if (!verify(
      null,
      Buffer.from(digestHex, 'hex'),
      this.#publicKey,
      Buffer.from(receipt.signature, 'base64url')
    )) {
      throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_SIGNATURE_INVALID');
    }
    return receipt.signature;
  }
}

function assertResponseOrigin(response: Response, endpoint: URL): void {
  if (!response.url) return;
  let responseUrl: URL;
  try {
    responseUrl = new URL(response.url);
  } catch {
    throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_RESPONSE_ORIGIN_MISMATCH');
  }
  if (responseUrl.origin !== endpoint.origin) {
    throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_RESPONSE_ORIGIN_MISMATCH');
  }
}

async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null
    && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES)
  ) throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_RESPONSE_TOO_LARGE');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_RESPONSE_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}

function assertEndpoint(endpoint: URL): void {
  if (endpoint.username || endpoint.password || endpoint.hash || endpoint.search) {
    throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_URL_INVALID');
  }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(endpoint.hostname);
  if (endpoint.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && loopback)) {
    throw new Error('TAX_FACTURA_E_FEATURE_SIGNER_HTTPS_REQUIRED');
  }
}
