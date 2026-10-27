import { z } from 'zod';

/**
 * Wire contract between the tax engine and the ARCA setup executor.
 *
 * Runs unchanged in Bun and in a Cloudflare Worker: only zod and WebCrypto.
 * Every message is HMAC-signed with a secret dedicated to its direction and
 * bound to a purpose, so an order can never be replayed as a receipt or a
 * cancellation, and a handoff ticket can never authorize anything else.
 */

export const ARCA_SETUP_CONTRACT_VERSION = 'arca-setup-contract-v1' as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const iso = z.iso.datetime({ offset: true });
const code = z.string().regex(/^[A-Z0-9_]{3,120}$/);
const safeScalar = z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]);

export const arcaSetupOperationSchema = z.enum([
  'authenticate',
  'inspect',
  'adhere_services',
  'create_point_of_sale',
  'enroll_certificate',
  'authorize_web_services',
  'delegate_to_provider',
  'provider_accept',
  'close_session',
]);
export type ArcaSetupWireOperation = z.infer<typeof arcaSetupOperationSchema>;

export const arcaSetupOrderSchema = z.object({
  version: z.literal('arca-setup-order-v1'),
  orderId: z.string().min(8).max(200),
  executionId: z.uuid(),
  onboardingId: z.uuid(),
  workspaceId: z.string().min(1).max(200),
  environment: z.enum(['homologation', 'production']),
  operation: arcaSetupOperationSchema,
  authorizationId: z.string().min(1).max(200),
  expectedRevision: z.number().int().positive(),
  attempt: z.number().int().positive().max(100),
  parameters: z.record(z.string(), z.union([safeScalar, z.array(z.string().max(200)).max(20)])),
  issuedAt: iso,
  expiresAt: iso,
}).strict();
export type ArcaSetupWireOrder = z.infer<typeof arcaSetupOrderSchema>;

export const arcaSetupInventorySchema = z.object({
  version: z.literal('arca-setup-inventory-v1'),
  observedAt: iso,
  evidenceHash: sha256,
  identity: z.object({
    loginIdentityHash: sha256,
    representedCuitCommitment: sha256,
    representedMatches: z.boolean(),
  }).strict(),
  services: z.object({
    relationshipManager: z.boolean(),
    pointOfSaleAdministration: z.boolean(),
    certificateAdministration: z.boolean(),
  }).strict(),
  certificates: z.object({
    intendedAliasExists: z.boolean(),
    intendedAliasCertificateValidUntil: iso.nullable(),
    otherAliasCount: z.number().int().nonnegative().max(1000),
  }).strict(),
  relationships: z.object({
    wsfex: z.enum(['none', 'customer_alias', 'provider_pending', 'provider_active']),
    wsfe: z.enum(['none', 'customer_alias', 'provider_pending', 'provider_active']),
  }).strict(),
  pointsOfSale: z.object({
    exportWebServices: z.array(z.number().int().min(1).max(99_999)).max(200),
    domesticWebServices: z.array(z.number().int().min(1).max(99_999)).max(200),
    usedNumbers: z.array(z.number().int().min(1).max(99_999)).max(500),
    domicileCount: z.number().int().nonnegative().max(1000),
  }).strict(),
}).strict();
export type ArcaSetupWireInventory = z.infer<typeof arcaSetupInventorySchema>;

export const arcaSetupReceiptSchema = z.object({
  version: z.literal('arca-setup-receipt-v1'),
  receiptId: z.string().min(8).max(200),
  orderId: z.string().min(8).max(200),
  executionId: z.uuid(),
  onboardingId: z.uuid(),
  workspaceId: z.string().min(1).max(200),
  operation: arcaSetupOperationSchema,
  expectedRevision: z.number().int().positive(),
  outcome: z.enum(['completed', 'handoff_required', 'blocked', 'uncertain', 'failed']),
  code: code.nullable(),
  observedAt: iso,
  evidenceHash: sha256,
  inventory: arcaSetupInventorySchema.nullable(),
  result: z.record(z.string(), safeScalar),
}).strict();
export type ArcaSetupWireReceipt = z.infer<typeof arcaSetupReceiptSchema>;

export const arcaSetupCancelSchema = z.object({
  version: z.literal('arca-setup-cancel-v1'),
  executionId: z.uuid(),
  reason: z.enum(['customer_cancelled', 'agent_cancelled', 'superseded', 'completed', 'failed']),
  requestedAt: iso,
}).strict();
export type ArcaSetupWireCancel = z.infer<typeof arcaSetupCancelSchema>;

export const arcaSetupCancelReceiptSchema = z.object({
  version: z.literal('arca-setup-cancel-receipt-v1'),
  executionId: z.uuid(),
  sessionClosed: z.boolean(),
  sessionVerifiedGone: z.boolean(),
  closedAt: iso,
}).strict();
export type ArcaSetupWireCancelReceipt = z.infer<typeof arcaSetupCancelReceiptSchema>;

/**
 * Lets the authenticated customer (or BUFI operator) open the hosted browser.
 * Minted by the tax engine for one execution and actor, valid for two minutes,
 * redeemable once. The Live View link itself is created by the executor only
 * when a valid ticket arrives, and is sent only to that browser.
 */
export const arcaSetupHandoffTicketSchema = z.object({
  version: z.literal('arca-setup-handoff-ticket-v1'),
  executionId: z.uuid(),
  actorId: z.string().min(1).max(300),
  /**
   * `*_authentication`: the private sign-in tab while ARCA asks for credentials.
   * `customer_view`: a READ-ONLY stream (Cloudflare Live View readonly guardrail)
   *   for the job player; refused while credentials are being entered.
   * `customer_control`: the interactive tab, only for the session's current
   *   controller after the executor acknowledged a take-control request.
   */
  purpose: z.enum(['customer_authentication', 'provider_authentication', 'customer_view', 'customer_control']),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22,64}$/),
  expiresAt: iso,
}).strict();
export type ArcaSetupHandoffTicket = z.infer<typeof arcaSetupHandoffTicketSchema>;

export const ARCA_SETUP_HANDOFF_TICKET_MAX_TTL_MS = 120_000;
export const ARCA_SETUP_SIGNATURE_MAX_SKEW_MS = 300_000;

export type ArcaSetupSignaturePurpose =
  | 'order'
  | 'receipt'
  | 'cancel'
  | 'cancel-receipt'
  | 'handoff-ticket'
  | 'control'
  | 'control-state';

/**
 * Execution control. One controller per browser session, enforced by the
 * executor (the session transport), never by the UI:
 *
 * - `pause` asks automation to stop at the next safe point (between orders,
 *   or while waiting on a human). It stays `pause_requested` until the
 *   executor acknowledges it as `paused`.
 * - `resume` continues the SAME execution from `paused`.
 * - `take_control` pauses automation, then grants ONE actor the interactive
 *   tab (`human`). Every other viewer stays read-only.
 * - `return_control` asks the executor to validate the handoff (no open
 *   Cloudflare handoff, tab still on an allowed host) and resume automation.
 *   The controller's tab is rotated, so its Live View link stops working.
 */
export const arcaSetupControlActionSchema = z.enum(['pause', 'resume', 'take_control', 'return_control']);
export type ArcaSetupControlAction = z.infer<typeof arcaSetupControlActionSchema>;

export const arcaSetupControlSchema = z.object({
  version: z.literal('arca-setup-control-v1'),
  executionId: z.uuid(),
  action: arcaSetupControlActionSchema,
  /** Opaque, tax-engine-derived reference of the requesting actor; never an email or CUIT. */
  actorRef: z.string().regex(/^actor:[a-f0-9]{64}$/),
  requestId: z.uuid(),
  requestedAt: iso,
}).strict();
export type ArcaSetupWireControl = z.infer<typeof arcaSetupControlSchema>;

export const arcaSetupControlModeSchema = z.enum([
  'automation',
  'pause_requested',
  'paused',
  'control_requested',
  'human',
  'return_requested',
]);
export type ArcaSetupControlMode = z.infer<typeof arcaSetupControlModeSchema>;

export const arcaSetupControlStateSchema = z.object({
  version: z.literal('arca-setup-control-state-v1'),
  executionId: z.uuid(),
  mode: arcaSetupControlModeSchema,
  /** The actor holding the interactive tab, or the one who asked for it. */
  controllerRef: z.string().regex(/^actor:[a-f0-9]{64}$/).nullable(),
  requestId: z.uuid().nullable(),
  requestedAt: iso.nullable(),
  acknowledgedAt: iso.nullable(),
  /** Bumped every time the interactive tab is rotated. */
  generation: z.number().int().min(0),
  /** A Cloudflare human handoff is open; `authentication` means credentials are being typed. */
  handoff: z.enum(['none', 'authentication', 'choice']),
  /** A handoff the executor refused to return from, with a stable reason. */
  rejection: code.nullable(),
  observedAt: iso,
}).strict();
export type ArcaSetupWireControlState = z.infer<typeof arcaSetupControlStateSchema>;

export const ARCA_SETUP_TIMESTAMP_HEADER = 'x-arca-setup-timestamp';
export const ARCA_SETUP_SIGNATURE_HEADER = 'x-arca-setup-signature';

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  if (encoder.encode(secret).byteLength < 32) throw new Error('ARCA_SETUP_SECRET_TOO_SHORT');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

/** Sign a body for one purpose. Returns the headers to send. */
export async function signArcaSetupMessage(
  secret: string,
  purpose: ArcaSetupSignaturePurpose,
  body: string,
  now: Date = new Date(),
): Promise<Record<string, string>> {
  const timestamp = String(now.getTime());
  return {
    [ARCA_SETUP_TIMESTAMP_HEADER]: timestamp,
    [ARCA_SETUP_SIGNATURE_HEADER]: await hmacHex(secret, `${ARCA_SETUP_CONTRACT_VERSION}.${purpose}.${timestamp}.${body}`),
  };
}

/** Verify a signed body. Throws a stable code; never reveals which part failed. */
export async function verifyArcaSetupMessage(
  secret: string,
  purpose: ArcaSetupSignaturePurpose,
  headers: Headers,
  body: string,
  now: Date = new Date(),
): Promise<void> {
  const timestamp = headers.get(ARCA_SETUP_TIMESTAMP_HEADER) ?? '';
  const signature = headers.get(ARCA_SETUP_SIGNATURE_HEADER) ?? '';
  if (!/^\d{10,16}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) throw new Error('ARCA_SETUP_SIGNATURE_INVALID');
  if (Math.abs(now.getTime() - Number(timestamp)) > ARCA_SETUP_SIGNATURE_MAX_SKEW_MS) throw new Error('ARCA_SETUP_SIGNATURE_INVALID');
  const expected = await hmacHex(secret, `${ARCA_SETUP_CONTRACT_VERSION}.${purpose}.${timestamp}.${body}`);
  if (!constantTimeEqual(signature, expected)) throw new Error('ARCA_SETUP_SIGNATURE_INVALID');
}

function base64UrlEncode(value: string): string {
  const bytes = encoder.encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('ARCA_SETUP_HANDOFF_TICKET_INVALID');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function mintArcaSetupHandoffTicket(
  secret: string,
  input: Omit<ArcaSetupHandoffTicket, 'version' | 'nonce' | 'expiresAt'>,
  now: Date = new Date(),
): Promise<Readonly<{ ticket: string; ticketHash: string; expiresAt: string }>> {
  const claims = arcaSetupHandoffTicketSchema.parse({
    version: 'arca-setup-handoff-ticket-v1',
    ...input,
    nonce: randomNonce(),
    expiresAt: new Date(now.getTime() + ARCA_SETUP_HANDOFF_TICKET_MAX_TTL_MS).toISOString(),
  });
  const encoded = base64UrlEncode(JSON.stringify(claims));
  const signature = await hmacHex(secret, `${ARCA_SETUP_CONTRACT_VERSION}.handoff-ticket.${encoded}`);
  const ticket = `${encoded}.${signature}`;
  return { ticket, ticketHash: await sha256Hex(ticket), expiresAt: claims.expiresAt };
}

export async function verifyArcaSetupHandoffTicket(
  secret: string,
  ticket: string,
  now: Date = new Date(),
): Promise<ArcaSetupHandoffTicket> {
  const [encoded, signature, extra] = ticket.split('.');
  if (!encoded || !signature || extra !== undefined || encoded.length > 2048 || !/^[a-f0-9]{64}$/.test(signature))
    throw new Error('ARCA_SETUP_HANDOFF_TICKET_INVALID');
  const expected = await hmacHex(secret, `${ARCA_SETUP_CONTRACT_VERSION}.handoff-ticket.${encoded}`);
  if (!constantTimeEqual(signature, expected)) throw new Error('ARCA_SETUP_HANDOFF_TICKET_INVALID');
  let claims: ArcaSetupHandoffTicket;
  try {
    claims = arcaSetupHandoffTicketSchema.parse(JSON.parse(base64UrlDecode(encoded)));
  } catch {
    throw new Error('ARCA_SETUP_HANDOFF_TICKET_INVALID');
  }
  const expiresAt = Date.parse(claims.expiresAt);
  if (expiresAt <= now.getTime()) throw new Error('ARCA_SETUP_HANDOFF_TICKET_EXPIRED');
  if (expiresAt - now.getTime() > ARCA_SETUP_HANDOFF_TICKET_MAX_TTL_MS) throw new Error('ARCA_SETUP_HANDOFF_TICKET_INVALID');
  return claims;
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Order-independent hash so both runtimes bind evidence identically. */
export async function canonicalHash(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(sortCanonical(value)));
}

function sortCanonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortCanonical(child)]));
  }
  return value;
}
