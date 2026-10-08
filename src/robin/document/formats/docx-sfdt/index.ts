/**
 * The format pack for the editor's verbose document JSON: the worked example of the pack interface
 * (`../../pack.ts`). Everything format-specific lives under this folder.
 */
import type { Pack } from '../../pack';
import { fromNormalForm } from './adapter/fromNormalForm';
import { FORMAT_REF_KEYS } from './adapter/keys';
import { toNormalForm } from './adapter/toNormalForm';
import { bindingAnnotations } from './features/binding';
import { formulasFinalizer } from './finalizers/formulas';
import { restripeFinalizer } from './finalizers/appearance';
import { tableGeometryReport } from './finalizers/geometry';
import {
  copiedBookmarksFinalizer,
  rowIdentityFinalizer
} from './finalizers/structure';
import { bindingConsistency } from './invariants/bindings';
import { bookmarkPairs } from './invariants/bookmarks';
import { fieldTriplets } from './invariants/fields';
import { orphanedDependents } from './invariants/formulas';
import { controlShape } from './invariants/identity';
import { styleReferences } from './invariants/references';
import { detail, features, listLabel, ownText } from './outline';
import {
  NORMALIZATIONS,
  UNDO_NORMALIZATIONS,
  accept,
  authoredBy,
  conservedResidue,
  expectedRejection,
  reject
} from './projections';
import { plan } from './reconcile';
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
import { docxTree } from './tree';
import VOCABULARY from './vocabulary.json';

export const FORMAT = 'docx-sfdt';

export const docxPack: Pack = {
  format: FORMAT,
  vocabulary: VOCABULARY,
  tree: docxTree,
  formatRefKeys: FORMAT_REF_KEYS,
  adapter: {
    toNormalForm,
    fromNormalForm: (nf, residue) => fromNormalForm(nf, residue as never)
  },
  outline: { defaultDepth: 3, detail, listLabel },
  text: ownText,
  features,
  annotate: (view) => bindingAnnotations(view.nf),
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
    styleReferences
  ],
  // identity first (bookmarks, rows): formulas read the rows; restripe over the settled rows; the
  // geometry report last, over everything
  finalizers: [
    copiedBookmarksFinalizer,
    rowIdentityFinalizer,
    formulasFinalizer,
    restripeFinalizer,
    tableGeometryReport
  ],
  projections: {
    accept,
    reject,
    normalizations: NORMALIZATIONS,
    undoNormalizations: UNDO_NORMALIZATIONS,
    expectedRejection,
    authoredBy,
    conservedResidue
  },
  reconcile: { plan },
  seams: { text: textSeam, format: formatSeam, splice: spliceSeam }
};

export { createHost } from './host';
export type { LiveEditor } from './host';
