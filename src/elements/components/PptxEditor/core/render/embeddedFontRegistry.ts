import { featheryDoc } from '../../../../../utils/browser';

// The embedded-font face registry, split out from embeddedFonts so that
// releasing a deck's fonts does not pull the XML parser (opc/xml via
// loadEmbeddedFonts) into every form's main bundle. loadEmbeddedFonts, which
// parses presentation.xml, stays in embeddedFonts and loads with the editor.
export interface EmbeddedFonts {
  aliases: Map<string, string>;
  faces: FontFace[];
  ready: Promise<void>;
  released: boolean;
}

export const packages = new WeakMap<object, EmbeddedFonts>();

export function releaseEmbeddedFonts(owner: object): void {
  const state = packages.get(owner);
  if (!state) return;
  state.released = true;
  packages.delete(owner);
  for (const face of state.faces) featheryDoc().fonts.delete(face);
}
