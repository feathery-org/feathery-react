import { useEffect, useState } from 'react';

import { isEmptyArray, toList } from './array';

export const THUMBNAIL_TYPE = {
  PDF: 'pdf',
  IMAGE: 'image',
  UNKNOWN: 'unknown'
};

// eslint-disable-next-line no-useless-escape
export const BASE64_PNG_REGEX = /(data:image\/png;base64,)([0-9a-zA-Z+\/]{4})*(([0-9a-zA-Z+\/]{2}==)|([0-9a-zA-Z+\/]{3}=))?$/gm;

export function getThumbnailType(file) {
  let thumbnailType = THUMBNAIL_TYPE.UNKNOWN;

  if (file) {
    if (/image\//.test(file.type)) {
      thumbnailType = THUMBNAIL_TYPE.IMAGE;
    } else if (/application\/pdf/.test(file.type)) {
      thumbnailType = THUMBNAIL_TYPE.PDF;
    }
  }

  return thumbnailType;
}

/**
 * Utility hook for handling file values in file upload fields.
 * This custom hook maintains a referentially-stable list of files,
 * and will execute a callback every time that list changes.
 */
export function useFileData(initialFiles, onSetFiles = () => {}) {
  const [files, setFiles] = useState(toList(initialFiles));
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
export async function getThumbnailData(filePromise) {
  const file = await filePromise;
  const thumbnailType = getThumbnailType(file);
  if (thumbnailType === THUMBNAIL_TYPE.IMAGE) {
    const url = await new Promise((resolve) => {
      const reader = new FileReader();

      reader.addEventListener('load', (event) => {
        resolve(event.target.result);
      });

      reader.readAsDataURL(file);
    });

    return { filename: '', thumbnail: url };
  } else {
    return { filename: file?.name ?? '', thumbnail: '' };
  }
}

/**
 * Utility hook for converting a list of files into a list of thumbnail information.
 */
export function useThumbnailData(files) {
  const [thumbnailData, setThumbnailData] = useState(
    files.map(() => ({ filename: '', thumbnail: '' }))
  );

  useEffect(() => {
    const thumbnailPromises = files.map(getThumbnailData);
    Promise.all(thumbnailPromises)
      .then((data) => data.filter((item) => item.thumbnail || item.filename))
      .then((data) => {
        setThumbnailData(data);
      });
  }, [files]);

  return thumbnailData;
}

export const dataURLToFile = (dataURL, name) => {
  const arr = dataURL.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new File([u8arr], name, { type: mime });
};

export const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });

export const isBase64PNG = (string) => {
  return BASE64_PNG_REGEX.test(string);
};
