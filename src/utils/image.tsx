import { useEffect, useState } from 'react';

const THUMBNAIL_TYPE = {
  PDF: 'pdf',
  IMAGE: 'image',
  UNKNOWN: 'unknown'
};

const BASE64_REGEX =
  /(data:image\/(png|jpg|jpeg);base64,)([0-9a-zA-Z+/]{4})*(([0-9a-zA-Z+/]{2}==)|([0-9a-zA-Z+/]{3}=))?$/gm;

function getThumbnailType(file: File) {
  let thumbnailType = THUMBNAIL_TYPE.UNKNOWN;

  if (file) {
    // Allow all image/*; unsupported ones (e.g., TIFF, HEIC off Safari)
    // will fall back via the <img> onError handler in FileUploadField
    if (/image\//.test(file.type)) {
      thumbnailType = THUMBNAIL_TYPE.IMAGE;
    } else if (/application\/pdf/.test(file.type)) {
      thumbnailType = THUMBNAIL_TYPE.PDF;
    }
  }

  return thumbnailType;
}

/**
 * Given a File (or a Promise<File>), convert the file to a filename and thumbnail.
 * Filename will be a plaintext string and thumbnail will be a base64 encoded image.
 */
async function getThumbnailData(filePromise: File | Promise<File>) {
  const file = await (filePromise as any);
  const thumbnailType = getThumbnailType(file);
  if (thumbnailType === THUMBNAIL_TYPE.IMAGE) {
    const url: string = await new Promise((resolve) => {
      const reader = new FileReader();

      reader.addEventListener('load', (event) => {
        // @ts-expect-error TS(2531): Object is possibly 'null'.
        resolve(event.target.result);
      });

      reader.readAsDataURL(file);
    });

    return { filename: file?.name ?? '', thumbnail: url };
  } else {
    return { filename: file?.name ?? '', thumbnail: '' };
  }
}

/**
 * Given a File (or a Promise<File>), convert the file to a source url and file type.
 */
export async function getRenderData(filePromise: File | Promise<File>) {
  const file = await filePromise;

  if (file && file instanceof File) {
    return { type: file.type, url: URL.createObjectURL(file) };
  } else {
    return { type: '', url: '' };
  }
}

/**
 * Utility hook for converting a list of files into a list of thumbnail information.
 */
export function useThumbnailData(files: Promise<File>[]) {
  const [thumbnailData, setThumbnailData] = useState(
    files.map(() => ({ filename: '', thumbnail: '' }))
  );

  useEffect(() => {
    const thumbnailPromises = files.map(getThumbnailData);
    Promise.all(thumbnailPromises).then((data) => {
      setThumbnailData(data);
    });
  }, [files]);

  return thumbnailData;
}

export const dataURLToFile = (dataURL: any, name: any) => {
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
