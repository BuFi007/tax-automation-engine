const DEFAULT_DEVELOPMENT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
] as const;

export function applyCors(response: Response, request: Request): Response {
  const requestOrigin = request.headers.get('origin');
  const allowedOrigins = configuredOrigins();
  const responseOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : requestOrigin === null
      ? allowedOrigins[0]
      : null;

  if (responseOrigin) response.headers.set('Access-Control-Allow-Origin', responseOrigin);
  response.headers.append('Vary', 'Origin');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Tax-Tenant-Principal, X-Tax-Tenant-Signature');
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  return response;
}

function configuredOrigins(): readonly string[] {
  const configured = process.env.CORS_ORIGIN
    ?.split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
  return configured?.length ? configured : DEFAULT_DEVELOPMENT_ORIGINS;
}
