import {
  hashCanonical,
  type FacturaEAgentRunV1,
} from '@tax-engine/core';
import {
  authorityPayloadSchema,
  type AuthorityPayload,
} from '@tax-engine/wsfex-signer/contracts';

import type { FacturaEAuthorityPrivatePreparation } from './factura-e-authority-preparation';

/** Builds the exact private WSFEX document from a frozen Tax intent plus fields
 * resolved by the private preparation boundary. */
export function buildFacturaEAuthorityPayload(
  run: FacturaEAgentRunV1,
  prepared: FacturaEAuthorityPrivatePreparation
): AuthorityPayload {
  if (
    !run.intent
    || !run.intentHash
    || run.intentState !== 'frozen'
    || run.issuanceState !== 'ready_for_wsfex'
    || run.issuancePath !== 'wsfex_delegated'
  ) throw new Error('TAX_AUTHORITY_FROZEN_APPROVED_INTENT_REQUIRED');
  if (
    run.runId !== prepared.runId
    || run.workspaceId !== prepared.workspaceId
    || run.intentHash !== prepared.intentHash
    || run.intent.taxpayerReferenceHash !== prepared.taxpayerReferenceHash
    || run.intent.foreignCustomerReferenceHash !== prepared.foreignCustomerReferenceHash
    || run.intent.workspaceId !== run.workspaceId
  ) throw new Error('TAX_AUTHORITY_PREPARATION_RUN_BINDING_MISMATCH');
  if (hashCanonical(run.intent) !== run.intentHash) {
    throw new Error('TAX_AUTHORITY_CANONICAL_INTENT_HASH_MISMATCH');
  }
  if (
    (run.intent.total.currency === 'ARS' && prepared.currencyArcaId !== 'PES')
    || (run.intent.total.currency !== 'ARS' && prepared.currencyArcaId === 'PES')
  ) throw new Error('TAX_AUTHORITY_PREPARATION_CURRENCY_MISMATCH');

  const canonicalDocument = {
    ...run.intent,
    lineItems: run.intent.lineItems.map(item => ({ ...item })),
    ruleVersionIds: [...run.intent.ruleVersionIds],
  };
  return authorityPayloadSchema.parse({
    version: 'wsfex-authority-payload-v1',
    canonicalDocument,
    issuerProfileRef: prepared.issuerProfileRef,
    taxpayerReferenceHash: prepared.taxpayerReferenceHash,
    representedCuitCommitment: prepared.representedCuitCommitment,
    subjectId: run.intent.intentId,
    intentHash: run.intentHash,
    requestId: prepared.requestId,
    invoiceNumber: prepared.invoiceNumber,
    documentType: 19,
    operationType: 2,
    pointOfSale: run.intent.pointOfSale,
    issueDate: run.intent.issueDate,
    destinationCountryArcaCode: run.intent.destinationCountryArcaCode,
    customer: {
      referenceHash: run.intent.foreignCustomerReferenceHash,
      ...prepared.customer,
    },
    currency: {
      safeCode: run.intent.total.currency,
      arcaId: prepared.currencyArcaId,
      quote: run.intent.exchangeRate?.decimal ?? '1',
    },
    sameCurrencyPayment:
      run.intent.total.currency === 'ARS' ? null : run.intent.sameCurrencyPayment,
    paymentDate: run.intent.paymentDate,
    total: run.intent.total.decimal,
    paymentTerms: run.intent.paymentTerms,
    commercialObservation: prepared.commercialObservation,
    generalObservation: prepared.generalObservation,
    language: prepared.language,
    associatedDocument: null,
    items: run.intent.lineItems.map(item => ({
      code: null,
      description: item.description,
      quantity: item.quantity,
      unitCode: item.unitCode,
      unitPrice: item.unitPrice,
      discount: '0',
      total: item.total,
    })),
  });
}
