import type { JurisdictionCatalogue, TaxJurisdictionProvider, WorkflowBuildContext } from './types';
import type { TaxObligation, TaxProfile } from '../types';
import { isoDate, localEndOfDay, nextMonth, taxYear } from './calendar';

const RULES = {
  monotributo: 'ar-monotributo-export-v1',
  facturaE: 'ar-rg-4401-factura-e-v1',
  wsfex: 'arca-wsfex-3.1.1',
  bcraServiceExports: 'bcra-a8330-service-exports-v1',
  recategorization: 'ar-monotributo-recat-v1',
  monotributoPayment: 'ar-monotributo-payment-2026-v1',
  iibbCaba: 'ar-caba-iibb-2026-v1',
  iibbCabaLocal: 'ar-caba-iibb-local-calendar-2026-v1',
  iibbConvenio: 'ar-convenio-multilateral-sifere-2026-v1',
  iibbCabaUnifiedPayment: 'ar-caba-iibb-unified-payment-2026-v1',
  iibbBuenosAires: 'ar-ba-iibb-2026-v1',
  iibbBuenosAiresUnifiedPayment: 'ar-ba-iibb-unified-payment-2026-v1',
  ivaSimple: 'ar-iva-simple-2026-v1',
  individualAnnual2025: 'ar-individual-annual-2025-v1',
  mipyme: 'ar-mipyme-v1',
  knowledgeEconomy: 'ar-economia-conocimiento-v1',
} as const;

export const ARGENTINA_FACTURA_E_RULE_IDS = [RULES.facturaE, RULES.wsfex, RULES.bcraServiceExports] as const;

export const argentinaCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'AR',
  version: 'ar-catalogue-2026-07-16',
  displayName: 'Argentina',
  questions: [
    { id: 'province', label: 'Fiscal province', kind: 'subdivision', required: true },
    { id: 'iibb_regime', label: 'Ingresos Brutos regime', kind: 'enum', required: true, options: [
      { value: 'caba_simplified', label: 'CABA · Régimen Simplificado' },
      { value: 'caba_local', label: 'CABA · Local' },
      { value: 'buenos_aires_simplified', label: 'Buenos Aires · Simplified' },
      { value: 'buenos_aires_local', label: 'Buenos Aires · Local' },
      { value: 'convenio_multilateral', label: 'Convenio Multilateral' },
      { value: 'needs_classification', label: 'Needs classification' },
    ] },
    { id: 'cuit_due_group', label: 'CUIT due-date group', kind: 'enum', required: false, options: [
      { value: '0_1', label: 'Ends in 0 or 1' },
      { value: '2_3', label: 'Ends in 2 or 3' },
      { value: '4_5', label: 'Ends in 4 or 5' },
      { value: '6_7', label: 'Ends in 6 or 7' },
      { value: '8_9', label: 'Ends in 8 or 9' },
    ] },
    { id: 'cuit_verifier_digit', label: 'CUIT verifier digit (only the last digit)', kind: 'enum', required: false, options: [
      { value: '0', label: 'Ends in 0' },
      { value: '1', label: 'Ends in 1' },
      { value: '2', label: 'Ends in 2' },
      { value: '3', label: 'Ends in 3' },
      { value: '4', label: 'Ends in 4' },
      { value: '5', label: 'Ends in 5' },
      { value: '6', label: 'Ends in 6' },
      { value: '7', label: 'Ends in 7' },
      { value: '8', label: 'Ends in 8' },
      { value: '9', label: 'Ends in 9' },
    ] },
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
      requiredQuestions: ['province', 'iibb_regime', 'exports_services', 'export_pos_ready'],
      ruleVersionIds: [RULES.monotributo, RULES.monotributoPayment, RULES.recategorization, RULES.iibbCaba, RULES.iibbCabaLocal, RULES.iibbConvenio, RULES.iibbBuenosAires, ...ARGENTINA_FACTURA_E_RULE_IDS],
    },
    {
      id: 'responsable_inscripto',
      entityTypes: ['individual'],
      label: 'Responsable Inscripto',
      description: 'IVA, income-tax, provincial, invoice, and annual evidence workflow.',
      requiredQuestions: ['province', 'iibb_regime', 'exports_services', 'export_pos_ready'],
      ruleVersionIds: [RULES.ivaSimple, RULES.individualAnnual2025, RULES.iibbCaba, RULES.iibbCabaLocal, RULES.iibbConvenio, RULES.iibbBuenosAires, ...ARGENTINA_FACTURA_E_RULE_IDS],
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
      id: RULES.monotributoPayment,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://www.arca.gob.ar/monotributo/ayuda/pagos.asp',
      title: 'ARCA Monotributo · monthly payment deadline',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.iibbCaba,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://imagenes.agip.gob.ar/normativa/resoluciones/2026/resolucion-n-24agip2026',
      title: 'AGIP CABA · Régimen Simplificado IIBB 2026',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.iibbCabaLocal,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://documentosboletinoficial.buenosaires.gob.ar/publico/PE-RES-MHFGC-AGIP-557-25-ANX.pdf',
      title: 'AGIP Resolution 557/2025 · CABA local IIBB calendar 2026',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.iibbConvenio,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://ed.comarb.gob.ar/resoluciones-comarb?catid=451&id=8627%3Arg-20-vencimientos-sifere-2026&task=download.send',
      title: 'COMARB General Resolution 20/2025 · SIFERE calendar 2026',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.iibbBuenosAires,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://www.arba.gov.ar/archivos/Tramites/RN%206-2026.pdf',
      title: 'ARBA · calendar 2026 (excludes simplified and Convenio Multilateral)',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.iibbCabaUnifiedPayment,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://imagenes.agip.gob.ar/impuestos/ingresos-brutos',
      title: 'AGIP CABA · Monotributo Unificado payment deadline',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.iibbBuenosAiresUnifiedPayment,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://web.arba.gov.ar/preguntas-frecuentes/cuando-y-como-se-realizan-los-pagos-cuales-son-los-medios-de-pago-habilitados',
      title: 'ARBA · Monotributo Unificado payment deadline',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.ivaSimple,
      jurisdiction: 'AR',
      effectiveFrom: '2025-11-01',
      effectiveTo: null,
      sourceUrl: 'https://serviciosweb.arca.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=518',
      title: 'ARCA IVA Simple',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.individualAnnual2025,
      jurisdiction: 'AR',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2025-12-31',
      sourceUrl: 'https://arca.gob.ar/gananciasYBienes/bienes-personales/declaracion-jurada/vencimientos.asp',
      title: 'ARCA Ganancias y Bienes Personales · período fiscal 2025',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.facturaE,
      jurisdiction: 'AR',
      effectiveFrom: '2019-01-23',
      effectiveTo: null,
      sourceUrl: 'https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A4401%7Co%3A3%7Ca%3A2019%7Cf%3A21%2F01%2F2019',
      title: 'ARCA RG 4401/2019 · Factura E de servicios',
      reviewedByAccountant: false,
      version: '1',
    },
    {
      id: RULES.wsfex,
      jurisdiction: 'AR',
      effectiveFrom: '2025-08-18',
      effectiveTo: null,
      sourceUrl: 'https://www.arca.gob.ar/ws/documentacion/manuales/WSFEX-Manualparaeldesarrollador_V3.1.1_ARCA.pdf',
      title: 'ARCA WSFEXV1 developer manual 3.1.1',
      reviewedByAccountant: false,
      version: '3.1.1',
    },
    {
      id: RULES.bcraServiceExports,
      jurisdiction: 'AR',
      effectiveFrom: '2025-09-18',
      effectiveTo: null,
      sourceUrl: 'https://www.bcra.gob.ar/archivos/Pdfs/comytexord/A8330.pdf',
      title: 'BCRA Comunicación A 8330 · exportación de servicios',
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
    const answerMap = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    const exportsServices = answerMap.get('exports_services') === true;
    const iibbRegime = answerMap.get('iibb_regime');
    const cuitDueGroup = answerMap.get('cuit_due_group');
    const cuitVerifierDigit = answerMap.get('cuit_verifier_digit');
    const year = taxYear(period);
    const paymentMonth = nextMonth(period);
    const iibb = iibbProjection(iibbRegime, cuitDueGroup, cuitVerifierDigit, paymentMonth);
    const obligations: TaxObligation[] = [
      {
        ...shared,
        id: 'ar:invoice-readiness',
        category: 'invoice',
        title: 'Factura E readiness and collection evidence',
        description: 'Prepare invoice intent and collection evidence. User approval and an authority receipt remain separate.',
        evidenceRequirementIds: ['ar:req:invoice', 'ar:req:collection'],
        ruleVersionIds: [RULES.monotributo, ...ARGENTINA_FACTURA_E_RULE_IDS],
        actionId: 'action:prepare-factura-e',
        applicability: unknown ? 'unknown' : exportsServices ? 'applicable' : 'not_applicable',
      },
      {
        ...shared,
        id: 'ar:iibb-review',
        category: 'monthly_regime',
        title: 'Ingresos Brutos regime and filing review',
        description: iibb.description,
        evidenceRequirementIds: ['ar:req:income-ledger', 'ar:req:province', 'ar:req:iibb-regime'],
        ruleVersionIds: iibb.ruleVersionIds,
        actionId: 'action:review-iibb',
        dueAt: iibb.dueDate ? localEndOfDay(iibb.dueDate, '-03:00') : null,
        applicability: unknown ? 'unknown' : iibb.applicability,
        preparationState: unknown || iibb.applicability === 'needs_professional_review' ? 'unknown' : 'not_started',
      },
    ];

    if (profile.entityType === 'individual') {
      obligations.push({
        ...shared,
        id: 'ar:annual-individual-review',
        category: 'annual_return',
        title: 'Ganancias and Bienes Personales applicability review',
        description: 'Prepare the annual ledger, foreign assets, and digital-asset evidence. A professional confirms thresholds and filing applicability.',
        evidenceRequirementIds: ['ar:req:annual-ledger', 'ar:req:foreign-assets', 'ar:req:digital-assets'],
        ruleVersionIds: [RULES.individualAnnual2025],
        actionId: 'action:prepare-annual-packet',
        dueAt: year === 2025 ? localEndOfDay('2026-07-27', '-03:00') : null,
        applicability: unknown ? 'unknown' : 'needs_professional_review',
        preparationState: 'unknown',
      });
    }

    if (profile.regimeId === 'monotributo_exportador') {
      const monthlyDue = paymentMonth.year === 2026
        ? MONOTRIBUTO_2026_DUE_DATES[paymentMonth.month]
        : undefined;
      obligations.push(
        {
          ...shared,
          id: 'ar:monotributo-payment',
          category: 'monthly_regime',
          title: 'Monotributo monthly payment',
          description: 'Pay the monthly quota by the official day-20 deadline or the published next-business-day adjustment.',
          evidenceRequirementIds: ['ar:req:income-ledger', 'ar:req:payment-status'],
          ruleVersionIds: [RULES.monotributoPayment],
          actionId: 'action:prepare-monotributo-payment',
          dueAt: monthlyDue ? localEndOfDay(monthlyDue, '-03:00') : null,
        },
        ...(['02', '08'] as const).map(month => ({
          ...shared,
          id: `ar:recategorization:${month}`,
          category: 'recategorization' as const,
          title: `Monotributo recategorization review · ${month === '02' ? 'February' : 'August'}`,
          description: 'Evaluate the prior 12 months. Submit only when the effective category changes.',
          evidenceRequirementIds: ['ar:req:rolling-revenue'],
          ruleVersionIds: [RULES.recategorization],
          actionId: 'action:review-recategorization',
          dueAt: year === 2026 ? localEndOfDay(`2026-${month}-05`, '-03:00') : null,
        }))
      );
    }

    if (profile.regimeId === 'responsable_inscripto') {
      obligations.push({
        ...shared,
        id: 'ar:iva-simple',
        category: 'monthly_regime',
        title: 'IVA Simple monthly declaration and payment',
        description: 'Prepare IVA evidence. The exact deadline remains unset until CUIT termination and the current General Due-Date Agenda are bound.',
        evidenceRequirementIds: ['ar:req:income-ledger', 'ar:req:expense-ledger', 'ar:req:iva-tax-lines'],
        ruleVersionIds: [RULES.ivaSimple],
        actionId: 'action:prepare-iva-simple',
        dueAt: null,
        applicability: unknown ? 'unknown' : 'needs_professional_review',
        preparationState: 'unknown',
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

const MONOTRIBUTO_2026_DUE_DATES: Readonly<Record<number, string>> = {
  1: isoDate(2026, 1, 20),
  2: isoDate(2026, 2, 20),
  3: isoDate(2026, 3, 20),
  4: isoDate(2026, 4, 20),
  5: isoDate(2026, 5, 20),
  6: isoDate(2026, 6, 22),
  7: isoDate(2026, 7, 20),
  8: isoDate(2026, 8, 20),
  9: isoDate(2026, 9, 21),
  10: isoDate(2026, 10, 20),
  11: isoDate(2026, 11, 20),
  12: isoDate(2026, 12, 21),
};

type IibbRegime =
  | 'caba_simplified'
  | 'caba_local'
  | 'buenos_aires_simplified'
  | 'buenos_aires_local'
  | 'convenio_multilateral'
  | 'needs_classification';
type CuitDueGroup = '0_1' | '2_3' | '4_5' | '6_7' | '8_9';
type CuitVerifierDigit = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type ConvenioDueGroup = '0_2' | '3_5' | '6_7' | '8_9';

function iibbProjection(
  regimeValue: TaxProfile['answers'][number]['value'] | undefined,
  dueGroupValue: TaxProfile['answers'][number]['value'] | undefined,
  verifierDigitValue: TaxProfile['answers'][number]['value'] | undefined,
  paymentMonth: Readonly<{ year: number; month: number }>
): Readonly<{
  dueDate: string | null;
  applicability: TaxObligation['applicability'];
  description: string;
  ruleVersionIds: readonly string[];
}> {
  const regime = isIibbRegime(regimeValue) ? regimeValue : 'needs_classification';
  const verifierDigit = isCuitVerifierDigit(verifierDigitValue) ? verifierDigitValue : null;
  const dueGroup = verifierDigit ? localDueGroupFromDigit(verifierDigit) : isCuitDueGroup(dueGroupValue) ? dueGroupValue : null;
  const advance = iibbAdvance(paymentMonth);
  const simplifiedDue = paymentMonth.year === 2026
    ? MONOTRIBUTO_2026_DUE_DATES[paymentMonth.month] ?? null
    : null;

  if (regime === 'caba_simplified') {
    return {
      dueDate: simplifiedDue,
      applicability: 'applicable',
      description: 'CABA Régimen Simplificado is paid with Monotributo Unificado through ARCA. The official monthly deadline is bound; category and payment evidence remain separate.',
      ruleVersionIds: [RULES.iibbCaba, RULES.iibbCabaUnifiedPayment],
    };
  }
  if (regime === 'buenos_aires_simplified') {
    return {
      dueDate: simplifiedDue,
      applicability: 'applicable',
      description: 'Buenos Aires Régimen Simplificado is paid with Monotributo Unificado through ARCA. The official monthly deadline is bound; category and payment evidence remain separate.',
      ruleVersionIds: [RULES.iibbBuenosAiresUnifiedPayment],
    };
  }
  if (regime === 'buenos_aires_local') {
    const dueDate = advance && dueGroup
      ? BUENOS_AIRES_LOCAL_2026_DUE_DATES[dueGroup]?.[advance] ?? null
      : null;
    return {
      dueDate,
      applicability: 'needs_professional_review',
      description: dueGroup
        ? 'ARBA local monthly declaration deadline is bound to the confirmed CUIT due-date group. Activity treatment, rate, deductions, submission, and payment still require review.'
        : 'Select the minimized CUIT due-date group before ARBA local deadlines can be calculated. The full CUIT is not required for this calendar.',
      ruleVersionIds: [RULES.iibbBuenosAires],
    };
  }
  if (regime === 'caba_local') {
    const dueDate = advance && dueGroup
      ? CABA_LOCAL_2026_DUE_DATES[dueGroup]?.[advance] ?? null
      : null;
    const sourceHasInvalidYear = advance === 9;
    return {
      dueDate,
      applicability: 'needs_professional_review',
      description: sourceHasInvalidYear
        ? 'The official AGIP annex prints the 9th advance dates with year 2025 inside the 2026 calendar. BUFI will not silently repair an authority source; confirm the corrected October 2026 deadline with AGIP or a qualified professional.'
        : dueGroup
          ? 'CABA local monthly declaration deadline is bound to the minimized CUIT verifier group. Activity treatment, rate, deductions, submission, and payment still require review.'
          : 'Select only the CUIT verifier digit (or its local due-date group) before CABA local deadlines can be calculated. The full CUIT is not required.',
      ruleVersionIds: [RULES.iibbCabaLocal],
    };
  }
  if (regime === 'convenio_multilateral') {
    const convenioGroup = verifierDigit ? convenioDueGroupFromDigit(verifierDigit) : null;
    const dueDate = advance && convenioGroup
      ? CONVENIO_MULTILATERAL_2026_DUE_DATES[convenioGroup]?.[advance] ?? null
      : null;
    return {
      dueDate,
      applicability: 'needs_professional_review',
      description: convenioGroup
        ? 'The SIFERE CM03/CM04 deadline is bound to the minimum disclosed CUIT verifier digit. Jurisdiction allocation, coefficients, bases, submission, and payment remain under professional review.'
        : 'Select only the CUIT verifier digit before the SIFERE calendar can be applied. Existing two-digit local groups are insufficient because COMARB uses 0–2, 3–5, 6–7, and 8–9.',
      ruleVersionIds: [RULES.iibbConvenio],
    };
  }
  return {
    dueDate: null,
    applicability: 'needs_professional_review',
    description: 'Resolve the local or multilateral regime before applying a taxpayer-specific IIBB calendar.',
    ruleVersionIds: [RULES.iibbCabaLocal, RULES.iibbConvenio, RULES.iibbBuenosAires],
  };
}

function isIibbRegime(value: unknown): value is IibbRegime {
  return [
    'caba_simplified',
    'caba_local',
    'buenos_aires_simplified',
    'buenos_aires_local',
    'convenio_multilateral',
    'needs_classification',
  ].includes(value as IibbRegime);
}

function isCuitDueGroup(value: unknown): value is CuitDueGroup {
  return ['0_1', '2_3', '4_5', '6_7', '8_9'].includes(value as CuitDueGroup);
}

function isCuitVerifierDigit(value: unknown): value is CuitVerifierDigit {
  return typeof value === 'string' && /^[0-9]$/.test(value);
}

function localDueGroupFromDigit(digit: CuitVerifierDigit): CuitDueGroup {
  if (digit === '0' || digit === '1') return '0_1';
  if (digit === '2' || digit === '3') return '2_3';
  if (digit === '4' || digit === '5') return '4_5';
  if (digit === '6' || digit === '7') return '6_7';
  return '8_9';
}

function convenioDueGroupFromDigit(digit: CuitVerifierDigit): ConvenioDueGroup {
  if (digit === '0' || digit === '1' || digit === '2') return '0_2';
  if (digit === '3' || digit === '4' || digit === '5') return '3_5';
  if (digit === '6' || digit === '7') return '6_7';
  return '8_9';
}

function iibbAdvance(paymentMonth: Readonly<{ year: number; month: number }>): number | null {
  if (paymentMonth.year === 2027 && paymentMonth.month === 1) return 12;
  if (paymentMonth.year === 2026 && paymentMonth.month >= 2) return paymentMonth.month - 1;
  return null;
}

const BUENOS_AIRES_LOCAL_2026_DUE_DATES: Readonly<
  Record<CuitDueGroup, Readonly<Record<number, string>>>
> = {
  '0_1': localDates([23, 25, 20, 18, 22, 20, 24, 21, 19, 24, 21, 18]),
  '2_3': localDates([24, 26, 21, 19, 23, 21, 25, 22, 20, 25, 22, 19]),
  '4_5': localDates([25, 27, 22, 20, 24, 22, 26, 23, 21, 26, 23, 20]),
  '6_7': localDates([26, 30, 23, 21, 25, 23, 27, 24, 22, 27, 28, 21]),
  '8_9': localDates([27, 31, 24, 22, 26, 24, 28, 25, 23, 30, 29, 22]),
};

const CABA_LOCAL_2026_DUE_DATES: Readonly<
  Record<CuitDueGroup, Readonly<Record<number, string | null>>>
> = {
  '0_1': calendarDates(['2026-02-18', '2026-03-11', '2026-04-13', '2026-05-11', '2026-06-11', '2026-07-13', '2026-08-11', '2026-09-11', null, '2026-11-11', '2026-12-11', '2027-01-11']),
  '2_3': calendarDates(['2026-02-19', '2026-03-12', '2026-04-14', '2026-05-12', '2026-06-12', '2026-07-14', '2026-08-12', '2026-09-14', null, '2026-11-12', '2026-12-14', '2027-01-12']),
  '4_5': calendarDates(['2026-02-20', '2026-03-13', '2026-04-15', '2026-05-13', '2026-06-16', '2026-07-15', '2026-08-13', '2026-09-15', null, '2026-11-13', '2026-12-15', '2027-01-13']),
  '6_7': calendarDates(['2026-02-23', '2026-03-16', '2026-04-16', '2026-05-14', '2026-06-17', '2026-07-16', '2026-08-14', '2026-09-16', null, '2026-11-16', '2026-12-16', '2027-01-14']),
  '8_9': calendarDates(['2026-02-24', '2026-03-17', '2026-04-17', '2026-05-15', '2026-06-18', '2026-07-17', '2026-08-18', '2026-09-17', null, '2026-11-17', '2026-12-17', '2027-01-15']),
};

const CONVENIO_MULTILATERAL_2026_DUE_DATES: Readonly<
  Record<ConvenioDueGroup, Readonly<Record<number, string>>>
> = {
  '0_2': calendarDates(['2026-02-13', '2026-03-13', '2026-04-15', '2026-05-15', '2026-06-16', '2026-07-15', '2026-08-14', '2026-09-15', '2026-10-15', '2026-11-13', '2026-12-15', '2027-01-15']),
  '3_5': calendarDates(['2026-02-18', '2026-03-16', '2026-04-16', '2026-05-18', '2026-06-17', '2026-07-16', '2026-08-18', '2026-09-16', '2026-10-16', '2026-11-16', '2026-12-16', '2027-01-18']),
  '6_7': calendarDates(['2026-02-19', '2026-03-17', '2026-04-17', '2026-05-19', '2026-06-18', '2026-07-17', '2026-08-19', '2026-09-17', '2026-10-19', '2026-11-17', '2026-12-17', '2027-01-19']),
  '8_9': calendarDates(['2026-02-20', '2026-03-18', '2026-04-20', '2026-05-20', '2026-06-19', '2026-07-20', '2026-08-20', '2026-09-18', '2026-10-20', '2026-11-18', '2026-12-18', '2027-01-20']),
};

function localDates(days: readonly number[]): Readonly<Record<number, string>> {
  if (days.length !== 12) throw new Error('IIBB_CALENDAR_INVALID');
  return Object.fromEntries(days.map((day, index) => {
    const paymentMonth = index + 2;
    return paymentMonth <= 12
      ? [index + 1, isoDate(2026, paymentMonth, day)]
      : [index + 1, isoDate(2027, 1, day)];
  }));
}

function calendarDates<T extends string | null>(dates: readonly T[]): Readonly<Record<number, T>> {
  if (dates.length !== 12) throw new Error('IIBB_CALENDAR_INVALID');
  return Object.fromEntries(dates.map((date, index) => [index + 1, date])) as Readonly<Record<number, T>>;
}
