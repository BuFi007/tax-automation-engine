import { useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, Circle, ExternalLink, KeyRound, LockKeyhole, RadioTower, ShieldCheck } from 'lucide-react';
import type { ArcaOnboardingBrowserRunV1 } from '@tax-engine/browser-contracts';

import { ARCA_ONBOARDING_UI_STEPS, ARCA_POINT_OF_SALE_GUIDE, arcaScopeDescriptions, formatArcaPointOfSale, parseArcaPointOfSale } from './ArcaOnboardingJourney.model';

const ARCA_POINT_OF_SALE_URL = 'https://auth.afip.gob.ar/contribuyente_/login.xhtml?action=SYSTEM&system=padron-puc-consulta-internet';

type PointOfSaleRegistrationState = 'idle' | 'recorded';

type ArcaOnboardingJourneyProps = Readonly<{
  run?: ArcaOnboardingBrowserRunV1 | null;
  activeFeeWsPoints?: readonly number[];
  saving?: boolean;
  saveError?: string | null;
  onRecordPointOfSale?: (pointOfSale: number) => Promise<void> | void;
  onSelectExistingPoint?: (pointOfSale: number) => Promise<void> | void;
  onConfirmLoginHandoff?: () => Promise<void> | void;
  onConfirmHumanAuth?: () => Promise<void> | void;
  onConfirmServiceAdherence?: () => Promise<void> | void;
}>;

export function ArcaOnboardingJourney({
  run,
  activeFeeWsPoints = [],
  saving = false,
  saveError = null,
  onRecordPointOfSale,
  onSelectExistingPoint,
  onConfirmLoginHandoff,
  onConfirmHumanAuth,
  onConfirmServiceAdherence,
}: ArcaOnboardingJourneyProps) {
  const [scope, setScope] = useState<'wsfex' | 'wsfex_wsfe'>('wsfex_wsfe');
  const [handoffStarted, setHandoffStarted] = useState(false);
  const [pointOfSale, setPointOfSale] = useState('');
  const [creationConfirmed, setCreationConfirmed] = useState(false);
  const [selectedExistingPoint, setSelectedExistingPoint] = useState('');
  const [registrationState, setRegistrationState] = useState<PointOfSaleRegistrationState>('idle');

  const effectiveScope = run?.requestedServices.includes('wsfe') ? 'wsfex_wsfe' : run ? 'wsfex' : scope;
  const scopeDescriptions = arcaScopeDescriptions(effectiveScope);
  const parsedPointOfSale = parseArcaPointOfSale(pointOfSale);
  const needsPointCreation = activeFeeWsPoints.length === 0;
  const serverPointRecorded = run?.pointOfSale.number !== null && run?.pointOfSale.active === true;
  const pointRecorded = serverPointRecorded || registrationState === 'recorded';
  const recordedPoint = run?.pointOfSale.number ?? parsedPointOfSale;
  const currentStepId = run?.currentStep ?? (pointRecorded ? 'ws_delegation' : needsPointCreation ? 'point_of_sale_creation' : 'point_of_sale_discovery');

  const recordPointOfSale = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!creationConfirmed || parsedPointOfSale === null) return;
    if (onRecordPointOfSale) {
      await onRecordPointOfSale(parsedPointOfSale);
      return;
    }
    setRegistrationState('recorded');
  };

  const selectExistingPoint = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const selected = Number(selectedExistingPoint);
    if (!Number.isSafeInteger(selected) || selected < 1 || !onSelectExistingPoint) return;
    await onSelectExistingPoint(selected);
  };

  return (
    <section className="panel arca-onboarding" aria-labelledby="arca-onboarding-heading">
      <div className="section-heading">
        <span className="step-number">3</span>
        <div>
          <p className="eyebrow">Argentina · Authority setup</p>
          <h2 id="arca-onboarding-heading">Connect ARCA without sharing your Clave Fiscal</h2>
          <p>One guided setup per taxpayer. After delegation, Motora signs API calls with its own certificate on behalf of that CUIT.</p>
        </div>
      </div>

      <div className="onboarding-config">
        <label>
          Invoice scope
          <select value={effectiveScope} disabled={Boolean(run)} onChange={event => setScope(event.target.value as typeof scope)}>
            <option value="wsfex_wsfe">Export + local · WSFEX and WSFE</option>
            <option value="wsfex">Export only · WSFEX</option>
          </select>
        </label>
        <div className="credential-boundary">
          <KeyRound aria-hidden="true" />
          <div><strong>Credential boundary</strong><span>Clave Fiscal stays between you and ARCA.</span></div>
        </div>
      </div>

      <ol className="onboarding-steps">
        {ARCA_ONBOARDING_UI_STEPS.map((step, index) => {
          const active = step.id === currentStepId;
          const runStep = run?.steps.find(candidate => candidate.step === step.id);
          const completed = runStep
            ? runStep.state === 'completed' || runStep.state === 'skipped'
            : index < (pointRecorded ? 4 : needsPointCreation ? 3 : 2);
          const scopeNote = effectiveScope === 'wsfex' && step.id === 'ws_delegation';
          return (
            <li key={step.id} className={active ? 'onboarding-step-active' : ''} data-step={step.id}>
              <div className="onboarding-step-icon">
                {step.id === 'ready' ? <ShieldCheck aria-hidden="true" /> : completed ? <CheckCircle2 aria-hidden="true" /> : <Circle aria-hidden="true" />}
              </div>
              <div className="onboarding-step-copy">
                <div><span>{String(index + 1).padStart(2, '0')}</span><h3>{step.title}</h3></div>
                <p>{step.id === 'api_verification' ? scopeDescriptions.apiVerification : step.id === 'ready' ? scopeDescriptions.ready : step.description}</p>
                {scopeNote && <small>WSFE is omitted for export-only scope; WSFEX delegation remains required.</small>}
              </div>
              <span className="onboarding-owner">{step.owner}</span>
            </li>
          );
        })}
      </ol>

      {run?.currentStep === 'login_handoff' && (
        <section className="point-of-sale-workbench" aria-label="ARCA login handoff">
          <div className="point-of-sale-next-step">
            <KeyRound aria-hidden="true" />
            <div><strong>Iniciá sesión directamente en ARCA</strong><p>Motora no ve ni conserva tu CUIT, Clave Fiscal, cookies o PIN. Volvé cuando el portal haya abierto correctamente.</p></div>
          </div>
          <button className="secondary-button" type="button" disabled={saving || !handoffStarted || !onConfirmLoginHandoff} onClick={() => void onConfirmLoginHandoff?.()}>{saving ? 'Guardando…' : 'Ya ingresé a ARCA'}</button>
          {saveError && <p className="inline-error" role="alert">{saveError}</p>}
        </section>
      )}

      {run?.currentStep === 'human_auth' && (
        <section className="point-of-sale-workbench" aria-label="Private ARCA authentication">
          <div className="point-of-sale-next-step">
            <LockKeyhole aria-hidden="true" />
            <div>
              <strong>Esta pantalla queda fuera de la captura de Motora</strong>
              <p>Terminá el ingreso en ARCA. No inspeccionamos campos, screenshots, portapapeles, cookies, storage, respuestas de red ni trazas crudas. Al volver conservamos sólo un recibo firmado y hash-bound.</p>
            </div>
          </div>
          <button className="secondary-button" type="button" disabled={saving || !onConfirmHumanAuth} onClick={() => void onConfirmHumanAuth?.()}>{saving ? 'Guardando…' : 'Autenticación terminada'}</button>
          {saveError && <p className="inline-error" role="alert">{saveError}</p>}
        </section>
      )}

      {run?.currentStep === 'service_adherence' && (
        <section className="point-of-sale-workbench" aria-label="ARCA service adherence confirmation">
          <div className="point-of-sale-next-step">
            <ShieldCheck aria-hidden="true" />
            <div><strong>Confirmá los dos servicios de administración</strong><p>En ARCA deben estar disponibles “Administración de puntos de venta y domicilios” y “Administrador de Relaciones de Clave Fiscal”.</p></div>
          </div>
          <button className="secondary-button" type="button" disabled={saving || !onConfirmServiceAdherence} onClick={() => void onConfirmServiceAdherence?.()}>{saving ? 'Guardando…' : 'Confirmar servicios adheridos'}</button>
          {saveError && <p className="inline-error" role="alert">{saveError}</p>}
        </section>
      )}

      {run?.currentStep === 'point_of_sale_discovery' && activeFeeWsPoints.length === 0 && (
        <section className="point-of-sale-workbench" aria-label="ARCA point of sale discovery">
          <div className="point-of-sale-next-step">
            <RadioTower aria-hidden="true" />
            <div><strong>Consultando puntos FEEWS</strong><p>El conector de evidencia debe registrar el resultado oficial. Si devuelve cero, el run habilita el alta manual; si devuelve varios, te pediremos elegir.</p></div>
          </div>
        </section>
      )}

      {(!run || run.currentStep === 'point_of_sale_creation' || activeFeeWsPoints.length > 1 || pointRecorded) && <section className={`point-of-sale-workbench ${!needsPointCreation || pointRecorded ? 'point-of-sale-workbench-found' : ''}`} aria-labelledby="point-of-sale-heading">
        <div className="point-of-sale-status">
          <div className="point-of-sale-status-icon">{needsPointCreation && !pointRecorded ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}</div>
          <div>
            <p className="eyebrow">{pointRecorded ? 'Alta registrada · Paso 6 de 9' : needsPointCreation ? 'Acción requerida · Paso 5 de 9' : 'Selección requerida · Paso 4 de 9'}</p>
            <h3 id="point-of-sale-heading">{pointRecorded ? `Punto ${formatArcaPointOfSale(recordedPoint!)} listo para delegación` : needsPointCreation ? 'Creá el punto para Factura E por Webservices' : 'Elegí el punto FEEWS que usará Motora'}</h3>
            <p>{pointRecorded
              ? <>Tu confirmación permite continuar, pero todavía <strong>no prueba que WSFEX vea el punto</strong>. La comprobación oficial ocurre después de delegar.</>
              : needsPointCreation
              ? <>La última consulta oficial devolvió <strong>0 puntos FEEWS activos</strong>. Sin este punto Motora no puede pedir un CAE ni emitir en tu nombre.</>
              : <>ARCA devolvió <strong>{activeFeeWsPoints.length} {activeFeeWsPoints.length === 1 ? 'punto FEEWS activo' : 'puntos FEEWS activos'}</strong>. Motora no selecciona uno silenciosamente.</>
            }</p>
          </div>
          <span className={`status-pill ${needsPointCreation && !pointRecorded ? 'status-unavailable' : 'status-review_ready'}`}>{pointRecorded ? 'Siguiente: delegar' : needsPointCreation ? 'Bloqueado por ARCA' : 'Elegí un punto'}</span>
        </div>

        {pointRecorded ? (
          <div className="point-of-sale-next-step" role="status">
            <ShieldCheck aria-hidden="true" />
            <div><strong>Motora conservó sólo el punto {formatArcaPointOfSale(recordedPoint!)}</strong><p>El siguiente paso guía la delegación del servicio WSFEX al certificado revisado. Después, la API de ARCA debe confirmar el mismo punto antes de habilitar Factura E.</p></div>
          </div>
        ) : needsPointCreation ? <div className="point-of-sale-guide-layout">
          <div>
            <ol className="point-of-sale-guide">
              {ARCA_POINT_OF_SALE_GUIDE.map((item, index) => (
                <li key={item.title}>
                  <span>{index + 1}</span>
                  <div><strong>{item.title}</strong><p>{item.description}</p></div>
                </li>
              ))}
            </ol>
            <a
              className="primary-button onboarding-button point-of-sale-open"
              href={ARCA_POINT_OF_SALE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setHandoffStarted(true)}
            >
              Abrir puntos de venta en ARCA <ExternalLink aria-hidden="true" />
            </a>
          </div>

          <form className="point-of-sale-confirmation" onSubmit={recordPointOfSale}>
            <div className="point-of-sale-system">
              <RadioTower aria-hidden="true" />
              <div><span>Sistema que debe figurar</span><strong>Comprobantes de Exportación - Webservices</strong></div>
            </div>
            <label htmlFor="arca-point-of-sale">
              Número creado en ARCA
              <input
                id="arca-point-of-sale"
                value={pointOfSale}
                onChange={event => {
                  setPointOfSale(event.target.value.replace(/\D/g, '').slice(0, 5));
                  setRegistrationState('idle');
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="00004"
                aria-describedby="arca-point-of-sale-help"
              />
            </label>
            <small id="arca-point-of-sale-help">Ingresá los 5 dígitos. Este número no es una credencial.</small>
            <label className="point-of-sale-checkbox">
              <input
                type="checkbox"
                checked={creationConfirmed}
                onChange={event => {
                  setCreationConfirmed(event.target.checked);
                  setRegistrationState('idle');
                }}
              />
              <span>Confirmo que presioné “Aceptar” en ARCA y guardé este punto como Webservices de exportación.</span>
            </label>
            <button className="secondary-button" type="submit" disabled={saving || !creationConfirmed || parsedPointOfSale === null}>
              {saving ? 'Guardando…' : 'Guardar punto y continuar'}
            </button>
            {saveError && <p className="inline-error" role="alert">{saveError}</p>}
          </form>
        </div> : (
          <form className="point-of-sale-existing" onSubmit={selectExistingPoint}>
            <label htmlFor="existing-arca-point-of-sale">
              Punto de venta para Factura E
              <select id="existing-arca-point-of-sale" value={selectedExistingPoint} onChange={event => setSelectedExistingPoint(event.target.value)}>
                <option value="">Seleccioná un punto</option>
                {activeFeeWsPoints.map(point => <option key={point} value={point}>{formatArcaPointOfSale(point)} · FEEWS activo</option>)}
              </select>
            </label>
            <p>La selección quedará vinculada al CUIT representado. Después de la delegación, WSFEX deberá devolver exactamente este punto.</p>
            <button className="secondary-button" type="submit" disabled={saving || !selectedExistingPoint || !onSelectExistingPoint}>{saving ? 'Guardando…' : 'Usar este punto'}</button>
            {saveError && <p className="inline-error" role="alert">{saveError}</p>}
          </form>
        )}
      </section>}

      <div className="onboarding-handoff">
        <div>
          <strong>{handoffStarted ? 'La sesión de ARCA quedó bajo tu control' : 'Tu sesión y tus credenciales siguen siendo tuyas'}</strong>
          <p>{handoffStarted ? 'Completá el alta en la pestaña de ARCA y volvé a Motora. Ninguna contraseña, cookie ni token de sesión cruza este límite.' : 'Motora guía cada pantalla y se detiene antes de cambiar servicios, puntos de venta o delegaciones.'}</p>
        </div>
        <a
          className="primary-button onboarding-button"
          href={ARCA_POINT_OF_SALE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setHandoffStarted(true)}
        >
          {handoffStarted ? 'Volver a abrir ARCA' : 'Continuar en ARCA'} <ExternalLink aria-hidden="true" />
        </a>
      </div>

      <div className="execution-gate onboarding-gate">
        <LockKeyhole aria-hidden="true" />
        <div><strong>ZK es evidencia, no autoridad</strong><p>Reclaim no puede crear el punto ni la delegación. `ready` exige una verificación API de ARCA vinculada al mismo contribuyente y punto de venta.</p></div>
      </div>
    </section>
  );
}
