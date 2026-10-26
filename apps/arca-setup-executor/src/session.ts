import { DurableObject } from 'cloudflare:workers';

import {
  arcaSetupOrderSchema,
  sha256Hex,
  signArcaSetupMessage,
  verifyArcaSetupHandoffTicket,
  type ArcaSetupWireOrder,
  type ArcaSetupWireReceipt,
} from '@tax-engine/arca-setup-contract';

import { DEFAULT_ARCA_PORTAL_URLS, PlaywrightArcaPortal, type ArcaPortalUrls } from './arca-portal';
import { HttpBoundaryExecutorClient } from './boundary-client';
import {
  closeSessionForReal,
  handoffActive,
  liveViewUrl,
  openSession,
  requestHandoff,
  sessionAlive,
  waitForHandoff,
  withSessionPage,
} from './browser';
import type { ExecutorEnv } from './env';
import { runArcaSetupOperation, type ReceiptDraft } from './operations';

type Role = 'customer' | 'provider';
type Current = {
  order: ArcaSetupWireOrder;
  state: 'queued' | 'awaiting_handoff' | 'done';
  handoff: { role: Role; reason: 'authentication' | 'choice'; requestedAt: string } | null;
  sentHandoffReceipt: boolean;
};
type Meta = { executionId: string | null; seenOrders: string[]; doneAt: number | null };
type OutboxEntry = { receipt: ArcaSetupWireReceipt; attempts: number; nextAt: number };

/** Alarms run at most ~15 minutes; leave room to persist and reschedule. */
const MAX_WAIT_IN_ALARM_MS = 12 * 60_000;
const IDLE_CLOSE_MS = 20 * 60_000;

const INSTRUCTIONS: Record<Role, Record<'authentication' | 'choice', string>> = {
  customer: {
    authentication: 'Ingresá a ARCA con tu CUIT y Clave Fiscal. BUFI no ve lo que escribís. Cuando entres, tocá "Done".',
    choice: 'Elegí el domicilio del punto de venta y tocá "Aceptar" en ARCA. Después tocá "Done": BUFI confirma el alta.',
  },
  provider: {
    authentication: 'Operador BUFI: ingresá a ARCA con la Clave Fiscal de BUFI y tocá "Done" para aceptar las delegaciones.',
    choice: 'Operador BUFI: completá la elección en ARCA y tocá "Done".',
  },
};

/**
 * One Durable Object per execution. It owns the remote browser sessions
 * (the customer's and, for provider acceptance, BUFI's), runs one order at a
 * time, pauses for human handoffs, and delivers signed receipts at least once.
 *
 * Storage is split per key and every write is a small transaction, so a
 * cancellation, a redeemed ticket or a new order arriving while an alarm is
 * mid-flight is never overwritten by the alarm's view of the world.
 */
export class ArcaSetupSession extends DurableObject<ExecutorEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/order') return this.acceptOrder(await request.json());
    if (request.method === 'POST' && url.pathname === '/cancel') return this.cancel(await request.json() as { executionId: string });
    if (request.method === 'GET' && url.pathname === '/handoff') return this.openHandoff(url.searchParams.get('ticket') ?? '');
    return Response.json({ error: 'NOT_FOUND' }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.flushOutbox();
    if (!(await this.cancelled())) {
      const current = await this.current();
      if (current && current.state !== 'done') {
        try {
          await this.execute(current);
        } catch (error) {
          // Unknown effect: never assume success. The tax engine re-inspects first.
          await this.finish(current.order, await receiptDraft('uncertain', codeOf(error, 'ARCA_SETUP_EXECUTOR_ERROR')));
        }
      } else {
        const meta = await this.meta();
        if (meta.doneAt && Date.now() - meta.doneAt > IDLE_CLOSE_MS) await this.closeAll();
      }
    }
    await this.flushOutbox();
    await this.scheduleNext();
  }

  private async acceptOrder(raw: unknown): Promise<Response> {
    const order = arcaSetupOrderSchema.parse(raw);
    if (order.environment !== this.env.ARCA_ENVIRONMENT) return Response.json({ error: 'ARCA_SETUP_ENVIRONMENT_MISMATCH' }, { status: 409 });
    if (Date.parse(order.expiresAt) <= Date.now()) return Response.json({ error: 'ARCA_SETUP_ORDER_EXPIRED' }, { status: 409 });
    const outcome = await this.ctx.storage.transaction(async txn => {
      if (await txn.get<boolean>('cancelled')) return { status: 409, body: { error: 'ARCA_SETUP_CANCELLED' } };
      const meta = (await txn.get<Meta>('meta')) ?? { executionId: null, seenOrders: [], doneAt: null };
      if (meta.executionId && meta.executionId !== order.executionId) return { status: 409, body: { error: 'ARCA_SETUP_EXECUTION_MISMATCH' } };
      if (meta.seenOrders.includes(order.orderId)) return { status: 202, body: { accepted: true, duplicate: true } };
      const current = await txn.get<Current>('current');
      if (current && current.state !== 'done') return { status: 409, body: { error: 'ARCA_SETUP_ORDER_IN_PROGRESS' } };
      await txn.put('current', { order, state: 'queued', handoff: null, sentHandoffReceipt: false } satisfies Current);
      await txn.put('meta', { executionId: order.executionId, seenOrders: [...meta.seenOrders, order.orderId].slice(-200), doneAt: null } satisfies Meta);
      return { status: 202, body: { accepted: true, duplicate: false } };
    });
    if (outcome.status === 202 && !('duplicate' in outcome.body && outcome.body.duplicate)) await this.ctx.storage.setAlarm(Date.now());
    return Response.json(outcome.body, { status: outcome.status });
  }

  private async execute(current: Current): Promise<void> {
    const { order } = current;
    if (Date.parse(order.expiresAt) <= Date.now()) {
      await this.finish(order, await receiptDraft('blocked', 'ARCA_SETUP_ORDER_EXPIRED'));
      return;
    }
    if (order.operation === 'close_session') {
      await this.closeAll();
      await this.finish(order, await receiptDraft('completed', null, { closed: true }));
      return;
    }
    const role: Role = order.operation === 'provider_accept' ? 'provider' : 'customer';
    const needsLogin = order.operation === 'authenticate' || order.operation === 'provider_accept';
    let sessionId = (await this.sessions())[role];
    if (sessionId && !(await sessionAlive(this.env.BROWSER, sessionId))) {
      await this.setSession(role, null);
      sessionId = undefined;
    }
    if (!sessionId) {
      if (!needsLogin) {
        await this.finish(order, await receiptDraft('blocked', 'BROWSER_SESSION_GONE'));
        return;
      }
      sessionId = await openSession(this.env.BROWSER);
      await this.setSession(role, sessionId);
    }

    const outcome = await withSessionPage(this.env.BROWSER, sessionId, async page => {
      const portal = new PlaywrightArcaPortal(page, this.env.ARCA_ENVIRONMENT, this.portalUrls());

      // A human step is open: wait for it without reading the page.
      if (current.state === 'awaiting_handoff' && current.handoff) {
        if (await handoffActive(page)) {
          const deadline = Date.now() + MAX_WAIT_IN_ALARM_MS;
          while (Date.now() < deadline && await handoffActive(page)) {
            if (await this.cancelled()) return 'cancelled' as const;
            await new Promise(resolve => setTimeout(resolve, 3_000));
          }
          if (await handoffActive(page)) return 'still_waiting' as const;
        }
        await this.updateCurrent(order.orderId, value => ({ ...value, state: 'queued', handoff: null }));
      } else if (needsLogin && !(await portal.isAuthenticated())) {
        await portal.openLogin();
        return this.handoff(current, page, role, 'authentication');
      }

      if (await this.cancelled()) return 'cancelled' as const;
      const result = await runArcaSetupOperation(order, {
        portal,
        boundary: new HttpBoundaryExecutorClient(this.env.ARCA_BOUNDARY_URL, this.env.ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN),
        providerCuit: this.env.ARCA_PROVIDER_CUIT ?? null,
        providerAlias: this.env.ARCA_PROVIDER_ALIAS ?? null,
        now: () => new Date(),
      });
      if (result.outcome === 'handoff_required') return this.handoff(current, page, role, 'choice');
      return result;
    });

    if (outcome === 'still_waiting' || outcome === 'cancelled') return;
    await this.finish(order, outcome);
  }

  /**
   * Hand the tab to a human. Subscribes to completion before requesting the
   * handoff; automation and page reads stop until Cloudflare reports it done.
   */
  private async handoff(
    current: Current,
    page: Parameters<typeof liveViewUrl>[0],
    role: Role,
    reason: 'authentication' | 'choice',
  ): Promise<'still_waiting' | ReceiptDraft> {
    const { completion } = await requestHandoff(page, INSTRUCTIONS[role][reason]);
    const updated = await this.updateCurrent(current.order.orderId, value => ({
      ...value,
      state: 'awaiting_handoff',
      handoff: { role, reason, requestedAt: new Date().toISOString() },
    }));
    if (updated && !updated.sentHandoffReceipt) {
      await this.updateCurrent(current.order.orderId, value => ({ ...value, sentHandoffReceipt: true }));
      await this.enqueue(current.order, await receiptDraft('handoff_required', null, { reason: `${role}_${reason}` }));
      await this.flushOutbox();
    }
    const result = await waitForHandoff(completion, MAX_WAIT_IN_ALARM_MS);
    if (result === 'still_waiting') return 'still_waiting';
    await this.updateCurrent(current.order.orderId, value => ({ ...value, state: 'queued', handoff: null }));
    if (!result.success) return receiptDraft('blocked', 'ARCA_AUTHENTICATION_NOT_COMPLETED');
    // Resume the same order on the next tick, starting from a fresh page read.
    await this.ctx.storage.setAlarm(Date.now());
    return 'still_waiting';
  }

  private async openHandoff(ticket: string): Promise<Response> {
    const headers = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
    const html = { ...headers, 'content-type': 'text/html; charset=utf-8' };
    let claims;
    try {
      claims = await verifyArcaSetupHandoffTicket(this.env.ARCA_SETUP_HANDOFF_SECRET, ticket);
    } catch {
      return new Response(page('Este enlace venció. Volvé a BUFI y abrí ARCA de nuevo.'), { status: 410, headers: html });
    }
    const role: Role = claims.purpose === 'provider_authentication' ? 'provider' : 'customer';
    const ticketKey = `ticket:${await sha256Hex(ticket)}`;
    const redeemable = await this.ctx.storage.transaction(async txn => {
      const meta = await txn.get<Meta>('meta');
      const current = await txn.get<Current>('current');
      if (
        meta?.executionId !== claims.executionId
        || await txn.get(ticketKey)
        || current?.state !== 'awaiting_handoff'
        || current.handoff?.role !== role
      ) return false;
      await txn.put(ticketKey, Date.now());
      return true;
    });
    if (!redeemable) return new Response(page('No hay un ingreso pendiente para este trámite. Volvé a BUFI.'), { status: 409, headers: html });
    const sessionId = (await this.sessions())[role];
    if (!sessionId) return new Response(page('La sesión segura terminó. Volvé a BUFI para empezar de nuevo.'), { status: 410, headers: html });
    const location = await withSessionPage(this.env.BROWSER, sessionId, livePage => liveViewUrl(livePage, 60_000));
    // The link leaves only toward the browser that presented the ticket, once.
    return new Response(null, { status: 302, headers: { ...headers, location } });
  }

  private async cancel(input: { executionId: string }): Promise<Response> {
    const meta = await this.meta();
    if (meta.executionId && meta.executionId !== input.executionId)
      return Response.json({ error: 'ARCA_SETUP_EXECUTION_MISMATCH' }, { status: 409 });
    await this.ctx.storage.put('cancelled', true);
    const closure = await this.closeAll();
    const current = await this.current();
    if (current) await this.updateCurrent(current.order.orderId, value => ({ ...value, state: 'done' }));
    return Response.json({ sessionClosed: closure.closed, sessionVerifiedGone: closure.verifiedGone });
  }

  private async closeAll(): Promise<{ closed: boolean; verifiedGone: boolean }> {
    let closed = true;
    let verifiedGone = true;
    const sessions = await this.sessions();
    for (const role of ['customer', 'provider'] as const) {
      const sessionId = sessions[role];
      if (!sessionId) continue;
      const result = await closeSessionForReal(this.env.BROWSER, sessionId);
      closed &&= result.closed;
      verifiedGone &&= result.verifiedGone;
      if (result.verifiedGone) await this.setSession(role, null);
    }
    await this.ctx.storage.transaction(async txn => {
      const meta = (await txn.get<Meta>('meta')) ?? { executionId: null, seenOrders: [], doneAt: null };
      await txn.put('meta', { ...meta, doneAt: null });
    });
    return { closed, verifiedGone };
  }

  private async finish(order: ArcaSetupWireOrder, draft: ReceiptDraft): Promise<void> {
    await this.enqueue(order, draft);
    await this.updateCurrent(order.orderId, value => ({ ...value, state: 'done' }));
    await this.ctx.storage.transaction(async txn => {
      const meta = (await txn.get<Meta>('meta')) ?? { executionId: null, seenOrders: [], doneAt: null };
      await txn.put('meta', { ...meta, doneAt: Date.now() });
    });
    // A failed run never leaves a browser session behind.
    if (draft.outcome === 'failed') await this.closeAll();
  }

  private async enqueue(order: ArcaSetupWireOrder, draft: ReceiptDraft): Promise<void> {
    const receipt: ArcaSetupWireReceipt = {
      version: 'arca-setup-receipt-v1',
      receiptId: `${order.orderId}:${draft.outcome}:${(await sha256Hex(draft.evidenceHash)).slice(0, 16)}`,
      orderId: order.orderId,
      executionId: order.executionId,
      onboardingId: order.onboardingId,
      workspaceId: order.workspaceId,
      operation: order.operation,
      expectedRevision: order.expectedRevision,
      ...draft,
    };
    await this.ctx.storage.transaction(async txn => {
      const outbox = (await txn.get<OutboxEntry[]>('outbox')) ?? [];
      if (!outbox.some(entry => entry.receipt.receiptId === receipt.receiptId))
        await txn.put('outbox', [...outbox, { receipt, attempts: 0, nextAt: Date.now() }]);
    });
  }

  private async flushOutbox(): Promise<void> {
    const outbox = (await this.ctx.storage.get<OutboxEntry[]>('outbox')) ?? [];
    const delivered = new Set<string>();
    const retries = new Map<string, OutboxEntry>();
    for (const entry of outbox) {
      if (entry.nextAt > Date.now()) continue;
      const body = JSON.stringify(entry.receipt);
      try {
        const response = await fetch(this.env.TAX_RECEIPT_URL, {
          method: 'POST',
          redirect: 'error',
          headers: { 'content-type': 'application/json', ...(await signArcaSetupMessage(this.env.ARCA_SETUP_RECEIPT_SECRET, 'receipt', body)) },
          body,
          signal: AbortSignal.timeout(15_000),
        });
        // 409/400 mean the tax engine already decided this receipt; stop resending.
        if (response.ok || response.status === 409 || response.status === 400) {
          delivered.add(entry.receipt.receiptId);
          continue;
        }
      } catch {
        // Retried below.
      }
      const attempts = entry.attempts + 1;
      if (attempts >= 50) delivered.add(entry.receipt.receiptId);
      else retries.set(entry.receipt.receiptId, { ...entry, attempts, nextAt: Date.now() + Math.min(60_000 * attempts, 15 * 60_000) });
    }
    if (delivered.size === 0 && retries.size === 0) return;
    await this.ctx.storage.transaction(async txn => {
      const latest = (await txn.get<OutboxEntry[]>('outbox')) ?? [];
      await txn.put('outbox', latest
        .filter(entry => !delivered.has(entry.receipt.receiptId))
        .map(entry => retries.get(entry.receipt.receiptId) ?? entry));
    });
  }

  private async scheduleNext(): Promise<void> {
    const candidates: number[] = [];
    const outbox = (await this.ctx.storage.get<OutboxEntry[]>('outbox')) ?? [];
    if (outbox.length > 0) candidates.push(Math.min(...outbox.map(entry => entry.nextAt)));
    const current = await this.current();
    if (current && current.state !== 'done' && !(await this.cancelled())) candidates.push(Date.now() + 1_000);
    const meta = await this.meta();
    if (meta.doneAt && Object.keys(await this.sessions()).length > 0) candidates.push(meta.doneAt + IDLE_CLOSE_MS + 1_000);
    if (candidates.length > 0) await this.ctx.storage.setAlarm(Math.max(Date.now(), Math.min(...candidates)));
  }

  private portalUrls(): ArcaPortalUrls {
    const base = DEFAULT_ARCA_PORTAL_URLS[this.env.ARCA_ENVIRONMENT];
    if (!this.env.ARCA_PORTAL_URLS_JSON) return base;
    const override = JSON.parse(this.env.ARCA_PORTAL_URLS_JSON) as Partial<ArcaPortalUrls>;
    for (const value of Object.values(override)) {
      const url = new URL(String(value));
      if (url.protocol !== 'https:' || !/(^|\.)(afip\.gob\.ar|afip\.gov\.ar|arca\.gob\.ar)$/.test(url.hostname))
        throw new Error('ARCA_PORTAL_URL_OVERRIDE_INVALID');
    }
    return { ...base, ...override };
  }

  private async current(): Promise<Current | null> {
    return (await this.ctx.storage.get<Current>('current')) ?? null;
  }

  private async updateCurrent(orderId: string, update: (value: Current) => Current): Promise<Current | null> {
    return this.ctx.storage.transaction(async txn => {
      const current = await txn.get<Current>('current');
      if (!current || current.order.orderId !== orderId) return null;
      const next = update(current);
      await txn.put('current', next);
      return next;
    });
  }

  private async meta(): Promise<Meta> {
    return (await this.ctx.storage.get<Meta>('meta')) ?? { executionId: null, seenOrders: [], doneAt: null };
  }

  private async sessions(): Promise<Partial<Record<Role, string>>> {
    return (await this.ctx.storage.get<Partial<Record<Role, string>>>('sessions')) ?? {};
  }

  private async setSession(role: Role, sessionId: string | null): Promise<void> {
    await this.ctx.storage.transaction(async txn => {
      const sessions = (await txn.get<Partial<Record<Role, string>>>('sessions')) ?? {};
      if (sessionId) sessions[role] = sessionId;
      else delete sessions[role];
      await txn.put('sessions', sessions);
    });
  }

  private async cancelled(): Promise<boolean> {
    return Boolean(await this.ctx.storage.get<boolean>('cancelled'));
  }
}

async function receiptDraft(outcome: ReceiptDraft['outcome'], code: string | null, result: ReceiptDraft['result'] = {}): Promise<ReceiptDraft> {
  const observedAt = new Date().toISOString();
  return { outcome, code, observedAt, evidenceHash: await sha256Hex(JSON.stringify({ outcome, code, result, observedAt })), inventory: null, result };
}

function codeOf(error: unknown, fallback: string): string {
  if (error instanceof Error && /^[A-Z0-9_]{3,120}$/.test(error.message)) return error.message;
  return fallback;
}

function page(message: string): string {
  const safe = message.replace(/[<>&"]/g, character => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[character]!);
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BUFI · ARCA</title><body style="font-family:system-ui;margin:2rem;color:#2f2462"><p>${safe}</p></body></html>`;
}
