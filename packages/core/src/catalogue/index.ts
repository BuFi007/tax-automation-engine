export * from './types';
export * from './argentina';
export * from './united-states';
export * from './united-arab-emirates';
export * from './calendar';

import { ArgentinaJurisdictionProvider } from './argentina';
import type { TaxJurisdictionProvider } from './types';
import { UnitedStatesJurisdictionProvider } from './united-states';
import { UnitedArabEmiratesJurisdictionProvider } from './united-arab-emirates';
import type { JurisdictionCode } from '../types';

const PROVIDERS: Readonly<Record<JurisdictionCode, TaxJurisdictionProvider>> = {
  AR: new ArgentinaJurisdictionProvider(),
  US: new UnitedStatesJurisdictionProvider(),
  AE: new UnitedArabEmiratesJurisdictionProvider(),
};

export function getJurisdictionProvider(jurisdiction: JurisdictionCode): TaxJurisdictionProvider {
  return PROVIDERS[jurisdiction];
}

export function listJurisdictionProviders(): readonly TaxJurisdictionProvider[] {
  return Object.values(PROVIDERS);
}
