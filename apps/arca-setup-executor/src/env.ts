import type { BrowserBinding } from './browser';

export interface ExecutorEnv {
  BROWSER: BrowserBinding;
  ARCA_SETUP_SESSION: DurableObjectNamespace;
  /** Public base URL of this Worker, used to build handoff links. */
  PUBLIC_BASE_URL: string;
  ARCA_ENVIRONMENT: 'homologation' | 'production';
  /** Tax engine endpoint that accepts signed receipts. */
  TAX_RECEIPT_URL: string;
  /** ARCA boundary origin for executor-scoped setup calls. */
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
