import type { PackTree } from '../../pack';
import type { NfNode } from '../../tree';
import type { Pending } from './adapter/toNormalForm';

const SHAPE_KINDS = [
  'shape',
  'picture',
  'table',
  'chart',
  'group',
  'connector',
  'graphic'
];
const RUN_KINDS = ['run', 'break', 'field'];

const LISTS: Record<string, [string, readonly string[]]> = {
  deck: ['slides', ['slide']],
  slide: ['shapes', SHAPE_KINDS],
  group: ['shapes', SHAPE_KINDS],
  shape: ['paragraphs', ['paragraph']],
  cell: ['paragraphs', ['paragraph']],
  table: ['rows', ['row']],
  row: ['cells', ['cell']],
  paragraph: ['runs', RUN_KINDS]
};

export const isShapeKind = (kind: string) => SHAPE_KINDS.includes(kind);

export const pptxTree: PackTree = {
  childLists: (node: NfNode) => {
    const list = LISTS[node.kind]?.[0];
    return list && Array.isArray(node[list]) ? [list] : [];
  },
  inferKind: (node, parentKind, listKey) => {
    if (LISTS[parentKind]?.[0] !== listKey) return null;
    if (listKey === 'shapes')
      return Array.isArray(node.paragraphs) ? 'shape' : null;
    if (listKey === 'runs')
      return node.text === '\n'
        ? 'break'
        : typeof node.text === 'string'
        ? 'run'
        : null;
    return LISTS[parentKind][1][0];
  },
  accepts: (parentKind, listKey, kind) => {
    const [list, kinds] = LISTS[parentKind] ?? [];
    return list === listKey && !!kinds?.includes(kind);
  },
  // A slide is its part and a shape its id on the slide, whatever their content
  identity: (node) => {
    if (node.kind === 'slide' && node.path) return `slide:${node.path}`;
    if (isShapeKind(node.kind) && node.shapeId) return `shape:${node.shapeId}`;
    return null;
  },
  goneOnAccept: (node) => !!(node.pending as Pending | undefined)?.deletion
};
