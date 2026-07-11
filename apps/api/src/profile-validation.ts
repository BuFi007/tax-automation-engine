import { getJurisdictionProvider } from '@tax-engine/core';
import type { CatalogueQuestion, TaxProfile, TaxProfileAnswer } from '@tax-engine/core';

export function assertCatalogueSafeProfile(profile: TaxProfile): void {
  const provider = getJurisdictionProvider(profile.jurisdiction);
  const catalogue = provider.catalogue;
  if (profile.catalogueVersion !== catalogue.version) throw new Error('PROFILE_CATALOGUE_VERSION_MISMATCH');

  const regime = catalogue.regimes.find(candidate => candidate.id === profile.regimeId);
  if (!regime) throw new Error('UNSUPPORTED_REGIME');
  if (!regime.entityTypes.includes(profile.entityType)) throw new Error('PROFILE_ENTITY_REGIME_MISMATCH');

  const questions = new Map(catalogue.questions.map(question => [question.id, question]));
  const seen = new Set<string>();
  for (const answer of profile.answers) {
    if (seen.has(answer.questionId)) throw new Error('DUPLICATE_PROFILE_QUESTION');
    seen.add(answer.questionId);
    const question = questions.get(answer.questionId);
    if (!question) throw new Error('UNKNOWN_PROFILE_QUESTION');
    if (!validAnswer(question, answer)) throw new Error('INVALID_PROFILE_ANSWER');
  }

  const validationErrors = provider.validateProfile(profile);
  if (validationErrors.length) throw new Error(validationErrors[0]);
}

function validAnswer(question: CatalogueQuestion, answer: TaxProfileAnswer): boolean {
  switch (question.kind) {
    case 'boolean':
      return typeof answer.value === 'boolean';
    case 'integer':
      return typeof answer.value === 'number' && Number.isSafeInteger(answer.value);
    case 'multi_select':
      return Array.isArray(answer.value) && answer.value.every(value => typeof value === 'string');
    case 'country':
      return typeof answer.value === 'string' && /^[A-Z]{2}$/.test(answer.value);
    case 'subdivision':
      return typeof answer.value === 'string' && answer.value.length > 0;
    case 'enum':
      return typeof answer.value === 'string' && (!question.options || question.options.some(option => option.value === answer.value));
  }
}
