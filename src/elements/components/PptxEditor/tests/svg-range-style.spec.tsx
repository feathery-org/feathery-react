/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import { addTextBox, setTextStyle } from '../core/model/edit';
import type { Deck, Shape, Slide } from '../core/model/types';
import { getAttr } from '../core/opc/xml';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  window.getSelection()?.removeAllRanges();
});

async function mountTextBox(
  children: React.ReactNode,
  options: { whiteText?: boolean } = {}
) {
  mounted = await mountEditor(children);
  const store = mounted.store;
  let deck!: Deck;
  let slide!: Slide;
  let shape!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    slide = deck.slides[0];
    shape = addTextBox(
      deck,
      slide,
      914400,
      914400,
      3000000,
      900000,
      'Hello world'
    );
    if (options.whiteText)
      setTextStyle(deck, slide, shape, { color: 'FFFFFF' });
    store.resetHistory();
  });
  await act(async () => store.select(shape.id));
  return { deck, slide, shape, store, host: mounted.host };
}

it('colors only selected SVG text through the toolbar after the editor blurs', async () => {
  const { shape, store, host } = await mountTextBox(
    <>
      <Toolbar />
      <SvgSlide />
    </>,
    { whiteText: true }
  );
  const svgBefore = host.querySelector('svg');
  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  const firstText = editor.querySelector('[data-source-run="0"]')!.firstChild!;
  const range = document.createRange();
  range.setStart(firstText, 0);
  range.setEnd(firstText, 5);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(async () => document.dispatchEvent(new Event('selectionchange')));
  expect(store.getState().textSelection?.ranges).toEqual([
    { paragraph: 0, start: 0, end: 5 }
  ]);

  const color = host.querySelector(
    'input[title="Text color"]'
  ) as HTMLInputElement;
  await act(async () => {
    color.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    editor.dispatchEvent(new Event('blur'));
    color.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  expect(store.getState().textSelection?.ranges).toEqual([
    { paragraph: 0, start: 0, end: 5 }
  ]);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(color, '#ff0000');
    color.dispatchEvent(new Event('input', { bubbles: true }));
    color.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(shape.text!.paragraphs[0].runs.map((r) => [r.text, r.color])).toEqual([
    ['Hello', 'FF0000'],
    [' world', 'FFFFFF']
  ]);
  expect(host.querySelector('svg')).toBe(svgBefore);
});

it('records a dragged text color as one undoable formatting action', async () => {
  const { deck, shape, store, host } = await mountTextBox(<Toolbar />);
  const color = host.querySelector(
    'input[title="Text color"]'
  ) as HTMLInputElement;

  await act(async () => {
    for (const value of ['#330000', '#990000', '#ff0000']) {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(color, value);
      color.dispatchEvent(new Event('input', { bubbles: true }));
    }
    color.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(shape.text!.paragraphs[0].runs[0].color).toBe('FF0000');
  expect(store.getState().undoStack).toHaveLength(1);
  await act(async () => store.undo());
  expect(
    deck.slides[0].shapes.find((candidate) => candidate.id === shape.id)!.text!
      .paragraphs[0].runs[0].color
  ).toBeUndefined();
});

it('commits the final font color when the browser emits input without change', async () => {
  const { shape, store, host } = await mountTextBox(<Toolbar />);
  const color = host.querySelector(
    'input[title="Text color"]'
  ) as HTMLInputElement;

  await act(async () => {
    for (const value of ['#330000', '#990000', '#ff0000']) {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value'
      )!.set!.call(color, value);
      color.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  expect(shape.text!.paragraphs[0].runs[0].color).toBeUndefined();
  // The quiet-period fallback commits ~300ms after the last input event.
  // (Real timers: Jest 26 legacy fake timers do not patch window.setTimeout.)
  await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));

  expect(shape.text!.paragraphs[0].runs[0].color).toBe('FF0000');
  expect(store.getState().undoStack).toHaveLength(1);
});

it('finishes an active SVG text edit before applying toolbar color to its selected word', async () => {
  const { shape, host } = await mountTextBox(
    <>
      <Toolbar />
      <SvgSlide />
    </>,
    { whiteText: true }
  );
  const svgBefore = host.querySelector('svg');
  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  const node = editor.querySelector('[data-source-run="0"]')!.firstChild!;
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 5);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const color = host.querySelector(
    'input[title="Text color"]'
  ) as HTMLInputElement;
  await act(async () => {
    color.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    color.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  expect(editor.getAttribute('contenteditable')).toBe('true');
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(color, '#ff0000');
    color.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(shape.text!.paragraphs[0].runs.map((r) => [r.text, r.color])).toEqual([
    ['Hello', 'FF0000'],
    [' world', 'FFFFFF']
  ]);
  expect(host.querySelector('svg')).toBe(svgBefore);
  expect(
    host.querySelector(
      `[data-shape-id="${shape.id}"] [data-textbody][contenteditable="true"]`
    )
  ).toBeNull();
});

it('toggles strikethrough on and off for one selected SVG text run', async () => {
  const { shape, host } = await mountTextBox(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const editor = host.querySelector(
    `[data-shape-id="${shape.id}"] [data-textbody]`
  ) as HTMLElement;
  await act(async () =>
    editor.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  const node = editor.querySelector('[data-source-run="0"]')!.firstChild!;
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 5);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  await act(async () => document.dispatchEvent(new Event('selectionchange')));
  const strikeButton = host.querySelector(
    'button[title="Strikethrough"]'
  ) as HTMLButtonElement;
  await act(async () =>
    strikeButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  );
  expect(host.querySelector('button[title="Strikethrough"]')).toBe(
    strikeButton
  );
  await act(async () => {
    editor.dispatchEvent(new Event('blur'));
    strikeButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    strikeButton.click();
  });
  expect(shape.text!.paragraphs[0].runs.map((r) => [r.text, r.strike])).toEqual(
    [
      ['Hello', true],
      [' world', false]
    ]
  );
  await act(async () =>
    (
      host.querySelector('button[title="Strikethrough"]') as HTMLButtonElement
    ).click()
  );
  expect(shape.text!.paragraphs[0].runs.map((r) => [r.text, r.strike])).toEqual(
    [
      ['Hello', false],
      [' world', false]
    ]
  );
});

it('toggles strikethrough on and off when only the SVG textbox is selected', async () => {
  const { shape, host } = await mountTextBox(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const strikeButton = host.querySelector(
    'button[title="Strikethrough"]'
  ) as HTMLButtonElement;
  await act(async () => strikeButton.click());
  expect(shape.text!.paragraphs[0].runs[0].strike).toBe(true);
  await act(async () =>
    (
      host.querySelector('button[title="Strikethrough"]') as HTMLButtonElement
    ).click()
  );
  expect(shape.text!.paragraphs[0].runs[0].strike).toBe(false);
  expect(getAttr(shape.text!.paragraphs[0].runs[0].rPr!, 'strike')).toBe(
    'noStrike'
  );
});
