import { fetchAndVerifyOfficialWsfexWsdl } from '../src/wsdl-contract';

try {
  const receipt = await fetchAndVerifyOfficialWsfexWsdl();
  console.log(JSON.stringify({ ...receipt, checkedAt: new Date().toISOString() }));
} catch (error) {
  const code = error instanceof Error && /^WSFEX_[A-Z0-9_]+$/.test(error.message)
    ? error.message
    : 'WSFEX_WSDL_CONTRACT_FAILED';
  console.error(code);
  process.exitCode = 1;
}
