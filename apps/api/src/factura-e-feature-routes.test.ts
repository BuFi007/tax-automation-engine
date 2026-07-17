import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import { FacturaEFeaturePublicationStore, type PrivateFacturaEFeatureSource } from './factura-e-feature-publication';
import { createFacturaEFeaturePrincipalHeaders } from './factura-e-feature-principal';
import { handleFacturaEFeatureRoute } from './factura-e-feature-routes';
import {
  canonicalDeskTaxEffectReceipt,
  canonicalDeskTaxNoEffectRecoveryReceipt,
  computeDeskTaxEffectReceiptCommitment,
  computeDeskTaxNoEffectReceiptCommitment,
} from './factura-e-feature-terminal-receipt';

const NOW = new Date('2026-07-15T12:00:00.000Z');
const executionId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const hash = (seed: string) => Bun.CryptoHasher.hash('sha256', seed, 'hex');
const secrets = {
  deskConsent: 'desk-consent-purpose-secret-that-is-more-than-32-bytes',
  projector: 'tax-projector-purpose-secret-that-is-more-than-32-bytes',
  creReader: 'cre-reader-purpose-secret-that-is-more-than-32-bytes',
  creReservation: 'cre-reservation-purpose-secret-that-is-more-than-32-bytes',
} as const;
const deskEffectKeys = generateKeyPairSync('ed25519');
const recoveryKeys = generateKeyPairSync('ed25519');
const terminalReceiptVerifiers = {
  deskEffect: {
    enabled: true,
    keyId: 'desk-tax-effect-key-2026-01',
    publicKey: deskEffectKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    transportSecret: 'desk-effect-transport-purpose-secret-more-than-32-bytes',
  },
  noEffectRecovery: {
    enabled: true,
    keyId: 'desk-tax-recovery-key-2026-01',
    publicKey: recoveryKeys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    transportSecret: 'recovery-transport-purpose-secret-more-than-32-bytes',
  },
} as const;

function signedDeskEffectReceipt(input: Readonly<{
  operationId: string;
  reservationId: string;
  idempotencyKey: string;
  headHash: string;
  featureId: string;
  featureHash: string;
  featureRevision: number;
  reportTxHash?: string;
}>) {
  const payloadWithoutCommitment = {
    action: 'submitted' as const,
    handoffRef: `hmac-sha256:v1:${'1'.repeat(64)}`,
    handoffIdempotencyKey: `0x${'2'.repeat(64)}`,
    idempotencyKey: input.idempotencyKey,
    reservationId: input.reservationId,
    operationId: input.operationId,
    headHash: input.headHash,
    featureId: input.featureId,
    featureHash: input.featureHash,
    featureRevision: input.featureRevision,
    reportTxHash: input.reportTxHash ?? `0x${'9'.repeat(64)}`,
    recordedAt: NOW.toISOString(),
  };
  const unsigned = {
    version: 'bufi.desk-tax-effect-receipt.v1' as const,
    keyId: terminalReceiptVerifiers.deskEffect.keyId,
    payload: {
      ...payloadWithoutCommitment,
      effectReceiptCommitment:
        computeDeskTaxEffectReceiptCommitment(payloadWithoutCommitment),
    },
  };
  return {
    ...unsigned,
    signature: `ed25519:v1:${sign(
      null,
      Buffer.from(canonicalDeskTaxEffectReceipt(unsigned), 'utf8'),
      deskEffectKeys.privateKey
    ).toString('hex')}`,
  };
}

function signedRecoveryReceipt(input: Readonly<{
  reservationId: string;
  idempotencyKey: string;
  operationId: string;
  headHash: string;
  featureId: string;
  featureHash: string;
  featureRevision: number;
}>) {
  const payloadWithoutCommitment = {
    action: 'confirmed_not_submitted' as const,
    reservationId: input.reservationId,
    idempotencyKey: input.idempotencyKey,
    operationId: input.operationId,
    headHash: input.headHash,
    featureId: input.featureId,
    featureHash: input.featureHash,
    featureRevision: input.featureRevision,
    recoveryEvidenceRef: `hmac-sha256:v1:${'8'.repeat(64)}`,
    recordedAt: NOW.toISOString(),
  };
  const unsigned = {
    version: 'bufi.desk-tax-no-effect-recovery.v1' as const,
    keyId: terminalReceiptVerifiers.noEffectRecovery.keyId,
    payload: {
      ...payloadWithoutCommitment,
      noEffectReceiptCommitment:
        computeDeskTaxNoEffectReceiptCommitment(payloadWithoutCommitment),
    },
  };
  return {
    ...unsigned,
    signature: `ed25519:v1:${sign(
      null,
      Buffer.from(canonicalDeskTaxNoEffectRecoveryReceipt(unsigned), 'utf8'),
      recoveryKeys.privateKey
    ).toString('hex')}`,
  };
}

function fixture() {
  let source: PrivateFacturaEFeatureSource = {
    executionId,
    runId: 'run-1',
    workspaceId,
    authorityState: 'unverified',
    authorityIdentityHash: null,
    reconciliationEvidenceHash: null,
    settlementState: 'unobserved',
    invoiceState: 'current',
    hasAdjustment: false,
    sourceRevision: 'source-1',
  };
  const { privateKey } = generateKeyPairSync('ed25519');
  const store = new FacturaEFeaturePublicationStore({
    readSource(id) {
      if (id !== executionId) throw new Error('SOURCE_NOT_FOUND');
      return source;
    },
    signer: {
      keyVersion: 'tax-feature-key-2026-01',
      async signDigest(digestHex) {
        return sign(null, Buffer.from(digestHex, 'hex'), privateKey).toString('base64url');
      },
    },
    commitmentSecret: 'commitment-purpose-secret-that-is-more-than-32-bytes',
    policyVersion: 'ar-factura-e-factoring-v1',
  });
  return {
    store,
    reconcile() {
      source = {
        ...source,
        authorityState: 'officially_reconciled',
        authorityIdentityHash: hash('private-authority'),
        reconciliationEvidenceHash: hash('private-evidence'),
        sourceRevision: 'source-2',
      };
    },
    observeSettlement() {
      source = { ...source, settlementState: 'observed', sourceRevision: 'source-3' };
    },
  };
}

function signedRequest(input: Readonly<{
  path: string;
  capability: 'factura-e:factoring-consent' | 'factura-e:feature-project' | 'factura-e:feature-head:read';
  secret: string;
  body: unknown;
}>): Request {
  const rawBody = JSON.stringify(input.body);
  return new Request(`http://tax.local${input.path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...createFacturaEFeaturePrincipalHeaders({
        secret: input.secret,
        workspaceId,
        actorId: input.capability === 'factura-e:factoring-consent' ? 'user-1' : 'service-1',
        capability: input.capability,
        path: input.path,
        rawBody,
        expiresAt: '2026-07-15T12:01:00.000Z',
      }),
    },
    body: rawBody,
  });
}

async function invoke(
  f: ReturnType<typeof fixture>,
  request: Request,
  options: Readonly<{ allowLegacyUnsignedRestrictedHead?: boolean }> = {
    allowLegacyUnsignedRestrictedHead: true,
  }
): Promise<Response> {
  return (await handleFacturaEFeatureRoute(
    request,
    new URL(request.url),
    f.store,
    {
      enabled: true,
      secrets,
      terminalReceiptVerifiers,
      now: NOW,
      ...options,
    }
  ))!;
}

describe('Factura E feature routes', () => {
  test('bounds a chunked CRE request while reading it', async () => {
    const f = fixture();
    try {
      const response = await invoke(f, new Request(
        'http://tax.local/v1/factoring/factura-e-feature-head',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${secrets.creReader}` },
          body: 'x'.repeat(16 * 1024 + 1),
        }
      ));
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        error: 'TAX_FACTURA_E_FEATURE_REQUEST_TOO_LARGE',
      });
    } finally {
      f.store.close();
    }
  });

  test('keeps consent, projection and restricted CRE reads on separate principals', async () => {
    const f = fixture();
    const consentPath = `/v1/factoring/factura-e/executions/${executionId}/consent`;
    try {
      const consent = await invoke(f, signedRequest({
        path: consentPath,
        capability: 'factura-e:factoring-consent',
        secret: secrets.deskConsent,
        body: {
          version: 'factura-e-factoring-consent-command-v1',
          action: 'grant',
          workspaceId,
          consentVersion: 'factoring-consent-v1',
          idempotencyKey: 'grant-consent-0001',
          expiresAt: '2026-07-15T13:00:00.000Z',
        },
      }));
      expect(consent.status).toBe(200);
      expect(await consent.json()).toMatchObject({
        data: { projection: { state: 'not_publishable' }, feature: null },
      });

      f.reconcile();
      const projectPath = `/v1/internal/factoring/factura-e/executions/${executionId}/project`;
      const projected = await invoke(f, signedRequest({
        path: projectPath,
        capability: 'factura-e:feature-project',
        secret: secrets.projector,
        body: { version: 'factura-e-feature-project-command-v1', workspaceId },
      }));
      const projectedBody = await projected.json() as any;
      expect(projected.status).toBe(200);
      expect(projectedBody.data).toMatchObject({
        projection: { state: 'active', revision: 1 },
        feature: { lifecycle: 'active' },
      });
      expect(JSON.stringify(projectedBody.data.feature)).not.toContain(hash('private-authority'));

      const headPath = `/v1/internal/factoring/factura-e/executions/${executionId}/head`;
      const head = await invoke(f, signedRequest({
        path: headPath,
        capability: 'factura-e:feature-head:read',
        secret: secrets.creReader,
        body: {
          version: 'factura-e-feature-head-request-v1',
          workspaceId,
          workspaceCommitment: projectedBody.data.feature.workspaceCommitment,
          invoiceCommitment: projectedBody.data.feature.invoiceCommitment,
        },
      }));
      expect(head.status).toBe(200);
      expect(head.headers.get('x-tax-data-classification')).toBe('restricted-tax-to-cre');
      expect(await head.json()).toMatchObject({
        data: {
          feature: { featureHash: projectedBody.data.feature.featureHash },
          restrictedAuthority: { authorityId: hash('private-authority') },
        },
      });

      const creBody = {
        featureId: projectedBody.data.feature.featureId,
        featureHash: projectedBody.data.feature.featureHash,
        workspaceCommitment: projectedBody.data.feature.workspaceCommitment,
        invoiceCommitment: projectedBody.data.feature.invoiceCommitment,
        revision: projectedBody.data.feature.revision,
        purpose: 'factura_e_factoring',
      };
      const creHeadRequest = () => new Request(
        'http://tax.local/v1/factoring/factura-e-feature-head', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${secrets.creReader}`,
          },
          body: JSON.stringify(creBody),
        }
      );
      const creHeads = await Promise.all([
        invoke(f, creHeadRequest()),
        invoke(f, creHeadRequest()),
        invoke(f, creHeadRequest()),
      ]);
      expect(creHeads.every(response => response.status === 200)).toBe(true);
      expect(creHeads[0]!.headers.get('x-tax-data-classification')).toBe('restricted-tax-to-cre');
      const creHeadTexts = await Promise.all(creHeads.map(response => response.text()));
      expect(new Set(creHeadTexts).size).toBe(1);
      const creHeadBody = JSON.parse(creHeadTexts[0]!) as any;
      expect(creHeadBody).toMatchObject({
        version: 'factura-e-feature-head-v1',
        featureId: projectedBody.data.feature.featureId,
        featureHash: projectedBody.data.feature.featureHash,
        featureLifecycle: 'active',
        settlementObservationState: 'unobserved',
        headRevision: 1,
        restrictedAuthority: { authorityId: hash('private-authority') },
        signature: { algorithm: 'Ed25519', keyId: 'tax-feature-key-2026-01' },
      });

      const operationId = `0x${'a'.repeat(64)}`;
      const reservationPath = '/v1/factoring/factura-e-feature-reservations';
      const creCommand = (
        path: string,
        body: unknown,
        secret: string = secrets.creReservation
      ) => invoke(f, new Request(
        `http://tax.local${path}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify(body),
        }
      ));
      const releaseOperationId = `0x${'c'.repeat(64)}`;
      const releasableCommand = {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'reserve',
        featureId: projectedBody.data.feature.featureId,
        featureHash: projectedBody.data.feature.featureHash,
        featureRevision: projectedBody.data.feature.revision,
        headHash: creHeadBody.headHash,
        operationId: releaseOperationId,
        idempotencyKey: 'reserve-route-operation-0002',
        leaseSeconds: 30,
      };
      const readerMutation = await creCommand(
        `${reservationPath}/reserve`,
        releasableCommand,
        secrets.creReader
      );
      expect(readerMutation.status).toBe(403);
      expect(await readerMutation.json()).toEqual({
        error: 'TAX_FACTURA_E_FEATURE_PRINCIPAL_UNAUTHORIZED',
      });
      const releasableResponse = await creCommand(
        `${reservationPath}/reserve`,
        releasableCommand
      );
      const releasable = await releasableResponse.json() as any;
      const releaseCommand = {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'release',
        reservationId: releasable.reservationId,
        operationId: releaseOperationId,
        headHash: creHeadBody.headHash,
        reason: 'before_consume',
        idempotencyKey: 'release-route-operation-0002',
      };
      const releasedResponse = await creCommand(`${reservationPath}/release`, releaseCommand);
      expect(releasedResponse.status).toBe(200);
      const releasedText = await releasedResponse.text();
      expect(await (await creCommand(`${reservationPath}/release`, releaseCommand)).text())
        .toBe(releasedText);
      expect(JSON.parse(releasedText)).toMatchObject({ state: 'released', replayed: false });

      const reserveCommand = {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'reserve',
        featureId: projectedBody.data.feature.featureId,
        featureHash: projectedBody.data.feature.featureHash,
        featureRevision: projectedBody.data.feature.revision,
        headHash: creHeadBody.headHash,
        operationId,
        idempotencyKey: 'reserve-route-operation-0001',
        leaseSeconds: 30,
      };
      const reservedResponse = await creCommand(`${reservationPath}/reserve`, reserveCommand);
      expect(reservedResponse.status).toBe(200);
      const reservedText = await reservedResponse.text();
      const reservedReplayText = await (await creCommand(`${reservationPath}/reserve`, reserveCommand)).text();
      expect(reservedReplayText).toBe(reservedText);
      const reserved = JSON.parse(reservedText) as any;
      expect(reserved).toMatchObject({ state: 'reserved', operationId, replayed: false });

      const consumeCommand = {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'consume',
        reservationId: reserved.reservationId,
        operationId,
        headHash: creHeadBody.headHash,
        idempotencyKey: 'consume-route-operation-0001',
      };
      const consumedResponse = await creCommand(`${reservationPath}/consume`, consumeCommand);
      expect(consumedResponse.status).toBe(200);
      const consumedText = await consumedResponse.text();
      expect(await (await creCommand(`${reservationPath}/consume`, consumeCommand)).text())
        .toBe(consumedText);
      expect(JSON.parse(consumedText)).toMatchObject({ state: 'consumed', replayed: false });

      const creNoEffectRelease = await creCommand(`${reservationPath}/release`, {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'release',
        reservationId: reserved.reservationId,
        operationId,
        headHash: creHeadBody.headHash,
        reason: 'no_effect_before_submit',
        noEffectReceiptCommitment: `0x${'d'.repeat(64)}`,
        idempotencyKey: 'cre-must-not-release-after-consume',
      });
      expect(creNoEffectRelease.status).toBe(400);
      expect(await creNoEffectRelease.json()).toEqual({ error: 'INVALID_REQUEST' });

      const signedEffect = signedDeskEffectReceipt({
        operationId,
        reservationId: reserved.reservationId,
        idempotencyKey: 'complete-route-operation-0001',
        headHash: creHeadBody.headHash,
        featureId: projectedBody.data.feature.featureId,
        featureHash: projectedBody.data.feature.featureHash,
        featureRevision: projectedBody.data.feature.revision,
      });
      const mixedEnvelope = await creCommand(`${reservationPath}/complete`, {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'complete',
        reservationId: reserved.reservationId,
        operationId: `0x${'e'.repeat(64)}`,
        headHash: creHeadBody.headHash,
        deskEffectReceipt: signedEffect,
        idempotencyKey: 'complete-route-mixed-envelope',
      });
      expect(mixedEnvelope.status).toBe(409);
      expect(await mixedEnvelope.json()).toEqual({
        error: 'FACTURA_E_FEATURE_TERMINAL_EFFECT_RECEIPT_BINDING_CONFLICT',
      });

      const completeCommand = {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'complete',
        reservationId: reserved.reservationId,
        operationId,
        headHash: creHeadBody.headHash,
        deskEffectReceipt: signedEffect,
        idempotencyKey: 'complete-route-operation-0001',
      };
      const completedResponse = await creCommand(`${reservationPath}/complete`, completeCommand);
      expect(completedResponse.status).toBe(200);
      const completedText = await completedResponse.text();
      expect(await (await creCommand(`${reservationPath}/complete`, completeCommand)).text())
        .toBe(completedText);
      expect(await (await creCommand(
        `${reservationPath}/complete`,
        completeCommand,
        terminalReceiptVerifiers.deskEffect.transportSecret
      )).text()).toBe(completedText);
      expect(JSON.parse(completedText)).toMatchObject({
        state: 'completed',
        effectReceiptCommitment: completeCommand.deskEffectReceipt.payload
          .effectReceiptCommitment,
        replayed: false,
      });

    } finally {
      f.store.close();
    }
  });

  test('keeps consumed no-effect recovery on its independent signed principal', async () => {
    const f = fixture();
    f.reconcile();
    const operationId = `0x${'7'.repeat(64)}`;
    const recoveryPath =
      '/v1/internal/factoring/factura-e-feature-reservations/recover-no-effect';
    try {
      f.store.grantConsent({
        executionId,
        workspaceId,
        consentVersion: 'factoring-consent-v1',
        actorId: 'user-1',
        idempotencyKey: 'grant-recovery-route-consent',
        occurredAt: NOW.toISOString(),
        expiresAt: '2026-07-15T13:00:00.000Z',
      });
      await f.store.project(executionId, NOW);
      const feature = f.store.currentPublicHead(executionId, workspaceId, NOW);
      const head = await f.store.signRestrictedHeadByFeature({
        featureId: feature.featureId,
        featureHash: feature.featureHash,
        workspaceCommitment: feature.workspaceCommitment,
        invoiceCommitment: feature.invoiceCommitment,
        revision: feature.revision,
        purpose: 'factura_e_factoring',
      }, () => NOW);
      const reserved = f.store.reserveForFactoring({
        featureId: feature.featureId,
        featureHash: feature.featureHash,
        featureRevision: feature.revision,
        headHash: head.headHash,
        operationId,
        idempotencyKey: 'reserve-recovery-route-operation',
        leaseSeconds: 30,
      }, NOW);
      f.store.consumeFactoringReservation({
        reservationId: reserved.reservationId,
        operationId,
        headHash: head.headHash,
        idempotencyKey: 'consume-recovery-route-operation',
      }, NOW);
      const idempotencyKey = 'recover-route-operation-0001';
      const recoveryReceipt = signedRecoveryReceipt({
        reservationId: reserved.reservationId,
        idempotencyKey,
        operationId,
        headHash: head.headHash,
        featureId: feature.featureId,
        featureHash: feature.featureHash,
        featureRevision: feature.revision,
      });
      const body = {
        version: 'factura-e-feature-reservation-command-v1',
        action: 'recover_no_effect',
        reservationId: reserved.reservationId,
        operationId,
        headHash: head.headHash,
        recoveryReceipt,
        idempotencyKey,
      };
      const request = (authorization?: string, value: unknown = body) => new Request(
        `http://tax.local${recoveryPath}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(authorization ? { authorization } : {}),
          },
          body: JSON.stringify(value),
        }
      );
      const unauthenticated = await invoke(f, request());
      expect(unauthenticated.status).toBe(403);
      expect(await unauthenticated.json()).toEqual({
        error: 'FACTURA_E_FEATURE_RECOVERY_PRINCIPAL_UNAUTHORIZED',
      });
      const mixed = await invoke(f, request(
        `Bearer ${terminalReceiptVerifiers.noEffectRecovery.transportSecret}`,
        { ...body, idempotencyKey: 'recover-route-operation-mixed' }
      ));
      expect(mixed.status).toBe(409);
      expect(await mixed.json()).toEqual({
        error: 'FACTURA_E_FEATURE_RECOVERY_RECEIPT_BINDING_CONFLICT',
      });
      const recovered = await invoke(f, request(
        `Bearer ${terminalReceiptVerifiers.noEffectRecovery.transportSecret}`
      ));
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({
        state: 'released',
        effectReceiptCommitment: recoveryReceipt.payload.noEffectReceiptCommitment,
      });
    } finally {
      f.store.close();
    }
  });

  test('withdrawal is immediate and a stale active head cannot be read', async () => {
    const f = fixture();
    f.reconcile();
    const consentPath = `/v1/factoring/factura-e/executions/${executionId}/consent`;
    const projectPath = `/v1/internal/factoring/factura-e/executions/${executionId}/project`;
    try {
      await invoke(f, signedRequest({
        path: consentPath,
        capability: 'factura-e:factoring-consent',
        secret: secrets.deskConsent,
        body: {
          version: 'factura-e-factoring-consent-command-v1', action: 'grant', workspaceId,
          consentVersion: 'factoring-consent-v1', idempotencyKey: 'grant-consent-0001',
          expiresAt: '2026-07-15T13:00:00.000Z',
        },
      }));
      const activeResponse = await invoke(f, signedRequest({
        path: projectPath,
        capability: 'factura-e:feature-project',
        secret: secrets.projector,
        body: { version: 'factura-e-feature-project-command-v1', workspaceId },
      }));
      const active = (await activeResponse.json() as any).data.feature;
      f.observeSettlement();

      const headPath = `/v1/internal/factoring/factura-e/executions/${executionId}/head`;
      const stale = await invoke(f, signedRequest({
        path: headPath,
        capability: 'factura-e:feature-head:read',
        secret: secrets.creReader,
        body: {
          version: 'factura-e-feature-head-request-v1', workspaceId,
          workspaceCommitment: active.workspaceCommitment,
          invoiceCommitment: active.invoiceCommitment,
        },
      }));
      expect(stale.status).toBe(400);
      expect(await stale.json()).toEqual({ error: 'FACTURA_E_FEATURE_HEAD_NOT_CURRENT' });

      const withdrawnResponse = await invoke(f, signedRequest({
        path: projectPath,
        capability: 'factura-e:feature-project',
        secret: secrets.projector,
        body: { version: 'factura-e-feature-project-command-v1', workspaceId },
      }));
      expect(await withdrawnResponse.json()).toMatchObject({
        data: {
          projection: { state: 'withdrawn', revision: 2 },
          feature: { lifecycle: 'withdrawn', withdrawalReason: 'SETTLEMENT_OBSERVED' },
        },
      });
    } finally {
      f.store.close();
    }
  });

  test('rejects body tampering and cross-capability secrets', async () => {
    const f = fixture();
    const path = `/v1/factoring/factura-e/executions/${executionId}/consent`;
    try {
      const request = signedRequest({
        path,
        capability: 'factura-e:factoring-consent',
        secret: secrets.deskConsent,
        body: {
          version: 'factura-e-factoring-consent-command-v1', action: 'grant', workspaceId,
          consentVersion: 'factoring-consent-v1', idempotencyKey: 'grant-consent-0001',
          expiresAt: '2026-07-15T13:00:00.000Z',
        },
      });
      const tampered = new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: JSON.stringify({
          version: 'factura-e-factoring-consent-command-v1', action: 'revoke', workspaceId,
          idempotencyKey: 'revoke-consent-001',
        }),
      });
      const response = await invoke(f, tampered);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: 'TAX_FACTURA_E_FEATURE_PRINCIPAL_SCOPE_UNAUTHORIZED',
      });
    } finally {
      f.store.close();
    }
  });

  test('keeps the legacy unsigned restricted-head route dark when disabled', async () => {
    const f = fixture();
    const path = `/v1/internal/factoring/factura-e/executions/${executionId}/head`;
    try {
      const response = await invoke(f, signedRequest({
        path,
        capability: 'factura-e:feature-head:read',
        secret: secrets.creReader,
        body: {
          version: 'factura-e-feature-head-request-v1',
          workspaceId,
          workspaceCommitment: 'a'.repeat(64),
          invoiceCommitment: 'b'.repeat(64),
        },
      }), { allowLegacyUnsignedRestrictedHead: false });
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: 'NOT_FOUND' });
    } finally {
      f.store.close();
    }
  });
});
