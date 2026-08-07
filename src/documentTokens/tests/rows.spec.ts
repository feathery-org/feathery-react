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
  shrinkGroup
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

  it('does not carry the template row default into a grown row', () => {
    // The template row's token has a per-row default. A grown row is not that
    // authored row, so it must NOT inherit the default — otherwise DEFAULT_WINS
    // seeds the template's value into every new row (the last item repeating)
    // instead of the new row's own (empty) field value.
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
    const qtyDefault = (index: number): TokenSpec => ({
      id: 'qty',
      source: 'qty',
      index,
      format: { kind: 'number' },
      default: 2
    });
    editor.open(
      JSON.stringify({
        sections: [
          {
            blocks: [
              {
                rows: [
                  {
                    cells: [cell([{ text: 'Qty' }])],
                    rowFormat: { height: 20 }
                  },
                  {
                    cells: [cell([tokenInline(qtyDefault(0), '2')])],
                    rowFormat: { height: 20 }
                  }
                ]
              }
            ]
          }
        ]
      })
    );

    const added = growGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      2,
      render
    );
    const grown = added.find((spec) => spec.index === 1);
    expect(grown).toBeDefined();
    expect((grown as any).default).toBeUndefined();

    editor.destroy();
    host.remove();
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
    // `deleteRow` leaves the controls in Syncfusion's collection, so the read
    // has to drop them itself — by identity, since a renumbered survivor can
    // end up carrying the same address as a deleted control.
    const { editor, destroy } = open(3);
    deleteRow(editor, 3);

    const read = readTokens(editor as any).map(({ spec }) => instanceKey(spec));
    expect(read).not.toContain('qty__2');
    expect(read).not.toContain('amount__2');
    expect(read).toContain('qty__1');
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

  it('does not read an empty document as every row deleted', () => {
    // `contentChange` can fire while a document is still loading. Treating a
    // group that has vanished as a full deletion spliced the whole field away.
    const before = [{ sources: ['qty'], indexes: [0, 1, 2] }];

    expect(deletedRows(before, [])).toEqual([]);
  });

  it('still reports a deletion when the group survives', () => {
    const before = [{ sources: ['qty'], indexes: [0, 1, 2] }];
    const after = [{ sources: ['qty'], indexes: [0, 2] }];

    expect(deletedRows(before, after)).toEqual([
      { sources: ['qty'], indexes: [1] }
    ]);
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

  it('settles: reconciling repeatedly does not keep adding rows', () => {
    // The container reconciles on EVERY render, so a grow that the next pass
    // cannot see would add a row per render until the browser dies.
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2] });
    const cycle = attachTokenCycle(editor as any, { fields });

    fields.values.qty = [1, 2, 3];
    cycle.reconcile();
    const afterFirst = tableRows(editor);

    cycle.reconcile();
    cycle.reconcile();
    cycle.reconcile();

    expect(tableRows(editor)).toBe(afterFirst);
    destroy();
  });

  it('SHOWS the new values in the grown row, not a placeholder', () => {
    // The row and its controls can exist while every cell still reads
    // "Click here or tap to insert text": built, tagged, and never written to.
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2] });
    const cycle = attachTokenCycle(editor as any, { fields });

    fields.values.qty = [1, 2, 7];
    cycle.reconcile();

    const shown = readTokens(editor as any)
      .filter(({ spec }) => spec.index === 2)
      .map(({ value }) => value)
      .sort();
    expect(shown).toEqual(['$70.00', '7']);
    destroy();
  });

  it('gives a grown row the shading of the same-parity row, not its neighbour', () => {
    // Banding is explicit per-cell shading; insertRow copies the adjacent row,
    // which would make two neighbours the same colour.
    const { editor, destroy } = open(2);
    const table = (editor as any).documentHelper.pages[0].bodyWidgets[0]
      .childWidgets[0];
    const fillOf = (row: number) =>
      table.childWidgets[row]?.childWidgets?.[0]?.cellFormat?.shading
        ?.backgroundColor;
    table.childWidgets[1].childWidgets.forEach((c: any) => {
      c.cellFormat.shading.backgroundColor = '#F2F2F2';
    });
    table.childWidgets[2].childWidgets.forEach((c: any) => {
      c.cellFormat.shading.backgroundColor = '#FFFFFF';
    });

    growGroup(editor as any, repeatGroups(editor as any)[0], 3, render);

    // Row 3 is new; row 1 is its same-parity source, row 2 its neighbour.
    expect(fillOf(3)).toBe(fillOf(1));
    expect(fillOf(3)).not.toBe(fillOf(2));
    destroy();
  });

  it('NEVER leaves a placeholder in a grown row, even with no value', () => {
    // A new item has no description yet. The control still must not read
    // "Click here or tap to insert text" — that is Syncfusion's content, not a
    // value, and it cannot be cleared by unsetting a flag.
    const { editor, destroy } = open(2);
    const fields = store({ qty: [1, 2] });
    const cycle = attachTokenCycle(editor as any, { fields });

    fields.values.qty = [1, 2, 3];
    cycle.reconcile();

    const values = readTokens(editor as any).map(({ value }) => value);
    expect(values.join(' | ')).not.toContain('Click here or tap to insert');
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

describe('a row deleted from the MIDDLE', () => {
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

  const deleteMiddle = (editor: DocumentEditor) => {
    const table = (editor as any).documentHelper.pages[0].bodyWidgets[0]
      .childWidgets[0];
    const para = table.childWidgets[2].childWidgets[0].childWidgets[0];
    (editor.selection as any).selectParagraphInternal(para, true);
    (editor.editor as any).deleteRow();
  };

  const setup = () => {
    const opened = open(3);
    const fields = store({ qty: [11, 22, 33] });
    attachTokenCycle(opened.editor as any, { fields });
    return { ...opened, fields };
  };

  it('splices the field instead of re-adopting the deleted row', () => {
    // The survivor kept its old tag, found no value at that index, and adopted
    // its own text BACK into the field — leaving a duplicate behind.
    const { editor, fields, destroy } = setup();
    deleteMiddle(editor);
    expect(fields.values.qty).toEqual([11, 33]);
    destroy();
  });

  it('renumbers the surviving rows to close the gap', () => {
    // Index MUST equal the field array position; a gap breaks every read.
    const { editor, destroy } = setup();
    deleteMiddle(editor);
    expect([...repeatGroups(editor as any)[0].rows.keys()].sort()).toEqual([
      0, 1
    ]);
    destroy();
  });

  it('reads exactly the surviving tokens, leaving the editor untouched', () => {
    // The renumbered survivor takes the deleted control's address, so telling
    // them apart by address loses both. Identity keeps them distinct WITHOUT
    // mutating Syncfusion's own collection, which broke every control created
    // afterwards.
    const { editor, destroy } = setup();
    const before = (editor as any).documentHelper.contentControlCollection
      .length;
    deleteMiddle(editor);

    expect(
      readTokens(editor as any).map(({ spec }) => instanceKey(spec))
    ).toEqual(['qty__0', 'amount__0', 'qty__1', 'amount__1', 'subtotal']);
    // Nothing was spliced out from under the editor.
    expect((editor as any).documentHelper.contentControlCollection.length).toBe(
      before
    );
    destroy();
  });

  it('keeps every surviving row readable and correctly valued', () => {
    const { editor, destroy } = setup();
    deleteMiddle(editor);
    const found = addresses(editor);
    expect(found).toContain('qty__1');
    expect(found).toContain('amount__1');
    destroy();
  });

  it('grows back onto the FREED index, linked and showing values', () => {
    const { editor, fields, destroy } = setup();
    deleteMiddle(editor);
    expect(fields.values.qty).toEqual([11, 33]);

    fields.values.qty = [11, 33, 77];
    const cycle = attachTokenCycle(editor as any, { fields });
    cycle.reconcile();

    const shown = readTokens(editor as any)
      .filter(({ spec }) => spec.index === 2)
      .map(({ spec, value }) => `${instanceKey(spec)}=${value}`)
      .sort();
    expect(shown).toEqual(['amount__2=$770.00', 'qty__2=77']);
    destroy();
  });

  it('grows onto the next free index afterwards, still linked', () => {
    // With a gap left behind, a grow picked index 3 against a field whose next
    // slot was 2, so the new tokens were created unlinked.
    const { editor, fields, destroy } = setup();
    deleteMiddle(editor);

    fields.values.qty = [11, 33, 55];
    const cycle = attachTokenCycle(editor as any, { fields });
    cycle.reconcile();

    expect([...repeatGroups(editor as any)[0].rows.keys()].sort()).toEqual([
      0, 1, 2
    ]);
    expect(addresses(editor)).toContain('qty__2');
    destroy();
  });
});

describe('grow and shrink by one and by many', () => {
  it('grows by exactly one row', () => {
    const { editor, destroy } = open(2);
    const added = growGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      3,
      render
    );

    expect(added.map(instanceKey).sort()).toEqual(['amount__2', 'qty__2']);
    expect(tableRows(editor)).toBe(4);
    destroy();
  });

  it('grows by many rows in one call, each linked and valued', () => {
    const { editor, destroy } = open(1);
    growGroup(editor as any, repeatGroups(editor as any)[0], 4, (spec) =>
      spec.id === 'qty' ? '5' : '$50.00'
    );

    expect(tableRows(editor)).toBe(5); // header + 4 items
    for (const index of [1, 2, 3]) {
      const shown = readTokens(editor as any)
        .filter(({ spec }) => spec.index === index)
        .map(({ spec, value }) => `${instanceKey(spec)}=${value}`)
        .sort();
      expect(shown).toEqual([`amount__${index}=$50.00`, `qty__${index}=5`]);
    }
    const live = addresses(editor);
    expect(new Set(live).size).toBe(live.length);
    destroy();
  });

  it('shrinks by exactly one row', () => {
    const { editor, destroy } = open(3);
    const dropped = shrinkGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      2
    );

    expect(dropped).toEqual([2]);
    expect(tableRows(editor)).toBe(3);
    expect(addresses(editor)).not.toContain('qty__2');
    destroy();
  });

  it('shrinks by many rows in one call', () => {
    const { editor, destroy } = open(5);
    const dropped = shrinkGroup(
      editor as any,
      repeatGroups(editor as any)[0],
      2
    );

    expect(dropped.sort((a, b) => a - b)).toEqual([2, 3, 4]);
    expect(tableRows(editor)).toBe(3);
    expect(addresses(editor)).toEqual(
      expect.arrayContaining(['qty__0', 'qty__1', 'amount__0', 'amount__1'])
    );
    destroy();
  });
});

describe('freed-index reuse and survivor updates', () => {
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

  const deleteRowAt = (editor: DocumentEditor, tableRow: number) => {
    const table = (editor as any).documentHelper.pages[0].bodyWidgets[0]
      .childWidgets[0];
    const para = table.childWidgets[tableRow].childWidgets[0].childWidgets[0];
    (editor.selection as any).selectParagraphInternal(para, true);
    (editor.editor as any).deleteRow();
  };

  const valueOf = (
    editor: DocumentEditor,
    instance: string
  ): string | undefined =>
    readTokens(editor as any).find(({ spec }) => instanceKey(spec) === instance)
      ?.value;

  it('deletes the FIRST row and renumbers the rest', () => {
    const { editor, destroy } = open(3);
    const fields = store({ qty: [11, 22, 33] });
    const cycle = attachTokenCycle(editor as any, { fields });

    deleteRowAt(editor, 1); // header is row 0; row 1 holds repeat index 0

    expect(fields.values.qty).toEqual([22, 33]);
    cycle.reconcile();
    expect(valueOf(editor, 'qty__0')).toBe('22');
    expect(valueOf(editor, 'qty__1')).toBe('33');
    const live = addresses(editor);
    expect(new Set(live).size).toBe(live.length);
    destroy();
  });

  it('updates a survivor value after a middle delete', () => {
    // Regression: deleteRow leaves the deleted row's control in the collection
    // still tagged qty__1, and renumbering the survivor (was qty__2) onto that
    // freed address left two controls sharing it. The write then landed on the
    // zombie or appended against its stale selection — 33 became "9933".
    const { editor, destroy } = open(3);
    const fields = store({ qty: [11, 22, 33] });
    const cycle = attachTokenCycle(editor as any, { fields });
    deleteRowAt(editor, 2); // -> [11, 33], survivor renumbered to qty__1

    fields.values.qty = [11, 99];
    cycle.reconcile();

    expect(valueOf(editor, 'qty__1')).toBe('99');
    destroy();
  });

  it('leaves no duplicate live address after a middle delete', () => {
    const { editor, destroy } = open(3);
    const fields = store({ qty: [11, 22, 33] });
    attachTokenCycle(editor as any, { fields });

    deleteRowAt(editor, 2);

    const live = addresses(editor);
    expect(new Set(live).size).toBe(live.length);
    destroy();
  });

  it('grows onto the freed index within one continuous cycle', () => {
    // The real flow: a reader deletes a row, then the field grows again, and
    // the same cycle must build the new row on the freed index — tagged, linked
    // and showing its value, never a Syncfusion placeholder.
    const { editor, destroy } = open(3);
    const fields = store({ qty: [11, 22, 33] });
    const cycle = attachTokenCycle(editor as any, { fields });
    deleteRowAt(editor, 2); // -> [11, 33]

    fields.values.qty = [11, 33, 77];
    cycle.reconcile();

    const shown = readTokens(editor as any)
      .filter(({ spec }) => spec.index === 2)
      .map(({ spec, value }) => `${instanceKey(spec)}=${value}`)
      .sort();
    expect(shown).toEqual(['amount__2=$770.00', 'qty__2=77']);

    const values = readTokens(editor as any).map(({ value }) => value);
    expect(values.join(' | ')).not.toContain('Click here or tap to insert');

    const live = addresses(editor);
    expect(new Set(live).size).toBe(live.length);
    destroy();
  });
});
