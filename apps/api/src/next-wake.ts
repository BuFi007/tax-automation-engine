/**
 * When the Tax API's background loops next have work, for the Durable Object's
 * work-driven alarm. `null` means no loop has work, so the DO sets no alarm.
 */
export type TaxApiWakeSources = Readonly<{
  facturaE: Readonly<{
    /** TAX_FACTURA_E_FEATURE_PUBLICATION_ENABLED: off means no Factura E wake, whatever the store holds. */
    enabled: boolean;
    pollIntervalMs: number;
    store: Readonly<{
      projectionCandidates(limit: number): readonly string[];
      nextFeatureOutboxDueAt(): string | null;
    }>;
  }> | null;
  taxDomain: Readonly<{
    pollIntervalMs: number;
    outboxes: readonly Readonly<{ nextTaxDomainEventDueAt(): string | null }>[];
  }> | null;
  arcaSetup: Readonly<{ intervalMs: number; hasWork(): boolean }> | null;
}>;

export function computeNextWakeAt(now: number, sources: TaxApiWakeSources): number | null {
  const due: number[] = [];
  const { facturaE, taxDomain, arcaSetup } = sources;
  if (facturaE?.enabled) {
    // An active consent or head is only re-checked by projecting it, so it wakes every poll.
    if (facturaE.store.projectionCandidates(1).length > 0) due.push(now + facturaE.pollIntervalMs);
    const outboxDue = facturaE.store.nextFeatureOutboxDueAt();
    if (outboxDue !== null) due.push(flooredAt(outboxDue, now, facturaE.pollIntervalMs));
  }
  if (taxDomain) {
    for (const outbox of taxDomain.outboxes) {
      const leasedUntil = outbox.nextTaxDomainEventDueAt();
      if (leasedUntil !== null) due.push(flooredAt(leasedUntil, now, taxDomain.pollIntervalMs));
    }
  }
  if (arcaSetup?.hasWork()) due.push(now + arcaSetup.intervalMs);
  return due.length > 0 ? Math.min(...due) : null;
}

/** The row's due time, but never sooner than one poll, so a failing publisher cannot spin the alarm. */
function flooredAt(dueAt: string, now: number, pollIntervalMs: number): number {
  const at = Date.parse(dueAt);
  return Math.max(Number.isFinite(at) ? at : now, now + pollIntervalMs);
}
