import { readFileSync } from 'node:fs';

import { createBoundary } from './app';

const port = Number(process.env.PORT ?? 4300);
const hostname = process.env.ARCA_BOUNDARY_HOST ?? '127.0.0.1';
const boundary = createBoundary({
  env: withKeyFilesRead(process.env),
  database: process.env.ARCA_BOUNDARY_DB_PATH ?? ':memory:',
  // Read only when setup is enabled, as before.
  ...(process.env.ARCA_BOUNDARY_SETUP_TOKEN && process.env.ARCA_SETUP_TRUSTED_ISSUERS_FILE
    ? { trustedIssuersPem: readFileSync(process.env.ARCA_SETUP_TRUSTED_ISSUERS_FILE, 'utf8') }
    : {}),
});

export const server = Bun.serve({
  hostname,
  port,
  fetch: boundary.fetch,
});

/** Bun keeps the `*_FILE` key forms: each file replaces its base64 variable, as `crypto.ts` reads it. */
function withKeyFilesRead(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const resolved: Record<string, string | undefined> = { ...env };
  for (const name of ['ARCA_BOUNDARY_MASTER_KEY', 'ARCA_BOUNDARY_CUIT_COMMITMENT_KEY', 'ARCA_BOUNDARY_TAXPAYER_REFERENCE_KEY']) {
    const file = env[`${name}_FILE`];
    if (file) resolved[name] = readFileSync(file, 'utf8').trim();
  }
  return resolved;
}

if (import.meta.main) console.info(`ARCA authority boundary listening on ${hostname}:${server.port}; environment=${boundary.environment}; secrets remain encrypted and outside agent context`);
