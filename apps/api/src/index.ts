import { createTaxApi, taxApiDatabasePath } from './app';

const port = Number(process.env.PORT ?? 4100);
const api = createTaxApi({
  env: process.env,
  openDatabase: name => taxApiDatabasePath(name, process.env),
});

export const server = Bun.serve({
  hostname: process.env.TAX_ENGINE_HOST ?? '127.0.0.1',
  port,
  fetch: request => api.fetch(request),
});

if (import.meta.main) {
  console.info(`Tax Automation Engine API listening on http://localhost:${server.port}`);
  console.info(`Execution mode: ${api.executionMode}; tax payments remain disabled`);
}

for (const [loop, startNow] of [
  [api.loops.facturaEFeatures, true],
  [api.loops.taxDomainEvents, true],
  [api.loops.arcaSetup, false],
] as const) {
  if (!loop) continue;
  const timer = setInterval(() => void loop.run(), loop.intervalMs);
  timer.unref();
  if (startNow) void loop.run();
}
