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
import {
  FEATURE_KEYS,
  HEADER_FOOTER,
  KIND,
  NATIVE_SETTERS
} from './adapter/keys';
import { revisionsIn } from './adapter/revisions';
import { docxTree } from './tree';
import { arr } from './util';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ------------------------------------------------------------------ projections

/** The change set being resolved; undefined resolves every pending change. */
let scope: string | undefined;
const kindsOf = (pending: unknown): string[] =>
  revisionsIn(pending)
    .filter((r) => scope === undefined || r.group === scope)
    .map((r) => r.kind);
/**
 * Whether a pending view carries a change of `kind`: applying it removes the anchor. A run inserted
 * by one change and deleted by another is gone whichever way the document is resolved (measured:
 * the editor's accept-all and reject-all both remove it).
 */
const allOf = (pending: unknown, kind: string) =>
  kindsOf(pending).includes(kind);

/** A pending view less the revisions of change set `group` (its mark's too); null when empty. */
export function withoutGroup(pending: unknown, group: string): Obj | null {
  if (!isObject(pending)) return null;
  const view = (revisions: ReturnType<typeof revisionsIn>): Obj | null => {
    const kept = revisions.filter((r) => r.group !== group);
    if (!kept.length) return null;
    return kept.length > 1 ? { ...kept[0], revisions: kept } : { ...kept[0] };
  };
  const own = view(revisionsIn(pending));
  const mark = view(revisionsIn(pending.mark));
  if (!own && !mark) return null;
  return { ...(own ?? {}), ...(mark ? { mark } : {}) };
}

const runsUnder = (node: NfNode): NfNode[] => {
  const out: NfNode[] = [];
  const rec = (n: NfNode) => {
    for (const key of docxTree.childLists(n)) {
      if (n.kind === KIND.table) continue;
      for (const c of arr<NfNode>(listOf(n, key))) {
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
    const rows = arr<NfNode>(node.rows);
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
    const tables = arr<NfNode>(node.blocks).filter(
      (b) => b.kind === KIND.table
    );
    return tables.length > 0 && tables.every((t) => removedBy(t, kind));
  }
  // a cell or a section whose every block goes goes with them (the editor's own reject removes an
  // inserted column's cells and an inserted section; WP1, measured in the headless lane)
  if (node.kind === KIND.cell || node.kind === KIND.section) {
    const blocks = arr<NfNode>(node.blocks);
    return blocks.length > 0 && blocks.every((b) => removedBy(b, kind));
  }
  return false;
}

function project(nf: NormalForm, drop: string, group?: string): NormalForm {
  const out = clone(nf);
  const rec = (n: NfNode) => {
    if (group === undefined) delete n.pending;
    else {
      const rest = withoutGroup(n.pending, group);
      if (rest) n.pending = rest;
      else delete n.pending;
    }
    for (const key of docxTree.childLists(n)) {
      const list = listOf(n, key) as NfNode[] | undefined;
      if (!list) continue;
      for (let i = list.length - 1; i >= 0; i -= 1) {
        let removed: boolean;
        scope = group;
        try {
          removed = removedBy(list[i], drop);
        } finally {
          scope = undefined;
        }
        if (removed) list.splice(i, 1);
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
/**
 * One change set's card resolved, every other pending change left as it is: what the engine
 * applies when it owns a card's accept or reject (a structural card, or a feature replacement the
 * editor's own resolution would leave as an empty control).
 */
export const resolveGroup = (
  nf: NormalForm,
  group: string,
  acceptIt: boolean
): NormalForm => project(nf, acceptIt ? 'Deletion' : 'Insertion', group);

// ------------------------------------------------------------------ normalizations

/** Apply `edit` to every node; format entries are rewritten copy-on-write. */
/**
 * Apply `edit` to every node of a copy; `edit` returns true when it changed something. When
 * nothing changed the input itself is returned, so the proof can skip re-reading it.
 */
function eachNode(
  nf: NormalForm,
  edit: (node: NfNode, inStory: boolean, out: NormalForm) => boolean | void
): NormalForm {
  const out = clone(nf);
  let changed = false;
  const rec = (n: NfNode, inStory: boolean) => {
    if (edit(n, inStory, out)) changed = true;
    for (const key of docxTree.childLists(n))
      for (const c of arr<NfNode>(listOf(n, key)))
        rec(c, inStory || key.startsWith(`${HEADER_FOOTER}/`));
  };
  rec(out.root, false);
  return changed ? out : nf;
}

const REF_KEYS = ['style', 'markStyle', 'listStyle'];

/** Rewrite a referenced format entry under a fresh key; the original stays for other referrers. */
function rewriteRef(
  out: NormalForm,
  n: NfNode,
  key: string,
  change: (e: FormatEntry) => FormatEntry
): boolean {
  const ref = n[key];
  if (typeof ref !== 'string' || !out.formats[ref]) return false;
  const next = change({ ...out.formats[ref] });
  if (!Object.keys(next).length) {
    delete n[key];
    return true;
  }
  const id = `${ref}~n`;
  out.formats[id] = next;
  n[key] = id;
  return true;
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
        /^\d+$/.test(n.text) &&
        n.text !== '#'
      ) {
        n.text = '#';
        return true;
      }
      return false;
    })
};

export const N2: Normalization = {
  name: 'N2',
  apply: (nf) =>
    eachNode(nf, (n, _s, out) => {
      let changed = false;
      for (const key of REF_KEYS)
        if (
          typeof n[key] === 'string' &&
          out.formats[n[key] as string] &&
          !Object.keys(out.formats[n[key] as string]).length
        ) {
          delete n[key];
          changed = true;
        }
      return changed;
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
      if (!key) return false;
      const ref = n[key];
      if (typeof ref === 'string' && out.formats[ref]?.bidi === false)
        return rewriteRef(out, n, key, (e) => {
          delete e.bidi;
          return e;
        });
      return false;
    })
};

export const N4: Normalization = {
  name: 'N4',
  apply: (nf) => {
    if (!('trackChanges' in nf.root)) return nf;
    const out = clone(nf);
    delete out.root.trackChanges;
    return out;
  }
};

export const N5: Normalization = {
  name: 'N5',
  apply: (nf) =>
    eachNode(nf, (n, _s, out) => {
      if (n.kind !== KIND.paragraph || textOf(n).length) return false;
      const ref = n.style;
      if (typeof ref === 'string' && out.formats[ref]?.styleName === 'Normal')
        return rewriteRef(out, n, 'style', (e) => {
          delete e.styleName;
          return e;
        });
      return false;
    })
};

export const N6: Normalization = {
  name: 'N6',
  apply: (nf) =>
    eachNode(nf, (n) => {
      if (!Array.isArray(n.inlines)) return false;
      const before = (n.inlines as NfNode[]).length;
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
      return merged.length !== before;
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
      if (n.kind !== KIND.row) return false;
      const ref = n.style;
      if (
        typeof ref === 'string' &&
        ROW_UNDO_DEFAULTS.some((k) => k in (out.formats[ref] ?? {}))
      )
        return rewriteRef(out, n, 'style', (e) => {
          for (const k of ROW_UNDO_DEFAULTS) delete e[k];
          return e;
        });
      return false;
    })
};

/** A format entry read whole: a hoisted reference resolved, an inline object as it is. */
const entryOf = (nf: NormalForm, ref: unknown): Obj | null =>
  typeof ref === 'string'
    ? (nf.formats[ref] as Obj | undefined) ?? null
    : isObject(ref)
    ? ref
    : null;

/**
 * N9 (undo only, measured in the headless lane): undoing a native paragraph property writes the
 * previous value back explicitly, where before it was inherited (an explicit `textAlignment: Left`
 * where the paragraph had none). A paragraph property the editor sets natively, explicit with the
 * value its named style (through `basedOn`) or the document default gives it, is the same as absent.
 */
export const N9: Normalization = {
  name: 'N9',
  apply: (nf) => {
    const styles = new Map(
      arr<Obj>(nf.root.styles).map((s) => [String(s.name), s] as const)
    );
    const documentDefault = entryOf(nf, nf.root.paragraphFormat) ?? {};
    const inherited = (styleName: unknown, key: string): unknown => {
      const seen = new Set<string>();
      let style = styles.get(String(styleName ?? 'Normal'));
      while (style && !seen.has(String(style.name))) {
        seen.add(String(style.name));
        const pf = entryOf(nf, style.paragraphFormat);
        if (pf && key in pf) return pf[key];
        style = styles.get(String(style.basedOn));
      }
      return documentDefault[key];
    };
    return eachNode(nf, (n, _s, out) => {
      if (n.kind !== KIND.paragraph || typeof n.style !== 'string')
        return false;
      const entry = out.formats[n.style];
      if (!entry) return false;
      const drop = NATIVE_SETTERS.paragraph.filter(
        (k) =>
          k in entry &&
          inherited(entry.styleName, k) !== undefined &&
          JSON.stringify(entry[k]) ===
            JSON.stringify(inherited(entry.styleName, k))
      );
      if (!drop.length) return false;
      return rewriteRef(out, n, 'style', (e) => {
        for (const k of drop) delete e[k];
        return e;
      });
    });
  }
};

export const NORMALIZATIONS: readonly Normalization[] = [
  N1,
  N2,
  N3,
  N4,
  N5,
  N6
];
export const UNDO_NORMALIZATIONS: readonly Normalization[] = [N7, N9];

// ------------------------------------------------------------------ what rejecting restores

/**
 * Text, structure and feature attributes are tracked (a changed binding or formula is the node
 * replaced); formatting (decision D3), widths and every other property land untracked, since the
 * native format has no revision for them. So rejecting should restore the document before, with
 * each kept node's own properties, less its feature attributes, as the intended document has
 * them; its text, children and features come back from the revisions.
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
      for (const c of arr<NfNode>(listOf(n, key))) index(c);
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
        lists.has(k) ||
        ['id', 'kind', 'text', 'pending', ...FEATURE_KEYS].includes(k);
      for (const k of Object.keys(n)) if (!skip(k) && !(k in m)) delete n[k];
      for (const [k, v] of Object.entries(m)) if (!skip(k)) n[k] = clone(v);
    }
    for (const key of docxTree.childLists(n))
      for (const c of arr<NfNode>(listOf(n, key))) rec(c);
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
  const keys = arr<string>(entry.keys).filter((k) => k !== 'revisionIds');
  return { hidden, hiddenIn, keys };
}

/**
 * Whether the editor's own accept or reject cannot settle change set `group`, so the engine
 * resolves its card: a node it carries twice (a feature replacement keeps the old control beside
 * the new one, and the editor keeps no revision on a control's own markers, so its resolution
 * leaves an empty control), or a revision in a header or footer, whose native reject does not
 * restore the story (architecture 7.5, probe P1b).
 */
export function ownsResolution(nf: NormalForm, group: string): boolean {
  const seen = new Map<string, number>();
  let story = false;
  const ours = (n: NfNode) =>
    isObject(n.pending) &&
    [...revisionsIn(n.pending), ...revisionsIn(n.pending.mark)].some(
      (r) => r.group === group
    );
  const marked = new Set<string>();
  const rec = (n: NfNode, inStory: boolean) => {
    seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
    if (ours(n)) {
      marked.add(n.id);
      if (inStory) story = true;
    }
    for (const key of docxTree.childLists(n))
      for (const c of arr<NfNode>(listOf(n, key)))
        rec(c, inStory || key.startsWith(`${HEADER_FOOTER}/`));
  };
  rec(nf.root, false);
  if (story) return true;
  // a twice-carried node whose copies hold this card's revisions somewhere inside
  const twice = new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  if (!twice.size) return false;
  let owned = false;
  const inside = (n: NfNode, under: boolean) => {
    const here = under || twice.has(n.id);
    if (here && marked.has(n.id)) owned = true;
    for (const key of docxTree.childLists(n))
      for (const c of arr<NfNode>(listOf(n, key))) inside(c, here);
  };
  inside(nf.root, false);
  return owned;
}
