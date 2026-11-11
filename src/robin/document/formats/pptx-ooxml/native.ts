// The deck as the core holds it: slide XML in order plus pending suggestions with the slides before them
import type { PptxEditorEngine } from '../../../../elements/components/PptxEditor/engine/PptxEditorEngine';
import type { DeckJSON } from '../../../../elements/components/PptxEditor/core/model/json';
import { resolveListProps } from '../../../../elements/components/PptxEditor/core/model/resolve';
import type {
  Deck,
  Slide
} from '../../../../elements/components/PptxEditor/core/model/types';
import {
  buildXml,
  parseXml
} from '../../../../elements/components/PptxEditor/core/opc/xml';

export interface PendingSuggestion {
  by: string;
  beforeSlides: Record<string, string>;
  beforeOrder?: string[];
}

/** The run formatting each shape's paragraphs take from the layout and master, by shape id and level */
export type InheritedFormat = Record<
  string,
  Record<string, Record<string, unknown>>
>;

export interface NativeSlide {
  path: string;
  xml: string;
  inherited?: InheritedFormat;
}

export interface DeckNative {
  slides: NativeSlide[];
  pending: PendingSuggestion[];
}

export function writeNative(native: DeckNative): string {
  return JSON.stringify({
    slides: native.slides.map(({ path, xml, inherited }) =>
      inherited ? { path, xml, inherited } : { path, xml }
    ),
    pending: native.pending.map(({ by, beforeSlides, beforeOrder }) =>
      beforeOrder ? { by, beforeSlides, beforeOrder } : { by, beforeSlides }
    )
  });
}

export function readNative(native: string): DeckNative {
  return JSON.parse(native) as DeckNative;
}

export function serializeDeck(engine: PptxEditorEngine): string {
  const deck = engine.readDeck();
  if (!deck) throw new Error('No presentation is loaded');
  const pending = engine
    .changes()
    .filter((record) => record.status === 'pending')
    .map((record): PendingSuggestion => {
      const deckWide = record.targets.some((target) => target.slideId === '*');
      const beforeDeck = deckWide
        ? ((record.before as Record<string, DeckJSON>)['*'] as DeckJSON)
        : undefined;
      return {
        by: record.author.id ?? record.id,
        beforeSlides: Object.fromEntries(
          Object.entries(record.beforeSlides ?? {}).map(([path, raw]) => [
            path,
            buildXml(raw)
          ])
        ),
        ...(beforeDeck
          ? { beforeOrder: beforeDeck.slides.map((slide) => slide.path) }
          : {})
      };
    });
  return writeNative({
    slides: deck.slides.map((slide) => {
      const inherited = inheritedFormat(deck, slide);
      return {
        path: slide.path,
        xml: buildXml(slide.raw),
        ...(inherited ? { inherited } : {})
      };
    }),
    pending
  });
}

function inheritedFormat(deck: Deck, slide: Slide): InheritedFormat | null {
  const out: InheritedFormat = {};
  for (const shape of slide.shapes) {
    if (!shape.text) continue;
    const levels = new Set(
      shape.text.paragraphs.map((paragraph) => paragraph.level ?? 0)
    );
    for (const level of levels) {
      const defaults = resolveListProps(deck, slide, shape, level).defRPr;
      if (!defaults) continue;
      const format: Record<string, unknown> = {};
      if (defaults.sizePt !== undefined) format.size = defaults.sizePt;
      if (defaults.color) format.color = `#${defaults.color.toUpperCase()}`;
      else if (defaults.colorScheme) format.color = defaults.colorScheme;
      if (defaults.font) format.font = defaults.font;
      if (defaults.bold !== undefined) format.bold = defaults.bold;
      if (defaults.italic !== undefined) format.italic = defaults.italic;
      if (!Object.keys(format).length) continue;
      out[shape.id] = { ...out[shape.id], [level]: format };
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Put saved slide XML back into the open deck, which drops the editor's pending suggestions */
export function openDeck(engine: PptxEditorEngine, native: string): void {
  const { slides } = readNative(native);
  engine.reopenSlides(
    slides.map((slide) => ({ path: slide.path, raw: parseXml(slide.xml) }))
  );
}
