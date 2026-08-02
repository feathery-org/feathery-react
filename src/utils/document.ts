import { initInfo, initState } from './init';

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function getSignUrl(redirect?: boolean | string, signerId?: string) {
  const regionPart =
    initState.region && initState.region !== 'us' ? `${initState.region}.` : '';

  let query = '';
  if (redirect) {
    if (typeof redirect === 'string') {
      if (!isValidUrl(redirect)) {
        console.error(
          `Invalid redirect URL: "${redirect}". Must be a full URL with http:// or https://`
        );
      } else {
        query = `?redirect=${encodeURIComponent(redirect)}`;
      }
    } else {
      // If redirect is true (boolean), redirect back to form
      const url = new URL(location.href);
      if (!url.searchParams.has('_id')) {
        url.searchParams.append('_id', initInfo().userId ?? '');
      }
      query = `?redirect=${encodeURIComponent(url.toString())}`;
    }
  }

  // A signer id only exists when the filler is themselves a first-order
  // signer - fill-only envelopes and non-signing fillers have none. The
  // fuser id falls back to resolving the submission's envelopes through the
  // legacy session path, since a signer id is a bearer token the backend
  // only ever hands back for the filler's own row.
  const id = signerId ?? initState._internalUserId;
  return `https://${regionPart}document.feathery.io/to/${id}${query}`;
}
