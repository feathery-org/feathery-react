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

// Long enough that a download the host defers behind a prompt still finds the
// blob, short enough that the bytes are not pinned in memory for the session.
const BLOB_URL_LIFETIME = 60000;

/**
 * Save a file to the user's device.
 *
 * Two details here exist so this survives being embedded in a Salesforce
 * Visualforce iframe, where the straightforward version fails:
 *
 * 1. The anchor is never put in the document. Salesforce watches for link
 *    clicks from a listener on the host document, and on seeing one it
 *    cancels the click and re-opens the href itself, outside the iframe -
 *    where a blob: URL, being scoped to the origin that minted it, no longer
 *    resolves. A detached anchor's click event propagates to nothing, so
 *    there is no delegated listener - capturing or bubbling - for Salesforce
 *    to intercept it from.
 * 2. The blob: URL outlives the click. Browsers hand a download off to the
 *    download manager asynchronously, so revoking on the very next line
 *    races it; a host that defers the click further loses the blob outright.
 *
 * This keeps the blob rather than linking to the file's stored URL: those URLs
 * are cross-origin (S3), where the `download` attribute is ignored, so without
 * a stored `Content-Disposition: attachment` the browser would render the PDF
 * inline instead of saving it.
 */
export function downloadFile(file: File) {
  const href = featheryWindow().URL.createObjectURL(file);

  const element = featheryDoc().createElement('a');
  element.href = href;
  element.download = file.name;

  element.click();

  featheryWindow().setTimeout(
    () => featheryWindow().URL.revokeObjectURL(href),
    BLOB_URL_LIFETIME
  );
}

async function getFileData(url: string) {
  const response = await fetch(url);
  const blob = await response.blob();
  const fileName = getFilenameFromUrl(url);
  return { fileName, blob };
}

export async function downloadAllFileUrls(urls: string[], zipName?: string) {
  if (urls.length === 0) return;

  let file: File;

  if (urls.length > 1) {
    const zip = new JSZip();

    const files = await Promise.all(
      urls.map((url: string) => getFileData(url))
    );

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
    file = new File([zipBlob], finalZipName || 'Feathery_Download.zip', {
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
