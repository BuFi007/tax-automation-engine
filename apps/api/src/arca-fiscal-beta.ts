import { z } from 'zod';

/** Exact scope ids: no email matching, wildcard, or default enrollment. */
export const fiscalWorkspaceIdSchema = z.union([
  z.uuid(),
  z.string().regex(/^personal:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
]);
export type ArcaFiscalBetaConfig = Readonly<{
  enabled: boolean;
  deploymentEnvironment: string;
  authorityEnvironment: string;
  workspaceIds: ReadonlySet<string>;
}>;
export function arcaFiscalBetaFromEnvironment(): ArcaFiscalBetaConfig {
  return {
    enabled: process.env.ARCA_FISCAL_BETA_ENABLED === 'true',
    deploymentEnvironment: process.env.TAX_DEPLOYMENT_ENVIRONMENT ?? '',
    authorityEnvironment: process.env.ARCA_ENVIRONMENT ?? '',
    workspaceIds: new Set((process.env.ARCA_FISCAL_BETA_WORKSPACE_IDS ?? '').split(',').map(v => v.trim()).filter(Boolean)),
  };
}
export function assertArcaFiscalBeta(workspaceId: string, config = arcaFiscalBetaFromEnvironment()): void {
  if (!config.enabled || config.deploymentEnvironment !== 'development'
    || config.authorityEnvironment !== 'homologation')
    throw new Error('ARCA_FISCAL_BETA_CONFIGURATION_REQUIRED');
  if (!fiscalWorkspaceIdSchema.safeParse(workspaceId).success || !config.workspaceIds.has(workspaceId))
    throw new Error('ARCA_FISCAL_BETA_SCOPE_UNAUTHORIZED');
}
/** A signed Desk permission delegates a human actor; Personal must be its owner. */
export function assertFiscalHumanActor(workspaceId: string, actorId: string): void {
  if (!z.uuid().safeParse(actorId).success
    || (workspaceId.startsWith('personal:') && workspaceId !== `personal:${actorId}`))
    throw new Error('ARCA_FISCAL_BETA_ACTOR_UNAUTHORIZED');
}
