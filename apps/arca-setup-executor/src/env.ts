import type { BrowserBinding } from './browser';

export interface ExecutorEnv {
  BROWSER: BrowserBinding;
  ARCA_SETUP_SESSION: DurableObjectNamespace;
  /** Public base URL of this Worker, used to build handoff links. */
  PUBLIC_BASE_URL: string;
  ARCA_ENVIRONMENT: 'homologation' | 'production';
  /** Boundary `ExecutorEntrypoint` (executor routes only) and the Tax API (receipts). */
  ARCA_BOUNDARY: Fetcher;
  TAX: Fetcher;
  /** Synthetic request URL for receipts, sent through `TAX`; never resolved. */
  TAX_RECEIPT_URL: string;
  /** Synthetic boundary origin for setup calls, sent through `ARCA_BOUNDARY`; never resolved. */
  ARCA_BOUNDARY_URL: string;
  /** BUFI's representative CUIT and computer alias for provider delegation. Public values. */
  ARCA_PROVIDER_CUIT?: string;
  ARCA_PROVIDER_ALIAS?: string;
  /** Optional JSON override of ARCA portal URLs when ARCA moves a service. */
  ARCA_PORTAL_URLS_JSON?: string;
  /**
   * Comma-separated Browser Run domain sets (`common-cdns` or HTTPS hosted
   * lists). Unset: homologation uses `common-cdns`, production none.
   */
  ARCA_GUARDRAIL_DOMAIN_SETS?: string;
  /**
   * Account and token (Browser Rendering Write) for READ-ONLY Live View links,
   * which Cloudflare only issues over REST. Without them the job player shows
   * no browser preview; control and sign-in still work.
   */
  CF_ACCOUNT_ID?: string;
  CF_LIVE_VIEW_API_TOKEN?: string;
  /** Enables the file-transfer and reachability proof routes. Never in production. */
  PROOF_ROUTES_ENABLED?: string;
  PROOF_TOKEN?: string;
  // Secrets — one per direction and purpose.
  ARCA_SETUP_ORDER_SECRET: string;
  ARCA_SETUP_RECEIPT_SECRET: string;
  ARCA_SETUP_HANDOFF_SECRET: string;
  ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN: string;
}
