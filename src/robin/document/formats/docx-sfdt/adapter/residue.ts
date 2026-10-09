/**
 * The residue: per node id, everything the normal form leaves out and the way back needs.
 * Never shown to the model. It is what makes the round trip byte-exact.
 */

/** A sub-key taken out of an object, with the position it had. */
export interface HiddenSub {
  at: number;
  k: string;
  v: unknown;
}

export interface BindingRecord {
  /** The binding as the normal form shows it. */
  view: Record<string, unknown>;
  /** The tag's key order, so an unchanged binding expands to the same bytes. */
  order: string[];
  tag: string;
  title: unknown;
}

export interface NodeRecord {
  /** The native node's keys, in order. */
  keys: string[];
  /** Normal-form key to the native format key it publishes (`style` to `paragraphFormat`). */
  fmt: Record<string, string>;
  /** Node-level native keys the normal form hides. */
  hidden: Record<string, unknown>;
  /** Per native key, the sub-keys taken out of that object. */
  hiddenIn: Record<string, HiddenSub[]>;
  binding?: BindingRecord;
  /** A table's cell geometry when read, which decides whether its grid is kept or derived. */
  geometry?: string;
  /** A cell's preferred width when read, which decides whether its laid-out width is kept. */
  preferredWidth?: unknown;
  /** The node's `pending` view when read; a different one means the engine re-authored it. */
  pending?: string;
}

export type DocxResidue = Record<string, NodeRecord>;
