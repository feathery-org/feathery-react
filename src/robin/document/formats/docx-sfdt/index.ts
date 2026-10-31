/**
 * The format pack for the editor's verbose document JSON: the worked example of the pack interface
 * (`../../pack.ts`). Everything format-specific lives under this folder.
 */
import type { Pack } from '../../pack';
import { fromNormalForm } from './adapter/fromNormalForm';
import { FEATURE_KEYS, FORMAT_REF_KEYS } from './adapter/keys';
import { toNormalForm } from './adapter/toNormalForm';
import { bindingAnnotations } from './features/binding';
import { layoutOnly } from './host';
import { formulasFinalizer } from './finalizers/formulas';
import { restripeFinalizer } from './finalizers/appearance';
import {
  columnFitFinalizer,
  tableGeometryReport,
  widthUnitsFinalizer
} from './finalizers/geometry';
import { cardCollections } from './card';
import {
  copiedBookmarksFinalizer,
  rowIdentityFinalizer,
  sectionTailFinalizer,
  tableIdentityFinalizer
} from './finalizers/structure';
import { bindingConsistency } from './invariants/bindings';
import { bookmarkPairs } from './invariants/bookmarks';
import { fieldTriplets } from './invariants/fields';
import { orphanedDependents } from './invariants/formulas';
import { controlShape } from './invariants/identity';
import { styleReferences } from './invariants/references';
import { belowBlocks, detail, features, listLabel, ownText } from './outline';
import {
  NORMALIZATIONS,
  UNDO_NORMALIZATIONS,
  accept,
  authoredBy,
  conservedResidue,
  expectedRejection,
  ownsResolution,
  reject,
  resolveGroup,
  withoutGroup
} from './projections';
import { plan, tocStep, transaction } from './reconcile';
import {
  FORMAT_SCHEMA,
  effective,
  schemaFor,
  setOnFormat,
  setOnSpan,
  setOverride
} from './schema';
import { formatSeam } from './seams/format';
import { spliceSeam } from './seams/splice';
import { textSeam } from './seams/text';
import { tocSeam } from './seams/toc';
import { tocAnnotations, tocField } from './toc';
import { derivedContent } from './invariants/derived';
import { selectionOf } from './selection';
import { docxTree } from './tree';
import VOCABULARY from './vocabulary';

export const FORMAT = 'docx-sfdt';

export const docxPack: Pack = {
  format: FORMAT,
  vocabulary: VOCABULARY,
  tree: docxTree,
  formatRefKeys: FORMAT_REF_KEYS,
  adapter: {
    toNormalForm,
    fromNormalForm: (nf, residue) => fromNormalForm(nf, residue as never),
    layoutOnly
  },
  outline: { defaultDepth: 3, belowBlocks, detail, listLabel },
  text: ownText,
  features,
  annotate: (view) => tocAnnotations(view, bindingAnnotations(view.nf)),
  properties: {
    schema: schemaFor,
    formatSchema: FORMAT_SCHEMA,
    effective,
    setOverride,
    setOnSpan,
    setOnFormat
  },
  invariants: [
    orphanedDependents,
    bindingConsistency,
    controlShape,
    bookmarkPairs,
    fieldTriplets,
    styleReferences,
    derivedContent
  ],
  // identity first (bookmarks, tables, rows): formulas read the rows; restripe over the settled rows;
  // column fit before width units, so a narrowed row still keeps one unit; the geometry report last,
  // over everything
  finalizers: [
    copiedBookmarksFinalizer,
    tableIdentityFinalizer,
    rowIdentityFinalizer,
    formulasFinalizer,
    restripeFinalizer,
    columnFitFinalizer,
    widthUnitsFinalizer,
    sectionTailFinalizer,
    tableGeometryReport
  ],
  projections: {
    accept,
    reject,
    normalizations: NORMALIZATIONS,
    undoNormalizations: UNDO_NORMALIZATIONS,
    expectedRejection,
    authoredBy,
    conservedResidue,
    resolveGroup,
    ownsResolution,
    othersOf: withoutGroup,
    derived: (nf) => tocField(nf)?.ids ?? new Set<string>()
  },
  reconcile: { plan, transaction, refresh: tocStep },
  seams: {
    text: textSeam,
    format: formatSeam,
    splice: spliceSeam,
    toc: tocSeam
  },
  featureKeys: FEATURE_KEYS,
  selection: selectionOf,
  // the server's card for how to edit a document (what it attached to these refusals on the rig)
  methodCards: ['edit-document'],
  residueKeys: {
    contentControlProperties:
      "A content control's native properties are the editor's and are kept as they are: write `binding` to change what the control holds and `title` to rename it."
  },
  cardCollections,
  cardNouns: {
    section: ['section', 'sections'],
    paragraph: ['paragraph', 'paragraphs'],
    table: ['table', 'tables'],
    row: ['row', 'rows'],
    cell: ['cell', 'cells'],
    control: ['field', 'fields'],
    image: ['image', 'images'],
    shape: ['text box', 'text boxes']
  }
};

export { createHost } from './host';
export type { LiveEditor } from './host';
