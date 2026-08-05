/**
 * What Syncfusion does to token content controls when a table row is inserted
 * or deleted — measured against a real editor, not assumed.
 *
 * Growing and shrinking a repeated field's rows depends entirely on these
 * answers, and every previous assumption about this editor's API has been wrong
 * at least once. These assertions are the record: if a version bump changes any
 * of them, the row-sync design has to change with it.
 */

import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';

import { bookmarkFor, encodeTag } from '../controls';
import { instanceKey, TokenSpec } from '../plan';

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, Search);

const shimBrowser = (): void => {
  if (!window.crypto?.getRandomValues) {
    Object.defineProperty(window, 'crypto', {
      value: {
        // eslint-disable-next-line global-require
        getRandomValues: (array: Uint8Array) =>
          require('crypto').randomFillSync(array)
      }
    });
  }
  if (!(window.SVGElement.prototype as any).getBBox) {
    (window.SVGElement.prototype as any).getBBox = () =>
      ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
  }
};

const tokenInline = (spec: TokenSpec, text: string) => ({
  contentControlProperties: {
    tag: encodeTag(spec),
    title: spec.id,
    type: 'Text',
    color: '#00000000',
    lockContents: Boolean(spec.formula),
    lockContentControl: true
  },
  inlines: [
    { bookmarkType: 0, name: bookmarkFor(instanceKey(spec)) },
    { text },
    { bookmarkType: 1, name: bookmarkFor(instanceKey(spec)) }
  ]
});

const cell = (inlines: any[]) => ({
  blocks: [{ inlines }],
  cellFormat: { cellWidth: 200, preferredWidth: 200 }
});

/** Header row plus one row per line item, each with a qty and an amount token. */
const tableSfdt = (rowCount: number) => ({
  sections: [
    {
      blocks: [
        {
          rows: [
            {
              cells: [cell([{ text: 'Qty' }]), cell([{ text: 'Amount' }])],
              rowFormat: { height: 20 }
            },
            ...Array.from({ length: rowCount }, (_, index) => ({
              cells: [
                cell([
                  tokenInline(
                    {
                      id: 'qty',
                      source: 'qty',
                      index,
                      format: { kind: 'number' }
                    },
                    String(index + 1)
                  )
                ]),
                cell([
                  tokenInline(
                    {
                      id: 'amount',
                      index,
                      formula: 'qty * 10',
                      format: { kind: 'currency' }
                    },
                    `$${(index + 1) * 10}.00`
                  )
                ])
              ],
              rowFormat: { height: 20 }
            }))
          ]
        },
        { inlines: [{ text: 'Total' }] }
      ]
    }
  ]
});

const openTable = (rowCount: number) => {
  shimBrowser();
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(tableSfdt(rowCount)));
  return {
    editor,
    destroy: () => {
      const element = editor.element;
      editor.destroy();
      element?.remove();
    }
  };
};

const controlsOf = (editor: DocumentEditor): any[] =>
  (editor as any)?.documentHelper?.contentControlCollection ?? [];

const tags = (editor: DocumentEditor): string[] =>
  controlsOf(editor)
    .map((control: any) => control?.contentControlProperties?.tag)
    .filter((tag: any) => typeof tag === 'string')
    .map((tag: string) => {
      const instance = /"instance":"([^"]*)"/.exec(tag);
      if (instance) return instance[1];
      const id = /"id":"([^"]*)"/.exec(tag);
      const index = /"index":(\d+)/.exec(tag);
      return index ? `${id?.[1]}__${index[1]}` : id?.[1] ?? '?';
    });

const tableOf = (editor: DocumentEditor): any =>
  (editor as any).documentHelper?.pages?.[0]?.bodyWidgets?.[0]
    ?.childWidgets?.[0];

const rowCount = (editor: DocumentEditor): number =>
  tableOf(editor)?.childWidgets?.length ?? -1;

const selectCell = (editor: DocumentEditor, row: number, col: number): void => {
  const target = tableOf(editor).childWidgets[row].childWidgets[col];
  (editor.selection as any).selectParagraphInternal(
    target.childWidgets[0],
    true
  );
};

const qtySpec = (index: number): TokenSpec => ({
  id: 'qty',
  source: 'qty',
  index,
  format: { kind: 'number' }
});

describe('table rows carrying token content controls', () => {
  it('parses a table of inline content controls from sfdt', () => {
    const { editor, destroy } = openTable(2);
    expect(rowCount(editor)).toBe(3);
    expect(tags(editor)).toEqual([
      'qty__0',
      'amount__0',
      'qty__1',
      'amount__1'
    ]);
    destroy();
  });

  it('inserts a row WITHOUT cloning the content controls in it', () => {
    // The new row is blank. Good news — a clone would have produced two controls
    // sharing one address, and the editor writes by address. It also means
    // growing a repeat has to BUILD the controls, not just add a row.
    const { editor, destroy } = openTable(2);
    selectCell(editor, 2, 0);
    (editor.editor as any).insertRow(false, 1);

    expect(rowCount(editor)).toBe(4);
    expect(tags(editor)).toEqual([
      'qty__0',
      'amount__0',
      'qty__1',
      'amount__1'
    ]);
    destroy();
  });

  it('leaves the content control collection STALE after deleting a row', () => {
    // The row goes, its controls do not leave the collection. Anything reading
    // tokens straight from the collection therefore still sees the deleted row,
    // so a row deletion has to force a re-read rather than trust this.
    const { editor, destroy } = openTable(3);
    selectCell(editor, 3, 0);
    (editor.editor as any).deleteRow();

    expect(rowCount(editor)).toBe(3);
    expect(tags(editor)).toContain('qty__2');
    destroy();
  });

  it('creates a usable token control inside a freshly inserted row', () => {
    // `insertContentControl('Text')` DOES create a control — it is the object
    // form that no-ops. It arrives untagged, and assigning the tag afterwards is
    // what turns it into a token.
    const { editor, destroy } = openTable(2);
    selectCell(editor, 2, 0);
    (editor.editor as any).insertRow(false, 1);

    selectCell(editor, 3, 0);
    editor.editor.insertText('3');
    selectCell(editor, 3, 0);
    (editor.editor as any).insertContentControl('Text');

    const controls = controlsOf(editor);
    expect(controls).toHaveLength(5);

    const fresh = controls[controls.length - 1];
    expect(fresh.contentControlProperties.tag).toBeFalsy();

    fresh.contentControlProperties.tag = encodeTag(qtySpec(2));
    fresh.contentControlProperties.title = 'qty';
    expect(tags(editor)).toContain('qty__2');
    destroy();
  });

  it('keeps a runtime-created token through a save and reopen', () => {
    // The whole approach rests on this: a control built in the browser has to
    // survive being serialised and read back, or growing a repeat would produce
    // rows that vanish on save.
    const { editor, destroy } = openTable(2);
    selectCell(editor, 2, 0);
    (editor.editor as any).insertRow(false, 1);
    selectCell(editor, 3, 0);
    editor.editor.insertText('3');
    selectCell(editor, 3, 0);
    (editor.editor as any).insertContentControl('Text');

    const controls = controlsOf(editor);
    const fresh = controls[controls.length - 1];
    fresh.contentControlProperties.tag = encodeTag(qtySpec(2));
    fresh.contentControlProperties.title = 'qty';

    editor.open(editor.serialize());

    expect(rowCount(editor)).toBe(4);
    expect(tags(editor)).toContain('qty__2');
    destroy();
  });

  it('exports controls under abbreviated keys, not the sfdt input names', () => {
    // Worth pinning: the export carries our tags but NOT the literal
    // `contentControlProperties` key, so grepping the serialised output for the
    // input schema name reads as "all controls lost" when nothing is lost.
    const { editor, destroy } = openTable(2);
    const sfdt = editor.serialize();

    expect(sfdt).not.toContain('contentControlProperties');
    expect(sfdt).toContain('ftk');
    destroy();
  });

  it('MEASURE: walking from a control up to its table row', () => {
    const { editor, destroy } = openTable(2);
    const control: any = controlsOf(editor)[2]; // qty__1
    const chain: string[] = [];
    let node: any = control;
    for (let i = 0; i < 8 && node; i += 1) {
      chain.push(node.constructor?.name ?? typeof node);
      node = node.line ?? node.paragraph ?? node.associatedCell ?? node.containerWidget ?? node.ownerRow ?? node.ownerTable;
    }
    // eslint-disable-next-line no-console
    console.log('WALK chain:', chain.join(' -> '));

    const paragraph = control.line?.paragraph;
    const cellW = paragraph?.associatedCell ?? paragraph?.containerWidget;
    const rowW = cellW?.ownerRow ?? cellW?.containerWidget;
    const tableW = rowW?.ownerTable ?? rowW?.containerWidget;
    // eslint-disable-next-line no-console
    console.log(
      'cell:', cellW?.constructor?.name,
      ' row:', rowW?.constructor?.name,
      ' rowIndex:', rowW?.rowIndex,
      ' table:', tableW?.constructor?.name,
      ' cellIndex:', cellW?.cellIndex,
      ' tableRows:', tableW?.childWidgets?.length
    );
    expect(true).toBe(true);
    destroy();
  });

  it('MEASURE: the full grow recipe', () => {
    const { editor, destroy } = openTable(2);

    // 1. Put the selection in the last token row, by token address.
    const last: any = controlsOf(editor).find((c: any) =>
      (c?.contentControlProperties?.tag ?? '').includes('"index":1')
    );
    (editor.selection as any).selectContentControlInternal(last);

    // 2. One row below it.
    (editor.editor as any).insertRow(false, 1);
    // eslint-disable-next-line no-console
    console.log('after insertRow rows:', rowCount(editor));

    // 3. Build a token in each cell of the new row.
    const built: string[] = [];
    for (let col = 0; col < 2; col += 1) {
      selectCell(editor, 3, col);
      editor.editor.insertText(col === 0 ? '3' : '$30.00');
      selectCell(editor, 3, col);
      (editor.editor as any).insertContentControl('Text');
      const controls = controlsOf(editor);
      const fresh = controls[controls.length - 1];
      const spec: TokenSpec =
        col === 0
          ? { id: 'qty', source: 'qty', index: 2, format: { kind: 'number' } }
          : { id: 'amount', index: 2, formula: 'qty * 10', format: { kind: 'currency' } };
      fresh.contentControlProperties.tag = encodeTag(spec);
      fresh.contentControlProperties.title = spec.id;
      built.push(instanceKey(spec));
    }
    // eslint-disable-next-line no-console
    console.log('GROW built:', built, '\n  tags:', tags(editor));

    // 4. Survive a save.
    editor.open(editor.serialize());
    // eslint-disable-next-line no-console
    console.log('GROW after reopen rows:', rowCount(editor), 'tags:', tags(editor));
    // eslint-disable-next-line no-console
    console.log('GROW values:', (editor as any).exportContentControlData().map((i: any) => i.value));
    expect(true).toBe(true);
    destroy();
  });
});
