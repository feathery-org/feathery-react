import { initState } from './init';

export function getSignUrl(redirectUrl: string) {
  const regionPart =
    initState.region && initState.region !== 'us' ? `${initState.region}.` : '';
  const query = redirectUrl
    ? `?redirect=${encodeURIComponent(redirectUrl)}`
    : '';
  return `https://${regionPart}document.feathery.io/to/${initState._internalUserId}${query}`;
}
