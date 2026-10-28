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

const isHoverDevice = () =>
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

const isAndroid = () => {
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

const ONE_YEAR_SECONDS = 31536000;

/**
 * @param maxAge how long the cookie lives, in seconds. Defaults to a year,
 * which is what every identity cookie the SDK writes has always used.
 */
export function setCookie(key: string, val: string, maxAge = ONE_YEAR_SECONDS) {
  featheryDoc().cookie = `${key}=${val}; max-age=${maxAge}; SameSite=strict; path=/;`;
}

export function deleteCookie(key: string) {
  featheryDoc().cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
}

export const openTab = (url: any) =>
  featheryWindow().open(url, '_blank', 'noopener');

// Long enough that a download the host defers behind a prompt still finds the
// blob, short enough that the bytes are not pinned in memory for the session.
// FileSaver.js holds its blob URLs for 40s for the same reason.
const BLOB_URL_LIFETIME = 60000;

/**
 * Save a file to the user's device via a blob: URL on a detached anchor.
 *
 * The anchor is never put in the document. Salesforce's Visualforce container
 * watches for link clicks from a listener on the document and, on seeing one,
 * cancels the click and re-opens the href itself outside the iframe, where a
 * blob: URL minted here no longer resolves. A detached anchor's click event
 * propagates to nothing, so no delegated listener sees it.
 *
 * The blob: URL is revoked on a timer rather than on the next line. Browsers
 * hand a download to the download manager asynchronously, so an immediate
 * revoke races it. This is independent of the Salesforce fix and matches what
 * FileSaver.js has always done.
 *
 * Linking straight at the stored S3 URL would need `Content-Disposition:
 * attachment` signed into the presigned URL, since the `download` attribute
 * is ignored cross-origin. That is a backend change tracked separately.
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

async function getFileData(
  url: string,
  options?: RequestInit,
  requireAll = false
) {
  const response = await fetch(url, options);
  if (requireAll && !response.ok)
    throw new Error('Could not download the document. Please retry.');
  const blob = await response.blob();
  const fileName = getFilenameFromUrl(url);
  return { fileName, blob };
}

export async function downloadAllFileUrls(
  urls: string[],
  zipName?: string,
  options?: RequestInit,
  requireAll = false
) {
  if (urls.length === 0) return;

  let file: File;

  if (urls.length > 1) {
    const zip = new JSZip();

    const files = await Promise.all(
      urls.map((url: string) => getFileData(url, options, requireAll))
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
    const { fileName, blob } = await getFileData(urls[0], options, requireAll);
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
