export const FACTURA_E_FEATURE_RENEWAL_WINDOW_MS = 15_000;
export const FACTURA_E_FEATURE_MAX_POLL_INTERVAL_MS = 10_000;
export const FACTURA_E_FEATURE_MIN_POLL_INTERVAL_MS = 1_000;

export function parseFacturaEFeaturePollInterval(
  raw: string | undefined
): number {
  const value = raw ?? '5000';
  if (!/^\d+$/.test(value))
    throw new Error('TAX_FACTURA_E_FEATURE_POLL_INTERVAL_INVALID');
  const interval = Number(value);
  if (
    !Number.isSafeInteger(interval)
    || interval < FACTURA_E_FEATURE_MIN_POLL_INTERVAL_MS
    || interval > FACTURA_E_FEATURE_MAX_POLL_INTERVAL_MS
    || interval >= FACTURA_E_FEATURE_RENEWAL_WINDOW_MS
  ) throw new Error('TAX_FACTURA_E_FEATURE_POLL_INTERVAL_INVALID');
  return interval;
}

export function facturaEFeatureRenewalCadenceReady(
  interval: number | null
): boolean {
  return interval !== null
    && Number.isSafeInteger(interval)
    && interval >= FACTURA_E_FEATURE_MIN_POLL_INTERVAL_MS
    && interval <= FACTURA_E_FEATURE_MAX_POLL_INTERVAL_MS
    && interval < FACTURA_E_FEATURE_RENEWAL_WINDOW_MS;
}
