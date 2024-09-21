import { initState } from './init';

export function getSignUrl(redirect?: boolean) {
  const regionPart =
    initState.region && initState.region !== 'us' ? `${initState.region}.` : '';
  const query = redirect
    ? `?redirect=${encodeURIComponent(location.href)}`
    : '';
  return `https://${regionPart}document.feathery.io/to/${initState._internalUserId}${query}`;
}
