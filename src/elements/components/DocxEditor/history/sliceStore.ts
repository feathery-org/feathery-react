// In-memory snapshots of the open session's document at each author boundary.
// A slice is a full serialize() taken when the acting author changed; the diff
// engine uses S0 + these slices + F to attribute every change to its author.
//
// Two things keep memory bounded: image payloads are digested away (they dwarf
// the text and never need to be diffed byte-for-byte), and the count is capped.
import { AuthorKey, Slice } from './types';
import {
  hash32,
  IMAGE_DIGEST_MIN_LENGTH,
  IMAGE_DIGEST_PREFIX
} from './sfdtDiff/index';

export const MAX_SLICES = 20;

/**
 * Replace long `imageString` payloads with the SAME digest normalizeForDiff
 * would produce, so a stored slice and the final document (digested at diff
 * time) compare equal on unchanged images. Returns a new SFDT string.
 */
export function stripImages(sfdt: string): string {
  const walk = (node: any): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (
      typeof node.imageString === 'string' &&
      node.imageString.length > IMAGE_DIGEST_MIN_LENGTH
    ) {
      node.imageString = `${IMAGE_DIGEST_PREFIX}${hash32(node.imageString)}`;
    }
    for (const value of Object.values(node)) walk(value);
  };
  const doc = JSON.parse(sfdt);
  walk(doc);
  return JSON.stringify(doc);
}

export interface SliceStore {
  push(sfdt: string, author: AuthorKey, endedAt?: string): void;
  all(): Slice[];
  size(): number;
  clear(): void;
}

export function createSliceStore(max = MAX_SLICES): SliceStore {
  let slices: Slice[] = [];

  // Keep the count at or under `max` with the least attribution loss: first
  // coalesce the oldest adjacent same-author pair (their boundary carries no
  // information), else drop the oldest slice outright.
  const trim = () => {
    if (slices.length <= max) return;
    let dropAt = -1;
    for (let i = 0; i < slices.length - 1; i++) {
      if (slices[i].author === slices[i + 1].author) {
        dropAt = i; // drop the earlier of the pair; the later snapshot covers it
        break;
      }
    }
    slices.splice(dropAt === -1 ? 0 : dropAt, 1);
  };

  return {
    push(sfdt, author, endedAt) {
      slices.push({ sfdt: stripImages(sfdt), author, endedAt });
      trim();
    },
    all() {
      return [...slices];
    },
    size() {
      return slices.length;
    },
    clear() {
      slices = [];
    }
  };
}
