/**
 * Accept and reject projections in pure normal form, and the measured normalization list
 * (architecture 4.3a and 4.4; WP1, ported from the lab's measured projection and canonical form).
 *
 * Accepting removes what a Deletion marks and keeps what an Insertion marks; rejecting the
 * reverse. As the editor itself does it: an inline, a row, a table whose every row, a paragraph
 * whose mark and every run, and a content control whose every run carry the change disappear with
 * it; everything else keeps its place with `pending` dropped. WP1 measured this projection equal
 * to the editor's own acceptAll except for run re-splitting (N6), empty-control removal (handled
 * here) and bookmark ends (an invariant, not a normalization).
 *
 * The proof admits exactly these differences:
 *
 *   N1  a PAGE field's cached text in a header or footer drifts with layout
 *   N2  created runs and marks get an empty character format (absorbed: the normal form never
 *       references an empty format, and this drops any reference to one)
 *   N3  `insertText` writes `bidi: false` into the character format
 *   N4  the root `trackChanges` mirrors the editor's flag
 *   N5  `styleName: Normal` is dropped from empty paragraphs at open
 *   N6  runs are re-split at layout boundaries while pending
 *   N8  an over-wide table's cellWidth and grid are scaled to the page (absorbed: both live in
 *       the residue, which the proof compares without geometry)
 *
 * and, only where an undo is compared with the document it should restore:
 *
 *   N7  undoing a table operation adds row default keys (gridBefore, gridAfter and their widths)
 */
import type { Normalization } from '../../pack';
import type { FormatEntry, NfNode, NormalForm } from '../../tree';
import { HEADER_FOOTER, KIND } from './adapter/keys';
import { revisionsIn } from './adapter/revisions';
import { docxTree } from './tree';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------------ projections

const kindsOf = (pending: unknown): string[] =>
  revisionsIn(pending).map((r) => r.kind);
const allOf = (pending: unknown, kind: string) => {
  const kinds = kindsOf(pending);
  return kinds.length > 0 && kinds.every((k) => k === kind);
};

const runsUnder = (node: NfNode): NfNode[] => {
  const out: NfNode[] = [];
  const rec = (n: NfNode) => {
    for (const key of docxTree.childLists(n)) {
      if (n.kind === KIND.table) continue;
      for (const c of (listOf(n, key) as NfNode[]) ?? []) {
        if (c.kind === KIND.run) out.push(c);
        rec(c);
      }
    }
  };
  rec(node);
  return out;
};

function listOf(node: Obj, key: string): unknown[] | undefined {
  let cur: unknown = node;
  for (const part of key.split('/'))
    cur = isObject(cur) ? cur[part] : undefined;
  return Array.isArray(cur) ? cur : undefined;
}

/** Whether a change of `kind`, once applied, removes this node. */
function removedBy(node: NfNode, kind: string): boolean {
  if (allOf(node.pending, kind)) return true;
  if (node.kind === KIND.table) {
    const rows = (node.rows as NfNode[] | undefined) ?? [];
    return rows.length > 0 && rows.every((r) => allOf(r.pending, kind));
  }
  if (node.kind === KIND.paragraph) {
    const mark = isObject(node.pending) ? node.pending.mark : undefined;
    const runs = runsUnder(node);
    return allOf(mark, kind) && runs.every((r) => allOf(r.pending, kind));
  }
  if (node.kind === KIND.control) {
    const runs = runsUnder(node);
    if (runs.length && runs.every((r) => allOf(r.pending, kind))) return true;
    const tables = ((node.blocks as NfNode[] | undefined) ?? []).filter(
      (b) => b.kind === KIND.table
    );
    return tables.length > 0 && tables.every((t) => removedBy(t, kind));
  }
  return false;
}

function project(nf: NormalForm, drop: string): NormalForm {
  const out = clone(nf);
  const rec = (n: NfNode) => {
    delete n.pending;
    for (const key of docxTree.childLists(n)) {
      const list = listOf(n, key) as NfNode[] | undefined;
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        if (removedBy(list[i], drop)) list.splice(i, 1);
        else rec(list[i]);
      }
    }
  };
  rec(out.root);
  return out;
}

/** All pending changes accepted. */
export const accept = (nf: NormalForm): NormalForm => project(nf, 'Deletion');
/** All pending changes rejected. */
export const reject = (nf: NormalForm): NormalForm => project(nf, 'Insertion');

// ------------------------------------------------------------------ normalizations

/** Apply `edit` to every node; format entries are rewritten copy-on-write. */
function eachNode(
  nf: NormalForm,
  edit: (node: NfNode, inStory: boolean, out: NormalForm) => void
): NormalForm {
  const out = clone(nf);
  const rec = (n: NfNode, inStory: boolean) => {
    edit(n, inStory, out);
    for (const key of docxTree.childLists(n))
      for (const c of (listOf(n, key) as NfNode[]) ?? [])
        rec(c, inStory || key.startsWith(`${HEADER_FOOTER}/`));
  };
  rec(out.root, false);
  return out;
}

const REF_KEYS = ['style', 'markStyle', 'listStyle'];

/** Rewrite a referenced format entry under a fresh key; the original stays for other referrers. */
function rewriteRef(
  out: NormalForm,
  n: NfNode,
  key: string,
  change: (e: FormatEntry) => FormatEntry
) {
  const ref = n[key];
  if (typeof ref !== 'string' || !out.formats[ref]) return;
  const next = change({ ...out.formats[ref] });
  if (!Object.keys(next).length) {
    delete n[key];
    return;
  }
  const id = `${ref}~n`;
  out.formats[id] = next;
  n[key] = id;
}

const textOf = (n: NfNode): string =>
  runsUnder(n)
    .map((r) => String(r.text ?? ''))
    .join('');

export const N1: Normalization = {
  name: 'N1',
  apply: (nf) =>
    eachNode(nf, (n, inStory) => {
      if (
        inStory &&
        n.kind === KIND.run &&
        typeof n.text === 'string' &&
        /^\d+$/.test(n.text)
      )
        n.text = '#';
    })
};

export const N2: Normalization = {
  name: 'N2',
  apply: (nf) =>
    eachNode(nf, (n, _s, out) => {
      for (const key of REF_KEYS)
        if (
          typeof n[key] === 'string' &&
          out.formats[n[key] as string] &&
          !Object.keys(out.formats[n[key] as string]).length
        )
          delete n[key];
    })
};

export const N3: Normalization = {
  name: 'N3',
  apply: (nf) =>
    eachNode(nf, (n, _s, out) => {
      const key =
        n.kind === KIND.paragraph
          ? 'markStyle'
          : n.kind === KIND.run
          ? 'style'
          : null;
      if (!key) return;
      const ref = n[key];
      if (typeof ref === 'string' && out.formats[ref]?.bidi === false)
        rewriteRef(out, n, key, (e) => {
          delete e.bidi;
          return e;
        });
    })
};

export const N4: Normalization = {
  name: 'N4',
  apply: (nf) => {
    const out = clone(nf);
    delete out.root.trackChanges;
    return out;
  }
};

export const N5: Normalization = {
  name: 'N5',
  apply: (nf) =>
    eachNode(nf, (n, _s, out) => {
      if (n.kind !== KIND.paragraph || textOf(n).length) return;
      const ref = n.style;
      if (typeof ref === 'string' && out.formats[ref]?.styleName === 'Normal')
        rewriteRef(out, n, 'style', (e) => {
          delete e.styleName;
          return e;
        });
    })
};

export const N6: Normalization = {
  name: 'N6',
  apply: (nf) =>
    eachNode(nf, (n) => {
      if (!Array.isArray(n.inlines)) return;
      const merged: NfNode[] = [];
      for (const inline of n.inlines as NfNode[]) {
        const prev = merged[merged.length - 1];
        if (prev && prev.kind === KIND.run && inline.kind === KIND.run) {
          const { text: a, id: ia, ...pa } = prev;
          const { text: b, id: ib, ...pb } = inline;
          if (
            ia !== undefined &&
            ib !== undefined &&
            JSON.stringify(pa) === JSON.stringify(pb)
          ) {
            prev.text = `${String(a)}${String(b)}`;
            continue;
          }
        }
        merged.push(inline);
      }
      n.inlines = merged;
    })
};

const ROW_UNDO_DEFAULTS = [
  'gridBefore',
  'gridAfter',
  'gridBeforeWidth',
  'gridAfterWidth',
  'gridBeforeWidthType',
  'gridAfterWidthType'
];
export const N7: Normalization = {
  name: 'N7',
  apply: (nf) =>
    eachNode(nf, (n, _s, out) => {
      if (n.kind !== KIND.row) return;
      const ref = n.style;
      if (
        typeof ref === 'string' &&
        ROW_UNDO_DEFAULTS.some((k) => k in (out.formats[ref] ?? {}))
      )
        rewriteRef(out, n, 'style', (e) => {
          for (const k of ROW_UNDO_DEFAULTS) delete e[k];
          return e;
        });
    })
};

export const NORMALIZATIONS: readonly Normalization[] = [
  N1,
  N2,
  N3,
  N4,
  N5,
  N6
];
export const UNDO_NORMALIZATIONS: readonly Normalization[] = [N7];

// ------------------------------------------------------------------ what rejecting restores

/**
 * Only text and structure are tracked (the native format has revisions for nothing else):
 * formatting (decision D3), bindings, widths and every other property land untracked. So
 * rejecting should restore the document before, with each kept node's own properties as the
 * intended document has them; its text and children come back from the revisions.
 */
export function expectedRejection(
  before: NormalForm,
  intended: NormalForm
): NormalForm {
  const out = clone(before);
  const later = new Map<string, NfNode>();
  const index = (n: NfNode) => {
    later.set(n.id, n);
    for (const key of docxTree.childLists(n))
      for (const c of (listOf(n, key) as NfNode[]) ?? []) index(c);
  };
  index(intended.root);
  Object.assign(out.formats, clone(intended.formats));
  const rec = (n: NfNode) => {
    const m = later.get(n.id);
    if (m && m.kind === n.kind) {
      const lists = new Set(
        [...docxTree.childLists(n), ...docxTree.childLists(m)].map(
          (k) => k.split('/')[0]
        )
      );
      const skip = (k: string) =>
        lists.has(k) || ['id', 'kind', 'text', 'pending'].includes(k);
      for (const k of Object.keys(n)) if (!skip(k) && !(k in m)) delete n[k];
      for (const [k, v] of Object.entries(m)) if (!skip(k)) n[k] = clone(v);
    }
    for (const key of docxTree.childLists(n))
      for (const c of (listOf(n, key) as NfNode[]) ?? []) rec(c);
  };
  rec(out.root);
  return out;
}

// ------------------------------------------------------------------ authorship and residue

/** Whether every revision a pending view names belongs to the change set `turnId`. */
export function authoredBy(pending: unknown, turnId: string): boolean {
  if (!isObject(pending)) return false;
  const all = [...revisionsIn(pending), ...revisionsIn(pending.mark)];
  return all.length > 0 && all.every((r) => r.group === turnId);
}

/**
 * The part of a node's residue a commit must leave as it was: native data the normal form does
 * not show (image payloads, the dialect flag, control colours, unknown keys). Revision anchors are
 * rewritten by every tracked commit, geometry is derived from the cells (N8), binding tags follow
 * the binding the normal form shows, and key order may gain an anchor; none of those is compared.
 */
export function conservedResidue(entry: unknown): unknown {
  if (!isObject(entry)) return entry;
  const hidden = { ...((entry.hidden as Obj) ?? {}) };
  for (const k of [
    'revisionIds',
    'revisions',
    'grid',
    'columnCount',
    'columnIndex'
  ])
    delete hidden[k];
  const hiddenIn: Obj = {};
  for (const [k, subs] of Object.entries((entry.hiddenIn as Obj) ?? {})) {
    const kept = (subs as Array<{ k: string; v: unknown }>)
      .filter(
        (h) => !['revisionIds', 'cellWidth', 'tag', 'title'].includes(h.k)
      )
      .map((h) => ({ k: h.k, v: h.v }));
    if (kept.length) hiddenIn[k] = kept;
  }
  const keys = ((entry.keys as string[]) ?? []).filter(
    (k) => k !== 'revisionIds'
  );
  return { hidden, hiddenIn, keys };
}
