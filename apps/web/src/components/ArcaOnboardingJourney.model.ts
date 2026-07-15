export const ARCA_ONBOARDING_UI_STEPS = [
  {
    id: 'login_handoff',
    title: 'Secure login handoff',
    description: 'You enter CUIT and Clave Fiscal directly on ARCA. Motora pauses and never receives credentials or cookies.',
    owner: 'You',
  },
  {
    id: 'service_adherence',
    title: 'Enable portal services',
    description: 'Add Point-of-Sale Administration and Relationship Manager only if missing. Every account change needs your confirmation.',
    owner: 'You + Motora',
  },
  {
    id: 'point_of_sale_discovery',
    title: 'Discover points of sale',
    description: 'Look for an active export point of sale first. An existing compatible point skips creation.',
    owner: 'Motora',
  },
  {
    id: 'point_of_sale_creation',
    title: 'Create export point of sale',
    description: 'Create the compatible FEEWS point only when discovery found none, after an explicit confirmation.',
    owner: 'You + Motora',
  },
  {
    id: 'ws_delegation',
    title: 'Delegate web services',
    description: 'Delegate WSFEX and WSFE to Motora’s reviewed certificate. Your Clave Fiscal is never part of API calls.',
    owner: 'You',
  },
  {
    id: 'api_verification',
    title: 'Verify ARCA APIs',
    description: 'WSFEX and WSFE independently confirm delegation and the active point of sale for this taxpayer.',
    owner: 'Motora',
  },
  {
    id: 'zk_evidence',
    title: 'Seal ZK evidence',
    description: 'Reclaim WITNESS proves the minimum onboarding facts. Raw portal responses stay in encrypted proof custody.',
    owner: 'Reclaim + Motora',
  },
  {
    id: 'ready',
    title: 'Ready',
    description: 'Electronic invoicing becomes available only after both authoritative API receipts and verified ZK evidence agree.',
    owner: 'Deterministic gate',
  },
] as const;

export function arcaScopeDescriptions(scope: 'wsfex' | 'wsfex_wsfe') {
  return scope === 'wsfex'
    ? {
        apiVerification: 'WSFEX independently confirms delegation and the active export point of sale for this taxpayer.',
        ready: 'Electronic export invoicing becomes available only after the authoritative WSFEX receipt and verified ZK evidence agree.',
      }
    : {
        apiVerification: 'WSFEX and WSFE independently confirm delegation and the active point of sale for this taxpayer.',
        ready: 'Electronic invoicing becomes available only after both authoritative API receipts and verified ZK evidence agree.',
      };
}
