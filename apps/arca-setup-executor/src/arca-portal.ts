import type { Download, Locator, Page, Response } from '@cloudflare/playwright';

import { ArcaPortalError, type ArcaPortal, type ArcaService, type RelationshipState } from './portal';

/**
 * Playwright operations for ARCA's portal.
 *
 * Built from ARCA's own manuals ("Delegación de Webservices con el
 * Administrador de Relaciones", "Generación de Certificados para Producción",
 * WSASS user manual). Locators prefer roles and visible labels; each step ends
 * with a postcondition read so a changed page fails closed with
 * `ARCA_PAGE_UNRECOGNIZED` instead of clicking the wrong thing.
 *
 * Selector set version below must be bumped whenever a live run shows a change.
 */
export const ARCA_SELECTOR_SET_VERSION = 'arca-portal-2026-10-manual-derived';

export type ArcaPortalUrls = Readonly<{
  login: string;
  portal: string;
  relationshipManager: string;
  certificates: string;
  pointsOfSale: string;
}>;

export const DEFAULT_ARCA_PORTAL_URLS: Readonly<Record<'homologation' | 'production', ArcaPortalUrls>> = {
  production: {
    login: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml',
    portal: 'https://portalcf.cloud.afip.gob.ar/portal/app/',
    relationshipManager: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=adminrel',
    certificates: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=admcert',
    pointsOfSale: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel_puntos_venta',
  },
  homologation: {
    login: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml',
    portal: 'https://portalcf.cloud.afip.gob.ar/portal/app/',
    relationshipManager: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=adminrel',
    // Homologation certificates and service authorizations live in WSASS.
    certificates: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=wsass',
    pointsOfSale: 'https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=rcel_puntos_venta',
  },
};

/** ARCA's public names for the web services, as listed under ARCA > WebServices. */
const SERVICE_LABEL: Record<ArcaService, RegExp> = {
  wsfex: /factura electr[oó]nica de exportaci[oó]n/i,
  wsfe: /^\s*facturaci[oó]n electr[oó]nica\s*$/i,
};
const EXPORT_SYSTEM = /comprobantes de exportaci[oó]n\s*-\s*web\s*services/i;
const DOMESTIC_SYSTEM = /(factura electr[oó]nica\s*-\s*monotributo\s*-\s*web\s*services|rece para aplicativo y web\s*services)/i;
const CUIT_PATTERN = /\b(\d{2})-?(\d{8})-?(\d)\b/g;
const NAVIGATION_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 15_000;

export class PlaywrightArcaPortal implements ArcaPortal {
  constructor(
    private readonly page: Page,
    private readonly environment: 'homologation' | 'production',
    private readonly urls: ArcaPortalUrls = DEFAULT_ARCA_PORTAL_URLS[environment],
  ) {
    page.setDefaultTimeout(ACTION_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
  }

  async openLogin(): Promise<void> {
    await this.navigate(this.urls.login, false);
  }

  async isAuthenticated(): Promise<boolean> {
    // Read only the URL and the public header: never the credential form.
    const url = this.page.url();
    if (/login\.xhtml/.test(url) && !/action=SYSTEM/.test(url)) return false;
    const header = await this.headerText();
    return /cerrar sesi[oó]n|salir/i.test(header) || cuits(header).length > 0;
  }

  async readIdentity(): Promise<Readonly<{ loginCuit: string; representableCuits: readonly string[] }>> {
    await this.navigate(this.urls.relationshipManager, true);
    const header = await this.headerText();
    const login = cuits(header)[0];
    if (!login) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'LOGIN_IDENTITY_NOT_VISIBLE');
    const selector = this.page.locator('select').filter({ has: this.page.locator('option') }).first();
    const representable = (await selector.count()) > 0
      ? cuits((await selector.locator('option').allTextContents()).join('\n'))
      : [];
    return { loginCuit: login, representableCuits: representable.length > 0 ? representable : [login] };
  }

  async selectRepresented(cuit: string): Promise<void> {
    const select = this.page.locator('select').filter({ has: this.page.locator('option') }).first();
    if ((await select.count()) === 0) return; // The user represents only themself.
    const option = select.locator('option').filter({ hasText: new RegExp(dashed(cuit).replaceAll('-', '-?')) }).first();
    if ((await option.count()) === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'REPRESENTED_OPTION_MISSING');
    const value = await option.getAttribute('value');
    await select.selectOption(value ?? { label: (await option.textContent()) ?? '' });
    await this.clickOptional(/continuar|aceptar|ingresar/i);
    await this.page.waitForLoadState('domcontentloaded');
    const header = await this.headerText();
    if (!cuits(header).includes(cuit)) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'REPRESENTED_NOT_ACTIVE');
  }

  async readServices() {
    await this.navigate(this.urls.portal, true);
    const text = await this.bodyText();
    return {
      relationshipManager: /administrador de relaciones/i.test(text),
      pointOfSaleAdministration: /administraci[oó]n de puntos de venta/i.test(text),
      certificateAdministration: this.environment === 'production'
        ? /administraci[oó]n de certificados digitales/i.test(text)
        : /wsass/i.test(text),
    };
  }

  async adhereService(service: 'point_of_sale_administration' | 'certificate_administration'): Promise<void> {
    await this.navigate(this.urls.relationshipManager, true);
    await this.click(/adherir servicio/i);
    const label = service === 'point_of_sale_administration'
      ? /administraci[oó]n de puntos de venta y domicilios/i
      : this.environment === 'production' ? /administraci[oó]n de certificados digitales/i : /wsass/i;
    await this.openArcaServiceTree();
    await this.click(label);
    await this.click(/confirmar/i);
    await this.expectText(/formulario|autorizaci[oó]n|constancia|se ha adherido/i);
  }

  async readCertificates(alias: string) {
    await this.navigate(this.urls.certificates, true);
    const rows = this.page.locator('table tr');
    const texts = await rows.allTextContents();
    const aliasRows = texts.filter(text => text.toLowerCase().includes(alias.toLowerCase()));
    const otherRows = texts.filter(text => /\w/.test(text) && !text.toLowerCase().includes(alias.toLowerCase()) && !/alias|nombre|dn/i.test(text));
    const dates = aliasRows.flatMap(text => [...text.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)])
      .map(match => new Date(`${match[3]}-${match[2]}-${match[1]}T23:59:59-03:00`).toISOString())
      .sort();
    return {
      intendedAliasExists: aliasRows.length > 0,
      intendedAliasCertificateValidUntil: dates.at(-1) ?? null,
      otherAliasCount: otherRows.length,
    };
  }

  async readRelationships(input: Readonly<{ alias: string; providerCuit: string | null }>) {
    await this.navigate(this.urls.relationshipManager, true);
    await this.click(/consultar/i);
    await this.page.waitForLoadState('domcontentloaded');
    const rows = await this.page.locator('table tr').allTextContents();
    const state = (service: ArcaService): RelationshipState => {
      const matching = rows.filter(row => SERVICE_LABEL[service].test(row.replace(/\s+/g, ' ')) || serviceCode(service).test(row));
      if (matching.some(row => row.toLowerCase().includes(input.alias.toLowerCase()))) return 'customer_alias';
      if (input.providerCuit) {
        const provider = matching.filter(row => cuits(row).includes(input.providerCuit!));
        if (provider.some(row => /pendiente/i.test(row))) return 'provider_pending';
        if (provider.length > 0) return 'provider_active';
      }
      return 'none';
    };
    return { wsfex: state('wsfex'), wsfe: state('wsfe') };
  }

  async readPointsOfSale() {
    await this.navigate(this.urls.pointsOfSale, true);
    await this.clickOptional(/a\/b\/m puntos de venta|puntos de venta/i);
    const rows = await this.page.locator('table tr').allTextContents();
    const number = (row: string) => Number(/\b(\d{1,5})\b/.exec(row)?.[1] ?? NaN);
    const active = (row: string) => !/baja|inactivo|bloqueado/i.test(row);
    const used = rows.map(number).filter(Number.isInteger).filter(value => value > 0);
    const exportPoints = rows.filter(row => EXPORT_SYSTEM.test(row) && active(row)).map(number).filter(Number.isInteger);
    const domesticPoints = rows.filter(row => DOMESTIC_SYSTEM.test(row) && active(row)).map(number).filter(Number.isInteger);
    // Domiciles are counted on the creation form; no domicile text leaves ARCA.
    await this.clickOptional(/agregar/i);
    const domicileSelect = this.page.locator('select').filter({ hasText: /domicilio|calle|av\.|piso/i }).first();
    const domicileCount = (await domicileSelect.count()) > 0
      ? (await domicileSelect.locator('option').count()) - 1
      : 0;
    await this.clickOptional(/cancelar|volver/i);
    return { exportWebServices: exportPoints, domesticWebServices: domesticPoints, usedNumbers: used, domicileCount: Math.max(0, domicileCount) };
  }

  async createPointOfSale(input: Readonly<{ number: number; system: 'export_web_services' | 'domestic_web_services' }>) {
    await this.navigate(this.urls.pointsOfSale, true);
    await this.clickOptional(/a\/b\/m puntos de venta|puntos de venta/i);
    await this.click(/agregar/i);
    await this.fillByLabel(/n[uú]mero/i, String(input.number).padStart(5, '0'));
    await this.fillByLabel(/nombre( de)? fantas[ií]a/i, 'BUFI');
    const system = this.page.locator('select').filter({ hasText: input.system === 'export_web_services' ? EXPORT_SYSTEM : DOMESTIC_SYSTEM }).first();
    if ((await system.count()) === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'POINT_OF_SALE_SYSTEM_SELECT_MISSING');
    const option = system.locator('option').filter({ hasText: input.system === 'export_web_services' ? EXPORT_SYSTEM : DOMESTIC_SYSTEM }).first();
    await system.selectOption({ label: ((await option.textContent()) ?? '').trim() });
    const domicile = this.page.locator('select').filter({ hasText: /domicilio|calle|av\.|piso/i }).first();
    if ((await domicile.count()) > 0) {
      const options = (await domicile.locator('option').count()) - 1;
      // The customer picks the domicile in ARCA when there is more than one.
      if (options > 1) return 'domicile_choice_required' as const;
      if (options === 1) await domicile.selectOption({ index: 1 });
    }
    await this.click(/^aceptar$|guardar|confirmar/i);
    await this.expectText(/alta|se ha|registrado|correctamente/i, 'ARCA_SUBMISSION_UNCONFIRMED');
    return 'submitted' as const;
  }

  async submitCsr(input: Readonly<{ alias: string; csrPem: string; aliasExists: boolean }>): Promise<void> {
    await this.navigate(this.urls.certificates, true);
    if (this.environment === 'homologation') {
      // WSASS takes the CSR as text in a form ("Nuevo certificado").
      await this.click(/nuevo certificado/i);
      await this.fillByLabel(/nombre simb[oó]lico|alias|nombre/i, input.alias);
      const textarea = this.page.locator('textarea').first();
      if ((await textarea.count()) === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'WSASS_CSR_FIELD_MISSING');
      await textarea.fill(input.csrPem);
      await this.click(/crear dn y obtener certificado|obtener certificado|crear/i);
    } else {
      if (input.aliasExists) {
        await this.rowFor(input.alias).getByRole('link', { name: /ver/i }).first().click();
        await this.click(/agregar certificado/i);
      } else {
        await this.click(/agregar alias/i);
        await this.fillByLabel(/alias/i, input.alias);
      }
      const file = this.page.locator('input[type="file"]').first();
      if ((await file.count()) === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'CSR_UPLOAD_FIELD_MISSING');
      // Bytes, not a path: the remote browser has no access to our filesystem.
      await file.setInputFiles({ name: `${input.alias}.csr`, mimeType: 'application/pkcs10', buffer: Buffer.from(input.csrPem, 'utf8') });
      await this.click(/agregar|aceptar|confirmar/i);
    }
    await this.expectText(/certificado|alias/i, 'ARCA_SUBMISSION_UNCONFIRMED');
  }

  async downloadCertificate(alias: string): Promise<string> {
    if (this.environment === 'homologation') {
      // WSASS shows the signed certificate as text right after creation, or under the DN's detail.
      const text = await this.readCertificateText(alias);
      if (text) return text;
      throw new ArcaPortalError('ARCA_CERTIFICATE_NOT_AVAILABLE');
    }
    await this.navigate(this.urls.certificates, true);
    const row = this.rowFor(alias);
    if ((await row.count()) === 0) throw new ArcaPortalError('ARCA_CERTIFICATE_NOT_AVAILABLE');
    await row.getByRole('link', { name: /ver/i }).first().click();
    const link = this.page.getByRole('link', { name: /descargar/i }).first();
    if ((await link.count()) === 0) throw new ArcaPortalError('ARCA_CERTIFICATE_NOT_AVAILABLE');
    return readDownload(this.page, link);
  }

  async relateAliasToService(input: Readonly<{ alias: string; service: ArcaService }>): Promise<void> {
    if (this.environment === 'homologation') {
      await this.navigate(this.urls.certificates, true);
      await this.click(/crear autorizaci[oó]n a servicio/i);
      const dn = this.page.locator('select').filter({ hasText: new RegExp(escapeRegex(input.alias), 'i') }).first();
      if ((await dn.count()) === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'WSASS_DN_SELECT_MISSING');
      await dn.selectOption({ label: ((await dn.locator('option').filter({ hasText: new RegExp(escapeRegex(input.alias), 'i') }).first().textContent()) ?? '').trim() });
      const service = this.page.locator('select').filter({ hasText: new RegExp(`\\b${input.service}\\b`, 'i') }).first();
      await service.selectOption({ label: ((await service.locator('option').filter({ hasText: new RegExp(`\\b${input.service}\\b`, 'i') }).first().textContent()) ?? '').trim() });
      await this.click(/crear autorizaci[oó]n/i);
      await this.expectText(/autorizaci[oó]n/i, 'ARCA_SUBMISSION_UNCONFIRMED');
      return;
    }
    await this.newRelationship(input.service);
    await this.click(/buscar/i, 1);
    const computer = this.page.locator('select').filter({ hasText: new RegExp(escapeRegex(input.alias), 'i') }).first();
    if ((await computer.count()) === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'COMPUTADOR_FISCAL_MISSING');
    await computer.selectOption({ label: ((await computer.locator('option').filter({ hasText: new RegExp(escapeRegex(input.alias), 'i') }).first().textContent()) ?? '').trim() });
    await this.clickOptional(/buscar/i);
    await this.click(/confirmar/i);
    await this.expectText(/F\.?\s*3283|autorizaci[oó]n|constancia/i, 'ARCA_SUBMISSION_UNCONFIRMED');
  }

  async delegateToProvider(input: Readonly<{ providerCuit: string; service: ArcaService }>): Promise<void> {
    await this.newRelationship(input.service);
    await this.click(/buscar/i, 1);
    await this.fillByLabel(/cuit\/cuil\/cdi|cuit/i, input.providerCuit);
    await this.click(/buscar/i);
    await this.click(/confirmar/i);
    await this.expectText(/F\.?\s*3283|autorizaci[oó]n|constancia|pendiente/i, 'ARCA_SUBMISSION_UNCONFIRMED');
  }

  async readPendingDesignations(service: ArcaService): Promise<readonly string[]> {
    await this.navigate(this.urls.relationshipManager, true);
    await this.click(/consultar/i);
    const rows = await this.page.locator('table tr').filter({ hasText: /pendiente/i }).allTextContents();
    return rows.filter(row => SERVICE_LABEL[service].test(row) || serviceCode(service).test(row)).map(row => cuits(row)[0]).filter((value): value is string => !!value);
  }

  async acceptDesignation(input: Readonly<{ representedCuit: string; service: ArcaService }>): Promise<void> {
    const row = this.page.locator('table tr').filter({ hasText: new RegExp(dashed(input.representedCuit).replaceAll('-', '-?')) }).filter({ hasText: /pendiente/i }).first();
    if ((await row.count()) === 0) throw new ArcaPortalError('ARCA_DESIGNATION_NOT_FOUND');
    await row.getByRole('button', { name: /aceptar/i }).or(row.getByRole('link', { name: /aceptar/i })).first().click();
    await this.clickOptional(/confirmar|aceptar/i);
    await this.expectText(/aceptad|constancia|F\.?\s*3283/i, 'ARCA_SUBMISSION_UNCONFIRMED');
  }

  async readRepresentedTaxpayers(): Promise<readonly string[]> {
    await this.navigate(this.urls.relationshipManager, true);
    await this.click(/nueva relaci[oó]n/i);
    const represented = this.page.locator('select').filter({ has: this.page.locator('option') }).first();
    if ((await represented.count()) === 0) return [];
    return cuits((await represented.locator('option').allTextContents()).join('\n'));
  }

  async bindProviderAlias(input: Readonly<{ representedCuit: string; service: ArcaService; alias: string }>): Promise<void> {
    // Idempotent: an existing relation for this taxpayer, service and alias is left as is.
    await this.navigate(this.urls.relationshipManager, true);
    await this.click(/consultar/i);
    const existing = await this.page.locator('table tr')
      .filter({ hasText: new RegExp(dashed(input.representedCuit).replaceAll('-', '-?')) })
      .filter({ hasText: new RegExp(escapeRegex(input.alias), 'i') })
      .allTextContents();
    if (existing.some(row => SERVICE_LABEL[input.service].test(row) || serviceCode(input.service).test(row))) return;
    await this.navigate(this.urls.relationshipManager, true);
    await this.click(/nueva relaci[oó]n/i);
    const represented = this.page.locator('select').filter({ hasText: new RegExp(dashed(input.representedCuit).replaceAll('-', '-?')) }).first();
    if ((await represented.count()) === 0) throw new ArcaPortalError('ARCA_DESIGNATION_NOT_FOUND');
    const option = represented.locator('option').filter({ hasText: new RegExp(dashed(input.representedCuit).replaceAll('-', '-?')) }).first();
    await represented.selectOption({ label: ((await option.textContent()) ?? '').trim() });
    await this.click(/buscar/i);
    await this.click(SERVICE_LABEL[input.service]);
    await this.click(/buscar/i, 1);
    const computer = this.page.locator('select').filter({ hasText: new RegExp(escapeRegex(input.alias), 'i') }).first();
    if ((await computer.count()) === 0) throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', 'PROVIDER_ALIAS_MISSING');
    await computer.selectOption({ label: ((await computer.locator('option').filter({ hasText: new RegExp(escapeRegex(input.alias), 'i') }).first().textContent()) ?? '').trim() });
    await this.clickOptional(/buscar/i);
    await this.click(/confirmar/i);
    await this.expectText(/F\.?\s*3283|autorizaci[oó]n|constancia/i, 'ARCA_SUBMISSION_UNCONFIRMED');
  }

  private async newRelationship(service: ArcaService): Promise<void> {
    await this.navigate(this.urls.relationshipManager, true);
    await this.click(/nueva relaci[oó]n/i);
    await this.click(/buscar/i);
    await this.openArcaServiceTree();
    await this.click(/web\s*services/i);
    await this.click(SERVICE_LABEL[service]);
  }

  private async openArcaServiceTree(): Promise<void> {
    // The service picker groups by agency; ARCA's entry is an image button.
    const agency = this.page.getByRole('img', { name: /arca|afip/i }).first();
    if ((await agency.count()) > 0) await agency.click();
  }

  private async readCertificateText(alias: string): Promise<string | null> {
    const fromPage = async () => {
      const areas = await this.page.locator('textarea, pre').allTextContents();
      return areas.find(text => text.includes('BEGIN CERTIFICATE')) ?? null;
    };
    const current = await fromPage();
    if (current) return current;
    await this.navigate(this.urls.certificates, true);
    const row = this.rowFor(alias);
    if ((await row.count()) === 0) return null;
    await row.getByRole('link').first().click();
    return fromPage();
  }

  private rowFor(alias: string): Locator {
    return this.page.locator('table tr').filter({ hasText: new RegExp(`\\b${escapeRegex(alias)}\\b`, 'i') }).first();
  }

  private async navigate(url: string, requireAuthenticated: boolean): Promise<void> {
    let response: Response | null;
    try {
      response = await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (error) {
      if (/closed|disconnected|Target page/i.test(String(error))) throw new ArcaPortalError('BROWSER_SESSION_GONE');
      throw new ArcaPortalError('ARCA_UNAVAILABLE');
    }
    const status = response?.status() ?? 0;
    if (status === 403 || status === 429) throw new ArcaPortalError('ARCA_AUTOMATION_BLOCKED');
    if (status >= 500) throw new ArcaPortalError('ARCA_UNAVAILABLE');
    const text = await this.bodyText();
    if (/captcha|acceso denegado|request blocked|attention required/i.test(text) && !/clave fiscal/i.test(text))
      throw new ArcaPortalError('ARCA_AUTOMATION_BLOCKED');
    if (/servicio no disponible|fuera de servicio|mantenimiento/i.test(text)) throw new ArcaPortalError('ARCA_UNAVAILABLE');
    if (requireAuthenticated && /login\.xhtml/.test(this.page.url()) && !/action=SYSTEM/.test(this.page.url()))
      throw new ArcaPortalError('ARCA_SESSION_EXPIRED');
  }

  private async click(name: RegExp, index = 0): Promise<void> {
    const candidates = [
      this.page.getByRole('button', { name }),
      this.page.getByRole('link', { name }),
      this.page.locator('input[type="submit"], input[type="button"]').filter({ hasText: name }),
      this.page.getByText(name),
    ];
    for (const candidate of candidates) {
      if ((await candidate.count()) > index) {
        await candidate.nth(index).click();
        await this.page.waitForLoadState('domcontentloaded').catch(() => undefined);
        return;
      }
    }
    throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', `CONTROL_NOT_FOUND:${name.source.slice(0, 40)}`);
  }

  private async clickOptional(name: RegExp): Promise<void> {
    try {
      await this.click(name);
    } catch (error) {
      if (!(error instanceof ArcaPortalError) || error.code !== 'ARCA_PAGE_UNRECOGNIZED') throw error;
    }
  }

  private async fillByLabel(label: RegExp, value: string): Promise<void> {
    const field = this.page.getByLabel(label).first();
    if ((await field.count()) > 0) {
      await field.fill(value);
      return;
    }
    const byPlaceholder = this.page.getByPlaceholder(label).first();
    if ((await byPlaceholder.count()) > 0) {
      await byPlaceholder.fill(value);
      return;
    }
    throw new ArcaPortalError('ARCA_PAGE_UNRECOGNIZED', `FIELD_NOT_FOUND:${label.source.slice(0, 40)}`);
  }

  private async expectText(pattern: RegExp, code: 'ARCA_PAGE_UNRECOGNIZED' | 'ARCA_SUBMISSION_UNCONFIRMED' = 'ARCA_PAGE_UNRECOGNIZED'): Promise<void> {
    try {
      await this.page.getByText(pattern).first().waitFor({ state: 'visible', timeout: ACTION_TIMEOUT_MS });
    } catch {
      throw new ArcaPortalError(code);
    }
  }

  private async headerText(): Promise<string> {
    const header = this.page.locator('header, #header, .header, nav, .navbar').first();
    if ((await header.count()) > 0) return (await header.innerText().catch(() => '')) ?? '';
    return (await this.page.locator('body').innerText().catch(() => '')).slice(0, 2_000);
  }

  private async bodyText(): Promise<string> {
    return (await this.page.locator('body').innerText().catch(() => '')).slice(0, 20_000);
  }
}

/**
 * Retrieve a downloaded file as text, without a local path.
 *
 * Measured in Cloudflare Browser Run with @cloudflare/playwright 1.3.6
 * (see docs/arca-setup-executor.md): the `download` event fires but
 * `createReadStream()` yields zero bytes, and `context.request` does not carry
 * the page's session. What does work is an authenticated response obtained in
 * the page itself, so that is the primary path:
 *
 * 1. GET links: `fetch(href, { credentials: 'include' })` inside the page.
 * 2. Form submissions (including JSF command links): replay the same form with
 *    `fetch(..., { credentials: 'include' })` inside the page. Route
 *    interception with `route.fetch()` did not capture a form-posted
 *    attachment in Browser Run, so it is not used.
 * 3. The download stream, only if it actually returns bytes.
 *
 * DER bodies are returned as base64; the boundary accepts both forms.
 */
export async function readDownload(page: Page, trigger: Locator): Promise<string> {
  const href = await trigger.getAttribute('href').catch(() => null);
  if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
    const fetched = await page.evaluate(async target => {
      const response = await fetch(target, { credentials: 'include' });
      if (!response.ok) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    }, new URL(href, page.url()).toString()).catch(() => null);
    if (fetched) return fromBase64Body(fetched);
  }
  // Form submissions (including JSF command links): replay the exact form in the page.
  const replayed = await trigger.evaluate(async element => {
    const form = element.closest('form');
    if (!form) return null;
    const isSubmitter = element instanceof HTMLButtonElement || element instanceof HTMLInputElement;
    const data = isSubmitter ? new FormData(form, element as HTMLButtonElement) : new FormData(form);
    // JSF commandLink: mojarra.jsfcljs(form, {'id':'id', ...}, '') adds request parameters.
    const onclick = element.getAttribute('onclick') ?? '';
    const parameters = /jsfcljs\([^,]+,\s*(\{[^}]*\})/.exec(onclick)?.[1];
    if (parameters) {
      for (const pair of parameters.slice(1, -1).split(',')) {
        const [key, value] = pair.split(':').map(part => part.trim().replace(/^['"]|['"]$/g, ''));
        if (key) data.set(key, value ?? key);
      }
    }
    const method = (form.getAttribute('method') ?? 'get').toUpperCase();
    const action = new URL(form.getAttribute('action') ?? location.href, location.href).toString();
    const body = new URLSearchParams();
    for (const [key, value] of data.entries()) if (typeof value === 'string') body.append(key, value);
    const response = method === 'GET'
      ? await fetch(`${action}${action.includes('?') ? '&' : '?'}${body.toString()}`, { credentials: 'include' })
      : await fetch(action, { method, body, credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }).catch(() => null);
  if (replayed) return fromBase64Body(replayed);

  // Last resort: the download stream, accepted only when it actually carries bytes.
  const download = page.waitForEvent('download', { timeout: ACTION_TIMEOUT_MS }).catch(() => null) as Promise<Download | null>;
  await trigger.click();
  const event = await download;
  if (event) {
    const stream = await event.createReadStream();
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) chunks.push(chunk);
    const bytes = concat(chunks);
    if (bytes.byteLength > 0) return fromBytesBody(bytes);
  }
  throw new ArcaPortalError('ARCA_CERTIFICATE_NOT_AVAILABLE');
}

function fromBase64Body(base64: string): string {
  const binary = atob(base64);
  return fromBytesBody(Uint8Array.from(binary, character => character.charCodeAt(0)));
}

function fromBytesBody(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  if (text.includes('-----BEGIN CERTIFICATE-----')) return text;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function cuits(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(CUIT_PATTERN)) {
    const value = `${match[1]}${match[2]}${match[3]}`;
    if (!found.includes(value)) found.push(value);
  }
  return found;
}

function dashed(cuit: string): string {
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

function serviceCode(service: ArcaService): RegExp {
  return service === 'wsfex' ? /\bwsfex\b/i : /\bwsfe\b/i;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
