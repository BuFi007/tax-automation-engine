/**
 * workerd rejects `redirect: 'error'`, so callers fetch with `redirect: 'manual'`
 * and pass the response here: a 3xx (or an opaque redirect) fails the call the
 * way 'error' did, inside the caller's own transport error handling.
 */
export function refuseRedirect(response: Response): Response {
  if (response.type !== 'opaqueredirect' && (response.status < 300 || response.status > 399)) return response;
  void response.body?.cancel();
  throw new Error('HTTP_REDIRECT_REFUSED');
}
