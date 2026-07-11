import type { JurisdictionCatalogue, TaxJurisdictionProvider, WorkflowBuildContext } from './types';
import type { TaxObligation, TaxProfile } from '../types';

const RULES = {
  monotributo: 'ar-monotributo-export-v1',
  recategorization: 'ar-monotributo-recat-v1',
  mipyme: 'ar-mipyme-v1',
  knowledgeEconomy: 'ar-economia-conocimiento-v1',
} as const;

export const argentinaCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'AR',
  version: 'ar-catalogue-2026-07-10',
  displayName: 'Argentina',
  questions: [
    { id: 'province', label: 'Fiscal province', kind: 'subdivision', required: true },
    { id: 'exports_services', label: 'Exports services', kind: 'boolean', required: true },
    { id: 'export_pos_ready', label: 'Export point of sale configured', kind: 'boolean', required: true },
    { id: 'mipyme_certificate', label: 'Current MiPyME certificate', kind: 'boolean', required: false },
    { id: 'digital_assets', label: 'Has digital-asset activity', kind: 'boolean', required: false },
    { id: 'knowledge_economy_interest', label: 'Review Economía del Conocimiento', kind: 'boolean', required: false },
  ],
  regimes: [
    {
      id: 'monotributo_exportador',
      entityTypes: ['individual'],
      label: 'Monotributo · service exporter',
      description: 'Manual readiness for Factura E, collections evidence, recategorization, and annual review.',
      requiredQuestions: ['province', 'exports_services', 'export_pos_ready'],
      ruleVersionIds: [RULES.monotributo, RULES.recategorization],
    },
    {
      id: 'responsable_inscripto',
      entityTypes: ['individual'],
      label: 'Responsable Inscripto',
      description: 'IVA, income-tax, provincial, invoice, and annual evidence workflow.',
      requiredQuestions: ['province', 'exports_services', 'export_pos_ready'],
      ruleVersionIds: [RULES.monotributo],
    },
    {
      id: 'sociedad_mipyme',
      entityTypes: ['company'],
      label: 'Sociedad / MiPyME',
      description: 'Company workflow with independent MiPyME and knowledge-economy readiness branches.',
      requiredQuestions: ['province', 'exports_services'],
      ruleVersionIds: [RULES.mipyme, RULES.knowledgeEconomy],
    },
  ],
  rules: [
    {
      id: RULES.monotributo,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceUrl: 'https://www.arca.gob.ar/monotributo/exportacion-servicios/',
      title: 'ARCA exportación de servicios',
      reviewedByAccountant: false,
      version: '1',
    },
    {
      id: RULES.recategorization,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceUrl: 'https://www.arca.gob.ar/monotributo/ayuda/recategorizacion.asp',
      title: 'ARCA recategorización',
      reviewedByAccountant: false,
      version: '1',
    },
    {
      id: RULES.mipyme,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceUrl: 'https://www.argentina.gob.ar/produccion/registrar-una-pyme/certificado-pyme',
      title: 'Certificado MiPyME',
      reviewedByAccountant: false,
      version: '1',
    },
    {
      id: RULES.knowledgeEconomy,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceUrl: 'https://www.argentina.gob.ar/servicio/acceder-los-beneficios-del-regimen-de-promocion-de-la-economia-del-conocimiento',
      title: 'Régimen de Economía del Conocimiento',
      reviewedByAccountant: false,
      version: '1',
    },
  ],
};

export class ArgentinaJurisdictionProvider implements TaxJurisdictionProvider {
  readonly jurisdiction = 'AR' as const;
  readonly catalogue = argentinaCatalogue;

  validateProfile(profile: TaxProfile): readonly string[] {
    if (profile.jurisdiction !== 'AR') return ['PROFILE_JURISDICTION_MISMATCH'];
    const regime = this.catalogue.regimes.find(candidate => candidate.id === profile.regimeId);
    if (!regime) return ['UNSUPPORTED_REGIME'];
    const answers = new Set(profile.answers.map(answer => answer.questionId));
    return regime.requiredQuestions.filter(question => !answers.has(question)).map(question => `MISSING_${question.toUpperCase()}`);
  }

  buildObligations({ profile, period }: WorkflowBuildContext): readonly TaxObligation[] {
    const validation = this.validateProfile(profile);
    const unknown = validation.length > 0;
    const shared = {
      jurisdiction: 'AR' as const,
      regimeId: profile.regimeId,
      period,
      dueAt: null,
      dueTimeZone: 'America/Argentina/Buenos_Aires',
      applicability: unknown ? ('unknown' as const) : ('applicable' as const),
      preparationState: unknown ? ('unknown' as const) : ('not_started' as const),
      submissionState: 'not_submitted' as const,
      satisfactionState: 'outstanding' as const,
    };
    const obligations: TaxObligation[] = [
      {
        ...shared,
        id: 'ar:invoice-readiness',
        category: 'invoice',
        title: 'Factura E readiness and collection evidence',
        description: 'Prepare invoice intent and collection evidence. User approval and an authority receipt remain separate.',
        evidenceRequirementIds: ['ar:req:invoice', 'ar:req:collection'],
        ruleVersionIds: [RULES.monotributo],
        actionId: 'action:prepare-factura-e',
      },
      {
        ...shared,
        id: 'ar:monthly-regime',
        category: 'monthly_regime',
        title: 'Monthly tax obligations',
        description: 'Prepare workspace evidence for Monotributo/IVA and provincial review.',
        evidenceRequirementIds: ['ar:req:income-ledger', 'ar:req:expense-ledger'],
        ruleVersionIds: [RULES.monotributo],
        actionId: 'action:prepare-monthly-packet',
      },
      {
        ...shared,
        id: 'ar:annual-review',
        category: 'annual_return',
        title: 'Annual accountant review',
        description: 'Prepare Bienes Personales, income, digital-asset, and certification evidence as applicable.',
        evidenceRequirementIds: ['ar:req:annual-ledger'],
        ruleVersionIds: [RULES.monotributo],
        actionId: 'action:prepare-annual-packet',
      },
    ];

    if (profile.regimeId === 'monotributo_exportador') {
      obligations.push({
        ...shared,
        id: 'ar:recategorization',
        category: 'recategorization',
        title: 'Monotributo recategorization review',
        description: 'Review confirmed annual activity against the effective rule with an accountant.',
        evidenceRequirementIds: ['ar:req:rolling-revenue'],
        ruleVersionIds: [RULES.recategorization],
        actionId: 'action:review-recategorization',
      });
    }

    if (profile.regimeId === 'sociedad_mipyme') {
      obligations.push(
        {
          ...shared,
          id: 'ar:mipyme',
          category: 'registration',
          title: 'MiPyME certificate readiness',
          description: 'Track certificate evidence and renewal separately from other incentives.',
          evidenceRequirementIds: ['ar:req:mipyme-certificate'],
          ruleVersionIds: [RULES.mipyme],
          actionId: 'action:review-mipyme',
        },
        {
          ...shared,
          id: 'ar:knowledge-economy',
          category: 'registration',
          title: 'Economía del Conocimiento readiness',
          description: 'Prepare eligibility evidence without inferring that the company qualifies.',
          evidenceRequirementIds: ['ar:req:knowledge-economy'],
          ruleVersionIds: [RULES.knowledgeEconomy],
          actionId: 'action:review-knowledge-economy',
        }
      );
    }

    return obligations;
  }
}
