import { describe, expect, test } from 'bun:test';

import {
  TAX_COMMAND_DESCRIPTORS_V1,
  TAX_COMMAND_IDS_V1,
  taxCommandReceiptV1Schema,
  taxCommandReplayPairV1Schema,
  taxCommandRequestV1Schema,
} from './commands';

describe('Tax browser command contract', () => {
  test('freezes OCC, idempotency, approvals, and external-effect descriptors', () => {
    expect(TAX_COMMAND_DESCRIPTORS_V1).toHaveLength(TAX_COMMAND_IDS_V1.length);
    expect(new Set(TAX_COMMAND_DESCRIPTORS_V1.map(command => command.commandId)).size).toBe(TAX_COMMAND_IDS_V1.length);
    expect(TAX_COMMAND_DESCRIPTORS_V1.every(command => command.idempotencyRequired)).toBe(true);
    expect(TAX_COMMAND_DESCRIPTORS_V1.every(command => command.optimisticConcurrency.kind === 'case_revision')).toBe(true);
    expect(TAX_COMMAND_DESCRIPTORS_V1.find(command => command.commandId === 'approve_arca_invoice_intent')).toMatchObject({
      risk: 'external_effect',
      approval: 'dual_control',
    });
  });

  test('requires a case revision and UUID idempotency key', () => {
    const request = {
      version: 'tax-command-request-v1',
      commandId: 'confirm_profile',
      workspaceId: 'workspace:ar-exporter',
      caseId: 'case:ar-exporter:2026',
      actionId: 'action:confirm-profile',
      expectedCaseRevision: 7,
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      payloadRef: 'payload:confirm-profile:1',
    };
    expect(taxCommandRequestV1Schema.safeParse(request).success).toBe(true);
    expect(taxCommandRequestV1Schema.safeParse({ ...request, expectedCaseRevision: 0 }).success).toBe(false);
    expect(taxCommandRequestV1Schema.safeParse({ ...request, idempotencyKey: 'retry-me' }).success).toBe(false);
  });

  test('returns the original applied transition when an idempotent request is replayed', () => {
    const original = {
      version: 'tax-command-receipt-v1',
      commandId: 'confirm_profile',
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
      operationRef: 'operation:confirm-profile:1',
      previousCaseRevision: 7,
      caseRevision: 8,
      replayed: false,
    } as const;
    const replay = { ...original, replayed: true } as const;

    expect(taxCommandReceiptV1Schema.safeParse(original).success).toBe(true);
    expect(taxCommandReceiptV1Schema.safeParse(replay).success).toBe(true);
    expect(taxCommandReceiptV1Schema.safeParse({ ...original, caseRevision: 7 }).success).toBe(false);
    expect(taxCommandReplayPairV1Schema.safeParse({ original, replay }).success).toBe(true);

    const secondTransition = {
      ...replay,
      previousCaseRevision: replay.caseRevision,
      caseRevision: replay.caseRevision + 1,
    };
    expect(taxCommandReceiptV1Schema.safeParse(secondTransition).success).toBe(true);
    expect(taxCommandReplayPairV1Schema.safeParse({ original, replay: secondTransition }).success).toBe(false);
  });
});
