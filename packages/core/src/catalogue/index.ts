export * from './types';
export * from './argentina';
export * from './united-states';
export * from './calendar';

import { ArgentinaJurisdictionProvider } from './argentina';
import type { TaxJurisdictionProvider } from './types';
import { UnitedStatesJurisdictionProvider } from './united-states';
import type { JurisdictionCode } from '../types';

const PROVIDERS: Readonly<Record<JurisdictionCode, TaxJurisdictionProvider>> = {
  AR: new ArgentinaJurisdictionProvider(),
  US: new UnitedStatesJurisdictionProvider(),
};

export function getJurisdictionProvider(jurisdiction: JurisdictionCode): TaxJurisdictionProvider {
  return PROVIDERS[jurisdiction];
}

export function listJurisdictionProviders(): readonly TaxJurisdictionProvider[] {
  return Object.values(PROVIDERS);
}
