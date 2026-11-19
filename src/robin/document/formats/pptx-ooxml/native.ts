// The deck as the core holds it: slide XML in order plus pending suggestions with the slides before them
import type { PptxEditorEngine } from '../../../../elements/components/PptxEditor/engine/PptxEditorEngine';
import type { DeckJSON } from '../../../../elements/components/PptxEditor/core/model/json';
import { resolveListProps } from '../../../../elements/components/PptxEditor/core/model/resolve';
import type {
  Deck,
  Slide
} from '../../../../elements/components/PptxEditor/core/model/types';
import {
  relationshipsOf,
  type RelEntry
} from '../../../../elements/components/PptxEditor/core/opc/package';
import {
  buildXml,
  parseXml
} from '../../../../elements/components/PptxEditor/core/opc/xml';

export interface PendingSuggestion {
  by: string;
  beforeSlides: Record<string, string>;
  changed: Record<string, string[] | null>;
  beforeOrder?: string[];
  afterOrder?: string[];
  links?: Record<string, Record<string, string>>;
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
  links?: Record<string, string>;
}

export interface DeckNative {
  slides: NativeSlide[];
  pending: PendingSuggestion[];
}

export function writeNative(native: DeckNative): string {
  return JSON.stringify({
    slides: native.slides.map(({ path, xml, inherited, links }) => ({
      path,
      xml,
      ...(inherited ? { inherited } : {}),
      ...(links ? { links } : {})
    })),
    pending: native.pending.map(
      ({ by, beforeSlides, changed, beforeOrder, afterOrder, links }) => ({
        by,
        beforeSlides,
        changed,
        ...(beforeOrder ? { beforeOrder, afterOrder } : {}),
        ...(links ? { links } : {})
      })
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
      const afterDeck = deckWide
        ? ((record.after as Record<string, DeckJSON>)['*'] as DeckJSON)
        : undefined;
      // The slides it changed in place, narrowed to the shapes it names
      const changed: Record<string, string[] | null> = {};
      if (deckWide)
        for (const path of record.changedSlides ?? []) changed[path] = null;
      else
        for (const { slideId, shapeId } of record.targets)
          changed[slideId] =
            shapeId && changed[slideId] !== null
              ? [...(changed[slideId] ?? []), shapeId]
              : null;
      const beforeSlides = Object.fromEntries(
        Object.entries(record.beforeSlides ?? {}).map(([path, raw]) => [
          path,
          buildXml(raw)
        ])
      );
      // A removed slide's links are known only from the relationships it had
      const links = Object.fromEntries(
        Object.entries(beforeSlides).flatMap(([path, xml]) => {
          const rels = record.beforeSlideRels?.[path];
          const targets = rels && linkTargets(relationshipsOf(rels, path), xml);
          return targets ? [[path, targets]] : [];
        })
      );
      return {
        by: record.author.id ?? record.id,
        beforeSlides,
        changed,
        ...(beforeDeck && afterDeck
          ? {
              beforeOrder: beforeDeck.slides.map((slide) => slide.path),
              afterOrder: afterDeck.slides.map((slide) => slide.path)
            }
          : {}),
        ...(Object.keys(links).length ? { links } : {})
      };
    });
  return writeNative({
    slides: deck.slides.map((slide) => {
      const inherited = inheritedFormat(deck, slide);
      const xml = buildXml(slide.raw);
      const links = linkTargets(deck.pkg.rels(slide.path), xml);
      return {
        path: slide.path,
        xml,
        ...(inherited ? { inherited } : {}),
        ...(links ? { links } : {})
      };
    }),
    pending
  });
}

/** Where each link on a slide goes, by the relationship its runs name */
function linkTargets(
  relationships: RelEntry[],
  xml: string
): Record<string, string> | null {
  const named = new Set(
    [...xml.matchAll(/<a:hlinkClick\b[^>]*\br:id="([^"]+)"/g)].map(
      (match) => match[1]
    )
  );
  if (!named.size) return null;
  return Object.fromEntries(
    relationships
      .filter((relationship) => named.has(relationship.id))
      .map((relationship) => [relationship.id, relationship.target])
  );
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
