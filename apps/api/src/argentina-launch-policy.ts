import { readFileSync, statSync } from 'node:fs';

import {
  argentinaLaunchPolicyReadiness,
  type ArgentinaLaunchPolicyReadinessV1,
} from '@tax-engine/core';

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

const MAX_POLICY_BYTES = 64 * 1024;

export function resolveArgentinaLaunchPolicyReadiness(
  environment: EnvironmentSource = process.env,
  now = new Date(),
): ArgentinaLaunchPolicyReadinessV1 {
  const path = environment.TAX_ENGINE_ARGENTINA_LAUNCH_POLICY_PATH;
  if (!path) return argentinaLaunchPolicyReadiness(null, now);
  let value: unknown;
  try {
    if (statSync(path).size > MAX_POLICY_BYTES) {
      throw new Error('ARGENTINA_LAUNCH_POLICY_TOO_LARGE');
    }
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message === 'ARGENTINA_LAUNCH_POLICY_TOO_LARGE') throw error;
    throw new Error('ARGENTINA_LAUNCH_POLICY_CONFIGURATION_REQUIRED');
  }
  return argentinaLaunchPolicyReadiness(value, now);
}

export function assertNoTaxEngineFundingAuthority(
  environment: EnvironmentSource = process.env,
): void {
  if (environment.TAX_ENGINE_INVOICE_ADVANCE_REMOTE_EFFECTS_ENABLED === 'true') {
    throw new Error('TAX_ENGINE_FUNDING_AUTHORITY_FORBIDDEN');
  }
}
