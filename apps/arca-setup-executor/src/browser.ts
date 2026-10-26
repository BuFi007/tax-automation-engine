import {
  acquire,
  connect,
  sessions,
  type Browser,
  type BrowserWorker,
  type CDPSession,
  type HandoffCompleteResponse,
  type Page,
} from '@cloudflare/playwright';

/**
 * Cloudflare Browser Run session lifecycle.
 *
 * - Sessions are acquired with recording off and outbound guardrails limited to
 *   ARCA, so a hijacked page cannot exfiltrate to arbitrary hosts.
 * - `connect` + `browser.close()` only DISCONNECTS (Playwright semantics for a
 *   connected session). Ending a session needs `closeSession`, which this
 *   module performs explicitly and then verifies.
 */

export const ARCA_ALLOWED_DOMAINS = [
  'afip.gob.ar',
  '*.afip.gob.ar',
  'afip.gov.ar',
  '*.afip.gov.ar',
  'arca.gob.ar',
  '*.arca.gob.ar',
] as const;

export const SESSION_KEEP_ALIVE_MS = 600_000;
export const HANDOFF_TIMEOUT_MS = 15 * 60_000;

/** The Worker binding also exposes session management beyond what Playwright wraps. */
export type BrowserBinding = BrowserWorker & {
  closeSession?: (sessionId: string) => Promise<unknown>;
};

export async function openSession(binding: BrowserBinding, allowedDomains: readonly string[] = ARCA_ALLOWED_DOMAINS): Promise<string> {
  const { sessionId } = await acquire(binding, {
    keep_alive: SESSION_KEEP_ALIVE_MS,
    recording: false,
    guardrails: { allowedDomains: [...allowedDomains], allowedDomainSets: ['common-cdns'] },
  });
  return sessionId;
}

export async function sessionAlive(binding: BrowserBinding, sessionId: string): Promise<boolean> {
  const active = await sessions(binding);
  return active.some(session => session.sessionId === sessionId);
}

/** Run `work` on the session's single page, then disconnect without ending the session. */
export async function withSessionPage<T>(
  binding: BrowserBinding,
  sessionId: string,
  work: (page: Page, browser: Browser) => Promise<T>,
): Promise<T> {
  const browser = await connect(binding, sessionId);
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    return await work(page, browser);
  } finally {
    // Disconnects only; the remote session keeps the customer's login.
    await browser.close().catch(() => undefined);
  }
}

export async function cdpFor(page: Page): Promise<CDPSession> {
  return page.context().newCDPSession(page);
}

/** A tab-only Live View link. Treat it as a credential: it goes to one browser, once. */
export async function liveViewUrl(page: Page, expiresInMs = 60_000): Promise<string> {
  const cdp = await cdpFor(page);
  const { devtoolsFrontendUrl } = await cdp.send('Cloudflare.getLiveView', { mode: 'tab', expiresInMs });
  return devtoolsFrontendUrl;
}

/**
 * Structured handoff: subscribe to completion BEFORE requesting it, as
 * Cloudflare documents, so a fast "Done" cannot be missed.
 */
export async function requestHandoff(page: Page, instructions: string, timeoutMs = HANDOFF_TIMEOUT_MS): Promise<Readonly<{
  handoffId: string;
  completion: Promise<HandoffCompleteResponse>;
}>> {
  const cdp = await cdpFor(page);
  const completion = new Promise<HandoffCompleteResponse>(resolve => {
    cdp.once('Cloudflare.handoffComplete' as never, ((event: HandoffCompleteResponse) => resolve(event)) as never);
  });
  const { handoffId } = await cdp.send('Cloudflare.handoff', { instructions, timeout: timeoutMs });
  return { handoffId, completion };
}

export async function handoffActive(page: Page): Promise<boolean> {
  const cdp = await cdpFor(page);
  const state = await cdp.send('Cloudflare.getHandoffState', {});
  return state.active;
}

/** Wait for the human, bounded so the Durable Object alarm can reschedule itself. */
export async function waitForHandoff(
  completion: Promise<HandoffCompleteResponse>,
  maximumWaitMs: number,
): Promise<HandoffCompleteResponse | 'still_waiting'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'still_waiting'>(resolve => { timer = setTimeout(() => resolve('still_waiting'), maximumWaitMs); });
  try {
    return await Promise.race([completion, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * End the remote session for real, then confirm it is gone.
 * Order: the binding's `closeSession`; otherwise CDP `Browser.close` over a
 * connected client, which terminates the browser process.
 */
export async function closeSessionForReal(binding: BrowserBinding, sessionId: string): Promise<Readonly<{ closed: boolean; verifiedGone: boolean; method: 'binding' | 'cdp' | 'none' }>> {
  let closed = false;
  let method: 'binding' | 'cdp' | 'none' = 'none';
  if (typeof binding.closeSession === 'function') {
    try {
      await binding.closeSession(sessionId);
      closed = true;
      method = 'binding';
    } catch {
      closed = false;
    }
  }
  if (!closed) {
    try {
      const browser = await connect(binding, sessionId);
      const cdp = await browser.newBrowserCDPSession();
      await cdp.send('Browser.close').catch(() => undefined);
      await browser.close().catch(() => undefined);
      closed = true;
      method = 'cdp';
    } catch {
      // A session that no longer accepts connections is already ending.
      closed = true;
    }
  }
  let verifiedGone = false;
  for (let attempt = 0; attempt < 5 && !verifiedGone; attempt += 1) {
    verifiedGone = !(await sessionAlive(binding, sessionId).catch(() => true));
    if (!verifiedGone) await new Promise(resolve => setTimeout(resolve, 1_000));
  }
  return { closed, verifiedGone, method };
}
