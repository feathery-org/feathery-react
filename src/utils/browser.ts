export function runningInClient() {
  return typeof window === 'object';
}

// Safeguard for NextJS support
// NOTE: This is not needed inside useEffect hooks.
export function featheryDoc() {
  return runningInClient() ? document : ({} as any);
}

/**
 * @param key string corresponding to cookie name
 * @returns cookie value, or undefined if not found
 */
export function getCookie(key: any) {
  return document.cookie
    .split('; ')
    .filter((row) => row.startsWith(`${key}=`))
    .map((c) => c.split('=')[1])[0];
}

export function getStytchJwt() {
  return getCookie('stytch_session_jwt');
}

export const openTab = (url: any) =>
  window.open(url, '_blank', 'noopener noreferrer');
