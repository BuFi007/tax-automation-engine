import type { JurisdictionCode, TaxWidgetSnapshotV1 } from '@tax-engine/core';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4100';

export async function loadDemoSnapshot(jurisdiction: JurisdictionCode): Promise<TaxWidgetSnapshotV1> {
  const response = await fetch(`${API_URL}/v1/snapshots/demo?jurisdiction=${jurisdiction}`);
  if (!response.ok) throw new Error(`Snapshot request failed (${response.status})`);
  const payload = (await response.json()) as { data: TaxWidgetSnapshotV1 };
  return payload.data;
}
