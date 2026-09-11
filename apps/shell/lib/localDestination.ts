/** Keep navigation context, but never allow a browser-normalized external URL. */
export function localDestination(candidate: string | null | undefined): string {
  // eslint-disable-next-line no-control-regex -- Reject URL control characters before browser normalization.
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(candidate)) return '/';
  try {
    const url = new URL(candidate, 'https://intra.invalid');
    const decodedPath = decodeURIComponent(url.pathname);
    // eslint-disable-next-line no-control-regex -- Encoded controls must not bypass the same-origin check.
    if (url.origin !== 'https://intra.invalid' || decodedPath.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decodedPath)) return '/';
    if (url.pathname === '/warehouse') url.pathname = '/warehouse/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
