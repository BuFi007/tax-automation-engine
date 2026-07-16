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
  version: 'ar-catalogue-2026-07-15',
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
      ruleVersionIds: [RULES.monotributo, RULES.monotributoPayment, RULES.recategorization, RULES.iibbCaba, RULES.iibbBuenosAires, ...ARGENTINA_FACTURA_E_RULE_IDS],
    },
    {
      id: 'responsable_inscripto',
      entityTypes: ['individual'],
      label: 'Responsable Inscripto',
      description: 'IVA, income-tax, provincial, invoice, and annual evidence workflow.',
      requiredQuestions: ['province', 'iibb_regime', 'exports_services', 'export_pos_ready'],
      ruleVersionIds: [RULES.ivaSimple, RULES.individualAnnual2025, RULES.iibbCaba, RULES.iibbBuenosAires, ...ARGENTINA_FACTURA_E_RULE_IDS],
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
    const year = taxYear(period);
    const paymentMonth = nextMonth(period);
    const iibb = iibbProjection(iibbRegime, cuitDueGroup, paymentMonth);
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

function iibbProjection(
  regimeValue: TaxProfile['answers'][number]['value'] | undefined,
  dueGroupValue: TaxProfile['answers'][number]['value'] | undefined,
  paymentMonth: Readonly<{ year: number; month: number }>
): Readonly<{
  dueDate: string | null;
  applicability: TaxObligation['applicability'];
  description: string;
  ruleVersionIds: readonly string[];
}> {
  const regime = isIibbRegime(regimeValue) ? regimeValue : 'needs_classification';
  const dueGroup = isCuitDueGroup(dueGroupValue) ? dueGroupValue : null;
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
    const anticipo = paymentMonth.year === 2027 && paymentMonth.month === 1
      ? 12
      : paymentMonth.year === 2026
        ? paymentMonth.month - 1
        : null;
    const dueDate = anticipo && dueGroup
      ? BUENOS_AIRES_LOCAL_2026_DUE_DATES[dueGroup]?.[anticipo] ?? null
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
  return {
    dueDate: null,
    applicability: 'needs_professional_review',
    description: regime === 'convenio_multilateral'
      ? 'Convenio Multilateral requires its separate SIFERE/COMARB calendar and professional jurisdiction allocation; no provincial local deadline is substituted.'
      : 'Resolve the local or multilateral regime before applying a taxpayer-specific IIBB calendar.',
    ruleVersionIds: [RULES.iibbCaba, RULES.iibbBuenosAires],
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

const BUENOS_AIRES_LOCAL_2026_DUE_DATES: Readonly<
  Record<CuitDueGroup, Readonly<Record<number, string>>>
> = {
  '0_1': localDates([23, 25, 20, 18, 22, 20, 24, 21, 19, 24, 21, 18]),
  '2_3': localDates([24, 26, 21, 19, 23, 21, 25, 22, 20, 25, 22, 19]),
  '4_5': localDates([25, 27, 22, 20, 24, 22, 26, 23, 21, 26, 23, 20]),
  '6_7': localDates([26, 30, 23, 21, 25, 23, 27, 24, 22, 27, 28, 21]),
  '8_9': localDates([27, 31, 24, 22, 26, 24, 28, 25, 23, 30, 29, 22]),
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
