// Tracked-edit records: a durable transaction log derived from engine
// transactions (never from diffing rendered SVG). Separate from the local
// undo stack - application metadata, not Word-style DrawingML revisions.

import type { CommandMeta, Invalidation } from './commands';
import type { DeckJSON, SlideJSON, ShapeJSON } from '../core/model/json';

export interface PptxChangeTarget {
  slideId: string;
  shapeId?: string;
  jsonPath?: string;
}

export interface PptxChangeAuthor {
  kind: 'user' | 'assistant' | 'system';
  id?: string;
  label: string;
}

export interface PptxChangeRecord {
  id: string;
  transactionId: string;
  author: PptxChangeAuthor;
  origin: NonNullable<CommandMeta['origin']>;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
  targets: PptxChangeTarget[];
  summary: string;
  before: unknown;
  after: unknown;
}

function slideOf(doc: DeckJSON, path: string): SlideJSON | undefined {
  return doc.slides.find((slide) => slide.path === path);
}

function shapeOf(
  slide: SlideJSON | undefined,
  shapeId: string
): ShapeJSON | undefined {
  return slide?.shapes.find((shape) => shape.id === shapeId);
}

/**
 * Scope a transaction's before/after documents down to fragments for its
 * targets: shape-level JSON when the invalidation names shapes, slide-level
 * JSON otherwise. Stable keys are the slide part path + cNvPr shape id.
 */
export function deriveChangeRecord(input: {
  transactionId: number;
  label: string;
  meta: CommandMeta;
  invalidations: Invalidation[];
  beforeDoc: DeckJSON;
  afterDoc: DeckJSON;
}): PptxChangeRecord {
  const { transactionId, label, meta, invalidations, beforeDoc, afterDoc } =
    input;
  const targets: PptxChangeTarget[] = [];
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const invalidation of invalidations) {
    if (invalidation.kind === 'deck') {
      targets.push({ slideId: '*' });
      before['*'] = beforeDoc;
      after['*'] = afterDoc;
      continue;
    }
    const slideId = invalidation.slideId;
    if (invalidation.kind === 'shapes' || invalidation.kind === 'structure') {
      for (const shapeId of invalidation.shapeIds) {
        const key = `${slideId}#${shapeId}`;
        targets.push({ slideId, shapeId });
        before[key] = shapeOf(slideOf(beforeDoc, slideId), shapeId) ?? null;
        after[key] = shapeOf(slideOf(afterDoc, slideId), shapeId) ?? null;
      }
    } else {
      targets.push({ slideId });
      before[slideId] = slideOf(beforeDoc, slideId) ?? null;
      after[slideId] = slideOf(afterDoc, slideId) ?? null;
    }
  }
  const origin = meta.origin ?? 'editor';
  const authorKind =
    origin === 'assistant'
      ? 'assistant'
      : origin === 'binding'
      ? 'system'
      : 'user';
  return {
    id: `change-${transactionId}`,
    transactionId: String(transactionId),
    author: { kind: authorKind, label: meta.authorLabel ?? authorKind },
    origin,
    // User edits are accepted immediately; assistant suggestions are pending.
    status: origin === 'assistant' ? 'pending' : 'accepted',
    createdAt: new Date().toISOString(),
    targets,
    summary: label,
    before,
    after
  };
}
