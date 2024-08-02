import { initState } from './init';

export function getSignUrl() {
  const regionPart =
    initState.region && initState.region !== 'us' ? `${initState.region}.` : '';
  return `https://${regionPart}document.feathery.io/to/${initState._internalUserId}`;
}
