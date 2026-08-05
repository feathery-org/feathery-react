/**
 * Growing and shrinking the table rows of a repeated field.
 *
 * Driven against a real `DocumentEditor` rather than a fake, because every
 * assumption about this editor's table and content-control APIs has been wrong
 * at least once — see rowMechanics.spec.ts for the measurements these rely on.
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

import { bookmarkFor, encodeTag, readTokens } from '../controls';
import { attachTokenCycle } from '../tokenCycle';
import { instanceKey, TokenSpec } from '../plan';
import {
  deletedRows,
  groupLength,
  growGroup,
  liveTokens,
  repeatGroups,
  rowSnapshot,
  shrinkGroup,
  staleControls
} from '../rows';

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

const qty = (index: number): TokenSpec => ({
  id: 'qty',
  source: 'qty',
  index,
  format: { kind: 'number' }
});

const amount = (index: number): TokenSpec => ({
  id: 'amount',
  index,
  formula: 'qty * 10',
  format: { kind: 'currency' }
});

const subtotal: TokenSpec = {
  id: 'subtotal',
  formula: 'SUM(amount)',
  format: { kind: 'currency' }
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

/** Header, `rows` item rows, then a scalar subtotal token OUTSIDE the table. */
const sfdtFor = (rows: number) => ({
  sections: [
    {
      blocks: [
        {
          rows: [
            {
              cells: [cell([{ text: 'Qty' }]), cell([{ text: 'Amount' }])],
              rowFormat: { height: 20 }
            },
            ...Array.from({ length: rows }, (_, index) => ({
              cells: [
                cell([tokenInline(qty(index), String(index + 1))]),
                cell([tokenInline(amount(index), `$${(index + 1) * 10}.00`)])
              ],
              rowFormat: { height: 20 }
            }))
          ]
        },
        { inlines: [{ text: 'Total ' }, tokenInline(subtotal, '$30.00')] }
      ]
    }
  ]
});

const open = (rows: number) => {
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
  editor.open(JSON.stringify(sfdtFor(rows)));
  return {
    editor,
    destroy: () => {
      const element = editor.element;
      editor.destroy();
      element?.remove();
    }
  };
};

const addresses = (editor: DocumentEditor): string[] =>
  liveTokens(editor as any)
    .map(({ spec }) => instanceKey(spec))
    .sort();

const tableRows = (editor: DocumentEditor): number =>
  (editor as any).documentHelper.pages[0].bodyWidgets[0].childWidgets[0]
    .childWidgets.length;

const render = (spec: TokenSpec): string =>
  spec.format?.kind === 'currency' ? '$0.00' : '0';

describe('repeatGroups', () => {
  it('finds one group per table, with the fields behind it', () => {
    const { editor, destroy } = open(2);
    const groups = repeatGroups(editor as any);

    expect(groups).toHaveLength(1);
    expect(groupLength(groups[0])).toBe(2);
    // Only `qty` is field-backed; `amount` is derived and has no source.
    expect(groups[0].sources).toEqual(['qty']);
    destroy();
  });

  it('ignores a scalar token outside the table', () => {
    const { editor, destroy } = open(2);
    const groups = repeatGroups(editor as any);

    const carried = [...groups[0].cells.values()]
      .flat()
      .map(({ spec }) => spec.id);
    expect(carried).not.toContain('subtotal');
    destroy();
  });
});

describe('growGroup', () => {
  it('adds the rows a longer field needs', () => {
    const { editor, destroy } = open(2);

    const added = growGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      4,
      render
    );

    expect(added.map(instanceKey).sort()).toEqual([
      'amount__2',
      'amount__3',
      'qty__2',
      'qty__3'
    ]);
    // Header plus four item rows.
    expect(tableRows(editor)).toBe(5);
    destroy();
  });

  it('gives every new token its own address', () => {
    const { editor, destroy } = open(2);
    growGroup(editor as any, repeatGroups(editor as any)[0], 3, render);

    const found = addresses(editor);
    expect(found).toContain('qty__2');
    expect(found).toContain('amount__2');
    // A duplicated address would make one write hit two controls.
    expect(new Set(found).size).toBe(found.length);
    destroy();
  });

  it('renders the value into the new row rather than leaving it blank', () => {
    const { editor, destroy } = open(2);
    growGroup(editor as any, repeatGroups(editor as any)[0], 3, (spec) =>
      spec.id === 'qty' ? '7' : '$70.00'
    );

    const built = readTokens(editor as any).filter(
      ({ spec }) => spec.index === 2
    );
    expect(built.map(({ value }) => value).sort()).toEqual(['$70.00', '7']);
    destroy();
  });

  it('keeps the grown rows through a save and reopen', () => {
    const { editor, destroy } = open(2);
    growGroup(editor as any, repeatGroups(editor as any)[0], 3, render);

    editor.open(editor.serialize());

    expect(tableRows(editor)).toBe(4);
    expect(addresses(editor)).toContain('qty__2');
    destroy();
  });

  it('does nothing when the document already has enough rows', () => {
    const { editor, destroy } = open(3);
    const added = growGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      3,
      render
    );

    expect(added).toEqual([]);
    expect(tableRows(editor)).toBe(4);
    destroy();
  });
});

describe('shrinkGroup', () => {
  it('drops the surplus rows from the end', () => {
    const { editor, destroy } = open(4);

    const dropped = shrinkGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      2
    );

    expect(dropped.sort()).toEqual([2, 3]);
    expect(tableRows(editor)).toBe(3);
    destroy();
  });

  it('leaves the surviving rows their original indexes', () => {
    // Removing from the end is what makes renumbering unnecessary.
    const { editor, destroy } = open(3);
    shrinkGroup(editor as any, repeatGroups(editor as any)[0], 2);

    const found = addresses(editor);
    expect(found).toContain('qty__0');
    expect(found).toContain('qty__1');
    expect(found).not.toContain('qty__2');
    destroy();
  });

  it('does nothing when the document is already short enough', () => {
    const { editor, destroy } = open(2);
    const dropped = shrinkGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      2
    );

    expect(dropped).toEqual([]);
    expect(tableRows(editor)).toBe(3);
    destroy();
  });
});

describe('a row deleted in the editor', () => {
  const deleteRow = (editor: DocumentEditor, rowIndex: number): void => {
    const table = (editor as any).documentHelper.pages[0].bodyWidgets[0]
      .childWidgets[0];
    const paragraph =
      table.childWidgets[rowIndex].childWidgets[0].childWidgets[0];
    (editor.selection as any).selectParagraphInternal(paragraph, true);
    (editor.editor as any).deleteRow();
  };

  it('is reported with the repeat index and the fields to splice', () => {
    const { editor, destroy } = open(3);
    const before = rowSnapshot(editor as any);

    deleteRow(editor, 2); // the row holding repeat index 1

    const gone = deletedRows(before, rowSnapshot(editor as any));
    expect(gone).toEqual([{ sources: ['qty'], indexes: [1] }]);
    destroy();
  });

  it('stops the deleted row being read back as a live token', () => {
    // deleteRow leaves the control collection stale, so a plain read still
    // reports the row that is gone.
    const { editor, destroy } = open(3);
    deleteRow(editor, 3);

    expect(
      readTokens(editor as any).map(({ spec }) => instanceKey(spec))
    ).toContain('qty__2');
    expect(staleControls(editor as any).sort()).toEqual([
      'amount__2',
      'qty__2'
    ]);
    expect(addresses(editor)).not.toContain('qty__2');
    destroy();
  });

  it('keeps every token that was not in the deleted row', () => {
    const { editor, destroy } = open(3);
    deleteRow(editor, 3);

    const found = addresses(editor);
    expect(found).toContain('qty__0');
    expect(found).toContain('qty__1');
    expect(found).toContain('subtotal');
    destroy();
  });

  it('reports nothing when no row was deleted', () => {
    const { editor, destroy } = open(3);
    const before = rowSnapshot(editor as any);

    expect(deletedRows(before, rowSnapshot(editor as any))).toEqual([]);
    destroy();
  });
});

describe('the cycle keeps rows in step with the field', () => {
  /** A field store shaped like the form's: one key holding an array. */
  const store = (initial: Record<string, any[]>) => {
    const values: Record<string, any[]> = { ...initial };
    return {
      values,
      read: (spec: TokenSpec) =>
        spec.source ? values[spec.source]?.[spec.index ?? 0] : undefined,
      write: (updates: Array<{ spec: TokenSpec; value: any }>) => {
        for (const { spec, value } of updates) {
          if (!spec.source) continue;
          const rows = [...(values[spec.source] ?? [])];
          rows[spec.index ?? 0] = value;
          values[spec.source] = rows;
        }
      },
      rowCount: (source: string) => values[source]?.length ?? 0,
      removeRow: (sources: string[], index: number) => {
        for (const source of sources) {
          const rows = values[source];
          if (!Array.isArray(rows) || index >= rows.length) continue;
          values[source] = [...rows.slice(0, index), ...rows.slice(index + 1)];
        }
      }
    };
  };

  it('adds a row when the field grows past what the document shows', () => {
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2, 3, 4] });

    attachTokenCycle(editor as any, { fields });

    expect(tableRows(editor)).toBe(5);
    expect(addresses(editor)).toContain('qty__3');
    destroy();
  });

  it('removes a row when the field shrinks after opening', () => {
    // Opening adopts the document's own values, because a freshly generated
    // envelope is where those values come from. A field SHRINKING is something
    // that happens afterwards, and that is what has to move the rows.
    const { editor, destroy } = open(4);
    const fields = store({ qty: [1, 2, 3, 4] });
    const cycle = attachTokenCycle(editor as any, { fields });
    expect(tableRows(editor)).toBe(5);

    fields.values.qty = [1, 2];
    cycle.reconcile();

    expect(tableRows(editor)).toBe(3);
    expect(addresses(editor)).not.toContain('qty__2');
    destroy();
  });

  it('adds a row when the field grows after opening', () => {
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2] });
    const cycle = attachTokenCycle(editor as any, { fields });

    fields.values.qty = [1, 2, 3];
    cycle.reconcile();

    expect(tableRows(editor)).toBe(4);
    expect(addresses(editor)).toContain('qty__2');
    destroy();
  });

  it('recomputes the scalar total over the rows it ends up with', () => {
    // The point of syncing rows at all: SUM has to aggregate the real column.
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2] });
    const cycle = attachTokenCycle(editor as any, { fields });
    // amount = qty * 10 per row, so two rows total 30.
    expect(cycle.getState().values.get('subtotal')).toBe(30);

    fields.values.qty = [1, 2, 3];
    const state = cycle.reconcile();

    // eslint-disable-next-line no-console
    console.log('DBG specs:', state.specs.map((s) => [s.id, s.index, s.formula, s.source]));
    // eslint-disable-next-line no-console
    console.log('DBG qty field:', fields.values.qty);
    expect(state.values.get('subtotal')).toBe(60);
    destroy();
  });

  it('keeps the derived token of a grown row, not just the field-backed one', () => {
    // Writing empty text into a fresh control destroys it, so a derived token
    // whose value is not renderable yet must be left for the reconcile after.
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2] });
    const cycle = attachTokenCycle(editor as any, { fields });

    fields.values.qty = [1, 2, 3];
    cycle.reconcile();

    const found = addresses(editor);
    expect(found).toContain('qty__2');
    expect(found).toContain('amount__2');
    destroy();
  });

  it('never collapses a repeat to no rows at all', () => {
    // The last row is the template every grown row is built from, so a table
    // with none could never grow back.
    const { editor, destroy } = open(2);
    const fields = store({ qty: [] });

    attachTokenCycle(editor as any, { fields });

    expect(tableRows(editor)).toBeGreaterThan(1);
    destroy();
  });

  it('leaves the rows alone when the host cannot report a row count', () => {
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2, 3, 4] });
    const { rowCount, ...withoutCount } = fields;

    attachTokenCycle(editor as any, { fields: withoutCount as any });

    expect(tableRows(editor)).toBe(3);
    destroy();
  });
});
