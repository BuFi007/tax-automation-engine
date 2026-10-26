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

/**
 * Hosted authentication policy for a customer signing in to ARCA inside a
 * remote browser session that BUFI automates afterwards.
 *
 * Version 2 keeps every v1 capture prohibition for the automation, agent and
 * observability side, and adds the one thing v1 never addressed: a private
 * human display. The customer sees the live remote tab through a single-use,
 * short-lived view link delivered only over their authenticated BUFI session.
 * Seeing that tab is display, not capture: nothing renders to a model, a trace,
 * a recording, a screenshot or a tax-domain event, and automation is paused
 * while the customer types.
 */
export type HostedHumanAuthPolicyV2 = Readonly<{
  version: 'hosted-human-auth-policy-v2';
  /** The v1 prohibitions bind the automation and agent side unchanged. */
  agentCapture: HumanAuthCapturePolicyV1;
  agentCapturePolicyHash: typeof HUMAN_AUTH_CAPTURE_POLICY_HASH;
  humanDisplay: Readonly<{
    channel: 'private_live_view';
    audience: 'authenticated_customer_only';
    deliveredThrough: 'bufi_authenticated_ui';
    viewLinkSingleUse: true;
    viewLinkMaxTtlSeconds: 120;
    viewModes: readonly ['tab'];
  }>;
  duringCredentialEntry: Readonly<{
    automationPaused: true;
    pageObservationPaused: true;
  }>;
  forbiddenSinks: readonly [
    'model_context',
    'tool_results',
    'analytics',
    'tax_domain_events',
    'session_recording',
    'logs',
  ];
}>;

export const HOSTED_HUMAN_AUTH_POLICY_V2: HostedHumanAuthPolicyV2 = Object.freeze({
  version: 'hosted-human-auth-policy-v2',
  agentCapture: HUMAN_AUTH_CAPTURE_POLICY,
  agentCapturePolicyHash: HUMAN_AUTH_CAPTURE_POLICY_HASH,
  humanDisplay: Object.freeze({
    channel: 'private_live_view',
    audience: 'authenticated_customer_only',
    deliveredThrough: 'bufi_authenticated_ui',
    viewLinkSingleUse: true,
    viewLinkMaxTtlSeconds: 120,
    viewModes: Object.freeze(['tab'] as const),
  }),
  duringCredentialEntry: Object.freeze({ automationPaused: true, pageObservationPaused: true }),
  forbiddenSinks: Object.freeze([
    'model_context',
    'tool_results',
    'analytics',
    'tax_domain_events',
    'session_recording',
    'logs',
  ] as const),
}) as HostedHumanAuthPolicyV2;

/** SHA-256 of the canonical JSON policy above; pinned for executor/server parity. */
export const HOSTED_HUMAN_AUTH_POLICY_V2_HASH = '4c22ba96fd4b4bbaf4d1a7f751b2a40e6f0e9f73c9c553d633b3d173192eb8d3';
