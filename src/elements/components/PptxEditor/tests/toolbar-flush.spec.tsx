/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import { addTextBox, insertTable, setTableCellText } from '../core/model/edit';
import { tableCell, tableCellText, tableRows } from '../core/model/table';
import { descendant, setAttr } from '../core/opc/xml';
import type { Deck, Shape } from '../core/model/types';
import { SvgSlide } from '../ui/SlideStage';
import { Toolbar } from '../ui/PptxToolbar';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

// Toolbar buttons suppress mousedown focus changes, so no blur commits the
// active contenteditable edit: the formatting handlers must flush it.

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  jest.restoreAllMocks();
});

const runText = (shape: Shape) =>
  shape.text!.paragraphs[0].runs.map((run) => run.text).join('');

it('keeps pending text when a toolbar command changes shape order', async () => {
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const { store, host } = mounted;
  let deck!: Deck;
  let shape!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    shape = addTextBox(
      deck,
      deck.slides[0],
      914400,
      914400,
      3000000,
      900000,
      'Before'
    );
    store.resetHistory();
  });
  await act(async () => store.select(shape.id));
  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  editor.querySelector('[data-source-run="0"]')!.textContent =
    'Typed before reorder';
  await act(async () => store.setTextToolbarPointer(false));
  const back = host.querySelector(
    'button[title="Send to back"]'
  ) as HTMLButtonElement;
  await act(async () => back.click());
  expect(
    runText(deck.slides[0].shapes.find((item) => item.id === shape.id)!)
  ).toBe('Typed before reorder');
  expect(deck.slides[0].shapes[0].id).toBe(shape.id);
});

it('commits pending text before applying bullets from the toolbar', async () => {
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const { store, host } = mounted;
  let deck!: Deck;
  let shape!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    shape = addTextBox(
      deck,
      deck.slides[0],
      914400,
      914400,
      3000000,
      900000,
      'Before'
    );
    store.resetHistory();
  });
  await act(async () => store.select(shape.id));
  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  editor.querySelector('[data-source-run="0"]')!.textContent = 'After';
  await act(async () => store.setTextToolbarPointer(false));

  const bullets = host.querySelector(
    'button[title="Bullets"]'
  ) as HTMLButtonElement;
  expect(bullets.disabled).toBe(false);
  await act(async () => bullets.click());

  const updated = deck.slides[0].shapes.find((s) => s.id === shape.id)!;
  expect(runText(updated)).toBe('After');
  expect(descendant(updated.node, 'a:buChar')).toBeDefined();
});

it('commits a pending table-cell edit before formatting cells from the toolbar', async () => {
  jest.spyOn(SVGSVGElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 16,
    y: 16,
    left: 16,
    top: 16,
    width: 1000,
    height: 750,
    right: 1016,
    bottom: 766
  } as unknown as DOMRect);
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const { store, host } = mounted;
  let deck!: Deck;
  let table!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    const slide = deck.slides[0];
    table = insertTable(deck, slide, 2, 2, 914400, 914400, 2000000, 800000);
    setTableCellText(deck, slide, table, 0, 0, 'First');
    tableRows(table).forEach((row) => setAttr(row, 'h', '500000'));
    store.resetHistory();
  });
  await act(async () => store.select(table.id));
  const first = host.querySelector(
    '[data-table-cell][data-row="0"][data-col="0"]'
  ) as HTMLElement;
  // First click highlights the cell, the second places a caret (edit mode).
  for (let i = 0; i < 2; i++) {
    await act(async () =>
      first.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 100,
          clientY: 100
        })
      )
    );
    await act(async () =>
      window.dispatchEvent(
        new MouseEvent('mouseup', { clientX: 100, clientY: 100 })
      )
    );
  }
  expect(first.getAttribute('contenteditable')).toBe('true');
  first.textContent = 'Typed';

  const bold = host.querySelector('button[title^="Bold"]') as HTMLButtonElement;
  expect(bold.disabled).toBe(false);
  await act(async () => bold.click());

  const cell = tableCell(table, 0, 0)!;
  expect(tableCellText(cell)).toBe('Typed');
  expect(descendant(cell, 'a:rPr')?.[':@']?.['@_b']).toBe('1');
});
