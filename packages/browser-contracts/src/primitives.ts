import { z } from 'zod';

export const EXACT_DECIMAL_RE = /^-?(?:0|[1-9]\d{0,59})(?:\.\d{1,30})?$/;
export const exactDecimalSchema = z.string().regex(EXACT_DECIMAL_RE);
export const nonNegativeExactDecimalSchema = exactDecimalSchema.refine(value => !value.startsWith('-'), {
  message: 'Expected a non-negative exact decimal string',
});
export const currencySchema = z.string().regex(/^[A-Z][A-Z0-9]{2,11}$/);
export const exactMoneySchema = z.object({
  decimal: exactDecimalSchema,
  currency: currencySchema,
}).strict();

export const isoDateSchema = z.iso.date();
export const isoDateTimeSchema = z.iso.datetime({ offset: true });
export const periodSchema = z.object({
  start: isoDateSchema,
  end: isoDateSchema,
}).strict().refine(period => period.start <= period.end, {
  message: 'Period start must not follow period end',
});

export const safeReferenceSchema = z.string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:._-]*$/);

/**
 * Cache and evidence identities are purpose/workspace-scoped opaque tokens,
 * not bare document or authority hashes that can be correlated globally.
 */
export const opaqueRevisionSchema = z.string()
  .min(20)
  .max(180)
  .regex(/^[a-z][a-z0-9_]{1,31}:[A-Za-z0-9_-]{16,147}$/);

export const projectionKeySchema = z.string().regex(/^[a-z0-9][a-z0-9._:-]{0,127}$/);

export type ExactMoneyV1 = z.infer<typeof exactMoneySchema>;
