import { type FocusEvent } from 'react';
import JSZip from 'jszip';
import { isElementInViewport } from './formHelperFunctions';

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

export const isAndroid = () => {
  return /(android)/i.test(navigator.userAgent);
};

export const isMobile = () => isIOS() || isAndroid();

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
  featheryDoc().cookie = `${key}=${val}; max-age=31536000; SameSite=strict; path=/;`;
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

async function getFileData(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const fileName = new URL(url).pathname.split('/').at(-1) ?? '';
  return { fileName, blob };
}

export async function downloadAllFileUrls(urls: string[]) {
  if (urls.length === 0) return;

  let file: File;

  if (urls.length > 1) {
    const zip = new JSZip();

    await Promise.all(
      urls.map(async (url: string) => {
        const { fileName, blob } = await getFileData(url);
        zip.file(fileName, blob);
      })
    );

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    file = new File([zipBlob], 'Feathery_Download.zip', {
      type: 'application/zip'
    });
  } else {
    const { fileName, blob } = await getFileData(urls[0]);
    file = new File([blob], fileName, { type: blob.type });
  }

  downloadFile(file);
}

// iOS devices do not scroll to focused radio buttons
// and checkboxes so we manually scroll to maintain a
// consistent user experience.
//
// scroll to element if it's not in viewport and an iOS device
export function iosScrollOnFocus(event: FocusEvent) {
  if (!isIOS()) return;
  const element = event.target;
  if (
    element &&
    element instanceof HTMLElement &&
    !isElementInViewport(element)
  ) {
    element.scrollIntoView();
  }
}

export function devicePixelRatio() {
  return featheryWindow().devicePixelRatio || 1;
}
