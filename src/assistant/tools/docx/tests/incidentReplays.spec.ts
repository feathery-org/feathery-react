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
  getDocumentInventory,
  LiveEditor
} from '../syncfusionDocumentOps';
import {
  incidentAChangeSet,
  incidentCChangeSet,
  incidentDChangeSets
} from './fixtures/incidentPayloads';

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

const styledIncidentCell = (
  text: string,
  rowIndex: number,
  columnIndex: number
) => ({
  cellFormat:
    rowIndex === 0
      ? { shading: { backgroundColor: '#1F3864' } }
      : rowIndex % 2 === 0
      ? { shading: { backgroundColor: '#D9E2F3' } }
      : {},
  blocks: [
    {
      paragraphFormat: {
        textAlignment: rowIndex === 0 ? 'Center' : 'Left'
      },
      inlines: [
        {
          text,
          characterFormat: {
            fontFamily:
              rowIndex === 0
                ? columnIndex === 0
                  ? 'Arial'
                  : 'Courier New'
                : columnIndex === 0
                ? 'Georgia'
                : 'Times New Roman',
            fontSize: rowIndex === 0 ? 12 : 9.5,
            bold: rowIndex === 0,
            ...(rowIndex === 0 ? { fontColor: '#FFFFFF' } : {})
          }
        }
      ]
    }
  ]
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
  blocks.push({
    tableFormat: {},
    rows: rows.map((texts, rowIndex) => ({
      rowFormat: rowIndex === 0 ? { isHeader: true } : {},
      cells: texts.map((text, columnIndex) =>
        styledIncidentCell(text, rowIndex, columnIndex)
      )
    }))
  });
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
  const cellWrites = payload.edits
    .map((edit, index) => ({ edit, index }))
    .filter(({ edit }) => edit.op === 'set_cell_text');
  const spacer = blocks(editor).find((block) => block.text === '  ');
  expect(spacer).toBeDefined();

  if (result.changeSet.status === 'applied') {
    const byAnchor = new Map(
      blocks(editor).map((block) => [block.anchor, block.text] as const)
    );
    const requestedAnchor =
      result.results[0].relocated?.to ?? payload.edits[0].anchor;
    const requestedParts = requestedAnchor.split(';');
    const insertAnchor =
      requestedParts.length === 2
        ? requestedAnchor
        : `${requestedParts[0]};${Number(requestedParts[1]) + 1}`;
    expect(byAnchor.has(`${insertAnchor};0;0;0`)).toBe(true);
    for (const { edit, index } of cellWrites) {
      const anchor = result.results[index].relocated?.to ?? edit.anchor;
      expect(byAnchor.get(anchor)).toBe(edit.text);
    }
    expect(
      revisions(editor).filter(
        (revision) => revision.revisionType === 'Deletion'
      )
    ).toHaveLength(0);
    // This replay now asserts the inherited result deliberately: even when the
    // recorded model omitted copy_table_format, the inserted grid adopts the
    // source table's header, stripe and header-column typography.
    const source = getDocumentInventory(editor as unknown as LiveEditor, {
      scope: 'table_facts',
      tableAnchor: '6;19'
    });
    const inherited = getDocumentInventory(editor as unknown as LiveEditor, {
      scope: 'table_facts',
      tableAnchor: insertAnchor
    });
    expect('table' in source && 'table' in inherited).toBe(true);
    if ('table' in source && 'table' in inherited) {
      expect(inherited.table.rows[0].isHeader).toBe(true);
      expect(
        inherited.table.rows.map((row) => row.appearance?.shading ?? null)
      ).toEqual(
        source.table.rows
          .slice(0, inherited.table.rows.length)
          .map((row) => row.appearance?.shading ?? null)
      );
    }
    editor.selection.select(
      `${insertAnchor};0;1;0;0`,
      `${insertAnchor};0;1;0;${cellWrites[1]?.edit.text.length ?? 0}`
    );
    expect(editor.selection.characterFormat.fontFamily).toBe('Courier New');
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
  it('A: inserts at 6;32 without a deletion revision over Billing Options', () => {
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
  });

  it('C: refuses fabricated amounts written into currency-symbol-only money cells', () => {
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
        error: 'change_set_failed'
      });
      expect(result.changeSet.status).toBe('failed');
      expect(revisions(editor)).toHaveLength(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('C: refuses reuse of the one stated premium as a second literal tax value', () => {
    const editor = makeRealDocumentEditor(incidentCSfdt(false));
    try {
      const before = editor.serialize();
      const result = replay(editor, incidentCChangeSet);

      expect(result.results[5]).toMatchObject({
        ok: false,
        error: 'user_stated_figure_reused'
      });
      expect(result.results[5].message).toContain('6;28;5;4;0');
      expect(result.results[5].message).toContain('6;28;5;5;0');
      expect(result.results[5].message).toContain('set_cell_formula');
      expect(result.results[5].message).toContain('ask the user');
      expect(result.changeSet.status).toBe('failed');
      // Only g02 is rejected. The independently reviewable g01 repair stays
      // applied and remains one rejectable card group.
      expect(revisions(editor)).toHaveLength(4);
      expect(
        revisions(editor).every((revision) =>
          String(revision.customData).includes('g01-fill-pl-row')
        )
      ).toBe(true);
      const after = new Map(
        blocks(editor).map((block) => [block.anchor, block.text] as const)
      );
      expect(after.get('6;28;4;4;0')).toBe('$3,863.00');
      expect(after.get('6;28;4;5;0')).toBe('$3,863.00');
      expect(after.has('6;28;5;0;0')).toBe(false);
      for (const revision of revisions(editor)) revision.reject();
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('C: allows two different user-stated figures in one change set', () => {
    const editor = makeRealDocumentEditor(incidentCSfdt(false));
    try {
      const before = editor.serialize();
      const edits = incidentCChangeSet.edits
        .slice(2)
        .map((edit, index) =>
          index === 3 ? { ...edit, text: '80023' } : edit
        );
      const result = replay(editor, {
        changeSetId: 'distinct-user-stated-figures',
        plan: 'Add the user-stated premium and tax figures.',
        edits
      });

      expect(result.changeSet.status).toBe('applied');
      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(result.results[2].literalNumber?.source).toBe('user_stated');
      expect(result.results[3].literalNumber?.source).toBe('user_stated');
      for (const revision of revisions(editor)) revision.reject();
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('D attempt a: lands as an addressable table or honestly refuses the genuinely empty payload', () => {
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
  });

  it('D attempt b: lands addressably at 6;20 or refuses the insert itself without consuming the spacer', () => {
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
  });

  it('D attempt c: relocates a stale paragraph within its original table cell', () => {
    const editor = makeRealDocumentEditor(incidentDSfdt());
    try {
      const before = editor.serialize();
      const payload = {
        ...incidentDChangeSets.c,
        edits: [
          {
            ...incidentDChangeSets.c.edits[0],
            anchor: '6;19;10;0;1',
            expect: 'Coverage 10',
            end: 11
          },
          ...incidentDChangeSets.c.edits.slice(1)
        ]
      };
      const result = replay(editor, payload);
      expectHonestDuplicateTableOutcome(editor, before, payload, result);
      expect(result.results[0].relocated).toEqual({
        from: '6;19;10;0;1',
        to: '6;19;10;0;0'
      });
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('D attempt d: never claims a populated payload has no cell writes', () => {
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
  });
});
