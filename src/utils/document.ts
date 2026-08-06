import { initInfo, initState } from './init';

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function signUrl(token: string, redirect?: boolean | string) {
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

  return `https://${regionPart}document.feathery.io/to/${token}${query}`;
}

// Everyone who can sign has a signer row, so an envelope is always opened as
// that one signer rather than left for the server to guess.
export function getSignUrl(signerId: string, redirect?: boolean | string) {
  return signUrl(signerId, redirect);
}

// The whole submission's envelopes instead of one signer's view - only for the
// action that reopens whatever was already generated.
export function getSubmissionSignUrl(redirect?: boolean | string) {
  return signUrl(initState._internalUserId, redirect);
}
