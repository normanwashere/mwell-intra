const GUIDE_ORIGIN = 'https://mwell-intra.invalid';

export function knowledgeGuideReturnPath(
  searchParams: URLSearchParams,
): string | null {
  const returnTo = searchParams.get('returnTo');
  if (!returnTo) return null;

  try {
    const target = new URL(returnTo, GUIDE_ORIGIN);
    if (target.origin !== GUIDE_ORIGIN || target.pathname !== '/knowledge') {
      return null;
    }
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}
