import { useEffect, useState } from 'react';

import { isEmptyArray, toList } from './array';
import { FeatheryFieldTypes } from './init';

export const THUMBNAIL_TYPE = {
  PDF: 'pdf',
  IMAGE: 'image',
  UNKNOWN: 'unknown'
};

export const BASE64_REGEX =
  /(data:image\/(png|jpg|jpeg);base64,)([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/gm;

export function getThumbnailType(file: File | null) {
  if (!file) return THUMBNAIL_TYPE.UNKNOWN;

  if (/image\//.test(file.type)) return THUMBNAIL_TYPE.IMAGE;
  if (/application\/pdf/.test(file.type)) return THUMBNAIL_TYPE.PDF;

  return THUMBNAIL_TYPE.UNKNOWN;
}

/**
 * Utility hook for handling file values in file upload fields.
 * This custom hook maintains a referentially-stable list of files,
 * and will execute a callback every time that list changes.
 */
export function useFileData(initialFiles: File[] = [], onSetFiles = () => {}) {
  const [files, setFiles] = useState<File[]>(toList(initialFiles));

  useEffect(() => {
    // Prevent infinite loop of setting a new empty array as the value
    if (isEmptyArray(files) && isEmptyArray(initialFiles)) return;
    setFiles(toList(initialFiles));
    onSetFiles();
  }, [initialFiles]);

  return [files, setFiles];
}

/**
 * Given a File (or a Promise<File>), convert the file to a filename and thumbnail.
 * Filename will be a plaintext string and thumbnail will be a base64 encoded image.
 */
export async function getThumbnailData(file: File) {
  if (!file) return Promise.resolve({ filename: '', thumbnail: '' });

  const thumbnailType = getThumbnailType(file);

  if (thumbnailType === THUMBNAIL_TYPE.IMAGE) {
    return new Promise<{ filename: string; thumbnail: string }>((resolve) => {
      const reader = new FileReader();

      reader.onload = (event) => {
        resolve({
          filename: file.name,
          thumbnail: event.target?.result as string
        });
      };

      reader.onerror = () => {
        resolve({ filename: file.name, thumbnail: '' });
      };

      reader.readAsDataURL(file);
    });
  }

  // For PDF or unknown files, only show filename
  return Promise.resolve({ filename: file.name, thumbnail: '' });
}

/**
 * Given a File (or a Promise<File>), convert the file to a source url and file type.
 */
export async function getRenderData(filePromise: any) {
  const file = await filePromise;

  if (file) {
    return { type: file.type, url: URL.createObjectURL(file) };
  } else {
    return { type: '', url: '' };
  }
}

/**
 * Utility hook for converting a list of files into a list of thumbnail information.
 */
export function useThumbnailData(files: File[]) {
  const [thumbnailData, setThumbnailData] = useState(
    files.map((f) => ({ filename: f?.name ?? '', thumbnail: '' }))
  );

  useEffect(() => {
    let cancelled = false;

    async function generate() {
      const data = await Promise.all(files.map(getThumbnailData));
      if (!cancelled) setThumbnailData(data);
    }

    generate();

    return () => {
      cancelled = true;
    };
  }, [files]);

  return thumbnailData;
}

export const dataURLToFile = (dataURL: FeatheryFieldTypes, name: string) => {
  if (typeof dataURL !== 'string') {
    throw new Error('dataURL must be a base64 string');
  }

  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)?.at(1);
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], name, { type: mime });
};

export const toBase64 = (file: any): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
  });

export const isBase64Image = (string: any) => {
  return BASE64_REGEX.test(string);
};
