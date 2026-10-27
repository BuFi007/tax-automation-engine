import { sha256Hex } from '@tax-engine/arca-setup-contract';
import { connect } from '@cloudflare/playwright';

import { readDownload } from './arca-portal';
import type { Locator, Page } from '@cloudflare/playwright';
import { closeSessionForReal, handoffActive, liveViewUrl, openSession, readonlyLiveViewUrl, sessionAlive, requestHandoff, targetIdOf, waitForHandoff } from './browser';
import { arcaGuardrailPolicy, blockedByGuardrails } from './guardrails';
import type { ExecutorEnv } from './env';

/**
 * Proof routes, enabled only outside production.
 *
 * They exercise, in Cloudflare's runtime and a real Browser Run session, the
 * two file transfers the ARCA flow depends on, and they measure whether ARCA's
 * public login page is reachable from Browser Run (Cloudflare marks this
 * traffic as automated). No credentials are involved.
 */

export const PROOF_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUQk1GSSBwcm9vZiBjZXJ0aWZpY2F0ZTAKBggqhkjOPQQD
AjAXMRUwEwYDVQQDDAxCVUZJIHByb29mIENBMB4XDTI2MTAyNjAwMDAwMFoXDTI3
MTAyNjAwMDAwMFowFzEVMBMGA1UEAwwMQlVGSSBwcm9vZiBDQTBZMBMGByqGSM49
AgEGCCqGSM49AwEHA0IABEJVRkkgcHJvb2YgZml4dHVyZSBieXRlcyBmb3IgZG93
bmxvYWQgc3RyZWFtIHJldHJpZXZhbCB0ZXN0aW5nIG9ubHkuo1MwUTAdBgNVHQ4E
FgQUQlVGSSBwcm9vZiBmaXh0dXJlIGlkMB8GA1UdIwQYMBaAFEJVRkkgcHJvb2Yg
Zml4dHVyZSBpZDAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIEJV
RkkgcHJvb2YgZml4dHVyZSBzaWduYXR1cmUgcGFydCAxAiEAQlVGSSBwcm9vZiBm
aXh0dXJlIHNpZ25hdHVyZSBwYXJ0IDI=
-----END CERTIFICATE-----
`;

const PROOF_CSR = `-----BEGIN CERTIFICATE REQUEST-----
QlVGSSBwcm9vZiBDU1IgYnl0ZXMgdXBsb2FkZWQgZnJvbSBtZW1vcnkgd2l0aG91
dCBhIGxvY2FsIGZpbGVzeXN0ZW0gcGF0aA==
-----END CERTIFICATE REQUEST-----
`;

export async function runProof(request: Request, env: ExecutorEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/proof/fixtures/upload') {
    return new Response(UPLOAD_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  }
  if (request.method === 'GET' && url.pathname === '/proof/fixtures/certificate.crt') {
    return new Response(PROOF_CERTIFICATE, {
      headers: {
        'content-type': 'application/x-x509-ca-cert',
        'content-disposition': 'attachment; filename="bufi-proof.crt"',
        'cache-control': 'no-store',
      },
    });
  }
  if (request.method === 'POST' && url.pathname === '/proof/fixtures/certificate-post') {
    return new Response(PROOF_CERTIFICATE, {
      headers: { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="bufi-proof.crt"', 'cache-control': 'no-store' },
    });
  }
  if (request.method === 'POST' && url.pathname === '/proof/run') {
    if (!env.PROOF_TOKEN || env.PROOF_TOKEN.length < 32 || request.headers.get('authorization') !== `Bearer ${env.PROOF_TOKEN}`)
      return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    const base = new URL(env.PUBLIC_BASE_URL);
    const results: Record<string, unknown> = { runtime: 'cloudflare-worker', package: '@cloudflare/playwright@1.3.6' };
    results.fileTransfer = await proveFileTransfer(env, base);
    results.arcaReachability = await proveArcaReachability(env);
    results.handoff = await proveHandoff(env, base);
    results.guardrails = await proveGuardrails(env, base);
    results.readonlyLiveView = await proveReadonlyLiveView(env, base);
    results.webmcp = await proveArcaWebMcp(env);
    return Response.json(results);
  }
  return new Response('Not found', { status: 404 });
}

async function proveFileTransfer(env: ExecutorEnv, base: URL) {
  const sessionId = await openSession(env.BROWSER, { allowedDomains: [base.hostname] });
  try {
    const browser = await connect(env.BROWSER, sessionId);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(new URL('/proof/fixtures/upload', base).toString());
    await page.locator('input[type="file"]').setInputFiles({
      name: 'bufi-proof.csr', mimeType: 'application/pkcs10', buffer: Buffer.from(PROOF_CSR, 'utf8'),
    });
    await page.getByText(/^[a-f0-9]{64}$/).first().waitFor({ timeout: 15_000 });
    const uploadedHash = (await page.locator('#digest').textContent())?.trim() ?? '';
    const expectedUploadHash = await sha256Hex(PROOF_CSR);
    const link = page.getByRole('link', { name: /descargar/i });
    const strategies = await downloadStrategies(page, link);
    const certificate = await readDownload(page, link).catch(error => `ERROR:${String(error).slice(0, 120)}`);
    await page.goto(new URL('/proof/fixtures/upload', base).toString());
    const postCertificate = await readDownload(page, page.getByRole('button', { name: /obtener certificado/i }))
      .catch(error => `ERROR:${String(error).slice(0, 120)}`);
    await browser.close();
    // Playwright's close() on a connected session only disconnects: the session must still be alive here.
    const aliveAfterDisconnect = await sessionAlive(env.BROWSER, sessionId);
    return {
      uploadFromBytes: uploadedHash === expectedUploadHash,
      uploadedHash,
      expectedUploadHash,
      aliveAfterDisconnect,
      downloadGetLink: certificate === PROOF_CERTIFICATE,
      downloadFormPost: postCertificate === PROOF_CERTIFICATE,
      downloadGetLinkDetail: certificate.startsWith('ERROR:') ? certificate : `bytes:${certificate.length}`,
      downloadFormPostDetail: postCertificate.startsWith('ERROR:') ? postCertificate : `bytes:${postCertificate.length}`,
      strategies,
      downloadedHash: await sha256Hex(certificate),
      expectedDownloadHash: await sha256Hex(PROOF_CERTIFICATE),
      session: await closeSessionForReal(env.BROWSER, sessionId),
    };
  } catch (error) {
    return { error: String(error).slice(0, 300), session: await closeSessionForReal(env.BROWSER, sessionId) };
  }
}

async function proveArcaReachability(env: ExecutorEnv) {
  const sessionId = await openSession(env.BROWSER, arcaGuardrailPolicy(env.ARCA_ENVIRONMENT, env.ARCA_GUARDRAIL_DOMAIN_SETS));
  try {
    const browser = await connect(env.BROWSER, sessionId);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const response = await page.goto('https://auth.afip.gob.ar/contribuyente_/login.xhtml', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 5_000);
    const result = {
      status: response?.status() ?? null,
      finalHost: new URL(page.url()).hostname,
      title: (await page.title()).slice(0, 120),
      loginFormPresent: (await page.locator('input[type="password"], input[name*="password" i], input[id*="F1:password" i]').count()) > 0
        || /clave fiscal/i.test(text),
      cuitFieldPresent: (await page.locator('input[id*="username" i], input[name*="username" i]').count()) > 0 || /cuit|cuil/i.test(text),
      blockedSignals: /captcha|acceso denegado|request blocked|attention required/i.test(text),
    };
    await browser.close();
    return { ...result, session: await closeSessionForReal(env.BROWSER, sessionId) };
  } catch (error) {
    return { error: String(error).slice(0, 300), session: await closeSessionForReal(env.BROWSER, sessionId) };
  }
}

const UPLOAD_PAGE = `<!doctype html><html lang="es"><meta charset="utf-8"><title>BUFI proof</title>
<body>
<label>CSR <input type="file" accept=".csr"></label>
<p id="digest"></p>
<a href="/proof/fixtures/certificate.crt">Descargar</a>
<form method="post" action="/proof/fixtures/certificate-post"><button type="submit">Obtener certificado</button></form>
<script>
document.querySelector('input').addEventListener('change', async event => {
  const file = event.target.files[0];
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  document.getElementById('digest').textContent = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
});
</script></body></html>`;

/** Measure each retrieval path on its own so the chosen one is evidence, not assumption. */
async function downloadStrategies(page: Page, link: Locator) {
  const expected = await sha256Hex(PROOF_CERTIFICATE);
  const out: Record<string, unknown> = {};
  try {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 15_000 }), link.click()]);
    out.downloadEvent = true;
    out.suggestedFilename = download.suggestedFilename();
    out.failure = await download.failure().catch(error => String(error).slice(0, 120));
    try {
      const stream = await download.createReadStream();
      const chunks: Uint8Array[] = [];
      await new Promise<void>((resolve, reject) => {
        (stream as unknown as NodeJS.ReadableStream).on('data', (chunk: Uint8Array) => chunks.push(chunk));
        (stream as unknown as NodeJS.ReadableStream).on('end', () => resolve());
        (stream as unknown as NodeJS.ReadableStream).on('error', reject);
      });
      const text = new TextDecoder().decode(Uint8Array.from(chunks.flatMap(chunk => [...chunk])));
      out.streamEvents = (await sha256Hex(text)) === expected;
      out.streamEventsBytes = text.length;
    } catch (error) {
      out.streamEventsError = String(error).slice(0, 160);
    }
  } catch (error) {
    out.downloadEventError = String(error).slice(0, 160);
  }
  try {
    const href = await link.getAttribute('href');
    const text = await page.evaluate(async target => {
      const response = await fetch(target!, { credentials: 'include' });
      return response.text();
    }, href);
    out.inPageAuthenticatedFetch = (await sha256Hex(text)) === expected;
  } catch (error) {
    out.inPageAuthenticatedFetchError = String(error).slice(0, 160);
  }
  try {
    const href = await link.getAttribute('href');
    const response = await page.context().request.get(new URL(href!, page.url()).toString());
    const text = new TextDecoder().decode(await response.body());
    out.contextRequest = (await sha256Hex(text)) === expected;
  } catch (error) {
    out.contextRequestError = String(error).slice(0, 160);
  }
  return out;
}

/**
 * Structured handoff in a real session: subscribe, request, observe the state,
 * then let it time out so the completion event is observed without a human.
 * The Live View link is checked for shape and discarded, never returned.
 */
async function proveHandoff(env: ExecutorEnv, base: URL) {
  const sessionId = await openSession(env.BROWSER, { allowedDomains: [base.hostname] });
  try {
    const browser = await connect(env.BROWSER, sessionId);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(new URL('/proof/fixtures/upload', base).toString());
    const link = await liveViewUrl(page, 60_000);
    const liveView = new URL(link);
    const { handoffId, completion } = await requestHandoff(page, 'Proof: no action needed.', 10_000);
    const activeDuring = await handoffActive(page);
    const event = await waitForHandoff(completion, 30_000);
    const activeAfter = await handoffActive(page);
    await browser.close();
    return {
      liveViewHost: liveView.hostname,
      liveViewModeTab: liveView.searchParams.get('mode') === 'tab' || link.includes('mode=tab'),
      handoffIdIssued: typeof handoffId === 'string' && handoffId.length > 0,
      activeDuring,
      completionObserved: event !== 'still_waiting',
      completionSuccess: event === 'still_waiting' ? null : event.success,
      completionReason: event === 'still_waiting' ? null : (event.reason ?? null),
      activeAfter,
      session: await closeSessionForReal(env.BROWSER, sessionId),
    };
  } catch (error) {
    return { error: String(error).slice(0, 300), session: await closeSessionForReal(env.BROWSER, sessionId) };
  }
}

/**
 * Guardrails in a real session: the allowed host loads; a host outside the
 * allowlist answers Cloudflare's 403 with `cf-mitigated: guardrails`, both for
 * a navigation and for a page-initiated fetch.
 */
async function proveGuardrails(env: ExecutorEnv, base: URL) {
  const sessionId = await openSession(env.BROWSER, { allowedDomains: [base.hostname] });
  try {
    const browser = await connect(env.BROWSER, sessionId);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const allowed = await page.goto(new URL('/proof/fixtures/upload', base).toString());
    const blocked = await page.goto('https://example.org/', { timeout: 15_000 }).catch(() => null);
    const blockedHeaders = blocked?.headers() ?? {};
    await page.goto(new URL('/proof/fixtures/upload', base).toString());
    const fetchStatus = await page.evaluate(async () => {
      try {
        return (await fetch('https://example.org/', { mode: 'no-cors' })).type;
      } catch {
        return 'blocked';
      }
    });
    await browser.close();
    return {
      allowedStatus: allowed?.status() ?? null,
      blockedNavigation: blocked ? blockedByGuardrails(blocked.status(), blockedHeaders) : null,
      blockedReason: blockedHeaders['cf-brapi-guardrails-reason'] ?? null,
      pageFetchOutsideAllowlist: fetchStatus,
      session: await closeSessionForReal(env.BROWSER, sessionId),
    };
  } catch (error) {
    return { error: String(error).slice(0, 300), session: await closeSessionForReal(env.BROWSER, sessionId) };
  }
}

/**
 * The job player's preview: a readonly Live View for one target, and whether
 * Cloudflare's hosted viewer may be framed by BUFI. The link itself is never
 * returned, only the facts about it.
 */
async function proveReadonlyLiveView(env: ExecutorEnv, base: URL) {
  if (!env.CF_ACCOUNT_ID || !env.CF_LIVE_VIEW_API_TOKEN) return { skipped: 'CF_LIVE_VIEW_CREDENTIALS_MISSING' };
  const sessionId = await openSession(env.BROWSER, { allowedDomains: [base.hostname] });
  try {
    const browser = await connect(env.BROWSER, sessionId);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(new URL('/proof/fixtures/upload', base).toString());
    const url = await readonlyLiveViewUrl({ accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_LIVE_VIEW_API_TOKEN }, sessionId, await targetIdOf(page));
    const viewer = await fetch(url, { redirect: 'manual' });
    const csp = viewer.headers.get('content-security-policy') ?? '';
    await browser.close();
    return {
      host: new URL(url).hostname,
      viewerStatus: viewer.status,
      xFrameOptions: viewer.headers.get('x-frame-options'),
      frameAncestors: /frame-ancestors[^;]*/.exec(csp)?.[0] ?? null,
      session: await closeSessionForReal(env.BROWSER, sessionId),
    };
  } catch (error) {
    return { error: String(error).slice(0, 300), session: await closeSessionForReal(env.BROWSER, sessionId) };
  }
}

/**
 * Does ARCA expose WebMCP tools? A Lab session (experimental Chrome, never a
 * customer session) opens the public login page and lists page tools through
 * the CDP `WebMCP` domain. Zero tools means the portal keeps being driven by
 * the Playwright locators; the result is evidence, not an assumption.
 */
async function proveArcaWebMcp(env: ExecutorEnv) {
  const sessionId = await openSession(env.BROWSER, arcaGuardrailPolicy(env.ARCA_ENVIRONMENT, env.ARCA_GUARDRAIL_DOMAIN_SETS), { lab: true })
    .catch(error => { throw new Error(`LAB_SESSION_UNAVAILABLE:${String(error).slice(0, 120)}`); });
  try {
    const browser = await connect(env.BROWSER, sessionId);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    const cdp = await page.context().newCDPSession(page);
    const tools: string[] = [];
    cdp.on('WebMCP.toolsAdded' as never, ((event: { tools?: Array<{ name?: string }> }) => {
      for (const tool of event.tools ?? []) if (typeof tool.name === 'string') tools.push(tool.name.slice(0, 80));
    }) as never);
    const enabled = await cdp.send('WebMCP.enable' as never).then(() => true, () => false);
    await page.goto('https://auth.afip.gob.ar/contribuyente_/login.xhtml', { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise(resolve => setTimeout(resolve, 5_000));
    const pageSide = await page.evaluate(async () => {
      const context = (document as unknown as { modelContext?: { getTools?: () => Promise<Array<{ name: string }>> } }).modelContext;
      return context?.getTools ? (await context.getTools()).map(tool => tool.name).slice(0, 50) : null;
    }).catch(() => null);
    await browser.close();
    return { webmcpDomainEnabled: enabled, cdpTools: tools, pageTools: pageSide, session: await closeSessionForReal(env.BROWSER, sessionId) };
  } catch (error) {
    return { error: String(error).slice(0, 300), session: await closeSessionForReal(env.BROWSER, sessionId) };
  }
}
