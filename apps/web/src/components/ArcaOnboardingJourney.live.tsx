import { useEffect, useMemo, useState } from 'react';
import type {
  ArcaOnboardingBrowserRunV1,
  TaxWidgetSnapshotV1,
} from '@tax-engine/browser-contracts';

import {
  ArcaOnboardingApiClient,
  type ArcaOnboardingBrowserAuthority,
} from '../arca-api';
import { ArcaOnboardingJourney } from './ArcaOnboardingJourney';

export function LiveArcaOnboardingJourney({
  snapshot,
  authority,
  environment,
  requestedServices = ['wsfex', 'wsfe'],
}: Readonly<{
  snapshot: TaxWidgetSnapshotV1;
  authority: ArcaOnboardingBrowserAuthority;
  environment: 'homologation' | 'production';
  requestedServices?: readonly ('wsfex' | 'wsfe')[];
}>) {
  const client = useMemo(() => new ArcaOnboardingApiClient(authority), [authority]);
  const requestedServicesKey = requestedServices.join(',');
  const [run, setRun] = useState<ArcaOnboardingBrowserRunV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const runs = await client.listRuns();
        const current = [...runs]
          .filter(candidate => candidate.status === 'active')
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
          ?? await client.createRun({
            taxpayerReference: snapshot.profile.profileRef,
            environment,
            requestedServices,
          });
        if (active) setRun(current);
      } catch (cause) {
        if (active) setError(messageFor(cause));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [client, environment, requestedServicesKey, snapshot.profile.profileRef]);

  const mutate = async (
    operation: (current: ArcaOnboardingBrowserRunV1) => Promise<ArcaOnboardingBrowserRunV1>,
  ) => {
    if (!run || saving) return;
    setSaving(true);
    setError(null);
    try {
      setRun(await operation(run));
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading-panel" role="status">Loading the ARCA onboarding run…</div>;
  if (!run) return <div className="error-panel" role="alert"><strong>ARCA onboarding unavailable.</strong><span>{error}</span></div>;

  return (
    <ArcaOnboardingJourney
      run={run}
      activeFeeWsPoints={run.pointOfSale.candidates ?? []}
      saving={saving}
      saveError={error}
      onConfirmLoginHandoff={() => mutate(current => client.completeLoginHandoff(current))}
      onConfirmHumanAuth={() => mutate(current => client.completeHumanAuth(current))}
      onConfirmServiceAdherence={() => mutate(current => client.confirmServiceAdherence(current))}
      onRecordPointOfSale={point => mutate(current => client.recordPointOfSale(current, point))}
      onSelectExistingPoint={point => mutate(current => client.selectPointOfSale(current, point))}
    />
  );
}

function messageFor(cause: unknown): string {
  if (!(cause instanceof Error)) return 'No pudimos actualizar el onboarding de ARCA.';
  if (cause.message.includes('EXPIRED')) return 'Tu autorización de Motora venció. Recargá la sesión para continuar.';
  if (cause.message.includes('STEP_OUT_OF_ORDER') || cause.message.includes('EXPECTED_')) return 'El run avanzó en otra sesión. Actualizá para ver el estado vigente.';
  return cause.message;
}
