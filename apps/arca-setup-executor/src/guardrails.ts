/**
 * Browser Run session guardrails for the ARCA executor.
 *
 * Cloudflare fixes a session's hostname allowlist when the session starts and
 * enforces it for every request and every Live View connection
 * (https://developers.cloudflare.com/browser-run/features/guardrails/). A page
 * that is hijacked, or a viewer who navigates, cannot reach any other host.
 *
 * - Production allows ARCA's own hostnames only. Cloudflare's `common-cdns`
 *   set may change over time, so it is opt-in per environment.
 * - The policy is validated here against Cloudflare's own rules (at most 50
 *   hostnames, four domain sets, one wildcard each, hostname only), so a bad
 *   configuration fails before a customer is asked to sign in, not as a 400
 *   in the middle of a run.
 * - A blocked request answers 403 with `cf-mitigated: guardrails`; the
 *   executor treats a blocked main-frame navigation as a stable error instead
 *   of trying to read whatever page it got.
 */

export const ARCA_ALLOWED_DOMAINS = [
  'afip.gob.ar',
  '*.afip.gob.ar',
  'afip.gov.ar',
  '*.afip.gov.ar',
  'arca.gob.ar',
  '*.arca.gob.ar',
] as const;

export type GuardrailPolicy = Readonly<{ allowedDomains: string[]; allowedDomainSets?: string[] }>;

const MAX_DOMAINS = 50;
const MAX_DOMAIN_SETS = 4;
const HOSTNAME_PATTERN = /^(?:\*|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)?(?:\*?[a-z0-9-]*)(?:\.(?:\*|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

export function assertHostnamePattern(entry: string): void {
  if (
    entry.length === 0 || entry.length > 253
    || /[:/?#@\s]/.test(entry)
    || (entry.match(/\*/g)?.length ?? 0) > 1
    || entry !== entry.toLowerCase()
    || !HOSTNAME_PATTERN.test(entry)
  ) throw new Error('ARCA_GUARDRAIL_POLICY_INVALID');
}

function assertDomainSet(entry: string): void {
  if (entry === 'common-cdns') return;
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw new Error('ARCA_GUARDRAIL_POLICY_INVALID');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error('ARCA_GUARDRAIL_POLICY_INVALID');
}

export function validateGuardrailPolicy(policy: GuardrailPolicy): GuardrailPolicy {
  if (policy.allowedDomains.length > MAX_DOMAINS) throw new Error('ARCA_GUARDRAIL_POLICY_INVALID');
  for (const entry of policy.allowedDomains) assertHostnamePattern(entry);
  const sets = policy.allowedDomainSets ?? [];
  if (sets.length > MAX_DOMAIN_SETS) throw new Error('ARCA_GUARDRAIL_POLICY_INVALID');
  for (const entry of sets) assertDomainSet(entry);
  // An empty allowlist with a domain set is not "block everything"; refuse the ambiguity.
  if (policy.allowedDomains.length === 0 && sets.length > 0) throw new Error('ARCA_GUARDRAIL_POLICY_INVALID');
  return sets.length > 0 ? { allowedDomains: [...policy.allowedDomains], allowedDomainSets: [...sets] } : { allowedDomains: [...policy.allowedDomains] };
}

/**
 * The executor's policy. `domainSets` comes from `ARCA_GUARDRAIL_DOMAIN_SETS`
 * (comma separated: `common-cdns` or HTTPS hosted lists); homologation keeps
 * `common-cdns` by default because the measured login page loaded with it.
 */
export function arcaGuardrailPolicy(environment: 'homologation' | 'production', domainSets?: string | null): GuardrailPolicy {
  const configured = domainSets?.split(',').map(entry => entry.trim()).filter(Boolean);
  const sets = configured ?? (environment === 'homologation' ? ['common-cdns'] : []);
  return validateGuardrailPolicy({ allowedDomains: [...ARCA_ALLOWED_DOMAINS], allowedDomainSets: sets });
}

/** Does this hostname pass the allowlist's own (hostname) entries? Mirrors Cloudflare's wildcard rule. */
export function hostnameAllowed(hostname: string, allowedDomains: readonly string[]): boolean {
  const host = hostname.toLowerCase();
  return allowedDomains.some(pattern => {
    if (!pattern.includes('*')) return pattern === host;
    const [prefix, suffix] = pattern.split('*') as [string, string];
    return host.length >= prefix.length + suffix.length && host.startsWith(prefix) && host.endsWith(suffix)
      && (pattern.startsWith('*.') ? host !== suffix.slice(1) : true);
  });
}

/** True when Browser Run's guardrails, not the site, answered this response. */
export function blockedByGuardrails(status: number, headers: Record<string, string>): boolean {
  return status === 403 && headers['cf-mitigated'] === 'guardrails';
}
