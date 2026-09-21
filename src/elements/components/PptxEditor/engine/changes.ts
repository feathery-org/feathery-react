// Tracked-edit records: a durable transaction log derived from engine
// transactions (never from diffing rendered SVG). Separate from the local
// undo stack - application metadata, not Word-style DrawingML revisions.

import type { CommandMeta } from './commands';

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
