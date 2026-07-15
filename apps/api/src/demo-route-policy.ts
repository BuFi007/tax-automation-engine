type EnvironmentSource = Readonly<Record<string, string | undefined>>;

/**
 * Fixture snapshots are a local-development aid only. They must never be a
 * fallback for a missing durable projection and cannot be enabled in a
 * production process.
 */
export function taxDemoRoutesEnabled(
  environment: EnvironmentSource = process.env
): boolean {
  return environment.NODE_ENV === 'development'
    && environment.TAX_ENGINE_DEMO_ROUTES_ENABLED === 'true';
}
