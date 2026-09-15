import { type FocusEvent } from 'react';
import JSZip from 'jszip';
import { isElementInViewport } from './formHelperFunctions';
import { getFilenameFromUrl } from './fileNames';

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
  const fileName = getFilenameFromUrl(url);
  return { fileName, blob };
}

// Points the download anchor directly at a real HTTP(S) URL instead of a
// blob: URL. Some embedding contexts (e.g. a Visualforce page rendered in
// Salesforce Lightning) intercept the anchor click and reopen the URL in a
// new top-level tab; blob: URLs only resolve in the browsing context that
// created them, so they fail to load there. A real URL survives being
// reopened, and relies on the server response having
// Content-Disposition: attachment so it downloads instead of rendering inline.
function downloadFileUrl(url: string) {
  const element = featheryDoc().createElement('a');
  element.style.display = 'none';
  element.href = url;
  element.download = '';
  featheryDoc().body.appendChild(element);
  element.click();
  featheryDoc().body.removeChild(element);
}

export async function downloadAllFileUrls(urls: string[], zipName?: string) {
  if (urls.length === 0) return;

  if (urls.length === 1) {
    downloadFileUrl(urls[0]);
    return;
  }

  const zip = new JSZip();

  const files = await Promise.all(urls.map((url: string) => getFileData(url)));

  const nameCount: Record<string, number> = {};
  for (const { fileName, blob } of files) {
    let uniqueName = fileName;
    if (nameCount[fileName] != null) {
      nameCount[fileName]++;
      const dotIndex = fileName.lastIndexOf('.');
      if (dotIndex !== -1) {
        uniqueName = `${fileName.slice(0, dotIndex)} (${
          nameCount[fileName]
        })${fileName.slice(dotIndex)}`;
      } else {
        uniqueName = `${fileName} (${nameCount[fileName]})`;
      }
    } else {
      nameCount[fileName] = 0;
    }
    zip.file(uniqueName, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });
  const finalZipName =
    zipName && !zipName.endsWith('.zip') ? `${zipName}.zip` : zipName;
  const file = new File([zipBlob], finalZipName || 'Feathery_Download.zip', {
    type: 'application/zip'
  });

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
