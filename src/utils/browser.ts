export function runningInClient() {
  return typeof window === 'object';
}

/**
 * @param key string corresponding to cookie name
 * @returns cookie value, or undefined if not found
 */
export function getCookie(key) {
  return document.cookie
    .split('; ')
    .filter((row) => row.startsWith(`${key}=`))
    .map((c) => c.split('=')[1])[0];
}

export function getStytchJwt() {
  return getCookie('stytch_session_jwt');
}

export const openTab = (url) =>
  window.open(url, '_blank', 'noopener noreferrer');
