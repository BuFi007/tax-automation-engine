import { HttpBoundaryExecutorClient } from './boundary-client';
import { refuseRedirect } from './http';

/**
 * The executor reaches the boundary (its `ExecutorEntrypoint`) and the Tax API
 * only through service bindings. The URL vars are synthetic: they only shape the
 * request URL the bound Worker routes on, and are never resolved.
 */
export interface ServiceBindingEnv {
  ARCA_BOUNDARY: Fetcher;
  TAX: Fetcher;
  ARCA_BOUNDARY_URL: string;
  TAX_RECEIPT_URL: string;
  ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN: string;
}

export function requireServiceBindings(env: Partial<Pick<ServiceBindingEnv, 'ARCA_BOUNDARY' | 'TAX'>>): void {
  if (typeof env.ARCA_BOUNDARY?.fetch !== 'function' || typeof env.TAX?.fetch !== 'function')
    throw new Error('ARCA_SETUP_EXECUTOR_CONFIGURATION_REQUIRED');
}

export function boundaryExecutorClient(env: ServiceBindingEnv): HttpBoundaryExecutorClient {
  return new HttpBoundaryExecutorClient(env.ARCA_BOUNDARY_URL, env.ARCA_BOUNDARY_SETUP_EXECUTOR_TOKEN, (input, init) => env.ARCA_BOUNDARY.fetch(input, init));
}

export async function postReceipt(env: ServiceBindingEnv, init: RequestInit): Promise<Response> {
  return refuseRedirect(await env.TAX.fetch(env.TAX_RECEIPT_URL, { ...init, redirect: 'manual' }));
}
