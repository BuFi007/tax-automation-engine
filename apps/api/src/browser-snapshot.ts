import { createHmac } from 'node:crypto';

import {
  buildTaxSnapshotProblemV1,
  deriveTaxSourceHealthStateV1,
  taxSnapshotReadResultV1Schema,
  taxWidgetSnapshotReceiptV1Schema,
  taxWidgetSnapshotV1Schema,
  type TaxSnapshotProblemCodeV1,
  type TaxSnapshotReadResultV1,
  type TaxWidgetSnapshotReceiptV1 as BrowserTaxWidgetSnapshotReceiptV1,
  type TaxWidgetSnapshotV1 as BrowserTaxWidgetSnapshotV1,
} from '@tax-engine/browser-contracts';
import {
  normalizeTaxSnapshotProjectionKey,
  type TaxConclusionEnvelopeV1,
  type TaxWidgetSnapshotReceiptV1 as CoreTaxWidgetSnapshotReceiptV1,
} from '@tax-engine/core';

import type { TaxEvidenceWorkspaceService } from './evidence-workspace';
import type { TaxProfileStore } from './store';

const BROWSER_SNAPSHOT_PROBLEM_CODES = new Set<TaxSnapshotProblemCodeV1>([
  'TAX_SNAPSHOT_NOT_FOUND',
  'TAX_SNAPSHOT_PROJECTION_CONFIG_REQUIRED',
  'TAX_SNAPSHOT_STALE',
  'TAX_EVIDENCE_SOURCE_STALE',
  'TAX_SNAPSHOT_PROJECTION_CONFIG_MISMATCH',
  'TAX_SNAPSHOT_CONFIG_VERSION_CONFLICT',
  'TAX_EVIDENCE_GENERATION_CONFLICT',
  'TAX_PROFILE_VERSION_CONFLICT',
  'TAX_SNAPSHOT_EXPIRED',
]);

type SnapshotReader = Pick<TaxEvidenceWorkspaceService, 'latestSnapshot'>;

export type TaxBrowserSnapshotRead = Readonly<{
  status: 200 | 404 | 409 | 410;
  result: TaxSnapshotReadResultV1;
}>;

export function resolveTaxBrowserReferenceSecret(
  configuredSecret: string | null | undefined = process.env.TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET,
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
): string | null {
  const secret = configuredSecret?.trim() || null;
  if (!secret) {
    if (nodeEnvironment === 'production') {
      throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED');
    }
    return null;
  }
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_TOO_SHORT');
  }
  return secret;
}

/**
 * Projects the server-only Tax receipt into the frozen browser contract. Every
 * correlatable identifier is purpose/workspace/projection scoped with HMAC.
 * Raw core IDs and hashes never cross this boundary.
 */
export class TaxBrowserSnapshotProjector {
  readonly #references: TaxBrowserReferenceScope;

  constructor(secret: string) {
    const resolved = resolveTaxBrowserReferenceSecret(secret, 'production');
    if (!resolved) throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED');
    this.#references = new TaxBrowserReferenceScope(resolved);
  }

  sourceFingerprint(receipt: CoreTaxWidgetSnapshotReceiptV1): string {
    return this.#references.digest('source-fingerprint', receipt.snapshot.workspaceId, receipt.projectionKey, JSON.stringify({
      snapshotHash: receipt.snapshotHash,
      inputHash: receipt.inputHash,
      configHash: receipt.configHash,
      evidenceGeneration: receipt.evidenceGeneration,
      generatedAt: receipt.generatedAt,
      asOf: receipt.asOf,
      expiresAt: receipt.expiresAt,
      profileVersion: receipt.snapshot.profile.version,
    }));
  }

  caseReference(workspaceId: string, projectionKey: string): string {
    return this.#references.reference('case', workspaceId, projectionKey, 'durable-tax-case-v1');
  }

  project(
    receipt: CoreTaxWidgetSnapshotReceiptV1,
    durable: Readonly<{ caseRef: string; caseRevision: number; sourceFingerprint: string }>,
  ): BrowserTaxWidgetSnapshotV1 {
    const workspaceId = receipt.snapshot.workspaceId;
    const projectionKey = receipt.projectionKey;
    const ref = (purpose: string, value: string): string => (
      this.#references.reference(purpose, workspaceId, projectionKey, value)
    );
    const revision = (prefix: string, purpose: string, value: string): string => (
      this.#references.revision(prefix, purpose, workspaceId, projectionKey, value)
    );
    const sourceRefForId = (value: string): string => ref('source', sourceReferenceSubject(value));
    const sourceRefForWrappedReference = (value: string): string => (
      sourceRefForId(unwrapCoreSourceReference(value))
    );
    const profile = receipt.snapshot.profile;
    const cacheIdentity = {
      version: 'tax-cache-identity-v1' as const,
      projectionKey,
      caseRevision: durable.caseRevision,
      configurationRevision: revision('cfg', 'configuration', receipt.configHash),
      inputRevision: revision(
        'input',
        'input',
        JSON.stringify({ inputHash: receipt.inputHash, evidenceGeneration: receipt.evidenceGeneration }),
      ),
      snapshotRevision: revision(
        'snapshot',
        'snapshot',
        JSON.stringify({ sourceFingerprint: durable.sourceFingerprint, caseRevision: durable.caseRevision }),
      ),
    };
    const sources = receipt.snapshot.sourceCoverage.map(source => ({
      sourceRef: sourceRefForId(source.sourceId),
      kind: source.kind,
      providerDescriptor: {
        providerId: source.providerId === null ? null : ref('provider', source.providerId),
        displayName: safeSourceDisplayName(source.kind),
      },
      state: source.connectionState,
      capabilities: source.capabilities.map(capability => ({ ...capability })),
      lastSuccessfulSyncAt: source.lastSuccessfulSyncAt,
      acceptedEvidenceCount: source.acceptedEvidenceCount,
      needsReviewCount: source.needsReviewCount,
      safeErrorCode: source.safeErrorCode,
    }));
    const conclusions = receipt.snapshot.facts.flatMap(fact => {
      const projected = projectConclusion(fact, {
        ref,
        revision,
        sourceRef: sourceRefForWrappedReference,
      });
      return projected ? [projected] : [];
    });

    return parseBrowserSnapshot({
      version: 'tax-widget-snapshot-v1',
      workspaceId: ref('workspace', workspaceId),
      caseId: durable.caseRef,
      profile: {
        profileRef: ref('profile', profile.profileId),
        profileVersion: ref('profile-version', profile.version),
        jurisdiction: profile.jurisdiction,
        entityType: profile.entityType,
        regimeId: profile.regimeId,
        confirmationState: profile.confirmationState,
        catalogueVersion: ref('catalogue-version', profile.catalogueVersion),
      },
      period: receipt.snapshot.period,
      displayCurrency: receipt.snapshot.displayCurrency,
      taxPosition: {
        state: 'unavailable',
        taxCollected: null,
        taxPaid: null,
        netTaxPosition: null,
        limitationCodes: ['TAX_LIABILITY_RULES_NOT_PROJECTED'],
      },
      activity: {
        grossIncome: receipt.snapshot.metrics.grossIncome,
        supportedExpenses: receipt.snapshot.metrics.supportedExpenses,
      },
      sourceHealth: {
        state: deriveTaxSourceHealthStateV1(sources),
        sources,
      },
      evidenceCoverage: {
        invoicedRevenue: receipt.snapshot.evidenceCoverage.revenue.invoiced,
        reconciledRevenue: receipt.snapshot.evidenceCoverage.revenue.reconciled,
        recordedExpenses: receipt.snapshot.evidenceCoverage.expenses.recorded,
        supportedExpenses: receipt.snapshot.evidenceCoverage.expenses.supported,
        applicableObligations: receipt.snapshot.evidenceCoverage.obligations.applicable,
        mappedObligations: receipt.snapshot.evidenceCoverage.obligations.mapped,
        gaps: receipt.snapshot.evidenceCoverage.gaps.map(gap => ({
          gapRef: ref('gap', gap.id),
          kind: gap.kind,
          severity: gap.severity,
          safeSourceRefs: gap.safeSourceReferenceIds.map(sourceRefForWrappedReference),
          // Actions remain non-authoritative until an explicit policy projection proves them.
          actionId: null,
        })),
      },
      capabilityManifest: {
        ...receipt.snapshot.capabilityManifest,
        reads: receipt.snapshot.capabilityManifest.reads.map(read => ({ ...read })),
        approvalAwareActions: receipt.snapshot.capabilityManifest.approvalAwareActions.map(action => ({
          ...action,
          state: 'policy_blocked' as const,
          actionId: null,
        })),
      },
      obligations: receipt.snapshot.obligations.map(obligation => ({
        obligationRef: ref('obligation', obligation.id),
        title: obligation.title,
        dueAt: obligation.dueAt,
        preparationState: obligation.preparationState,
        submissionState: obligation.submissionState,
        satisfactionState: obligation.satisfactionState,
        actionId: null,
      })),
      authorizedNextActions: [],
      conclusions,
      warnings: [
        'Tax liability remains unavailable until deterministic jurisdiction rules are projected.',
      ],
      cacheIdentity,
    });
  }
}

export class TaxBrowserSnapshotService {
  constructor(
    private readonly store: TaxProfileStore,
    private readonly snapshots: SnapshotReader,
    private readonly projector: TaxBrowserSnapshotProjector | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  read(workspaceId: string, projectionKey?: string): TaxBrowserSnapshotRead {
    const normalizedProjectionKey = normalizeTaxSnapshotProjectionKey(projectionKey);
    if (!this.projector) throw new Error('TAX_ENGINE_BROWSER_REFERENCE_HMAC_SECRET_CONFIGURATION_REQUIRED');
    try {
      const internal = this.snapshots.latestSnapshot(workspaceId, normalizedProjectionKey);
      const checkedAt = this.now().toISOString();
      if (internal.expiresAt !== null && Date.parse(checkedAt) >= Date.parse(internal.expiresAt)) {
        return problemRead('TAX_SNAPSHOT_EXPIRED');
      }
      const sourceFingerprint = this.projector.sourceFingerprint(internal);
      const stamped = this.store.stampBrowserTaxSnapshot({
        receipt: internal,
        sourceFingerprint,
        caseRef: this.projector.caseReference(workspaceId, normalizedProjectionKey),
        buildSnapshot: durable => this.projector!.project(internal, {
          ...durable,
          sourceFingerprint,
        }),
      });
      const receipt = parseBrowserReceipt({
        version: 'tax-browser-snapshot-receipt-v1',
        projectionKey: normalizedProjectionKey,
        generatedAt: internal.generatedAt,
        asOf: internal.asOf,
        expiresAt: internal.expiresAt,
        validity: { state: 'current', checkedAt },
        cacheIdentity: stamped.snapshot.cacheIdentity,
        snapshot: stamped.snapshot,
      });
      return {
        status: 200,
        result: parseBrowserReadResult({ ok: true, data: receipt }),
      };
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (isBrowserSnapshotProblemCode(code)) return problemRead(code);
      throw new Error('Tax browser snapshot read failed closed');
    }
  }
}

function projectConclusion(
  fact: TaxConclusionEnvelopeV1<unknown>,
  scope: Readonly<{
    ref: (purpose: string, value: string) => string;
    revision: (prefix: string, purpose: string, value: string) => string;
    sourceRef: (value: string) => string;
  }>,
): BrowserTaxWidgetSnapshotV1['conclusions'][number] | null {
  if (fact.confidence.derivation === 'ai_candidate') return null;
  const value = safeFactValue(fact.value);
  if (!value) return null;
  return {
    conclusionRef: scope.ref('conclusion', fact.conclusionId),
    kind: value.kind,
    safeDisplayValue: value.safeDisplayValue,
    period: fact.period,
    sourceRefs: fact.sourceReferenceIds
      .filter(value => value.startsWith('source:'))
      .map(scope.sourceRef),
    freshness: fact.freshness.state,
    confidence: fact.confidence.level,
    derivation: fact.confidence.derivation,
    consentScopeRevision: fact.consent.scopeHash === null
      ? null
      : scope.revision('consent', 'consent-scope', fact.consent.scopeHash),
    evidenceRevision: scope.revision('evidence', 'evidence', fact.evidenceHash),
    accountantReviewState: fact.accountantReview.state,
    ruleVersions: fact.ruleVersionIds.map(value => scope.ref('rule-version', value)),
    limitations: [...fact.limitations],
  };
}

function safeFactValue(value: unknown): Readonly<{
  kind: string;
  safeDisplayValue: string | boolean | null;
}> | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string') return null;
  if (record.safeDisplayValue !== null
    && typeof record.safeDisplayValue !== 'string'
    && typeof record.safeDisplayValue !== 'boolean') return null;
  return { kind: record.kind, safeDisplayValue: record.safeDisplayValue } as const;
}

function unwrapCoreSourceReference(value: string): string {
  if (!value.startsWith('source:')) {
    throw new Error('Tax browser source reference is not canonical');
  }
  return value.slice('source:'.length);
}

function sourceReferenceSubject(sourceId: string): string {
  // Namespace raw IDs before hashing. Without this tag, a raw source ID such
  // as `source:bank` aliases the canonical wrapped reference for raw `bank`.
  return `source-id:${sourceId}`;
}

function safeSourceDisplayName(kind: CoreTaxWidgetSnapshotReceiptV1['snapshot']['sourceCoverage'][number]['kind']): string {
  return ({
    bank: 'Bank source',
    wallet: 'Wallet source',
    crypto: 'Crypto source',
    stripe: 'Stripe source',
    fx: 'FX source',
    payroll: 'Payroll source',
    bufi_invoice: 'Invoice source',
    bufi_bill: 'Bill source',
    accounting: 'Accounting source',
    magic_inbox: 'Magic Inbox source',
    transaction_enrichment: 'Transaction enrichment',
    knowledge_graph: 'Knowledge graph',
    financial_analytics: 'Financial analytics',
    unknown: 'Financial source',
  } as const)[kind];
}

function problemRead(code: TaxSnapshotProblemCodeV1): TaxBrowserSnapshotRead {
  const problem = buildTaxSnapshotProblemV1(code);
  return {
    status: problem.status,
    result: parseBrowserReadResult({ ok: false, problem }),
  };
}

function isBrowserSnapshotProblemCode(code: string): code is TaxSnapshotProblemCodeV1 {
  return BROWSER_SNAPSHOT_PROBLEM_CODES.has(code as TaxSnapshotProblemCodeV1);
}

function parseBrowserSnapshot(value: unknown): BrowserTaxWidgetSnapshotV1 {
  try {
    return taxWidgetSnapshotV1Schema.parse(value);
  } catch {
    throw new Error('Tax browser snapshot projection failed schema validation');
  }
}

function parseBrowserReceipt(value: unknown): BrowserTaxWidgetSnapshotReceiptV1 {
  try {
    return taxWidgetSnapshotReceiptV1Schema.parse(value);
  } catch {
    throw new Error('Tax browser snapshot receipt failed schema validation');
  }
}

function parseBrowserReadResult(value: unknown): TaxSnapshotReadResultV1 {
  try {
    return taxSnapshotReadResultV1Schema.parse(value);
  } catch {
    throw new Error('Tax browser snapshot read result failed schema validation');
  }
}

class TaxBrowserReferenceScope {
  constructor(private readonly secret: string) {}

  reference(purpose: string, workspaceId: string, projectionKey: string, value: string): string {
    return `${safePrefix(purpose)}:${this.digest(purpose, workspaceId, projectionKey, value)}`;
  }

  revision(
    prefix: string,
    purpose: string,
    workspaceId: string,
    projectionKey: string,
    value: string,
  ): string {
    return `${safePrefix(prefix)}:${this.digest(purpose, workspaceId, projectionKey, value)}`;
  }

  digest(purpose: string, workspaceId: string, projectionKey: string, value: string): string {
    return createHmac('sha256', this.secret)
      .update(JSON.stringify([
        'tax-browser-reference-v1',
        purpose,
        workspaceId,
        projectionKey,
        value,
      ]), 'utf8')
      .digest('base64url');
  }
}

function safePrefix(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 31);
  if (!/^[a-z][a-z0-9_]{0,30}$/.test(normalized)) throw new Error('Tax browser reference purpose is invalid');
  return normalized;
}
