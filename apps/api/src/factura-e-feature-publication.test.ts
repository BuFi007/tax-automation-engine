import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'bun:test';

import type { FacturaEFeatureSigningGateway } from '@tax-engine/core';

import {
  FacturaEFeaturePublicationStore,
  type PrivateFacturaEFeatureSource,
} from './factura-e-feature-publication';

const T0 = new Date('2026-07-15T12:00:00.000Z');
const T1 = new Date('2026-07-15T12:00:01.000Z');
const T2 = new Date('2026-07-15T12:00:02.000Z');
const T7 = new Date('2026-07-15T12:00:07.000Z');
const hash = (seed: string) => Bun.CryptoHasher.hash('sha256', seed, 'hex');

function structuredKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(structuredKeys);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, nested]) => [key.toLowerCase(), ...structuredKeys(nested)]);
}

function source(
  overrides: Partial<PrivateFacturaEFeatureSource> = {}
): PrivateFacturaEFeatureSource {
  return {
    executionId: 'execution-1',
    runId: 'run-1',
    workspaceId: 'workspace-1',
    authorityState: 'unverified',
    authorityIdentityHash: null,
    reconciliationEvidenceHash: null,
    settlementState: 'unobserved',
    invoiceState: 'current',
    hasAdjustment: false,
    sourceRevision: 'source-1',
    ...overrides,
  };
}

function signingGateway(
  onSign?: (digestHex: string) => void
): FacturaEFeatureSigningGateway {
  const { privateKey } = generateKeyPairSync('ed25519');
  return {
    keyVersion: 'tax-feature-key-2026-01',
    async signDigest(digestHex) {
      onSign?.(digestHex);
      return sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('base64url');
    },
  };
}

function fixture(options: Readonly<{
  initial?: PrivateFacturaEFeatureSource;
  signer?: FacturaEFeatureSigningGateway;
}> = {}) {
  let current = options.initial ?? source();
  const store = new FacturaEFeaturePublicationStore({
    readSource(executionId) {
      if (executionId !== current.executionId) throw new Error('SOURCE_NOT_FOUND');
      return current;
    },
    signer: options.signer ?? signingGateway(),
    commitmentSecret: 'test-purpose-secret-that-is-at-least-32-bytes-long',
    policyVersion: 'ar-factura-e-factoring-v1',
  });
  return {
    store,
    get current() {
      return current;
    },
    set current(value: PrivateFacturaEFeatureSource) {
      current = value;
    },
  };
}

function grant(
  store: FacturaEFeaturePublicationStore,
  overrides: Partial<Parameters<FacturaEFeaturePublicationStore['grantConsent']>[0]> = {}
) {
  return store.grantConsent({
    executionId: 'execution-1',
    workspaceId: 'workspace-1',
    consentVersion: 'factoring-consent-v1',
    actorId: 'user-1',
    idempotencyKey: 'grant-1',
    occurredAt: T0.toISOString(),
    expiresAt: '2026-07-15T13:00:00.000Z',
    ...overrides,
  });
}

function reconciled(revision = 'source-2'): PrivateFacturaEFeatureSource {
  return source({
    authorityState: 'officially_reconciled',
    authorityIdentityHash: hash('private-authority-identity'),
    reconciliationEvidenceHash: hash('private-reconciliation-evidence'),
    sourceRevision: revision,
  });
}

describe('Factura E feature publication', () => {
  test('does not publish accepted-but-unverified authority state', async () => {
    const f = fixture();
    try {
      grant(f.store);
      expect(await f.store.project('execution-1', T1)).toMatchObject({
        state: 'not_publishable',
        featureId: null,
        revision: null,
      });
      expect(f.store.claimOutbox({ limit: 10, leaseSeconds: 5, now: T1 })).toEqual([]);
    } finally {
      f.store.close();
    }
  });

  test('publishes one minimized active feature only after official reconciliation and consent', async () => {
    const f = fixture({ initial: reconciled() });
    try {
      expect(await f.store.project('execution-1', T1)).toMatchObject({
        state: 'not_publishable',
      });
      grant(f.store);
      const receipt = await f.store.project('execution-1', T1);
      expect(receipt).toMatchObject({ state: 'active', revision: 1, replayed: false });

      const [claimed] = f.store.claimOutbox({ limit: 10, leaseSeconds: 5, now: T1 });
      expect(claimed?.feature).toMatchObject({
        lifecycle: 'active',
        revision: 1,
        predicates: {
          eligibleCurrentUnpaid: true,
          officialIssuanceReconciled: true,
          undisputed: true,
        },
      });
      const serialized = JSON.stringify(claimed?.feature).toLowerCase();
      const keys = structuredKeys(claimed?.feature);
      expect(serialized).not.toContain('workspace-1');
      expect(serialized).not.toContain(hash('private-authority-identity'));
      for (const forbidden of [
        'cuit', 'cae', 'counterparty', 'amount', 'currency', 'pointofsale',
        'authorityinvoiceid', 'rawproof', 'credential', 'score',
      ]) expect(keys).not.toContain(forbidden);

      const head = f.store.currentRestrictedHead(
        'execution-1',
        claimed!.feature.workspaceCommitment,
        claimed!.feature.invoiceCommitment,
        T1
      );
      expect(head.feature.featureHash).toBe(claimed!.feature.featureHash);
      expect(head.restrictedAuthority.authorityId).toBe(hash('private-authority-identity'));
      f.store.ackOutbox(claimed!.eventId, claimed!.leaseToken, T2.toISOString());

      expect(await f.store.project('execution-1', T7)).toMatchObject({
        state: 'active', revision: 1, replayed: true,
      });
      expect(f.store.claimOutbox({ limit: 10, leaseSeconds: 5, now: T7 })).toEqual([]);
    } finally {
      f.store.close();
    }
  });

  test('withdraws immediately when any settlement is observed and denies the current head', async () => {
    const f = fixture({ initial: reconciled() });
    try {
      grant(f.store);
      await f.store.project('execution-1', T1);
      const [active] = f.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T1 });
      f.store.ackOutbox(active!.eventId, active!.leaseToken, T2.toISOString());

      f.current = {
        ...f.current,
        settlementState: 'observed',
        sourceRevision: 'source-3',
      };
      const withdrawn = await f.store.project('execution-1', T7);
      expect(withdrawn).toMatchObject({ state: 'withdrawn', revision: 2 });
      const [event] = f.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T7 });
      expect(event?.feature).toMatchObject({
        lifecycle: 'withdrawn',
        revision: 2,
        previousFeatureHash: active!.feature.featureHash,
        withdrawalReason: 'SETTLEMENT_OBSERVED',
      });
      expect(() => f.store.currentRestrictedHead(
        'execution-1',
        active!.feature.workspaceCommitment,
        active!.feature.invoiceCommitment,
        T7
      )).toThrow('FACTURA_E_FEATURE_HEAD_NOT_CURRENT');
    } finally {
      f.store.close();
    }
  });

  test.each([
    ['dispute', { settlementState: 'disputed' as const }, 'DISPUTED'],
    ['adjustment', { hasAdjustment: true }, 'VOIDED_OR_ADJUSTED'],
    ['void', { invoiceState: 'voided' as const }, 'VOIDED_OR_ADJUSTED'],
    ['authority loss', { authorityState: 'revoked' as const }, 'AUTHORITY_REVOKED'],
  ])('withdraws an active feature on %s', async (_name, change, reason) => {
    const f = fixture({ initial: reconciled() });
    try {
      grant(f.store);
      await f.store.project('execution-1', T1);
      const [active] = f.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T1 });
      f.store.ackOutbox(active!.eventId, active!.leaseToken, T2.toISOString());
      f.current = { ...f.current, ...change, sourceRevision: 'source-change' };
      await f.store.project('execution-1', T7);
      const [withdrawal] = f.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T7 });
      expect(withdrawal?.feature).toMatchObject({
        lifecycle: 'withdrawn',
        withdrawalReason: reason,
      });
    } finally {
      f.store.close();
    }
  });

  test('withdraws on consent revocation and expiration', async () => {
    const revokedFixture = fixture({ initial: reconciled() });
    try {
      grant(revokedFixture.store);
      await revokedFixture.store.project('execution-1', T1);
      const [active] = revokedFixture.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T1 });
      revokedFixture.store.ackOutbox(active!.eventId, active!.leaseToken, T2.toISOString());
      revokedFixture.store.revokeConsent({
        executionId: 'execution-1',
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        idempotencyKey: 'revoke-1',
        occurredAt: T7.toISOString(),
      });
      await revokedFixture.store.project('execution-1', T7);
      expect(revokedFixture.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T7 })[0]?.feature)
        .toMatchObject({ lifecycle: 'withdrawn', withdrawalReason: 'CONSENT_REVOKED' });
    } finally {
      revokedFixture.store.close();
    }

    const expiredFixture = fixture({ initial: reconciled() });
    try {
      grant(expiredFixture.store, { expiresAt: '2026-07-15T12:00:05.000Z' });
      await expiredFixture.store.project('execution-1', T1);
      const [active] = expiredFixture.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T1 });
      expiredFixture.store.ackOutbox(active!.eventId, active!.leaseToken, T2.toISOString());
      await expiredFixture.store.project('execution-1', T7);
      expect(expiredFixture.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T7 })[0]?.feature)
        .toMatchObject({ lifecycle: 'withdrawn', withdrawalReason: 'CONSENT_EXPIRED' });
    } finally {
      expiredFixture.store.close();
    }
  });

  test('permits an explicit re-grant after expiry and replays each original revision exactly', async () => {
    const f = fixture({ initial: reconciled() });
    try {
      expect(grant(f.store, { expiresAt: '2026-07-15T12:00:05.000Z' }))
        .toEqual({ replayed: false, revision: 1 });
      await f.store.project('execution-1', T1);
      await f.store.project('execution-1', T7);
      expect(f.store.claimOutbox({ limit: 10, leaseSeconds: 5, now: T7 })
        .map(event => event.feature.lifecycle)).toEqual(['active', 'withdrawn']);

      expect(grant(f.store, {
        consentVersion: 'factoring-consent-v2',
        idempotencyKey: 'grant-2',
        occurredAt: T7.toISOString(),
        expiresAt: '2026-07-15T13:00:00.000Z',
      })).toEqual({ replayed: false, revision: 2 });
      expect(await f.store.project('execution-1', T7)).toMatchObject({
        state: 'active',
        revision: 3,
        replayed: false,
      });

      expect(grant(f.store, { expiresAt: '2026-07-15T12:00:05.000Z' }))
        .toEqual({ replayed: true, revision: 1 });
      expect(grant(f.store, {
        consentVersion: 'factoring-consent-v2',
        idempotencyKey: 'grant-2',
        occurredAt: T7.toISOString(),
        expiresAt: '2026-07-15T13:00:00.000Z',
      })).toEqual({ replayed: true, revision: 2 });
    } finally {
      f.store.close();
    }
  });

  test('re-reads source after signing and never finalizes a stale active feature', async () => {
    let f!: ReturnType<typeof fixture>;
    let signed = 0;
    f = fixture({
      initial: reconciled(),
      signer: signingGateway(() => {
        signed += 1;
        f.current = {
          ...f.current,
          settlementState: 'observed',
          sourceRevision: 'source-raced',
        };
      }),
    });
    try {
      grant(f.store);
      expect(await f.store.project('execution-1', T1)).toMatchObject({
        state: 'not_publishable',
        featureId: null,
      });
      expect(signed).toBe(1);
      expect(f.store.claimOutbox({ limit: 10, leaseSeconds: 5, now: T1 })).toEqual([]);
    } finally {
      f.store.close();
    }
  });

  test('binds global command idempotency to workspace and payload', () => {
    const f = fixture({ initial: reconciled() });
    try {
      expect(grant(f.store)).toEqual({ replayed: false, revision: 1 });
      expect(grant(f.store)).toEqual({ replayed: true, revision: 1 });
      expect(() => grant(f.store, { consentVersion: 'factoring-consent-v2' }))
        .toThrow('FACTURA_E_FACTORING_CONSENT_IDEMPOTENCY_CONFLICT');
      expect(() => grant(f.store, { workspaceId: 'workspace-2' }))
        .toThrow('FACTURA_E_FACTORING_SOURCE_SCOPE_UNAUTHORIZED');
    } finally {
      f.store.close();
    }
  });

  test('fences stale outbox workers across lease takeover', async () => {
    const f = fixture({ initial: reconciled() });
    try {
      grant(f.store);
      await f.store.project('execution-1', T0);
      const first = f.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T0 })[0]!;
      const second = f.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T7 })[0]!;
      expect(second.leaseToken).not.toBe(first.leaseToken);
      expect(() => f.store.ackOutbox(first.eventId, first.leaseToken, T7.toISOString()))
        .toThrow('FACTURA_E_FEATURE_OUTBOX_ACK_FENCE_REJECTED');
      expect(() => f.store.nackOutbox(
        first.eventId,
        first.leaseToken,
        'STALE_WORKER',
        '2026-07-15T12:00:20.000Z',
        T7.toISOString()
      )).toThrow('FACTURA_E_FEATURE_OUTBOX_NACK_FENCE_REJECTED');
      f.store.ackOutbox(second.eventId, second.leaseToken, '2026-07-15T12:00:08.000Z');
      expect(f.store.claimOutbox({ limit: 1, leaseSeconds: 5, now: T7 })).toEqual([]);
    } finally {
      f.store.close();
    }
  });

  test('survives process restart with its feature head and pending outbox intact', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'tax-feature-publication-'));
    const path = join(directory, 'features.sqlite');
    const current = reconciled();
    const signer = signingGateway();
    const dependencies = {
      readSource: () => current,
      signer,
      commitmentSecret: 'restart-purpose-secret-that-is-at-least-32-bytes-long',
      policyVersion: 'ar-factura-e-factoring-v1',
      databasePath: path,
      requireDurable: true,
      singleWriter: true,
    } as const;
    try {
      const first = new FacturaEFeaturePublicationStore(dependencies);
      expect(existsSync(path)).toBe(true);
      grant(first);
      const projected = await first.project('execution-1', T1);
      first.close();

      const reopened = new FacturaEFeaturePublicationStore(dependencies);
      try {
        expect(await reopened.project('execution-1', T2)).toMatchObject({
          featureHash: projected.featureHash,
          revision: 1,
          replayed: true,
        });
        expect(reopened.claimOutbox({ limit: 1, leaseSeconds: 5, now: T2 }))
          .toHaveLength(1);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects anonymous durable stores and requires an explicit single writer', () => {
    const base = {
      readSource: () => reconciled(),
      signer: signingGateway(),
      commitmentSecret: 'durable-purpose-secret-that-is-at-least-32-bytes-long',
      policyVersion: 'ar-factura-e-factoring-v1',
      requireDurable: true,
      singleWriter: true,
    } as const;
    for (const databasePath of ['', '   ', ':memory:', 'file::memory:?cache=shared']) {
      expect(() => new FacturaEFeaturePublicationStore({ ...base, databasePath }))
        .toThrow('TAX_FACTURA_E_FEATURE_DURABLE_STORE_REQUIRED');
    }

    const directory = mkdtempSync(join(tmpdir(), 'tax-feature-single-writer-'));
    try {
      expect(() => new FacturaEFeaturePublicationStore({
        ...base,
        databasePath: join(directory, 'features.sqlite'),
        singleWriter: false,
      })).toThrow('TAX_FACTURA_E_FEATURE_SINGLE_WRITER_REQUIRED');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rotates projection candidates instead of starving later executions', async () => {
    const sources = new Map<string, PrivateFacturaEFeatureSource>([
      ['execution-1', reconciled('source-a')],
      ['execution-2', {
        ...reconciled('source-b'), executionId: 'execution-2', runId: 'run-2', workspaceId: 'workspace-2',
      }],
    ]);
    const store = new FacturaEFeaturePublicationStore({
      readSource(executionId) {
        const value = sources.get(executionId);
        if (!value) throw new Error('SOURCE_NOT_FOUND');
        return value;
      },
      signer: signingGateway(),
      commitmentSecret: 'rotation-purpose-secret-that-is-at-least-32-bytes-long',
      policyVersion: 'ar-factura-e-factoring-v1',
    });
    try {
      grant(store);
      grant(store, {
        executionId: 'execution-2',
        workspaceId: 'workspace-2',
        idempotencyKey: 'grant-2',
      });
      expect(store.projectionCandidates(1)).toEqual(['execution-1']);
      await store.project('execution-1', T1);
      expect(store.projectionCandidates(1)).toEqual(['execution-2']);
    } finally {
      store.close();
    }
  });
});
