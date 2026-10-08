/**
 * The commit plan by delta class (architecture 4.3a, measured in WP1; classification ported from
 * the lab's live commit, `wp4/live.mjs`):
 *
 *   text     text-shaped deltas inside existing paragraphs of the body and table cells: tracked
 *            `insertText` and `delete` in one grouped undo step, tagged with the change set; the
 *            card and the user's undo stack survive (WP1 P1 and P2 pass for these)
 *   format   character formatting only: the native format API on the selected span in one undo
 *            group; the editor authors no revision for formatting, so it lands immediately with
 *            no card (decision D3)
 *   splice   everything else (table structure, paragraphs added, removed or moved, headers and
 *            footers, controls holding blocks, mixed text and formatting): the engine composes the
 *            tracked document itself and replaces the editor's document with it (WP1 P3, the only
 *            path that passes for table structure); the editor's undo history is cleared and the
 *            engine keeps the way back
 *
 * Composition is by id, recursively, at the granularity of what changed (ported from the lab's
 * `wp3/track.mjs`): a kept child is merged; a dropped child stays in place marked Deletion; a
 * child that matches nothing is marked Insertion; a run whose text changed becomes the old run
 * (Deletion) beside the new (Insertion) inside the same paragraph and control. Property changes
 * have no revision in the native format and land untracked.
 */
import type { Warning } from '../../envelope';
import type { CommitPlan, DocumentView, PlanContext } from '../../pack';
import { NfNode, NormalForm, canonicalJson, clone } from '../../tree';
import {
  FEATURE_KEYS,
  FORMAT_REF_KEYS,
  HEADER_FOOTER,
  KIND,
  NATIVE_SETTERS
} from './adapter/keys';
import { revisionsIn } from './adapter/revisions';
import { fromNormalForm } from './adapter/fromNormalForm';
import { ownText } from './outline';
import { docxTree } from './tree';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export const AUTHOR = 'Robin';

// ------------------------------------------------------------------ composing tracked changes

function listOf(node: Obj, key: string): NfNode[] | undefined {
  let cur: unknown = node;
  for (const part of key.split('/'))
    cur = isObject(cur) ? cur[part] : undefined;
  return Array.isArray(cur) ? (cur as NfNode[]) : undefined;
}
function setList(node: Obj, key: string, list: NfNode[]): void {
  const parts = key.split('/');
  let cur: Obj = node;
  for (const part of parts.slice(0, -1)) cur = cur[part] as Obj;
  cur[parts[parts.length - 1]] = list;
}

type Pending = { kind: string; author: string; group: string };

/** Add a revision to a pending view (keeping any revision already there). */
function withRevision(existing: unknown, p: Pending): Obj {
  const prior = revisionsIn(existing);
  if (!prior.length) return { ...(isObject(existing) ? existing : {}), ...p };
  const all = [...prior, p];
  const mark = isObject(existing) ? existing.mark : undefined;
  return { ...all[0], revisions: all, ...(mark ? { mark } : {}) };
}

/** Mark every revision anchor inside a node: runs and other text inlines, paragraph marks, rows. */
export function markSubtree(node: NfNode, p: Pending): void {
  if (node.kind === KIND.run) node.pending = withRevision(node.pending, p);
  if (node.kind === KIND.paragraph) {
    const mark = isObject(node.pending) ? node.pending.mark : undefined;
    node.pending = {
      ...(isObject(node.pending) ? node.pending : {}),
      mark: withRevision(mark, p)
    };
  }
  if (node.kind === KIND.row) {
    const mark = isObject(node.pending) ? node.pending.mark : undefined;
    node.pending = {
      ...withRevision(node.pending, p),
      ...(mark ? { mark } : {})
    };
  }
  for (const key of docxTree.childLists(node))
    for (const child of listOf(node, key) ?? []) markSubtree(child, p);
}

const ownFields = (n: NfNode): string => {
  const out: Obj = {};
  const lists = new Set(docxTree.childLists(n).map((k) => k.split('/')[0]));
  for (const [k, v] of Object.entries(n))
    if (!lists.has(k) && k !== 'pending' && k !== 'text') out[k] = v;
  return canonicalJson(out);
};

/**
 * A node's own fields with every format reference read as the entry it names, less `except`: a
 * set on a shared format entry changes what its referrers look like without changing their ids.
 */
function ownContent(
  formats: Record<string, unknown>,
  n: NfNode,
  except: string[] = []
): string {
  const copy: Obj = { ...n };
  for (const k of except) delete copy[k];
  for (const k of FORMAT_REF_KEYS)
    if (typeof copy[k] === 'string')
      copy[k] = { format: formats[copy[k] as string] ?? null };
  return ownFields(copy as NfNode);
}

/**
 * The tracked document: `intended` with what it removed kept in place as Deletion and what it
 * added marked Insertion, all under change set `turnId`. Also reports whether any property change
 * lands untracked.
 */
export function composeTracked(
  before: DocumentView,
  intended: NormalForm,
  turnId: string
): { tracked: NormalForm; untracked: string[] } {
  const ins: Pending = { kind: 'Insertion', author: AUTHOR, group: turnId };
  const del: Pending = { kind: 'Deletion', author: AUTHOR, group: turnId };
  const tracked = clone(intended);
  const untracked: string[] = [];
  const moved = new Set<string>();
  const removedCopies: NfNode[] = [];

  const merge = (node: NfNode, original: NfNode) => {
    if (
      ownContent(intended.formats, node) !==
      ownContent(before.nf.formats, original)
    )
      untracked.push(node.id);
    for (const key of docxTree.childLists(node)) {
      const kids = listOf(node, key) ?? [];
      const was = listOf(original, key) ?? [];
      const keep = new Set(kids.map((k) => k.id));
      const result: NfNode[] = [];
      let w = 0;
      const flushRemovedBefore = (stopId: string | null) => {
        while (w < was.length && was[w].id !== stopId && !keep.has(was[w].id)) {
          const gone = clone(was[w]);
          markSubtree(gone, del);
          removedCopies.push(gone);
          result.push(gone);
          w += 1;
        }
      };
      for (const kid of kids) {
        flushRemovedBefore(kid.id);
        const old = was.find((x) => x.id === kid.id);
        if (old && was[w]?.id === kid.id) w += 1;
        if (!old) {
          // new here, or moved here from elsewhere: an insertion in this list
          markSubtree(kid, ins);
          result.push(kid);
          if (before.get(kid.id)) moved.add(kid.id);
          continue;
        }
        if (kid.kind === KIND.run && kid.text !== old.text) {
          const gone = clone(old);
          markSubtree(gone, del);
          markSubtree(kid, ins);
          result.push(gone, kid);
          continue;
        }
        if (
          FEATURE_KEYS.some(
            (k) =>
              canonicalJson(kid[k] ?? null) !== canonicalJson(old[k] ?? null)
          )
        ) {
          // a feature attribute changed (a rewritten formula, a binding removed): content, so the
          // old node stays as a Deletion beside the new one as an Insertion, and reject restores it;
          // like a move, the bookmarks it holds stay with the new copy. The editor keeps no
          // revision on a control's own markers through open(), so its piecewise accept or reject
          // leaves the other control as an empty shell: such a card resolves through the engine's
          // projections (`featureReplacements` names it), never natively
          const gone = clone(old);
          markSubtree(gone, del);
          markSubtree(kid, ins);
          removedCopies.push(gone);
          moved.add(kid.id);
          result.push(gone, kid);
          continue;
        }
        merge(kid, old);
        result.push(kid);
      }
      flushRemovedBefore(null);
      while (w < was.length) {
        if (!keep.has(was[w].id)) {
          const gone = clone(was[w]);
          markSubtree(gone, del);
          removedCopies.push(gone);
          result.push(gone);
        }
        w += 1;
      }
      setList(node, key, result);
    }
  };
  merge(tracked.root, before.nf.root);
  // A moved node is a Deletion where it was and an Insertion where it goes. A bookmark name is
  // unique, and with both copies pending the editor's accept drops the moved copy's bookmark
  // (WP1 F8, measured again in the headless lane), so the bookmarks stay with the moved copy only.
  const stripBookmarks = (n: NfNode) => {
    if (Array.isArray(n.inlines))
      n.inlines = (n.inlines as NfNode[]).filter(
        (i) => i.kind !== KIND.bookmark
      );
    for (const key of docxTree.childLists(n))
      for (const c of listOf(n, key) ?? []) stripBookmarks(c);
  };
  for (const copy of removedCopies)
    if (moved.has(copy.id)) stripBookmarks(copy);
  return { tracked, untracked };
}

// ------------------------------------------------------------------ classifying the delta

/** The editor's hierarchical paragraph index (`section;block;row;cell;block...`), or null. */
export function hierOf(view: DocumentView, id: string): string | null {
  const out: Array<string | number> = [];
  let p = view.placement(id);
  while (p && p.parent) {
    const key = p.key as string;
    if (!['sections', 'blocks', 'rows', 'cells'].includes(key)) return null;
    // a paragraph inside a block-level control is not addressable natively (lab: not wired)
    if (key === 'blocks' && p.parent.kind === KIND.control) return null;
    out.unshift(p.index);
    p = view.placement(p.parent.id);
  }
  return out.length ? out.join(';') : null;
}

export interface TextOp {
  hi: string;
  a: number;
  b: number;
  /** `a` as the editor counts it (inline control boundaries take a position each). */
  at: number;
  oldMid: string;
  newMid: string;
}

export interface FormatOp {
  /**
   * What the op formats: a run's span or a paragraph mark (character), or the paragraph, table,
   * row or cell holding the paragraph at `hi` (its first paragraph for a table, row or cell).
   */
  target: 'character' | 'paragraph' | 'table' | 'row' | 'cell';
  hi: string;
  /** Whole paragraph mark, or a run's span (character ops). */
  whole: boolean;
  a: number;
  b: number;
  /** `a` as the editor counts it, for a span. */
  at: number;
  expect: string;
  props: Record<string, unknown>;
}

const charFormat = (view: DocumentView, ref: unknown): Obj =>
  typeof ref === 'string' ? (view.nf.formats[ref] as Obj) ?? {} : {};

function cfDelta(before: Obj, after: Obj): Obj {
  const out: Obj = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (canonicalJson(before[k]) === canonicalJson(after[k])) continue;
    out[k] = after[k] === undefined ? null : after[k];
  }
  return out;
}

/**
 * The native setter values that take a format entry from `was` to `is`, or null when some change
 * has no native setter (or removes a value, which no setter does). A cell's shading whose only
 * change is its background colour is the cell format's `background`.
 */
function nativeProps(target: string, was: Obj, is: Obj): Obj | null {
  const out: Obj = {};
  for (const [k, v] of Object.entries(cfDelta(was, is))) {
    if (k === 'shading' && target === 'cell') {
      const sd = cfDelta(
        isObject(was.shading) ? was.shading : {},
        isObject(v) ? v : {}
      );
      const keys = Object.keys(sd);
      if (
        keys.length === 1 &&
        keys[0] === 'backgroundColor' &&
        typeof sd.backgroundColor === 'string'
      ) {
        out.background = sd.backgroundColor;
        continue;
      }
      return null;
    }
    if (v === null || !NATIVE_SETTERS[target]?.includes(k)) return null;
    out[k] = v;
  }
  return out;
}

/** The paragraph the editor's selection goes to for a table, row or cell: its first one. */
function firstParagraphHi(view: DocumentView, node: NfNode): string | null {
  let cur: NfNode | undefined = node;
  while (cur && cur.kind !== KIND.paragraph) {
    if (cur.kind === KIND.table) cur = (cur.rows as NfNode[] | undefined)?.[0];
    else if (cur.kind === KIND.row)
      cur = (cur.cells as NfNode[] | undefined)?.[0];
    else if (cur.kind === KIND.cell)
      cur = (cur.blocks as NfNode[] | undefined)?.[0];
    else return null;
  }
  return cur ? hierOf(view, cur.id) : null;
}

const childIds = (n: NfNode) =>
  canonicalJson(
    docxTree.childLists(n).map((k) => (listOf(n, k) ?? []).map((c) => c.id))
  );

/** A native plan for the delta, or null when it needs the document replaced. */
function nativePlan(
  before: DocumentView,
  intended: DocumentView
): { text: TextOp[]; format: FormatOp[] } | null {
  const text: TextOp[] = [];
  const format: FormatOp[] = [];
  const beforeNodes = before.nodes();
  if (beforeNodes.length !== intended.nodes().length) return null;
  const textParagraphs = new Set<string>();
  for (const old of beforeNodes) {
    const now = intended.get(old.id);
    if (!now || now.kind !== old.kind) return null;
    if (isObject(old.pending)) {
      // a node with someone's pending change is left to the composed path
      if (canonicalJson(old.pending) !== canonicalJson(now.pending))
        return null;
    }
    if (childIds(old) !== childIds(now)) return null;
    const was = before.nf.formats;
    const is = intended.nf.formats;
    const ownSame = ownContent(was, old) === ownContent(is, now);
    if (old.kind === KIND.run) {
      // by what the format says, not its id: a set on a shared entry keeps every referrer's id
      const styleChanged =
        canonicalJson(charFormat(before, old.style)) !==
        canonicalJson(charFormat(intended, now.style));
      const textChanged = old.text !== now.text;
      if (!textChanged && !styleChanged && ownSame) continue;
      const para = enclosingParagraph(intended, now.id);
      if (!para) return null;
      if (textChanged) textParagraphs.add(para.id);
      if (styleChanged) {
        const hi = hierOf(before, para.id);
        if (!hi) return null;
        const { start, text: runText } = runOffset(before, para.id, old.id);
        format.push({
          target: 'character',
          hi,
          whole: false,
          at: editorOffset(before, para.id, start),
          a: start,
          b: start + runText.length,
          expect: runText,
          props: cfDelta(
            charFormat(before, old.style),
            charFormat(intended, now.style)
          )
        });
      }
      if (ownContent(was, old, ['style']) !== ownContent(is, now, ['style']))
        return null;
      continue;
    }
    if (old.kind === KIND.paragraph) {
      if (
        ownContent(was, old, ['style', 'markStyle']) !==
        ownContent(is, now, ['style', 'markStyle'])
      )
        return null;
      const hi = hierOf(before, old.id);
      const markChanged =
        canonicalJson(charFormat(before, old.markStyle)) !==
        canonicalJson(charFormat(intended, now.markStyle));
      const paraChanged =
        canonicalJson(charFormat(before, old.style)) !==
        canonicalJson(charFormat(intended, now.style));
      if ((markChanged || paraChanged) && !hi) return null;
      if (markChanged)
        format.push({
          target: 'character',
          hi: hi as string,
          whole: true,
          at: 0,
          a: 0,
          b: 0,
          expect: ownText(before.get(old.id) as NfNode) ?? '',
          props: cfDelta(
            charFormat(before, old.markStyle),
            charFormat(intended, now.markStyle)
          )
        });
      if (paraChanged) {
        const props = nativeProps(
          'paragraph',
          charFormat(before, old.style),
          charFormat(intended, now.style)
        );
        if (!props) return null;
        format.push({
          target: 'paragraph',
          hi: hi as string,
          whole: false,
          at: 0,
          a: 0,
          b: 0,
          expect: '',
          props
        });
      }
      continue;
    }
    if (
      old.kind === KIND.table ||
      old.kind === KIND.row ||
      old.kind === KIND.cell
    ) {
      if (ownContent(was, old, ['style']) !== ownContent(is, now, ['style']))
        return null;
      const wasF = charFormat(before, old.style);
      const isF = charFormat(intended, now.style);
      if (canonicalJson(wasF) === canonicalJson(isF)) continue;
      const props = nativeProps(old.kind, wasF, isF);
      const hi = firstParagraphHi(before, old);
      if (!props || !hi) return null;
      format.push({
        target: old.kind as FormatOp['target'],
        hi,
        whole: false,
        at: 0,
        a: 0,
        b: 0,
        expect: '',
        props
      });
      continue;
    }
    if (!ownSame) return null;
  }
  for (const id of textParagraphs) {
    const hi = hierOf(before, id);
    if (!hi) return null;
    const oldText = ownText(before.get(id) as NfNode) ?? '';
    const newText = ownText(intended.get(id) as NfNode) ?? '';
    let a = 0;
    while (
      a < oldText.length &&
      a < newText.length &&
      oldText[a] === newText[a]
    )
      a += 1;
    let z = 0;
    while (
      z < oldText.length - a &&
      z < newText.length - a &&
      oldText[oldText.length - 1 - z] === newText[newText.length - 1 - z]
    )
      z += 1;
    // whole words: a tracked change reads as words replaced, not letters inside a word
    const ws = (c: string | undefined) => c === undefined || /\s/.test(c);
    while (a > 0 && !ws(oldText[a - 1])) a -= 1;
    while (z > 0 && !ws(oldText[oldText.length - z])) z -= 1;
    text.push({
      hi,
      a,
      at: editorOffset(before, id, a),
      b: oldText.length - z,
      oldMid: oldText.slice(a, oldText.length - z),
      newMid: newText.slice(a, newText.length - z)
    });
  }
  if (text.length && format.length) return null; // the lab's rule: one native seam per change set
  return { text, format };
}

function enclosingParagraph(view: DocumentView, id: string): NfNode | null {
  let p = view.placement(id);
  while (p && p.parent) {
    if (p.parent.kind === KIND.paragraph) return p.parent;
    p = view.placement(p.parent.id);
  }
  return null;
}

/**
 * A text offset in a paragraph's own text as the editor counts it: each inline content control's
 * start and end take one position (measured in the headless lane), so an offset after a control is
 * two further on, and one inside it one further. Offsets come from the normal form, never searched.
 */
export function editorOffset(
  view: DocumentView,
  paragraphId: string,
  offset: number
): number {
  let t = 0;
  let markers = 0;
  let done = false;
  const rec = (inlines: NfNode[] | undefined) => {
    for (const i of inlines ?? []) {
      if (done) return;
      if (i.kind === KIND.run) {
        const len = String(i.text ?? '').length;
        if (t + len > offset || (t === offset && len > 0)) {
          done = true;
          return;
        }
        t += len;
      } else if (i.kind === KIND.control && Array.isArray(i.inlines)) {
        markers += 1;
        rec(i.inlines as NfNode[]);
        if (done) return;
        markers += 1;
      } else if (Array.isArray(i.inlines)) rec(i.inlines as NfNode[]);
    }
  };
  rec(view.get(paragraphId)?.inlines as NfNode[] | undefined);
  return offset + markers;
}

/** A run's character offset in its paragraph's own text. */
function runOffset(
  view: DocumentView,
  paragraphId: string,
  runId: string
): { start: number; text: string } {
  let at = 0;
  let found = { start: 0, text: '' };
  const rec = (inlines: NfNode[] | undefined) => {
    for (const i of inlines ?? []) {
      if (i.kind === KIND.run) {
        if (i.id === runId) found = { start: at, text: String(i.text ?? '') };
        at += String(i.text ?? '').length;
      }
      if (Array.isArray(i.inlines)) rec(i.inlines as NfNode[]);
    }
  };
  rec(view.get(paragraphId)?.inlines as NfNode[] | undefined);
  return found;
}

// ------------------------------------------------------------------ the plan

const UNDO_CLEARED: Warning = {
  code: 'undo-history-cleared',
  message:
    "The editor's undo history before this change is no longer available; the card is the way back."
};
const IMMEDIATE: Warning = {
  code: 'immediate-not-tracked',
  message:
    'Formatting and property changes are applied immediately and are not part of the review card; undo reverts them.'
};

export function plan(ctx: PlanContext): CommitPlan {
  const native = nativePlan(ctx.before, ctx.intended);
  // a write that changes nothing the document holds lands nothing
  if (native && !native.text.length && !native.format.length)
    return { steps: [], landed: 'immediate', history: 'editor' };
  if (native && native.text.length)
    return {
      steps: [{ seam: 'text', payload: native.text }],
      landed: 'card',
      history: 'editor'
    };
  if (native && native.format.length)
    return {
      steps: [{ seam: 'format', payload: native.format }],
      landed: 'immediate',
      history: 'editor',
      warnings: [IMMEDIATE]
    };
  const { tracked, untracked } = composeTracked(
    ctx.before,
    ctx.intended.nf,
    ctx.turnId
  );
  const payload = fromNormalForm(tracked, {
    ...ctx.beforeResidue,
    ...ctx.intendedResidue
  } as never);
  // truthful about the card: a splice that composed no revision (properties only) lands immediately
  const card = revisionsAuthored(tracked.root, ctx.turnId);
  return {
    steps: [{ seam: 'splice', payload }],
    landed: card ? 'card' : 'immediate',
    history: 'engine',
    warnings: [UNDO_CLEARED, ...(untracked.length ? [IMMEDIATE] : [])]
  };
}

/** Whether anything under `node` carries a revision of change set `turnId`. */
function revisionsAuthored(node: unknown, turnId: string): boolean {
  if (Array.isArray(node))
    return node.some((n) => revisionsAuthored(n, turnId));
  if (!isObject(node)) return false;
  if (
    isObject(node.pending) &&
    [...revisionsIn(node.pending), ...revisionsIn(node.pending.mark)].some(
      (r) => r.group === turnId
    )
  )
    return true;
  return Object.entries(node).some(
    ([k, v]) => k !== 'pending' && revisionsAuthored(v, turnId)
  );
}

export const STORY_PREFIX = `${HEADER_FOOTER}/`;
