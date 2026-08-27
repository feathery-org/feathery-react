/**
 * What the MODEL is allowed to see in an EditResult.
 *
 * `collectOpExtras` spreads a handler's extras wholesale into the result and
 * deletes the engine-internal keys by name. That means the deletions are the
 * only thing between an internal receipt and the model: any field added to
 * `OpSuccessExtras` reaches the model unless someone remembers to name it.
 *
 * Someone did not. `tableFootprints` was added as an engine-internal receipt,
 * with a comment saying the model never sees it, and a split's result came back
 * carrying it. The whole suite passed, because nothing anywhere asserted the
 * ABSENCE of unknown keys.
 *
 * So this row does not check for that one field. It allowlists every key the
 * result is allowed to have, and fails on anything else - which catches the next
 * one too, whatever it is called. When a genuinely model-facing field is added,
 * this list is where it gets declared, deliberately.
 */
import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import { applyDocumentEdits, LiveEditor } from '../syncfusionDocumentOps';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);
if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

/** Every key EditResult declares, plus the one the runner spreads on top. */
const MODEL_FACING_KEYS = new Set([
  'ok',
  'anchor',
  'op',
  'route',
  'error',
  'relocated',
  'message',
  'details',
  'ambiguity',
  'retry',
  'formula',
  'literalNumber',
  'column',
  'noOp',
  'withdrewPendingInsertion',
  'appearance',
  'inherited',
  'withoutDonor',
  'styleResolved'
]);

/** Named so a failure says WHY the key must not be there. */
const KNOWN_ENGINE_INTERNAL = new Set([
  'tableFootprints',
  'appearanceWrite',
  'postWriteSfdt'
]);

const HEADER = '#001B49FF';
const STRIPE = '#E6E6E6FF';
const para = (t: string) => ({
  paragraphFormat: {},
  characterFormat: {},
  inlines: t ? [{ characterFormat: {}, text: t }] : []
});
const cell = (t: string, sh?: string) => ({
  blocks: [para(t)],
  cellFormat: {
    columnSpan: 1,
    rowSpan: 1,
    ...(sh ? { shading: { backgroundColor: sh } } : {})
  }
});
const stripedTable = (n: number) => ({
  rows: [
    {
      rowFormat: {},
      cells: [cell('Coverage', HEADER), cell('Amount', HEADER)]
    },
    ...Array.from({ length: n }, (_, i) => ({
      rowFormat: {},
      cells: [
        cell(`Item ${i + 1}`, i % 2 === 1 ? STRIPE : undefined),
        cell(`$${(i + 1) * 100}`, i % 2 === 1 ? STRIPE : undefined)
      ]
    }))
  ]
});

let editor: DocumentEditor;
const open = (): LiveEditor => {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    enableSearch: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(
    JSON.stringify({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792 },
          blocks: [
            para('Coverages and Limits'),
            stripedTable(5),
            para('Driver Information')
          ]
        }
      ]
    })
  );
  return editor as unknown as LiveEditor;
};

const assertSurface = (results: any[], label: string) => {
  for (const result of results) {
    for (const key of Object.keys(result)) {
      if (KNOWN_ENGINE_INTERNAL.has(key))
        throw new Error(
          `${label}: EditResult carries engine-internal key "${key}". ` +
            'It must be deleted in collectOpExtras, not returned to the model.'
        );
      if (!MODEL_FACING_KEYS.has(key))
        throw new Error(
          `${label}: EditResult carries undeclared key "${key}". ` +
            'If it is model-facing, declare it in MODEL_FACING_KEYS deliberately; ' +
            'if it is an engine receipt, delete it in collectOpExtras.'
        );
    }
  }
};

describe('EditResult exposes only model-facing keys', () => {
  it('a split_table result carries no engine-internal receipts', () => {
    // split_table is the op that records table footprints, so it is the one
    // that leaked. Kept as its own row because it is the regression case.
    const live = open();
    const result = applyDocumentEdits(live, {
      changeSetId: 'surface-split',
      edits: [
        {
          op: 'split_table',
          anchor: '0;1;0;0;0',
          splitAtRow: 2,
          targetAnchor: '0;2',
          position: 'before',
          group: 'g'
        } as any
      ]
    }) as any;
    expect(result.results[0].ok).toBe(true);
    expect('tableFootprints' in result.results[0]).toBe(false);
    assertSurface(result.results, 'split_table');
  });

  it('a mixed change set carries no undeclared keys on any result', () => {
    // The class, not the instance: several op families in one change set, every
    // result key checked against the allowlist.
    const live = open();
    const result = applyDocumentEdits(live, {
      changeSetId: 'surface-mixed',
      edits: [
        { op: 'insert_row', anchor: '0;1;2;0;0' } as any,
        {
          op: 'replace_text',
          anchor: '0;0',
          find: 'Coverages',
          replace: 'Cover'
        } as any,
        { op: 'delete_row', anchor: '0;1;3;0;0', group: 'g' } as any
      ]
    }) as any;
    assertSurface(result.results, 'mixed change set');
  });
});
