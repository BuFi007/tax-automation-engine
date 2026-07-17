import type { JurisdictionCatalogue, TaxJurisdictionProvider, WorkflowBuildContext } from './types';
import type { EvidenceMoney, TaxObligation, TaxProfile } from '../types';
import { FinancialDecimal, isFinancialDecimal } from '../financial-decimal';
import { isoDate, localEndOfDay, nextMonth, taxYear } from './calendar';

const RULES = {
  monotributo: 'ar-monotributo-export-v1',
  facturaE: 'ar-rg-4401-factura-e-v1',
  wsfex: 'arca-wsfex-3.1.1',
  bcraServiceExports: 'bcra-a8330-service-exports-v1',
  recategorization: 'ar-monotributo-recat-v1',
  monotributoPayment: 'ar-monotributo-payment-2026-v1',
  monotributoCategories: 'ar-monotributo-categories-2026-02-v1',
  domesticInvoices: 'ar-invoice-class-matrix-2026-v1',
  iibbCaba: 'ar-caba-iibb-2026-v1',
  iibbCabaLocal: 'ar-caba-iibb-local-calendar-2026-v1',
  iibbConvenio: 'ar-convenio-multilateral-sifere-2026-v1',
  iibbCabaUnifiedPayment: 'ar-caba-iibb-unified-payment-2026-v1',
  iibbBuenosAires: 'ar-ba-iibb-2026-v1',
  iibbBuenosAiresUnifiedPayment: 'ar-ba-iibb-unified-payment-2026-v1',
  ivaSimple: 'ar-iva-simple-2026-v1',
  ivaGeneralSchedule: 'ar-rg-4172-iva-calendar-v1',
  argentinaHolidays2026: 'ar-national-holidays-2026-v1',
  individualAnnual2025: 'ar-individual-annual-2025-v1',
  gananciasSimplified: 'ar-ganancias-simplified-rg-5820-v1',
  corporateAnnual2026: 'ar-corporate-income-calendar-2026-v1',
  mipyme: 'ar-mipyme-v1',
  knowledgeEconomy: 'ar-economia-conocimiento-v1',
} as const;

export const ARGENTINA_FACTURA_E_RULE_IDS = [RULES.facturaE, RULES.wsfex, RULES.bcraServiceExports] as const;

export const argentinaCatalogue: JurisdictionCatalogue = {
  jurisdiction: 'AR',
  version: 'ar-catalogue-2026-07-16.2',
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
    { id: 'monotributo_category', label: 'Current Monotributo category', kind: 'enum', required: false, options: [...'ABCDEFGHIJK'].map(value => ({ value, label: `Category ${value}` })) },
    { id: 'fiscal_year_end_month', label: 'Fiscal year-end month', kind: 'integer', required: false },
    { id: 'ganancias_simplified_status', label: 'Ganancias simplified-regime status', kind: 'enum', required: false, options: [
      { value: 'not_enrolled', label: 'Not enrolled' },
      { value: 'enrolled', label: 'Enrollment verified' },
      { value: 'needs_review', label: 'Needs eligibility review' },
    ] },
    { id: 'tax_accounting_basis', label: 'Confirmed tax accounting basis', kind: 'enum', required: false, options: [
      { value: 'cash', label: 'Cash basis' },
      { value: 'accrual', label: 'Accrual basis' },
      { value: 'needs_review', label: 'Needs professional review' },
    ] },
    { id: 'exports_services', label: 'Exports services', kind: 'boolean', required: true },
    { id: 'export_pos_ready', label: 'Export point of sale configured', kind: 'boolean', required: false },
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
      requiredQuestions: ['province', 'iibb_regime', 'exports_services', 'monotributo_category'],
      ruleVersionIds: [RULES.monotributo, RULES.monotributoPayment, RULES.monotributoCategories, RULES.recategorization, RULES.domesticInvoices, RULES.iibbCaba, RULES.iibbCabaLocal, RULES.iibbConvenio, RULES.iibbBuenosAires, ...ARGENTINA_FACTURA_E_RULE_IDS],
    },
    {
      id: 'responsable_inscripto',
      entityTypes: ['individual'],
      label: 'Responsable Inscripto',
      description: 'IVA, income-tax, provincial, invoice, and annual evidence workflow.',
      requiredQuestions: ['province', 'iibb_regime', 'exports_services', 'cuit_verifier_digit', 'tax_accounting_basis'],
      ruleVersionIds: [RULES.ivaSimple, RULES.ivaGeneralSchedule, RULES.argentinaHolidays2026, RULES.individualAnnual2025, RULES.gananciasSimplified, RULES.domesticInvoices, RULES.iibbCaba, RULES.iibbCabaLocal, RULES.iibbConvenio, RULES.iibbBuenosAires, ...ARGENTINA_FACTURA_E_RULE_IDS],
    },
    {
      id: 'sociedad_mipyme',
      entityTypes: ['company'],
      label: 'Sociedad / MiPyME',
      description: 'Company workflow with independent MiPyME and knowledge-economy readiness branches.',
      requiredQuestions: ['province', 'iibb_regime', 'exports_services', 'cuit_verifier_digit', 'fiscal_year_end_month', 'tax_accounting_basis'],
      ruleVersionIds: [RULES.ivaSimple, RULES.ivaGeneralSchedule, RULES.argentinaHolidays2026, RULES.corporateAnnual2026, RULES.domesticInvoices, RULES.iibbCaba, RULES.iibbCabaLocal, RULES.iibbConvenio, RULES.iibbBuenosAires, RULES.mipyme, RULES.knowledgeEconomy, ...ARGENTINA_FACTURA_E_RULE_IDS],
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
      id: RULES.monotributoCategories,
      jurisdiction: 'AR',
      effectiveFrom: '2026-02-01',
      effectiveTo: null,
      sourceUrl: 'https://arca.gob.ar/monotributo/categorias.asp',
      title: 'ARCA Monotributo · categories and amounts from February 2026',
      reviewedByAccountant: false,
      version: '2026.02.1',
    },
    {
      id: RULES.domesticInvoices,
      jurisdiction: 'AR',
      effectiveFrom: '2025-12-01',
      effectiveTo: null,
      sourceUrl: 'https://www.arca.gob.ar/facturacion/regimen-general/comprobantes.asp',
      title: 'ARCA invoice-class matrix · A/B/C/E',
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
      id: RULES.ivaGeneralSchedule,
      jurisdiction: 'AR',
      effectiveFrom: '2018-01-01',
      effectiveTo: null,
      sourceUrl: 'https://biblioteca.arca.gob.ar/search/query/adjunto.aspx?p=t%3ARAG%7Cn%3A4172%7Co%3A3%7Ca%3A2017%7Cd%3ARG4172_efecto4186.pdf',
      title: 'ARCA RG 4172 · IVA due-date groups',
      reviewedByAccountant: false,
      version: '1',
    },
    {
      id: RULES.argentinaHolidays2026,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://www.argentina.gob.ar/feriados',
      title: 'Argentina official national holiday calendar 2026',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.individualAnnual2025,
      jurisdiction: 'AR',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2025-12-31',
      sourceUrl: 'https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A5851%7Co%3A9%7Ca%3A2026%7Cf%3A21%2F05%2F2026',
      title: 'ARCA Ganancias y Bienes Personales · período fiscal 2025',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.gananciasSimplified,
      jurisdiction: 'AR',
      effectiveFrom: '2026-02-09',
      effectiveTo: null,
      sourceUrl: 'https://biblioteca.arca.gob.ar/search/query/norma.aspx?p=t%3ARAG%7Cn%3A5820%7Co%3A9%7Ca%3A2026%7Cf%3A08%2F02%2F2026',
      title: 'ARCA RG 5820/2026 · optional simplified Ganancias return',
      reviewedByAccountant: false,
      version: '2026.1',
    },
    {
      id: RULES.corporateAnnual2026,
      jurisdiction: 'AR',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      sourceUrl: 'https://arca.gob.ar/gananciasYBienes/ganancias/personas-juridicas/declaracion-jurada/documentos/Ganancias-vencimientos-PJ.pdf',
      title: 'ARCA Ganancias personas jurídicas · due dates 2026',
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
    const answerMap = new Map(profile.answers.map(answer => [answer.questionId, answer.value]));
    if (answerMap.size !== profile.answers.length) return ['DUPLICATE_PROFILE_QUESTION'];
    const errors = regime.requiredQuestions
      .filter(question => !answerMap.has(question))
      .map(question => `MISSING_${question.toUpperCase()}`);
    if (answerMap.has('iibb_regime') && !isIibbRegime(answerMap.get('iibb_regime'))) errors.push('INVALID_IIBB_REGIME');
    if (answerMap.has('cuit_due_group') && !isCuitDueGroup(answerMap.get('cuit_due_group'))) errors.push('INVALID_CUIT_DUE_GROUP');
    if (answerMap.has('cuit_verifier_digit') && !isCuitVerifierDigit(answerMap.get('cuit_verifier_digit'))) errors.push('INVALID_CUIT_VERIFIER_DIGIT');
    if (answerMap.has('exports_services') && typeof answerMap.get('exports_services') !== 'boolean') errors.push('INVALID_EXPORTS_SERVICES');
    if (answerMap.get('exports_services') === true && typeof answerMap.get('export_pos_ready') !== 'boolean') errors.push('MISSING_EXPORT_POS_READY');
    if (profile.regimeId === 'monotributo_exportador' && answerMap.has('monotributo_category') && !isMonotributoCategory(answerMap.get('monotributo_category'))) errors.push('INVALID_MONOTRIBUTO_CATEGORY');
    if (profile.entityType === 'company' && answerMap.has('fiscal_year_end_month') && !isFiscalYearEndMonth(answerMap.get('fiscal_year_end_month'))) errors.push('INVALID_FISCAL_YEAR_END_MONTH');
    if ((profile.regimeId === 'responsable_inscripto' || profile.entityType === 'company') && answerMap.has('tax_accounting_basis') && !isTaxAccountingBasis(answerMap.get('tax_accounting_basis'))) errors.push('INVALID_TAX_ACCOUNTING_BASIS');
    return [...new Set(errors)];
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
    const verifierDigit = isCuitVerifierDigit(cuitVerifierDigit) ? cuitVerifierDigit : null;
    const fiscalYearEndMonth = isFiscalYearEndMonth(answerMap.get('fiscal_year_end_month')) ? answerMap.get('fiscal_year_end_month') as number : null;
    const gananciasSimplifiedStatus = answerMap.get('ganancias_simplified_status');
    const year = taxYear(period);
    const periodEndMonth = Number(period.end.slice(5, 7));
    const paymentMonth = nextMonth(period);
    const iibb = iibbProjection(iibbRegime, cuitDueGroup, cuitVerifierDigit, paymentMonth);
    const obligations: TaxObligation[] = [
      {
        ...shared,
        id: 'ar:invoice-readiness',
        category: 'invoice',
        title: exportsServices
          ? 'Factura E readiness and collection evidence'
          : profile.regimeId === 'monotributo_exportador'
            ? 'Factura C readiness'
            : 'Factura A/B readiness',
        description: exportsServices
          ? 'Prepare Factura E intent and collection evidence. User approval and an authority receipt remain separate.'
          : profile.regimeId === 'monotributo_exportador'
            ? 'Domestic Monotributo operations use class C. Point-of-sale readiness, issuance, and authority receipt remain separate.'
            : 'Domestic class A or B depends on the receiver and emitter authorization. Prepare the invoice without inferring its class or authority result.',
        evidenceRequirementIds: ['ar:req:invoice', 'ar:req:collection'],
        ruleVersionIds: exportsServices
          ? profile.regimeId === 'monotributo_exportador'
            ? [RULES.monotributo, ...ARGENTINA_FACTURA_E_RULE_IDS]
            : [...ARGENTINA_FACTURA_E_RULE_IDS]
          : [RULES.domesticInvoices],
        actionId: exportsServices ? 'action:prepare-factura-e' : 'action:prepare-domestic-invoice',
        applicability: unknown ? 'unknown' : 'applicable',
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
      const annualDue = year === 2025 ? localEndOfDay('2026-07-27', '-03:00') : null;
      obligations.push(
        {
          ...shared,
          id: 'ar:ganancias-individual-annual',
          category: 'annual_return',
          title: 'Ganancias annual return readiness',
          description: 'Prepare annual income, deductions, foreign-source and related-entity evidence. A professional confirms filing applicability and the general or verified simplified path.',
          evidenceRequirementIds: ['ar:req:annual-ledger', 'ar:req:foreign-income', 'ar:req:deductions', 'ar:req:related-entities', 'ar:req:tax-accounting-basis'],
          ruleVersionIds: [RULES.individualAnnual2025, RULES.gananciasSimplified],
          actionId: 'action:prepare-ganancias-packet',
          dueAt: annualDue,
          applicability: unknown ? 'unknown' : 'needs_professional_review',
          preparationState: 'unknown',
        },
        {
          ...shared,
          id: 'ar:bienes-personales-annual',
          category: 'annual_return',
          title: 'Bienes Personales annual evidence and filing review',
          description: 'Prepare the year-end domestic, foreign, and digital-asset holdings snapshot. Filing applicability and valuation remain under professional review.',
          evidenceRequirementIds: ['ar:req:year-end-holdings', 'ar:req:foreign-assets', 'ar:req:digital-assets', 'ar:req:valuation-sources'],
          ruleVersionIds: [RULES.individualAnnual2025],
          actionId: 'action:prepare-bienes-personales-packet',
          dueAt: annualDue,
          applicability: unknown ? 'unknown' : 'needs_professional_review',
          preparationState: 'unknown',
        },
        {
          ...shared,
          id: 'ar:ganancias-simplified-review',
          category: 'other',
          title: 'Optional simplified Ganancias regime review',
          description: gananciasSimplifiedStatus === 'enrolled'
            ? 'Enrollment evidence is recorded, but annual eligibility, ratification, return confirmation, and acceptance remain separate.'
            : 'Review the effective-dated statutory and ARCA eligibility conditions. BUFI does not infer enrollment or promise the regime benefits.',
          evidenceRequirementIds: ['ar:req:ganancias-simplified-status', 'ar:req:income-thresholds', 'ar:req:asset-thresholds', 'ar:req:arca-characterization'],
          ruleVersionIds: [RULES.gananciasSimplified],
          actionId: 'action:review-ganancias-simplified',
          dueAt: annualDue,
          applicability: unknown ? 'unknown' : 'needs_professional_review',
          preparationState: 'unknown',
        },
      );
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
          evidenceRequirementIds: ['ar:req:monotributo-category', 'ar:req:income-ledger', 'ar:req:payment-status'],
          ruleVersionIds: [RULES.monotributoPayment, RULES.monotributoCategories],
          actionId: 'action:prepare-monotributo-payment',
          dueAt: monthlyDue ? localEndOfDay(monthlyDue, '-03:00') : null,
        },
        ...(['02', '08'] as const).map(month => ({
          ...shared,
          id: `ar:recategorization:${month}`,
          category: 'recategorization' as const,
          title: `Monotributo recategorization review · ${month === '02' ? 'February' : 'August'}`,
          description: 'Evaluate the prior 12 months. Submit only when the effective category changes.',
          evidenceRequirementIds: ['ar:req:rolling-revenue', 'ar:req:monotributo-category', 'ar:req:activity-months', 'ar:req:category-assessment'],
          ruleVersionIds: [RULES.recategorization, RULES.monotributoCategories],
          actionId: 'action:review-recategorization',
          dueAt: year === 2026 ? localEndOfDay(`2026-${month}-05`, '-03:00') : null,
        }))
      );
    }

    if (profile.regimeId === 'responsable_inscripto' || profile.entityType === 'company') {
      const ivaDue = ivaDueDate(paymentMonth, verifierDigit);
      obligations.push({
        ...shared,
        id: 'ar:iva-simple',
        category: 'monthly_regime',
        title: 'IVA Simple monthly declaration and payment',
        description: ivaDue
          ? 'The IVA Simple declaration/payment deadline is bound to the minimized CUIT verifier digit. Preparation, submission, acceptance, and payment remain independent.'
          : 'Select only the CUIT verifier digit before applying the official IVA due-date group. The full CUIT is not required.',
        evidenceRequirementIds: ['ar:req:income-ledger', 'ar:req:expense-ledger', 'ar:req:iva-tax-lines'],
        ruleVersionIds: [RULES.ivaSimple, RULES.ivaGeneralSchedule, RULES.argentinaHolidays2026],
        actionId: 'action:prepare-iva-simple',
        dueAt: ivaDue ? localEndOfDay(ivaDue, '-03:00') : null,
        applicability: unknown ? 'unknown' : verifierDigit ? 'applicable' : 'needs_professional_review',
        preparationState: unknown || !verifierDigit ? 'unknown' : 'not_started',
      });
    }

    if (profile.regimeId === 'sociedad_mipyme') {
      const corporateDue = fiscalYearEndMonth === periodEndMonth
        ? corporateIncomeDueDate2026(year, fiscalYearEndMonth, verifierDigit)
        : null;
      obligations.push(
        {
          ...shared,
          id: 'ar:ganancias-corporate-annual',
          category: 'annual_return',
          title: 'Corporate Ganancias return and payment readiness',
          description: corporateDue
            ? 'The filing deadline is bound to fiscal year-end and the minimized CUIT verifier digit. Any balance payment is due the next business day and remains a separate satisfaction state.'
            : 'Confirm fiscal year-end and the CUIT verifier digit against the bounded official 2026 company calendar before publishing a deadline.',
          evidenceRequirementIds: ['ar:req:trial-balance', 'ar:req:annual-ledger', 'ar:req:tax-adjustments', 'ar:req:related-entities', 'ar:req:tax-accounting-basis'],
          ruleVersionIds: [RULES.corporateAnnual2026],
          actionId: 'action:prepare-corporate-ganancias',
          dueAt: corporateDue ? localEndOfDay(corporateDue, '-03:00') : null,
          applicability: unknown ? 'unknown' : corporateDue ? 'applicable' : 'needs_professional_review',
          preparationState: unknown || !corporateDue ? 'unknown' : 'not_started',
        },
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

export type MonotributoCategory = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'I' | 'J' | 'K';

export const MONOTRIBUTO_SERVICE_CATEGORY_CEILINGS_2026: Readonly<Record<MonotributoCategory, string>> = {
  A: '10277988.13',
  B: '15058447.71',
  C: '21113696.52',
  D: '26212853.42',
  E: '30833964.37',
  F: '38642048.36',
  G: '46211109.37',
  H: '70113407.33',
  I: '78479211.62',
  J: '89872640.30',
  K: '108357084.05',
};

export type MonotributoCategoryAssessmentV1 = Readonly<{
  version: 'monotributo-category-assessment-v1';
  asOf: string;
  currentCategory: MonotributoCategory;
  recommendedCategory: MonotributoCategory | null;
  rollingGrossRevenue: EvidenceMoney;
  currentCategoryCeiling: EvidenceMoney;
  maximumCeiling: EvidenceMoney;
  activityMonths: number;
  state: 'not_due_under_six_months' | 'within_category' | 'recategorization_required' | 'exclusion_review';
  ruleVersionIds: readonly [typeof RULES.monotributoCategories, typeof RULES.recategorization];
  sourceUrl: 'https://arca.gob.ar/monotributo/categorias.asp';
}>;

export function assessMonotributoServiceCategory2026(input: Readonly<{
  asOf: string;
  currentCategory: string;
  rollingGrossRevenue: EvidenceMoney;
  activityMonths: number;
}>): MonotributoCategoryAssessmentV1 {
  const asOf = Date.parse(input.asOf);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(input.asOf) || !/[zZ]|[+-]\d\d:\d\d$/.test(input.asOf) || !Number.isFinite(asOf)) throw new Error('MONOTRIBUTO_AS_OF_INVALID');
  if (asOf < Date.parse('2026-02-01T00:00:00.000-03:00')) throw new Error('MONOTRIBUTO_RULE_NOT_EFFECTIVE');
  if (!isMonotributoCategory(input.currentCategory)) throw new Error('MONOTRIBUTO_CATEGORY_INVALID');
  if (input.rollingGrossRevenue.currency !== 'ARS' || !isFinancialDecimal(input.rollingGrossRevenue.decimal)) throw new Error('MONOTRIBUTO_REVENUE_INVALID');
  const revenue = new FinancialDecimal(input.rollingGrossRevenue.decimal);
  if (revenue.isNegative()) throw new Error('MONOTRIBUTO_REVENUE_INVALID');
  if (!Number.isInteger(input.activityMonths) || input.activityMonths < 0 || input.activityMonths > 1200) throw new Error('MONOTRIBUTO_ACTIVITY_MONTHS_INVALID');
  const ordered = Object.entries(MONOTRIBUTO_SERVICE_CATEGORY_CEILINGS_2026) as [MonotributoCategory, string][];
  const recommended = ordered.find(([, ceiling]) => revenue.lte(ceiling))?.[0] ?? null;
  const currentIndex = ordered.findIndex(([category]) => category === input.currentCategory);
  const recommendedIndex = recommended ? ordered.findIndex(([category]) => category === recommended) : -1;
  const state = input.activityMonths < 6
    ? 'not_due_under_six_months'
    : recommended === null
      ? 'exclusion_review'
      : recommendedIndex === currentIndex
        ? 'within_category'
        : 'recategorization_required';
  return {
    version: 'monotributo-category-assessment-v1',
    asOf: input.asOf,
    currentCategory: input.currentCategory,
    recommendedCategory: recommended,
    rollingGrossRevenue: input.rollingGrossRevenue,
    currentCategoryCeiling: { decimal: MONOTRIBUTO_SERVICE_CATEGORY_CEILINGS_2026[input.currentCategory], currency: 'ARS' },
    maximumCeiling: { decimal: MONOTRIBUTO_SERVICE_CATEGORY_CEILINGS_2026.K, currency: 'ARS' },
    activityMonths: input.activityMonths,
    state,
    ruleVersionIds: [RULES.monotributoCategories, RULES.recategorization],
    sourceUrl: 'https://arca.gob.ar/monotributo/categorias.asp',
  };
}

const IVA_2026_DUE_DATES: Readonly<Record<string, Readonly<Record<CuitDueGroup, string>>>> = {
  '2026-02': dueGroupDates(['2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23', '2026-02-24']),
  '2026-03': dueGroupDates(['2026-03-18', '2026-03-19', '2026-03-20', '2026-03-25', '2026-03-26']),
  '2026-04': dueGroupDates(['2026-04-20', '2026-04-21', '2026-04-22', '2026-04-23', '2026-04-24']),
  '2026-05': dueGroupDates(['2026-05-18', '2026-05-19', '2026-05-20', '2026-05-21', '2026-05-22']),
  '2026-06': dueGroupDates(['2026-06-18', '2026-06-19', '2026-06-22', '2026-06-23', '2026-06-24']),
  '2026-07': dueGroupDates(['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']),
  '2026-08': dueGroupDates(['2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21', '2026-08-24']),
  '2026-09': dueGroupDates(['2026-09-18', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']),
  '2026-10': dueGroupDates(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']),
  '2026-11': dueGroupDates(['2026-11-18', '2026-11-19', '2026-11-20', '2026-11-24', '2026-11-25']),
  '2026-12': dueGroupDates(['2026-12-18', '2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24']),
  '2027-01': dueGroupDates(['2027-01-18', '2027-01-19', '2027-01-20', '2027-01-21', '2027-01-22']),
};

type CorporateDueGroup = '0_3' | '4_6' | '7_9';

const CORPORATE_INCOME_2026_DUE_DATES: Readonly<Record<string, Readonly<Record<CorporateDueGroup, string>>>> = {
  '2025-08': corporateDueGroupDates(['2026-01-13', '2026-01-14', '2026-01-15']),
  '2025-09': corporateDueGroupDates(['2026-02-13', '2026-02-18', '2026-02-19']),
  '2025-10': corporateDueGroupDates(['2026-03-13', '2026-03-16', '2026-03-17']),
  '2025-11': corporateDueGroupDates(['2026-04-13', '2026-04-14', '2026-04-15']),
  '2025-12': corporateDueGroupDates(['2026-05-13', '2026-05-14', '2026-05-15']),
  '2026-01': corporateDueGroupDates(['2026-06-16', '2026-06-17', '2026-06-18']),
  '2026-02': corporateDueGroupDates(['2026-07-13', '2026-07-14', '2026-07-15']),
  '2026-03': corporateDueGroupDates(['2026-08-13', '2026-08-14', '2026-08-18']),
  '2026-04': corporateDueGroupDates(['2026-09-14', '2026-09-15', '2026-09-16']),
  '2026-05': corporateDueGroupDates(['2026-10-13', '2026-10-14', '2026-10-15']),
  '2026-06': corporateDueGroupDates(['2026-11-13', '2026-11-16', '2026-11-17']),
  '2026-07': corporateDueGroupDates(['2026-12-14', '2026-12-15', '2026-12-16']),
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

function isMonotributoCategory(value: unknown): value is MonotributoCategory {
  return typeof value === 'string' && /^[A-K]$/.test(value);
}

function isFiscalYearEndMonth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12;
}

function isTaxAccountingBasis(value: unknown): value is 'cash' | 'accrual' | 'needs_review' {
  return value === 'cash' || value === 'accrual' || value === 'needs_review';
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

function ivaDueDate(paymentMonth: Readonly<{ year: number; month: number }>, digit: CuitVerifierDigit | null): string | null {
  if (!digit) return null;
  const key = `${paymentMonth.year}-${paymentMonth.month.toString().padStart(2, '0')}`;
  return IVA_2026_DUE_DATES[key]?.[localDueGroupFromDigit(digit)] ?? null;
}

function corporateIncomeDueDate2026(closeYear: number, closeMonth: number, digit: CuitVerifierDigit | null): string | null {
  if (!digit) return null;
  const key = `${closeYear}-${closeMonth.toString().padStart(2, '0')}`;
  return CORPORATE_INCOME_2026_DUE_DATES[key]?.[corporateDueGroupFromDigit(digit)] ?? null;
}

function corporateDueGroupFromDigit(digit: CuitVerifierDigit): CorporateDueGroup {
  if (digit === '0' || digit === '1' || digit === '2' || digit === '3') return '0_3';
  if (digit === '4' || digit === '5' || digit === '6') return '4_6';
  return '7_9';
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

function dueGroupDates(dates: readonly [string, string, string, string, string]): Readonly<Record<CuitDueGroup, string>> {
  return { '0_1': dates[0], '2_3': dates[1], '4_5': dates[2], '6_7': dates[3], '8_9': dates[4] };
}

function corporateDueGroupDates(dates: readonly [string, string, string]): Readonly<Record<CorporateDueGroup, string>> {
  return { '0_3': dates[0], '4_6': dates[1], '7_9': dates[2] };
}
