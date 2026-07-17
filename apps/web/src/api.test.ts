import { describe, expect, test } from 'bun:test';

import { argentinaTaxWidgetSnapshotReceiptV1Fixture } from '@tax-engine/browser-contracts/fixtures';

import { loadTaxSnapshot, TaxSnapshotReadError } from './api';

const authority = {
  workspaceId: argentinaTaxWidgetSnapshotReceiptV1Fixture.snapshot.workspaceId,
  projectionKey: argentinaTaxWidgetSnapshotReceiptV1Fixture.projectionKey,
  principal: 'short-lived-principal',
  signature: 'a'.repeat(64),
} as const;

describe('durable Tax browser client', () => {
  test('reads and validates the canonical browser receipt with scoped no-store authority', async () => {
    const captured: Array<{ url: string; init: RequestInit | undefined }> = [];
    const receipt = await loadTaxSnapshot(authority, 'https://tax.example', async (input, init) => {
      captured.push({ url: String(input), init });
      return Response.json({ ok: true, data: argentinaTaxWidgetSnapshotReceiptV1Fixture });
    });

    expect(receipt).toEqual(argentinaTaxWidgetSnapshotReceiptV1Fixture);
    expect(captured[0]!.url).toBe(`https://tax.example/v1/browser/snapshots/${encodeURIComponent(authority.workspaceId)}/${encodeURIComponent(authority.projectionKey)}`);
    expect(captured[0]!.init?.cache).toBe('no-store');
    expect(new Headers(captured[0]!.init?.headers).get('x-tax-tenant-principal')).toBe(authority.principal);
    expect(new Headers(captured[0]!.init?.headers).get('x-tax-tenant-signature')).toBe(authority.signature);
  });

  test('surfaces safe durable-state problems and never falls back to a fixture', async () => {
    await expect(loadTaxSnapshot(authority, 'https://tax.example', async () => Response.json({
      ok: false,
      problem: {
        version: 'tax-browser-problem-v1',
        code: 'TAX_SNAPSHOT_STALE',
        status: 409,
        state: 'syncing',
        retryable: true,
        traceRef: 'trace:snapshot-stale',
      },
    }, { status: 409 }))).rejects.toEqual(new TaxSnapshotReadError('TAX_SNAPSHOT_STALE', 'syncing', true));
  });

  test('rejects a valid receipt replayed across workspace or projection scope', async () => {
    await expect(loadTaxSnapshot({ ...authority, workspaceId: 'workspace:other' }, 'https://tax.example', async () => (
      Response.json({ ok: true, data: argentinaTaxWidgetSnapshotReceiptV1Fixture })
    ))).rejects.toThrow('TAX_SNAPSHOT_WORKSPACE_MISMATCH');

    await expect(loadTaxSnapshot({ ...authority, projectionKey: 'annual:2027' }, 'https://tax.example', async () => (
      Response.json({ ok: true, data: argentinaTaxWidgetSnapshotReceiptV1Fixture })
    ))).rejects.toThrow('TAX_SNAPSHOT_PROJECTION_MISMATCH');
  });

  test('masks an invalid or unauthorized response body behind a stable browser error', async () => {
    await expect(loadTaxSnapshot(authority, 'https://tax.example', async () => (
      Response.json({ error: 'internal provider details' }, { status: 401 })
    ))).rejects.toThrow('TAX_SNAPSHOT_RESPONSE_INVALID');
  });
});
