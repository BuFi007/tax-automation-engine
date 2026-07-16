const FORBIDDEN_KEY = /(?:^|_)(?:clave(?:_?fiscal)?|password|passphrase|pin|otp|totp|cookies?|authorization|access_?token|refresh_?token|session(?:_?id)?|local_?storage|session_?storage|clipboard|raw_?trace|network_?log|cuit|cuil|tin)(?:$|_)/i;
const FORBIDDEN_VALUE = /(?:BEGIN (?:RSA |EC )?PRIVATE KEY|bearer\s+[a-z0-9._~+/=-]{12,}|(?:clave\s+fiscal|password|otp|pin)\s*[:=])/i;

export type HumanAuthCapturePolicyV1 = Readonly<{
  inspectCredentialDom: false;
  screenshots: false;
  clipboard: false;
  cookies: false;
  browserStorage: false;
  networkBodies: false;
  rawTraces: false;
}>;

export const HUMAN_AUTH_CAPTURE_POLICY: HumanAuthCapturePolicyV1 = Object.freeze({
  inspectCredentialDom: false,
  screenshots: false,
  clipboard: false,
  cookies: false,
  browserStorage: false,
  networkBodies: false,
  rawTraces: false,
});

/** SHA-256 of the canonical JSON policy above; pinned for browser/server parity. */
export const HUMAN_AUTH_CAPTURE_POLICY_HASH = '033c36138debd63d88a9e7fbb0e61aed31bd2515dbd1e02f4cfb32ecb05764ef';

export type HumanAuthCompletionV1 = Readonly<{
  version: 'human-auth-completion-v1';
  completionReceiptHash: string;
  capturePolicyHash: string;
  completedAt: string;
  /** Set only after the trusted user principal has authenticated the mutation. */
  signatureVerified: true;
}>;

/**
 * Validates the receipt emitted after the human leaves the ARCA credential page.
 * Raw browser evidence is structurally outside this contract; only hashes survive.
 */
export function assertHumanAuthCompletion(value: HumanAuthCompletionV1): void {
  assertExactKeys(value, ['version', 'completionReceiptHash', 'capturePolicyHash', 'completedAt', 'signatureVerified']);
  assertSafeHumanAuthValue(value);
  if (value.version !== 'human-auth-completion-v1' || value.signatureVerified !== true) {
    throw new Error('HUMAN_AUTH_COMPLETION_UNVERIFIED');
  }
  if (!/^[a-f0-9]{64}$/i.test(value.completionReceiptHash)) throw new Error('HUMAN_AUTH_RECEIPT_HASH_INVALID');
  if (value.capturePolicyHash !== HUMAN_AUTH_CAPTURE_POLICY_HASH) throw new Error('HUMAN_AUTH_CAPTURE_POLICY_MISMATCH');
  if (!Number.isFinite(Date.parse(value.completedAt))) throw new Error('HUMAN_AUTH_COMPLETION_TIME_INVALID');
}

/** Safe for schemas, logs, support exports, workflow events, and agent traces. */
export function assertSafeHumanAuthValue(value: unknown): void {
  visit(value, new Set());
}

function visit(value: unknown, seen: Set<object>): void {
  if (typeof value === 'string') {
    if (FORBIDDEN_VALUE.test(value)) throw new Error('HUMAN_AUTH_SECRET_MATERIAL_FORBIDDEN');
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) throw new Error('HUMAN_AUTH_CYCLIC_PAYLOAD');
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) throw new Error('HUMAN_AUTH_FIELD_FORBIDDEN');
    visit(child, seen);
  }
  seen.delete(value);
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error('HUMAN_AUTH_MALFORMED_PAYLOAD');
  }
}
