// PPTX uses EMU (English Metric Units). Canvas uses CSS px at 96 dpi.
export const EMU_PER_INCH = 914400;
export const EMU_PER_POINT = 12700;
export const EMU_PER_PX = 9525; // 914400 / 96

export const emuToPx = (emu: number): number => emu / EMU_PER_PX;
export const pxToEmu = (px: number): number => Math.round(px * EMU_PER_PX);

export const ptToPx = (pt: number): number => (pt * 96) / 72;
export const pxToPt = (px: number): number => (px * 72) / 96;

export const emuToPt = (emu: number): number => emu / EMU_PER_POINT;

// PPTX rotations are stored in 60,000ths of a degree.
export const angleToDeg = (a: number): number => a / 60000;
export const degToAngle = (d: number): number => Math.round(d * 60000);

// PPTX font sizes (a:rPr @sz) are in hundredths of a point.
export const szToPt = (sz: number): number => sz / 100;
export const ptToSz = (pt: number): number => Math.round(pt * 100);
