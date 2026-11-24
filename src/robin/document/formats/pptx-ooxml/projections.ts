import { FILLS } from '../../../../elements/components/PptxEditor/core/model/edit';
import { MERGE_MARKS, isMerge } from './adapter/nodes';
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
// A run's link tags follow the link it sits in
const RUN_CHILDREN = [
  ...FILLS,
  'a:highlight',
  'a:latin',
  'a:hlinkClick',
  'a:hlinkMouseOver'
];
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
  // A frame and a table's column grid follow from what the normal form shows
  if (
    tag === '#slot' ||
    tag === 'a:xfrm' ||
    tag === 'p:xfrm' ||
    tag === 'a:tblGrid'
  )
    return null;
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
  if (tag === 'a:tc') {
    for (const mark of MERGE_MARKS)
      if (isMerge(mark, attributes[`@_${mark}`]))
        delete attributes[`@_${mark}`];
    // A text body holding nothing but paragraphs is what a cell without one gets once written
    kids = kids.filter((kid) => !(tagOf(kid) === 'a:txBody' && isBare(kid)));
  }
  // The editor gives a row it copies an id of its own
  if (tag === 'a:tr') kids = kids.filter((kid) => tagOf(kid) !== 'a:extLst');
  const out: Record<string, unknown> = { [tag]: kids };
  if (Object.keys(attributes).length) out[':@'] = attributes;
  if ((tag === 'a:rPr' || tag === 'a:pPr') && isEmpty(out, tag)) return null;
  return out;
}

const isBare = (body: Record<string, unknown>) =>
  (body['a:txBody'] as Array<Record<string, unknown>>).every(
    (kid) =>
      ['a:bodyPr', 'a:lstStyle'].includes(tagOf(kid) as string) &&
      !kid[':@'] &&
      !(kid[tagOf(kid) as string] as unknown[]).length
  );

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

const isEmptyRun = (run: NfNode): boolean =>
  run.kind === 'link'
    ? (run.runs as NfNode[]).every(isEmptyRun)
    : run.kind === 'run' && run.text === '';

const joinsLink = (run: NfNode, i: number, runs: NfNode[]) =>
  run.kind === 'link' &&
  runs[i - 1]?.kind === 'link' &&
  runs[i - 1].target === run.target;

const hasJoinedLinks = (node: NfNode) =>
  node.kind === 'paragraph' &&
  Array.isArray(node.runs) &&
  (node.runs as NfNode[]).some(joinsLink);

/** Two links side by side to one place read back as one link */
export const adjacentLinks: Normalization = {
  name: 'adjacent-links',
  apply(nf) {
    let found = false;
    walk(nf.root, pptxTree, ({ node }) => {
      if (hasJoinedLinks(node)) found = true;
    });
    if (!found) return nf;
    const out = clone(nf);
    walk(out.root, pptxTree, ({ node }) => {
      if (!hasJoinedLinks(node)) return;
      const runs: NfNode[] = [];
      (node.runs as NfNode[]).forEach((run, i, all) => {
        const link = runs[runs.length - 1];
        if (joinsLink(run, i, all))
          link.runs = [...(link.runs as NfNode[]), ...(run.runs as NfNode[])];
        else runs.push(run);
      });
      node.runs = runs;
    });
    return out;
  }
};

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

/** A run with no highlight reads back without one, as written with none */
export const noHighlight: Normalization = {
  name: 'no-highlight',
  apply(nf) {
    let found = false;
    walk(nf.root, pptxTree, ({ node }) => {
      if (node.highlight === 'none') found = true;
    });
    if (!found) return nf;
    const out = clone(nf);
    walk(out.root, pptxTree, ({ node }) => {
      if (node.highlight === 'none') delete node.highlight;
    });
    return out;
  }
};

/** The editor fits a table's size to its rows and columns */
export const tableSize: Normalization = {
  name: 'table-size',
  apply(nf) {
    const out = clone(nf);
    walk(out.root, pptxTree, ({ node }) => {
      const frame = node.frame as Record<string, unknown> | undefined;
      if (node.kind !== 'table' || !frame) return;
      delete frame.cx;
      delete frame.cy;
    });
    return out;
  }
};
