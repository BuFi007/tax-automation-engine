export function executionGateCopy(jurisdiction: 'AR' | 'US'): string {
  return jurisdiction === 'AR'
    ? 'No filing, payment, or authority submission can run from this workspace. ARCA onboarding remains a separate user-controlled handoff.'
    : 'No filing, payment, or IRS submission can run from this workspace. U.S. filing remains separately provider- or accountant-gated.';
}
