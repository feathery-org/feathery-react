/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { insertTable, setTableCellText } from '../core/model/edit';
import {
  tableCell,
  tableCellText,
  tableCells,
  tableColumns,
  tableRows
} from '../core/model/table';
import { child, descendant, getAttr, setAttr } from '../core/opc/xml';
import type { Deck, Shape, Slide } from '../core/model/types';
import { SvgSlide } from '../ui/SlideStage';
import { Toolbar } from '../ui/PptxToolbar';
import { act, mountEditor, sampleBytes, type Mounted, switchTab } from './harness';

const STAGE_RECT = {
  x: 16,
  y: 16,
  left: 16,
  top: 16,
  width: 1000,
  height: 750,
  right: 1016,
  bottom: 766
} as unknown as DOMRect;

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  jest.restoreAllMocks();
});

// The stage keydown listener lives on the stage host element (not window), so
// keyboard events for table navigation are dispatched on that element.
const stageHost = () =>
  mounted!.host.querySelector('div[tabindex="-1"]') as HTMLDivElement;

async function mountTable() {
  jest
    .spyOn(SVGSVGElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(STAGE_RECT);
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const store = mounted.store;
  let deck!: Deck;
  let slide!: Slide;
  let table!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    slide = deck.slides[0];
    table = insertTable(deck, slide, 2, 2, 914400, 914400, 2000000, 800000);
    setTableCellText(deck, slide, table, 0, 0, 'First');
    setTableCellText(deck, slide, table, 0, 1, 'Second value');
    tableRows(table).forEach((row) => setAttr(row, 'h', '500000'));
    store.resetHistory();
  });
  await act(async () => store.select(table.id));
  const host = mounted.host;
  return { deck, slide, table, host, store };
}

it('selects the complete table grid even when its XML frame height differs from row heights', async () => {
  const { deck, host } = await mountTable();
  const overlay = Array.from(host.querySelectorAll('div[data-overlay]')).find(
    (el) => el.querySelector('div[data-overlay]')
  ) as HTMLDivElement;
  expect(overlay).toBeTruthy();
  expect(parseFloat(overlay.style.height)).toBeCloseTo(
    (1000000 * 1000) / deck.size.cx,
    4
  );
  expect(overlay.style.pointerEvents).toBe('none');
});

it('renders a merged table anchor across its full column and row span without painting continuation cells over it', async () => {
  const { deck, slide, table, host, store } = await mountTable();
  await act(async () =>
    store.executeCommand(
      {
        type: 'edit-table',
        slideId: slide.path,
        shapeId: table.id,
        operations: [
          {
            kind: 'merge-cells',
            range: { startRow: 0, startCol: 0, endRow: 1, endCol: 1 }
          }
        ]
      },
      'Merge table cells'
    )
  );
  const background = host.querySelector(
    '[data-table-cell-bg][data-row="0"][data-col="0"]'
  ) as SVGRectElement;
  expect(background).toBeTruthy();
  expect(background.getAttribute('width')).toBe('2000000');
  expect(background.getAttribute('height')).toBe('1000000');
  expect(host.querySelectorAll('[data-table-cell]')).toHaveLength(1);
  expect(host.querySelector('[data-table-cell]')?.textContent).toBe(
    'First\nSecond value'
  );
  await act(async () =>
    store.setTableSelection({
      shapeId: table.id,
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0
    })
  );
  const selection = host.querySelector('[data-table-range]') as HTMLDivElement;
  expect(parseFloat(selection.style.width)).toBeCloseTo(
    (2000000 * 1000) / deck.size.cx,
    4
  );
  expect(parseFloat(selection.style.height)).toBeCloseTo(
    (1000000 * 1000) / deck.size.cx,
    4
  );
});

it('merges a highlighted cell range and unmerges the selected merged cell from the toolbar', async () => {
  const { table, host, store } = await mountTable();
  await act(async () =>
    store.setTableSelection({
      shapeId: table.id,
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 1
    })
  );
  await act(async () =>
    (
      host.querySelector('button[title="Merge cells"]') as HTMLButtonElement
    ).click()
  );
  const rows = tableRows(table);
  expect(getAttr(tableCells(rows[0])[0], 'gridSpan')).toBe('2');
  expect(getAttr(tableCells(rows[0])[0], 'rowSpan')).toBe('2');
  expect(getAttr(tableCells(rows[0])[1], 'hMerge')).toBe('1');
  expect(getAttr(tableCells(rows[1])[0], 'vMerge')).toBe('1');
  expect(getAttr(tableCells(rows[1])[1], 'hMerge')).toBe('1');
  expect(getAttr(tableCells(rows[1])[1], 'vMerge')).toBe('1');
  expect(host.querySelectorAll('[data-table-cell]')).toHaveLength(1);
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0
  });

  await act(async () =>
    (
      host.querySelector('button[title="Unmerge cells"]') as HTMLButtonElement
    ).click()
  );
  for (const row of tableRows(table))
    for (const cell of tableCells(row)) {
      expect(getAttr(cell, 'gridSpan')).toBeUndefined();
      expect(getAttr(cell, 'rowSpan')).toBeUndefined();
      expect(getAttr(cell, 'hMerge')).toBeUndefined();
      expect(getAttr(cell, 'vMerge')).toBeUndefined();
    }
  expect(host.querySelectorAll('[data-table-cell]')).toHaveLength(4);
});

it('moves Shift+Tab to the next cell during table editing', async () => {
  const { host } = await mountTable();
  const first = host.querySelector(
    '[data-table-cell][data-row="0"][data-col="0"]'
  ) as HTMLElement;
  await act(async () =>
    first.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  expect(first.getAttribute('contenteditable')).toBe('true');
  await act(async () =>
    first.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true
      })
    )
  );
  const next = host.querySelector(
    '[data-table-cell][data-row="0"][data-col="1"]'
  )!;
  expect(next.getAttribute('contenteditable')).toBe('true');
  expect(window.getSelection()?.toString()).toBe('Second value');
});

it('selects a cell on one click, places a caret on the next click, and selects its value on double click', async () => {
  const { host, store } = await mountTable();
  const first = host.querySelector(
    '[data-table-cell][data-row="0"][data-col="0"]'
  ) as HTMLElement;
  await act(async () =>
    first.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 100, clientY: 100 })
    )
  );
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0
  });
  expect(first.getAttribute('contenteditable')).toBeNull();
  await act(async () =>
    first.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 100, clientY: 100 })
    )
  );
  expect(first.getAttribute('contenteditable')).toBe('true');
  expect(window.getSelection()?.isCollapsed).toBe(true);
  await act(async () =>
    first.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  expect(window.getSelection()?.toString()).toBe('First');
});

it('tabs past a merged continuation into the next editable cell on the second row', async () => {
  const { slide, table, host, store } = await mountTable();
  await act(async () =>
    store.executeCommand(
      {
        type: 'edit-table',
        slideId: slide.path,
        shapeId: table.id,
        operations: [
          {
            kind: 'merge-cells',
            range: { startRow: 0, startCol: 0, endRow: 1, endCol: 0 }
          }
        ]
      },
      'Merge table cells'
    )
  );
  const lastInFirstRow = host.querySelector(
    '[data-table-cell][data-row="0"][data-col="1"]'
  ) as HTMLElement;
  await act(async () =>
    lastInFirstRow.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  await act(async () =>
    lastInFirstRow.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    )
  );
  const next = host.querySelector(
    '[data-table-cell][data-row="1"][data-col="1"]'
  ) as HTMLElement;
  expect(next.getAttribute('contenteditable')).toBe('true');
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 1,
    startCol: 1,
    endRow: 1,
    endCol: 1
  });
});

it('uses Tab and Shift+Tab on a highlighted cell to advance the highlight without entering edit mode', async () => {
  const { host, store } = await mountTable();
  const first = host.querySelector(
    '[data-table-cell][data-row="0"][data-col="0"]'
  ) as HTMLElement;
  await act(async () =>
    first.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    stageHost().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 0,
    startCol: 1,
    endRow: 0,
    endCol: 1
  });
  expect(
    host
      .querySelector('[data-table-cell][data-row="0"][data-col="1"]')
      ?.getAttribute('contenteditable')
  ).toBeNull();
  await act(async () =>
    stageHost().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 1,
    startCol: 0,
    endRow: 1,
    endCol: 0
  });
  expect(
    host
      .querySelector('[data-table-cell][data-row="1"][data-col="0"]')
      ?.getAttribute('contenteditable')
  ).toBeNull();
});

it('uses Tab on a highlighted cell to skip a merged continuation on the next row', async () => {
  const { slide, table, store } = await mountTable();
  await act(async () =>
    store.executeCommand(
      {
        type: 'edit-table',
        slideId: slide.path,
        shapeId: table.id,
        operations: [
          {
            kind: 'merge-cells',
            range: { startRow: 0, startCol: 0, endRow: 1, endCol: 0 }
          }
        ]
      },
      'Merge table cells'
    )
  );
  await act(async () =>
    store.setTableSelection({
      shapeId: table.id,
      startRow: 0,
      startCol: 1,
      endRow: 0,
      endCol: 1
    })
  );
  await act(async () =>
    stageHost().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 1,
    startCol: 1,
    endRow: 1,
    endCol: 1
  });
});

it('leaves Tab available to toolbar controls while a table cell remains highlighted', async () => {
  const { table, host, store } = await mountTable();
  await act(async () =>
    store.setTableSelection({
      shapeId: table.id,
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 0
    })
  );
  await switchTab(host, 'Home');
  const font = host.querySelector('select[title="Font"]') as HTMLSelectElement;
  font.focus();
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    bubbles: true,
    cancelable: true
  });
  await act(async () => stageHost().dispatchEvent(event));
  expect(event.defaultPrevented).toBe(false);
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 0,
    startCol: 0,
    endRow: 0,
    endCol: 0
  });
});

it('drag-selects a rectangular cell range and applies text, fill, and border formatting from the toolbar', async () => {
  const { deck, table, host, store } = await mountTable();
  const first = host.querySelector(
    '[data-table-cell][data-row="0"][data-col="0"]'
  ) as HTMLElement;
  const last = host.querySelector(
    '[data-table-cell][data-row="1"][data-col="1"]'
  ) as HTMLElement;
  await act(async () =>
    first.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    last.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, clientX: 140, clientY: 140 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 140, clientY: 140 })
    )
  );
  expect(store.getState().tableSelection).toMatchObject({
    startRow: 0,
    startCol: 0,
    endRow: 1,
    endCol: 1
  });
  expect(host.querySelector('[data-table-range]')).toBeTruthy();
  await switchTab(host, 'Home');
  await act(async () =>
    (host.querySelector('button[title="Bold"]') as HTMLButtonElement).click()
  );
  await switchTab(host, 'Table');
  const fill = host.querySelector(
    'input[title="Selected cell fill"]'
  ) as HTMLInputElement;
  await act(async () => {
    fill.value = '#ff0000';
    fill.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dash = host.querySelector(
    'select[title="Border style"]'
  ) as HTMLSelectElement;
  const width = host.querySelector(
    'input[title="Border width (pt)"]'
  ) as HTMLInputElement;
  const borderColor = host.querySelector(
    'input[title="Border color"]'
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value'
    )!.set!.call(dash, 'dash');
    dash.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(width, '2');
    width.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(borderColor, '#00ff00');
    borderColor.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    (
      host.querySelector('button[title="Apply borders"]') as HTMLButtonElement
    ).click()
  );
  expect(store.getState().undoStack).toHaveLength(3);
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++) {
      const cell = tableCell(table, row, col)!;
      expect(
        getAttr(
          (descendant(cell, 'a:rPr') || descendant(cell, 'a:endParaRPr'))!,
          'b'
        )
      ).toBe('1');
      expect(
        getAttr(
          child(child(child(cell, 'a:tcPr')!, 'a:solidFill')!, 'a:srgbClr')!,
          'val'
        )
      ).toBe('FF0000');
      const left = child(child(cell, 'a:tcPr')!, 'a:lnL')!;
      expect(getAttr(left, 'w')).toBe('25400');
      expect(getAttr(child(left, 'a:prstDash')!, 'val')).toBe('dash');
      expect(
        getAttr(child(child(left, 'a:solidFill')!, 'a:srgbClr')!, 'val')
      ).toBe('00FF00');
    }
  const savedTable = importDeck(exportDeckBytes(deck)).slides[0].shapes.find(
    (shape) => shape.id === table.id
  )!;
  const savedCell = tableCell(savedTable, 1, 1)!;
  expect(
    getAttr(
      (descendant(savedCell, 'a:rPr') ||
        descendant(savedCell, 'a:endParaRPr'))!,
      'b'
    )
  ).toBe('1');
  expect(
    getAttr(
      child(child(child(savedCell, 'a:tcPr')!, 'a:solidFill')!, 'a:srgbClr')!,
      'val'
    )
  ).toBe('FF0000');
  expect(child(child(savedCell, 'a:tcPr')!, 'a:lnL')).toBeTruthy();
});

it('adds a row when table-cell navigation advances beyond the final cell', async () => {
  const { table, host, store } = await mountTable();
  const last = host.querySelector(
    '[data-table-cell][data-row="1"][data-col="1"]'
  ) as HTMLElement;
  await act(async () =>
    last.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  last.textContent = 'Added with row';
  await act(async () =>
    last.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    )
  );
  expect(tableRows(table)).toHaveLength(3);
  expect(tableCellText(tableCell(table, 1, 1))).toBe('Added with row');
  expect(store.getState().undoStack).toHaveLength(1);
  expect(store.getState().undoStack[0]?.label).toBe('Add table row');
  expect(
    host
      .querySelector('[data-table-cell][data-row="2"][data-col="0"]')
      ?.getAttribute('contenteditable')
  ).toBe('true');
});

it('resizes one table column and one row by dragging their internal edges', async () => {
  const { table, host, store } = await mountTable();
  const columnEdge = host.querySelector(
    '[data-table-edge="column"][data-index="0"]'
  ) as HTMLElement;
  const rowEdge = host.querySelector(
    '[data-table-edge="row"][data-index="0"]'
  ) as HTMLElement;
  expect(columnEdge).toBeTruthy();
  expect(rowEdge).toBeTruthy();
  const scale = 1000 / store.getState().deck!.size.cx;
  const deltaEMU = Math.round(10 / scale);
  await act(async () =>
    columnEdge.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 110, clientY: 100 })
    )
  );
  expect(store.getState().undoStack).toHaveLength(0);
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 110, clientY: 100 })
    )
  );
  expect(Number(getAttr(tableColumns(table)[0], 'w'))).toBe(1000000 + deltaEMU);
  expect(Number(getAttr(tableColumns(table)[1], 'w'))).toBe(1000000);
  expect(store.getState().undoStack).toHaveLength(1);
  const nextRowEdge = host.querySelector(
    '[data-table-edge="row"][data-index="0"]'
  ) as HTMLElement;
  await act(async () =>
    nextRowEdge.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 100, clientY: 110 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 100, clientY: 110 })
    )
  );
  expect(Number(getAttr(tableRows(table)[0], 'h'))).toBe(500000 + deltaEMU);
  expect(Number(getAttr(tableRows(table)[1], 'h'))).toBe(500000);
  expect(store.getState().undoStack).toHaveLength(2);
});

it('double-clicks a column or row edge to fit that dimension to its content', async () => {
  const { table, host } = await mountTable();
  const beforeWidth = Number(getAttr(tableColumns(table)[0], 'w'));
  const beforeHeight = Number(getAttr(tableRows(table)[0], 'h'));
  const columnEdge = host.querySelector(
    '[data-table-edge="column"][data-index="0"]'
  ) as HTMLElement;
  await act(async () =>
    columnEdge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  expect(Number(getAttr(tableColumns(table)[0], 'w'))).toBeLessThan(
    beforeWidth
  );
  const rowEdge = host.querySelector(
    '[data-table-edge="row"][data-index="0"]'
  ) as HTMLElement;
  await act(async () =>
    rowEdge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  expect(Number(getAttr(tableRows(table)[0], 'h'))).not.toBe(beforeHeight);
});

it('resizes from the outer left and top edges while keeping the far edges fixed in the exported PPTX', async () => {
  const { deck, table, host } = await mountTable();
  const before = {
    x: table.xfrm!.x,
    y: table.xfrm!.y,
    width: 2000000,
    height: 1000000
  };
  const deltaEMU = Math.round(10 / (1000 / deck.size.cx));
  const left = host.querySelector(
    '[data-table-edge="column"][data-index="-1"]'
  ) as HTMLElement;
  await act(async () =>
    left.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 110, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 110, clientY: 100 })
    )
  );
  const top = host.querySelector(
    '[data-table-edge="row"][data-index="-1"]'
  ) as HTMLElement;
  await act(async () =>
    top.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 100, clientY: 110 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 100, clientY: 110 })
    )
  );
  expect(table.xfrm!.x).toBe(before.x + deltaEMU);
  expect(table.xfrm!.y).toBe(before.y + deltaEMU);
  expect(table.xfrm!.cx).toBe(before.width - deltaEMU);
  expect(table.xfrm!.cy).toBe(before.height - deltaEMU);
  const exportedTable = importDeck(exportDeckBytes(deck)).slides[0].shapes.find(
    (shape) => shape.id === table.id
  )!;
  expect([
    exportedTable.xfrm!.x,
    exportedTable.xfrm!.y,
    exportedTable.xfrm!.cx,
    exportedTable.xfrm!.cy
  ]).toEqual([table.xfrm!.x, table.xfrm!.y, table.xfrm!.cx, table.xfrm!.cy]);
});

it('moves a selected table from its move handle without changing row and column sizes', async () => {
  const { table, host } = await mountTable();
  const before = {
    x: table.xfrm!.x,
    y: table.xfrm!.y,
    rows: tableRows(table).map((row) => getAttr(row, 'h')),
    columns: tableColumns(table).map((column) => getAttr(column, 'w'))
  };
  const moveHandle = host.querySelector(
    '[data-table-move-handle]'
  ) as HTMLElement;
  await act(async () =>
    moveHandle.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 110, clientY: 110 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 110, clientY: 110 })
    )
  );
  expect(table.xfrm!.x).toBeGreaterThan(before.x);
  expect(table.xfrm!.y).toBeGreaterThan(before.y);
  expect(tableRows(table).map((row) => getAttr(row, 'h'))).toEqual(before.rows);
  expect(tableColumns(table).map((column) => getAttr(column, 'w'))).toEqual(
    before.columns
  );
});

it('moves a table inserted from the toolbar from its selection handle', async () => {
  jest
    .spyOn(SVGSVGElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(STAGE_RECT);
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const store = mounted.store;
  const host = mounted.host;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  const slide = store.getState().deck!.slides[0];
  await switchTab(host, 'Insert');
  // The +Table button opens the size picker; choose 3x3 from the grid.
  await act(async () =>
    (
      host.querySelector('button[title="Insert table"]') as HTMLButtonElement
    ).click()
  );
  await act(async () =>
    (
      host.querySelector(
        'button[aria-label="3 columns by 3 rows"]'
      ) as HTMLButtonElement
    ).click()
  );
  const table = slide.shapes[slide.shapes.length - 1];
  expect(store.getState().selectedId).toBe(table.id);
  const before = { x: table.xfrm!.x, y: table.xfrm!.y };
  const moveHandle = host.querySelector(
    '[data-table-move-handle]'
  ) as HTMLElement;
  expect(moveHandle).toBeTruthy();
  await act(async () =>
    moveHandle.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 120, clientY: 120 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 120, clientY: 120 })
    )
  );

  expect(table.xfrm!.x).toBeGreaterThan(before.x);
  expect(table.xfrm!.y).toBeGreaterThan(before.y);
});
