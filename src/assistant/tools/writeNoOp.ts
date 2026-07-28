// ---------------------------------------------------------------------------
// The no-op write rule
//
// A tracked change is a claim: "this is different now". Rewriting `0.00` as
// `0.00` makes that claim falsely, and it does more damage than the wasted
// revision suggests - a reviewer who opens three change cards and finds two of
// them identical to what was already there learns that a change card does not
// mean anything, and starts accepting them without reading. Observed live on
// 2026-07-27: the engine wrote `0.00` over `0.00` and it appeared in the review
// pane as a tracked change.
//
// So: BEFORE writing, compare the value about to be written with what the cell
// already holds. If they are identical, write nothing at all - no selection, no
// insertText, no revision, no change card. The op still reports `ok: true`
// (the requested state IS the state), carrying a `noOp` record so the model can
// say "already correct" instead of "changed" and so a human can see the op ran.
//
// This is a universal rule in the write path, not a formula feature: every
// value-writing op consults it (see NO_OP_CHECKED_OPS in
// syncfusionDocumentOps.ts). It is also what makes a whole-column recompute
// safe - the engine computes every row and only the cells that actually moved
// produce a card.
//
// WHAT "IDENTICAL" MEANS - the whole subtlety
//
// Identical means the *rendered text*: value AND format, byte for byte.
//
//   `$0.00`  ->  `$0.00`      identical            -> SKIP
//   `$0.00`  ->  `0.00`       same number, no `$`  -> WRITE
//   `0.00`   ->  `0`          same number, 0 dp    -> WRITE
//   `1,000.00` -> `1000.00`   same number, no comma-> WRITE
//   `(100.00)` -> `-100.00`   same number, style   -> WRITE
//
// Comparing PARSED NUMERIC VALUES instead would be wrong in exactly the cases
// that matter: it would suppress `$0.00 -> 0.00`, which strips a currency
// symbol out of a document and is a real, reviewable change. The comparison is
// therefore textual and strict, and it fails in the safe direction: a byte
// difference is always written, so no genuine change can ever be swallowed. The
// only thing a strict comparison can miss is a cosmetically-invisible
// difference (a trailing space), which is still a real edit to the document
// text and is correctly written.
// ---------------------------------------------------------------------------

import { parseNumericCell, rescaleExact } from './numericCells';

/**
 * THE RULE. True when writing `next` where `current` already stands would
 * change nothing at all.
 *
 * Deliberately a strict text comparison - see the header for why a numeric
 * comparison would be wrong. Keep it that way: every relaxation of this
 * predicate silently suppresses a real change somewhere.
 */
export function writeIsNoOp(current: string, next: string): boolean {
  return current === next;
}

/**
 * Why two cell texts differ, for receipts and refusal details. Never consulted
 * for the skip decision itself - only `writeIsNoOp` decides that - but it is
 * what lets a receipt say "same number, different format" out loud rather than
 * leaving a reviewer to spot it.
 */
export type WriteDifference =
  | { changed: false }
  | {
      changed: true;
      /** Both texts parse as numbers and those numbers are equal. */
      sameNumber: boolean;
      /** `format` when only the rendering moved, `value` otherwise. */
      difference: 'value' | 'format';
    };

/** True when both texts parse numerically and denote the same magnitude. */
function sameParsedNumber(current: string, next: string): boolean {
  const a = parseNumericCell(current);
  const b = parseNumericCell(next);
  if (!a || !b) return false;
  const scale = Math.max(a.value.scale, b.value.scale);
  const left = rescaleExact(a.value, scale);
  const right = rescaleExact(b.value, scale);
  return !!left && !!right && left.units === right.units;
}

export function describeWriteDifference(
  current: string,
  next: string
): WriteDifference {
  if (writeIsNoOp(current, next)) return { changed: false };
  const sameNumber = sameParsedNumber(current, next);
  return {
    changed: true,
    sameNumber,
    difference: sameNumber ? 'format' : 'value'
  };
}

/** `"$4,810.00" -> "$4,810.13"`, or `"" (blank) -> "$0.00"`. */
export function describeTextChange(current: string, next: string): string {
  const shown = (text: string) =>
    text === '' ? '"" (blank)' : JSON.stringify(text);
  const difference = describeWriteDifference(current, next);
  const sameNumberNote =
    difference.changed && difference.sameNumber
      ? ' (same number, different format)'
      : '';
  return `${shown(current)} -> ${shown(next)}${sameNumberNote}`;
}

/**
 * The record a skipped write leaves behind. There is no revision and no change
 * card, so this result IS the whole trace of the op - it names the anchor, the
 * text that was already there, and the fact that nothing was written.
 */
export interface NoOpWriteReport {
  /** The anchor the op addressed. */
  anchor: string;
  /** The op that was skipped. */
  op: string;
  /** The text already present, which is also the text that was to be written. */
  text: string;
  /** Always true; present so a consumer can branch on the field alone. */
  skipped: true;
  /** One line to relay. */
  receipt: string;
}

export function buildNoOpWriteReport(
  op: string,
  anchor: string,
  text: string,
  /** What the op was going to do, in the op's own terms, for the receipt. */
  what?: string
): NoOpWriteReport {
  const subject = what?.trim() ? `${what.trim()} ` : '';
  return {
    anchor,
    op,
    text,
    skipped: true,
    receipt:
      `Nothing written at ${anchor}: ${subject}already reads ` +
      `${text === '' ? '"" (blank)' : JSON.stringify(text)}, identical in ` +
      'value and format to what this op would have written. No revision and ' +
      'no change card were created.'
  };
}
