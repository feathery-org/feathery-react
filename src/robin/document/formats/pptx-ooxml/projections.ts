import type { Normalization } from '../../pack';
import {
  clone,
  isPlainObject,
  walk,
  type NfNode,
  type NormalForm
} from '../../tree';
import { pptxTree } from './tree';
import type { Mark, Pending } from './adapter/toNormalForm';

const pendingOf = (node: NfNode) => node.pending as Pending | undefined;

function markedLists(node: NfNode, visit: (list: NfNode[]) => NfNode[]): void {
  for (const key of ['slides', 'shapes'] as const) {
    if (!Array.isArray(node[key])) continue;
    node[key] = visit(node[key] as NfNode[]);
    for (const kid of node[key] as NfNode[]) markedLists(kid, visit);
  }
}

function resolve(
  nf: NormalForm,
  drop: Mark,
  settle: Mark,
  inGroup: (by: string) => boolean
): NormalForm {
  const out = clone(nf);
  markedLists(out.root, (list) =>
    list.filter((node) => {
      const pending = pendingOf(node);
      if (!pending) return true;
      if (pending[drop] && inGroup(pending[drop] as string)) return false;
      if (pending[settle] && inGroup(pending[settle] as string)) {
        const rest = { ...pending };
        delete rest[settle];
        if (Object.keys(rest).length) node.pending = rest;
        else delete node.pending;
      }
      return true;
    })
  );
  return out;
}

export const accept = (nf: NormalForm) =>
  resolve(nf, 'deletion', 'insertion', () => true);

export const reject = (nf: NormalForm) =>
  resolve(nf, 'insertion', 'deletion', () => true);

export const resolveGroup = (
  nf: NormalForm,
  group: string,
  accepted: boolean
) =>
  accepted
    ? resolve(nf, 'deletion', 'insertion', (by) => by === group)
    : resolve(nf, 'insertion', 'deletion', (by) => by === group);

export const authoredBy = (pending: unknown, turnId: string) =>
  isPlainObject(pending) &&
  (pending.insertion === turnId || pending.deletion === turnId);

export function othersOf(pending: unknown, turnId: string): unknown {
  if (!isPlainObject(pending)) return pending;
  const rest = Object.fromEntries(
    Object.entries(pending).filter(([, by]) => by !== turnId)
  );
  return Object.keys(rest).length ? rest : null;
}

const RUN_ATTRIBUTES = ['@_b', '@_i', '@_u', '@_strike', '@_sz'];
const RUN_CHILDREN = ['a:solidFill', 'a:latin'];
const PARAGRAPH_ATTRIBUTES = ['@_algn', '@_lvl'];

const tagOf = (node: Record<string, unknown>) =>
  Object.keys(node).find((key) => key !== ':@');

const isEmpty = (node: Record<string, unknown>, tag: string) =>
  !(node[tag] as unknown[]).length &&
  !Object.keys((node[':@'] as object | undefined) ?? {}).length;

/** A native node less what the normal form shows */
function unmodeled(
  node: Record<string, unknown>
): Record<string, unknown> | null {
  const tag = tagOf(node);
  if (tag === '#slot' || tag === 'a:xfrm' || tag === 'p:xfrm') return null;
  if (!tag || !Array.isArray(node[tag])) return node;
  const attributes = { ...((node[':@'] as Record<string, string>) ?? {}) };
  let kids = (node[tag] as Array<Record<string, unknown>>)
    .map(unmodeled)
    .filter((kid): kid is Record<string, unknown> => kid !== null);
  if (tag === 'a:t') kids = [];
  if (tag === 'p:cNvPr') delete attributes['@_id'];
  if (tag === 'a:rPr') {
    for (const name of RUN_ATTRIBUTES) delete attributes[name];
    kids = kids.filter((kid) => !RUN_CHILDREN.includes(tagOf(kid) as string));
    // The editor gives a run it formats for the first time a language
    if (
      attributes['@_lang'] === 'en-US' &&
      Object.keys(attributes).length === 1
    )
      delete attributes['@_lang'];
  }
  if (tag === 'a:pPr')
    for (const name of PARAGRAPH_ATTRIBUTES) delete attributes[name];
  const out: Record<string, unknown> = { [tag]: kids };
  if (Object.keys(attributes).length) out[':@'] = attributes;
  if ((tag === 'a:rPr' || tag === 'a:pPr') && isEmpty(out, tag)) return null;
  return out;
}

export function conservedResidue(entry: unknown): unknown {
  if (!isPlainObject(entry) || 'pending' in entry) return null;
  if ('slide' in entry)
    return (entry.slide as Array<Record<string, unknown>>).map(unmodeled);
  return unmodeled(entry);
}

/** The editor gives a paragraph left with no runs one empty run, so empty runs are no text at all */
export const emptyRuns: Normalization = {
  name: 'empty-runs',
  apply(nf) {
    let found = false;
    walk(nf.root, pptxTree, ({ node }) => {
      if (Array.isArray(node.runs) && (node.runs as NfNode[]).some(isEmptyRun))
        found = true;
    });
    if (!found) return nf;
    const out = clone(nf);
    walk(out.root, pptxTree, ({ node }) => {
      if (Array.isArray(node.runs))
        node.runs = (node.runs as NfNode[]).filter((run) => !isEmptyRun(run));
    });
    return out;
  }
};

const isEmptyRun = (run: NfNode) => run.kind === 'run' && run.text === '';

/** What a paragraph takes from the layout is read from the deck, never written */
export const inheritedFormat: Normalization = {
  name: 'inherited-format',
  apply(nf) {
    let found = false;
    walk(nf.root, pptxTree, ({ node }) => {
      if (node.inherited !== undefined) found = true;
    });
    if (!found) return nf;
    const out = clone(nf);
    walk(out.root, pptxTree, ({ node }) => {
      delete node.inherited;
    });
    return out;
  }
};

/** The editor names what it adds: a new slide's part and a new shape's id and name */
export const editorIdentity: Normalization = {
  name: 'editor-identity',
  apply(nf) {
    const out = clone(nf);
    walk(out.root, pptxTree, ({ node }) => {
      if (node.kind === 'slide') delete node.path;
      else if (node.shapeId !== undefined) {
        delete node.shapeId;
        delete node.name;
      }
    });
    return out;
  }
};
