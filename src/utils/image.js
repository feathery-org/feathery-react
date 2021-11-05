import { useEffect, useState } from 'react';

import { toList } from './array';

export const THUMBNAIL_TYPE = {
  PDF: 'pdf',
  IMAGE: 'image',
  UNKNOWN: 'unknown'
};

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
