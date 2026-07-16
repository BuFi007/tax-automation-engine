import {
  taxSnapshotReadResultV1Schema,
  type TaxWidgetSnapshotReceiptV1,
} from '@tax-engine/browser-contracts';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4100';

export type TaxSnapshotBrowserAuthority = Readonly<{
  workspaceId: string;
  principal: string;
  signature: string;
  projectionKey?: string;
}>;

type BrowserFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Read only the durable browser projection. There is intentionally no fixture fallback. */
export async function loadTaxSnapshot(
  authority: TaxSnapshotBrowserAuthority,
  apiUrl = API_URL,
  request: BrowserFetch = fetch,
): Promise<TaxWidgetSnapshotReceiptV1> {
  const projectionKey = authority.projectionKey ?? 'default';
  const response = await request(
    `${apiUrl}/v1/browser/snapshots/${encodeURIComponent(authority.workspaceId)}/${encodeURIComponent(projectionKey)}`,
    {
      method: 'GET',
      headers: {
        'x-tax-tenant-principal': authority.principal,
        'x-tax-tenant-signature': authority.signature,
      },
      cache: 'no-store',
    },
  );
  const parsed = taxSnapshotReadResultV1Schema.safeParse(await response.json());
  if (!parsed.success) throw new Error('TAX_SNAPSHOT_RESPONSE_INVALID');
  const result = parsed.data;
  if (!result.ok) throw new TaxSnapshotReadError(result.problem.code, result.problem.state, result.problem.retryable);
  if (!response.ok) throw new Error(`TAX_SNAPSHOT_HTTP_STATUS_MISMATCH_${response.status}`);
  if (result.data.snapshot.workspaceId !== authority.workspaceId) throw new Error('TAX_SNAPSHOT_WORKSPACE_MISMATCH');
  if (result.data.projectionKey !== projectionKey) throw new Error('TAX_SNAPSHOT_PROJECTION_MISMATCH');
  return result.data;
}

export class TaxSnapshotReadError extends Error {
  constructor(
    readonly code: string,
    readonly state: 'setup_required' | 'syncing' | 'refresh_required',
    readonly retryable: boolean,
  ) {
    super(code);
  }
}
