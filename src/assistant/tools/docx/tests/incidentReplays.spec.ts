/**
 * W0 incident replays use `it.failing` for assertions that state the correct
 * behavior but fail on today's master. Such tests are green while the defect is
 * present and flip red as soon as a fix makes the assertion pass; that fixing
 * change must promote the case to ordinary `it()`.
 *
 * Jest 26's Jasmine runner exposes `it.failing` in our TypeScript definitions
 * but not at runtime. The file-local compatibility below implements the same
 * inversion without changing the repository-wide runner.
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
import {
  applyDocumentEdits,
  flattenSfdt,
  LiveEditor
} from '../syncfusionDocumentOps';
import {
  incidentAChangeSet,
  incidentCChangeSet,
  incidentDChangeSets
} from './fixtures/incidentPayloads';

if (typeof it.failing !== 'function') {
  Object.defineProperty(it, 'failing', {
    value: (name: string, body: () => unknown, timeout?: number) =>
      it(
        name,
        () => {
          let failed = false;
          try {
            body();
          } catch (_error) {
            failed = true;
          }
          if (!failed) {
            throw new Error(
              'Expected this replay to fail on current master. Promote it.failing to it after landing the fix.'
            );
          }
        },
        timeout
      )
  });
}

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
  });
}

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof window.getComputedStyle;

if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

const para = (text: string, styleName?: string) => ({
  inlines: [{ text }],
  ...(styleName ? { paragraphFormat: { styleName } } : {})
});

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [para(text)]
});

const row = (...texts: string[]) => ({
  rowFormat: {},
  cells: texts.map(cell)
});

const table = (rows: string[][]) => ({
  tableFormat: {},
  rows: rows.map((texts) => row(...texts))
});

const padding = (count: number, label: string) =>
  Array.from({ length: count }, (_, index) => para(`${label} ${index}`));

const sfdtWithSectionSix = (blocks: unknown[]) => ({
  sections: [
    ...Array.from({ length: 6 }, (_, index) => ({
      blocks: [para(`Earlier section ${index}`)]
    })),
    {
      blocks,
      sectionFormat: { pageWidth: 612, pageHeight: 792 }
    }
  ]
});

const incidentASfdt = () => {
  const blocks = padding(32, 'Premium summary context');
  blocks.push(para('Billing Options', 'Heading 2'));
  blocks.push(para('Billing details follow.'));
  return sfdtWithSectionSix(blocks);
};

const incidentCSfdt = (withMoneyContext: boolean) => {
  // The non-money neighbours isolate the single-use-literal assertion: once
  // the "$" blind spot is fixed, that earlier refusal must not make the tax
  // write look refused merely because it became collateral change_set_failed.
  const amountRows = withMoneyContext
    ? [
        ['$1,000.00', '$1,130.00'],
        ['$2,000.00', '$2,260.00'],
        ['$500.00', '$565.00']
      ]
    : [
        ['Pending', 'Pending'],
        ['Included', 'Included'],
        ['N/A', 'N/A']
      ];
  const blocks: unknown[] = padding(28, 'Premium summary context');
  blocks.push(
    table([
      ['Coverage', 'Carrier', 'Policy', 'Term', 'Premium', 'Premium + Tax'],
      ['General Liability', '', '', '', ...amountRows[0]],
      ['Property', '', '', '', ...amountRows[1]],
      ['Umbrella', '', '', '', ...amountRows[2]],
      ['Professional Liability', '', '', '', '$', '$']
    ])
  );
  blocks.push(para('After premium summary'));
  return sfdtWithSectionSix(blocks);
};

const incidentDSfdt = () => {
  const rows = Array.from({ length: 11 }, (_, index) => [
    index === 0 ? 'Coverage' : `Coverage ${index}`,
    index === 0 ? 'Limit' : `$${index * 10},000`,
    index === 0
      ? 'Retention / Deductible'
      : index === 10
      ? '$5,000'
      : `$${index},000`
  ]);
  const blocks: unknown[] = padding(19, 'Cyber section context');
  blocks.push(table(rows));
  blocks.push(para('  '));
  return sfdtWithSectionSix(blocks);
};

function makeRealDocumentEditor(sfdt: unknown): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyRealDocumentEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const revisions = (editor: DocumentEditor): any[] =>
  Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );

const blocks = (editor: DocumentEditor) =>
  flattenSfdt(JSON.parse(editor.serialize()));

const replay = (editor: DocumentEditor, payload: unknown) =>
  applyDocumentEdits(
    editor as unknown as LiveEditor,
    payload as Parameters<typeof applyDocumentEdits>[1]
  );

function expectHonestDuplicateTableOutcome(
  editor: DocumentEditor,
  before: string,
  payload: typeof incidentDChangeSets[keyof typeof incidentDChangeSets],
  result: ReturnType<typeof applyDocumentEdits>,
  allowEmptyTableRefusal = false
): void {
  const cellWrites = payload.edits.filter(
    (edit) => edit.op === 'set_cell_text'
  );
  const spacer = blocks(editor).find((block) => block.text === '  ');
  expect(spacer).toBeDefined();

  if (result.changeSet.status === 'applied') {
    const byAnchor = new Map(
      blocks(editor).map((block) => [block.anchor, block.text] as const)
    );
    const insertAnchor = payload.edits[0].anchor;
    expect(byAnchor.has(`${insertAnchor};0;0;0`)).toBe(true);
    for (const edit of cellWrites) {
      expect(byAnchor.get(edit.anchor)).toBe(edit.text);
    }
    expect(
      revisions(editor).filter(
        (revision) => revision.revisionType === 'Deletion'
      )
    ).toHaveLength(0);
    return;
  }

  expect(editor.serialize()).toBe(before);
  expect(revisions(editor)).toHaveLength(0);
  if (allowEmptyTableRefusal) {
    expect(result.results[0].error).toBe('empty_insert_table');
    return;
  }
  // These are generic/collateral diagnoses, or the HILB false-positive. An
  // honest refusal must belong to the insert itself and name why it is unsafe.
  expect([
    'change_set_failed',
    'change_set_preflight_failed',
    'empty_insert_table',
    'expect_mismatch'
  ]).not.toContain(result.results[0].error);
}

jest.setTimeout(120000);

describe('W0 captain incident replays', () => {
  it.failing(
    'A: inserts at 6;32 without a deletion revision over Billing Options',
    () => {
      const editor = makeRealDocumentEditor(incidentASfdt());
      try {
        const before = editor.serialize();
        const result = replay(editor, incidentAChangeSet);
        const after = new Map(
          blocks(editor).map((block) => [block.anchor, block.text] as const)
        );

        expect(result.changeSet.status).toBe('applied');
        expect(result.results.every((entry) => entry.ok)).toBe(true);
        expect(after.get('6;32;0;0;0')).toBe('\u00a0');
        expect(after.get('6;33')).toBe('Billing Options');
        expect(
          revisions(editor).filter(
            (revision) => revision.revisionType === 'Deletion'
          )
        ).toHaveLength(0);

        for (const revision of revisions(editor)) revision.reject();
        expect(editor.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );

  it.failing(
    'C: refuses fabricated amounts written into currency-symbol-only money cells',
    () => {
      const editor = makeRealDocumentEditor(incidentCSfdt(true));
      try {
        const before = editor.serialize();
        const result = replay(editor, incidentCChangeSet);

        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'model_authored_number'
        });
        expect(result.results[1]).toMatchObject({
          ok: false,
          error: 'model_authored_number'
        });
        expect(result.changeSet.status).toBe('failed');
        expect(revisions(editor)).toHaveLength(0);
        expect(editor.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );

  it.failing(
    'C: refuses reuse of the one stated premium as a second literal tax value',
    () => {
      const editor = makeRealDocumentEditor(incidentCSfdt(false));
      try {
        const before = editor.serialize();
        const result = replay(editor, incidentCChangeSet);

        expect(result.results[5].ok).toBe(false);
        expect(result.results[5].error).toBeDefined();
        expect(result.results[5].error).not.toBe('change_set_failed');
        expect(result.changeSet.status).toBe('failed');
        expect(revisions(editor)).toHaveLength(0);
        expect(editor.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );

  // Promoted from it.failing on the HILB branch: the empty-table guard here
  // already refuses attempt a honestly. Stays it.failing on plain master.
  it(
    'D attempt a: lands as an addressable table or honestly refuses the genuinely empty payload',
    () => {
      const editor = makeRealDocumentEditor(incidentDSfdt());
      try {
        const before = editor.serialize();
        const result = replay(editor, incidentDChangeSets.a);
        expectHonestDuplicateTableOutcome(
          editor,
          before,
          incidentDChangeSets.a,
          result,
          true
        );
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );

  it.failing(
    'D attempt b: lands addressably at 6;20 or refuses the insert itself without consuming the spacer',
    () => {
      const editor = makeRealDocumentEditor(incidentDSfdt());
      try {
        const before = editor.serialize();
        const result = replay(editor, incidentDChangeSets.b);
        expectHonestDuplicateTableOutcome(
          editor,
          before,
          incidentDChangeSets.b,
          result
        );
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );

  it.failing(
    'D attempt c: never claims a populated payload has no cell writes',
    () => {
      const editor = makeRealDocumentEditor(incidentDSfdt());
      try {
        const before = editor.serialize();
        const result = replay(editor, incidentDChangeSets.c);
        expectHonestDuplicateTableOutcome(
          editor,
          before,
          incidentDChangeSets.c,
          result
        );
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );

  it.failing(
    'D attempt d: never claims a populated payload has no cell writes',
    () => {
      const editor = makeRealDocumentEditor(incidentDSfdt());
      try {
        const before = editor.serialize();
        const result = replay(editor, incidentDChangeSets.d);
        expectHonestDuplicateTableOutcome(
          editor,
          before,
          incidentDChangeSets.d,
          result
        );
      } finally {
        destroyRealDocumentEditor(editor);
      }
    }
  );
});
