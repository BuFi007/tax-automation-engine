/**
 * Cloudflare Worker entry for the Factura C (WSFE) signer. Every request runs inside one
 * SQLite-backed Durable Object (`WsfeSignerState`). The Worker has no public
 * surface: the Tax API reaches it through a Service Binding, and it reaches the
 * boundary through the `ARCA_BOUNDARY` binding to the boundary's
 * SignerEntrypoint. No background loop, so no alarm. The Bun entry is `index.ts`.
 */
import { DurableObject } from 'cloudflare:workers';

import { DurableObjectSqlDatabase } from '@tax-engine/sql-store/durable-object';

import { createWsfeSigner, type Signer } from './app';

export type SignerWorkerEnv = Readonly<{
  SIGNER_STATE: DurableObjectNamespace<WsfeSignerState>;
  ARCA_BOUNDARY: Fetcher;
}> & Readonly<Record<string, unknown>>;

export class WsfeSignerState extends DurableObject<SignerWorkerEnv> {
  #signer: Signer | null = null;

  override fetch(request: Request): Promise<Response> {
    this.#signer ??= createWsfeSigner({
      env: Object.fromEntries(
        Object.entries(this.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ),
      database: new DurableObjectSqlDatabase(this.ctx.storage),
      boundaryFetcher: this.env.ARCA_BOUNDARY,
    });
    return this.#signer.fetch(request);
  }
}

export default {
  fetch(request: Request, env: SignerWorkerEnv): Promise<Response> {
    return env.SIGNER_STATE.get(env.SIGNER_STATE.idFromName('primary')).fetch(request);
  },
} satisfies ExportedHandler<SignerWorkerEnv>;
