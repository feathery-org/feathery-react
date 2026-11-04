import { featheryDoc, featheryWindow } from '../../../../../utils/browser';
import { child, children, getAttr, root } from '../opc/xml';
import type { Deck } from '../model/types';

interface EmbeddedFonts {
  aliases: Map<string, string>;
  faces: FontFace[];
  ready: Promise<void>;
  released: boolean;
}

const packages = new WeakMap<object, EmbeddedFonts>();
let nextFontSet = 0;

export function embeddedFontFamily(
  deck: Deck | undefined,
  family: string
): string | undefined {
  return deck && packages.get(deck.pkg)?.aliases.get(family.toLowerCase());
}

export function loadEmbeddedFonts(
  deck: Deck,
  splitWeight: (name: string) => { family: string; weight: number },
  onLoaded: () => void
): Promise<void> {
  const existing = packages.get(deck.pkg);
  if (existing) return existing.ready;
  const doc = featheryDoc();
  const Face = featheryWindow().FontFace;
  if (!Face || !doc.fonts?.add) return Promise.resolve();
  const state: EmbeddedFonts = {
    aliases: new Map(),
    faces: [],
    ready: Promise.resolve(),
    released: false
  };
  packages.set(deck.pkg, state);
  const fontSet = ++nextFontSet;
  const list = child(
    root(deck.pkg.tree('ppt/presentation.xml')),
    'p:embeddedFontLst'
  );
  const entries: Array<{
    alias: string;
    weight: number;
    style: string;
    bytes: Uint8Array;
  }> = [];
  for (const entry of list ? children(list, 'p:embeddedFont') : []) {
    const font = child(entry, 'p:font');
    const name = font && getAttr(font, 'typeface');
    if (!name) continue;
    const { family, weight } = splitWeight(name);
    for (const variant of ['regular', 'bold', 'italic', 'boldItalic']) {
      const variantNode = child(entry, `p:${variant}`);
      const rid = variantNode && getAttr(variantNode, 'r:id');
      const part = rid && deck.pkg.relTarget('ppt/presentation.xml', rid);
      const bytes = part && deck.pkg.binary(part);
      if (!bytes) continue;
      let alias = state.aliases.get(family.toLowerCase());
      if (!alias) {
        alias = `FeatheryPptx${fontSet}_${state.aliases.size}`;
        state.aliases.set(family.toLowerCase(), alias);
      }
      const faceWeight = /bold/i.test(variant) ? Math.max(700, weight) : weight;
      const style = /italic/i.test(variant) ? 'italic' : 'normal';
      if (
        entries.some(
          (face) =>
            face.alias === alias &&
            face.weight === faceWeight &&
            face.style === style
        )
      )
        continue;
      entries.push({
        alias,
        bytes,
        weight: faceWeight,
        style
      });
    }
  }
  if (!entries.length) return state.ready;
  state.ready = (async () => {
    const { eotToTtf, parseEotMetadata, canLegallyEdit } = await import(
      'mtx-decompressor'
    );
    await Promise.all(
      entries.map(async (entry) => {
        try {
          const metadata = parseEotMetadata(entry.bytes);
          if (!canLegallyEdit(metadata) || metadata.rootString) return;
          const bytes = eotToTtf(entry.bytes);
          if (state.released) return;
          const face = new Face(entry.alias, bytes.buffer as ArrayBuffer, {
            weight: String(entry.weight),
            style: entry.style
          });
          state.faces.push(face);
          doc.fonts.add(face);
          await face.load();
        } catch {
          // A malformed/unsupported font falls back to the existing webfont path.
        }
      })
    );
    for (const [family, alias] of state.aliases) {
      if (
        !state.faces.some(
          (face) => face.family === alias && face.status === 'loaded'
        )
      )
        state.aliases.delete(family);
    }
    if (!state.released) onLoaded();
  })().catch(() => {
    state.aliases.clear();
    if (!state.released) onLoaded();
  });
  return state.ready;
}

export function releaseEmbeddedFonts(owner: object): void {
  const state = packages.get(owner);
  if (!state) return;
  state.released = true;
  packages.delete(owner);
  for (const face of state.faces) featheryDoc().fonts.delete(face);
}
