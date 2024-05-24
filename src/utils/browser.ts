export function runningInClient() {
  // eslint-disable-next-line no-restricted-globals
  return typeof window === 'object';
}

// Safeguard for NextJS support
export function featheryDoc() {
  // eslint-disable-next-line no-restricted-globals
  return runningInClient() ? document : ({} as any);
}

export function featheryWindow() {
  // eslint-disable-next-line no-restricted-globals
  return runningInClient() ? window : ({} as any);
}

export const isHoverDevice = () =>
  featheryWindow().matchMedia('(hover: hover)').matches;

export const isTouchDevice = () =>
  featheryWindow().matchMedia('(pointer: coarse)').matches;

// Returns whether or not user device is running iOS
// based on: https://stackoverflow.com/a/76302335
export const isIOS = () => {
  let userAgentString = navigator.userAgent;
  const uaData = (navigator as any).userAgentData;
  if (uaData != null && uaData.brands) {
    userAgentString = uaData.brands
      .map((item: any) => item.brand + '/' + item.version)
      .join(' ');
  }
  return /iPad|iPhone|iPod/.test(userAgentString);
};

export const hoverStylesGuard = (styles: any) =>
  isHoverDevice() ? styles : {};

/**
 * @param key string corresponding to cookie name
 * @returns cookie value, or undefined if not found
 */
export function getCookie(key: string) {
  return featheryDoc()
    .cookie.split('; ')
    .filter((row: string) => row.startsWith(`${key}=`))
    .map((c: string) => c.split('=')[1])[0];
}

export function setCookie(key: string, val: string) {
  featheryDoc().cookie = `${key}=${val}; max-age=31536000; SameSite=strict`;
}

export function deleteCookie(key: string) {
  featheryDoc().cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

export function getStytchJwt() {
  return getCookie('stytch_session_jwt');
}

export const openTab = (url: any) =>
  featheryWindow().open(url, '_blank', 'noopener');

export function downloadFile(file: File) {
  const element = featheryDoc().createElement('a');
  element.style.display = 'none';
  const href = featheryWindow().URL.createObjectURL(file);
  element.href = href;
  element.download = file.name;
  featheryDoc().body.appendChild(element);

  element.click();

  featheryWindow().URL.revokeObjectURL(href);
  featheryDoc().body.removeChild(element);
}
