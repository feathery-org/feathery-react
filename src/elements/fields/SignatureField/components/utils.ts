/*
 * Implementation of canvas trimming is taken from:
 * https://github.com/agilgur5/trim-canvas/blob/master/src/index.js
 *
 * Implementation of drawing a signature from a data URL is taken from:
 * https://github.com/szimek/signature_pad/blob/356e97d1c9fc27b8d5930544b50feadc754dd8ba/src/signature_pad.ts#L128C10-L128C21
 *
 */

import { devicePixelRatio } from '../../../../utils/browser';

export function trimCanvas(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not get 2d context from canvas');
  }
  const imgWidth = canvas.width;
  const imgHeight = canvas.height;

  const imgData = context.getImageData(0, 0, imgWidth, imgHeight).data;

  // get the corners of the relevant content (everything that's not white)
  const cropTop = scanY(true, imgWidth, imgHeight, imgData);
  const cropBottom = scanY(false, imgWidth, imgHeight, imgData);
  const cropLeft = scanX(true, imgWidth, imgHeight, imgData);
  const cropRight = scanX(false, imgWidth, imgHeight, imgData);

  // if the image is already trimmed, return the original canvas
  if (
    cropTop === null ||
    cropBottom === null ||
    cropLeft === null ||
    cropRight === null
  ) {
    return canvas;
  }

  // + 1 is needed because this is a difference, there are n + 1 pixels in
  // between the two numbers inclusive
  const cropXDiff = cropRight - cropLeft + 1;
  const cropYDiff = cropBottom - cropTop + 1;

  // get the relevant data from the calculated coordinates
  const trimmedData = context.getImageData(
    cropLeft,
    cropTop,
    cropXDiff,
    cropYDiff
  );

  // set the trimmed width and height
  canvas.width = cropXDiff;
  canvas.height = cropYDiff;
  // clear the canvas
  context.clearRect(0, 0, cropXDiff, cropYDiff);
  // place the trimmed data into the cleared canvas to create
  // a new, trimmed canvas
  context.putImageData(trimmedData, 0, 0);
  return canvas; // for chaining
}

// returns the RGBA values of an x, y coord of imgData
function getRGBA(
  x: number,
  y: number,
  imgWidth: number,
  imgData: Uint8ClampedArray
) {
  return {
    red: imgData[(imgWidth * y + x) * 4],
    green: imgData[(imgWidth * y + x) * 4 + 1],
    blue: imgData[(imgWidth * y + x) * 4 + 2],
    alpha: imgData[(imgWidth * y + x) * 4 + 3]
  };
}

function getAlpha(
  x: number,
  y: number,
  imgWidth: number,
  imgData: Uint8ClampedArray
) {
  return getRGBA(x, y, imgWidth, imgData).alpha;
}

// finds the first y coord in imgData that is not white
function scanY(
  fromTop: boolean,
  imgWidth: number,
  imgHeight: number,
  imgData: Uint8ClampedArray
) {
  const offset = fromTop ? 1 : -1;
  const firstCol = fromTop ? 0 : imgHeight - 1;

  // loop through each row
  for (let y = firstCol; fromTop ? y < imgHeight : y > -1; y += offset) {
    // loop through each column
    for (let x = 0; x < imgWidth; x++) {
      // if not white, return col
      if (getAlpha(x, y, imgWidth, imgData)) {
        return y;
      }
    }
  }

  // the whole image is white already
  return null;
}

// finds the first x coord in imgData that is not white
function scanX(
  fromLeft: boolean,
  imgWidth: number,
  imgHeight: number,
  imgData: Uint8ClampedArray
) {
  const offset = fromLeft ? 1 : -1;
  const firstRow = fromLeft ? 0 : imgWidth - 1;

  // loop through each column
  for (let x = firstRow; fromLeft ? x < imgWidth : x > -1; x += offset) {
    // loop through each row
    for (let y = 0; y < imgHeight; y++) {
      // if not white, return row
      if (getAlpha(x, y, imgWidth, imgData)) {
        return x;
      }
    }
  }

  // the whole image is white already
  return null;
}

export function fromDataURL(
  canvas: HTMLCanvasElement,
  dataUrl: string,
  options: {
    ratio?: number;
    width?: number;
    height?: number;
    xOffset?: number;
    yOffset?: number;
  } = {}
): Promise<void> {
  return new Promise((resolve, reject) => {
    const context = canvas.getContext('2d');

    const image = new Image();
    const ratio = options.ratio || devicePixelRatio();
    const width = options.width || canvas.width / ratio;
    const height = options.height || canvas.height / ratio;
    const xOffset = options.xOffset || 0;
    const yOffset = options.yOffset || 0;

    image.onload = (): void => {
      context?.drawImage(image, xOffset, yOffset, width, height);
      resolve();
    };
    image.onerror = (error): void => {
      reject(error);
    };
    image.crossOrigin = 'anonymous';
    image.src = dataUrl;
  });
}

export const generateSignatureImage = (
  text: string,
  fontFamily = 'La Belle Aurore',
  fontSize = '1.5em'
) => {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return;
  }

  const scaleFactor = 4;

  canvas.width = 560 * scaleFactor;
  canvas.height = 100 * scaleFactor;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scaleFactor, scaleFactor);

  ctx.font = `${fontSize} ${fontFamily}`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';

  const textMetrics = ctx.measureText(text);
  const textWidth = textMetrics.width;
  const textHeight = parseInt(fontSize) * 1.5;

  ctx.scale(1 / scaleFactor, 1 / scaleFactor);

  const padding = 20 * scaleFactor;
  canvas.width = textWidth * scaleFactor + padding * 2;
  canvas.height = textHeight * scaleFactor + padding * 2;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.scale(scaleFactor, scaleFactor);

  ctx.font = `${fontSize} ${fontFamily}`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'middle';

  ctx.fillText(text, padding / scaleFactor, canvas.height / 2 / scaleFactor);

  return canvas;
};

export function cloneCanvas(oldCanvas: HTMLCanvasElement): HTMLCanvasElement {
  const newCanvas: HTMLCanvasElement = document.createElement('canvas');
  const context: CanvasRenderingContext2D | null = newCanvas.getContext('2d');

  newCanvas.width = oldCanvas.width;
  newCanvas.height = oldCanvas.height;

  if (context) {
    context.drawImage(oldCanvas, 0, 0);
  }

  return newCanvas;
}
