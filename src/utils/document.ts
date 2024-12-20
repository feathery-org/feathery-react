import { initInfo, initState } from './init';

export function getSignUrl(redirect?: boolean) {
  const regionPart =
    initState.region && initState.region !== 'us' ? `${initState.region}.` : '';

  const url = new URL(location.href);
  if (!url.searchParams.has('_id')) {
    url.searchParams.append('_id', initInfo().userId ?? '');
  }
  const query = redirect
    ? `?redirect=${encodeURIComponent(url.toString())}`
    : '';

  return `https://${regionPart}document.feathery.io/to/${initState._internalUserId}${query}`;
}
