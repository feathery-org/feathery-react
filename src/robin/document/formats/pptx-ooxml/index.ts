import { shortCardId } from '../../envelope';
import type { Pack } from '../../pack';
import { fromNormalForm } from './adapter/fromNormalForm';
import { toNormalForm } from './adapter/toNormalForm';
import { continueFormatFinalizer } from './finalizers/continueFormat';
import { copyIdentityFinalizer } from './finalizers/copyIdentity';
import { limits } from './invariants/limits';
import { belowBlocks, detail, ownText } from './outline';
import {
  accept,
  adjacentLinks,
  authoredBy,
  conservedResidue,
  editorIdentity,
  emptyRuns,
  inheritedFormat,
  noHighlight,
  othersOf,
  reject,
  resolveGroup,
  tableSize
} from './projections';
import { plan } from './reconcile';
import { deckSeam } from './seams/deck';
import { effective, schemaFor, setOnSpan, setOverride } from './schema';
import { pagesOf, selectionOf } from './selection';
import { pptxTree } from './tree';
import VOCABULARY from './vocabulary';
import type { PendingSuggestion } from './native';

const FEATURES: readonly string[] = ['color', 'highlight'];

export const pptxPack: Pack = {
  format: 'pptx-ooxml',
  vocabulary: VOCABULARY,
  tree: pptxTree,
  formatRefKeys: [],
  adapter: { toNormalForm, fromNormalForm },
  outline: { defaultDepth: 1, belowBlocks, detail },
  text: ownText,
  // Runs are found by their colour and highlight, the way people point at them
  features: (node) =>
    FEATURES.filter((name) => typeof node[name] === 'string').map((name) => ({
      name,
      value: node[name] as string
    })),
  featureSpecs: (schemaFor('run') ?? []).filter((spec) =>
    FEATURES.includes(spec.name)
  ),
  annotate: () => new Map(),
  properties: {
    schema: schemaFor,
    formatSchema: [],
    effective,
    setOverride: (node, name, value) => setOverride(node, name, value),
    setOnSpan: (node, span, text, props) => setOnSpan(node, span, text, props),
    setOnFormat: () => {
      throw new Error('A deck has no shared format entries');
    }
  },
  invariants: [limits],
  finalizers: [copyIdentityFinalizer, continueFormatFinalizer],
  projections: {
    accept,
    reject,
    normalizations: [
      emptyRuns,
      adjacentLinks,
      inheritedFormat,
      editorIdentity,
      noHighlight,
      tableSize
    ],
    authoredBy,
    othersOf,
    conservedResidue,
    resolveGroup
  },
  reconcile: { plan },
  selection: selectionOf,
  pages: pagesOf,
  // Only Robin's suggestions stay pending, one card per turn, oldest first
  cards: (view, residue) => {
    const { pending } = residue[view.nf.root.id] as {
      pending: PendingSuggestion[];
    };
    return [...new Set(pending.map((suggestion) => suggestion.by))].map(
      (id) => ({ id, short: shortCardId(id) })
    );
  },
  seams: { deck: deckSeam },
  methodCards: ['edit-document'],
  cardNouns: {
    slide: ['slide', 'slides'],
    shape: ['shape', 'shapes'],
    picture: ['picture', 'pictures'],
    table: ['table', 'tables'],
    chart: ['chart', 'charts'],
    group: ['group', 'groups'],
    paragraph: ['paragraph', 'paragraphs']
  }
};

export { createHost } from './host';
