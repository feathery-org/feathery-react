import React from 'react';
import { insertTable } from '../core/model/edit';
import { deckToJSON } from '../core/model/json';
import type { Deck, Shape } from '../core/model/types';
import { SvgSlide } from '../ui/SlideStage';
import { JsonPanel } from '../ui/JsonPanel';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function mount() {
  mounted = await mountEditor(
    <>
      <SvgSlide />
      <JsonPanel />
    </>
  );
  const store = mounted.store;
  let deck!: Deck;
  let table!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    table = insertTable(
      deck,
      deck.slides[0],
      1,
      1,
      914400,
      914400,
      1000000,
      400000
    );
    store.resetHistory();
  });
  await act(async () => store.select(table.id));
  return { deck, table, store, host: mounted.host };
}

async function startEditing(host: HTMLElement) {
  await act(async () =>
    (
      Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Edit JSON'
      ) as HTMLButtonElement
    ).click()
  );
}

async function setEditor(host: HTMLElement, value: string) {
  const textarea = host.querySelector(
    'textarea[aria-label="Slide JSON editor"]'
  ) as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function applyDraft(host: HTMLElement) {
  await act(async () =>
    (
      Array.from(host.querySelectorAll('button')).find(
        (button) => button.textContent === 'Apply'
      ) as HTMLButtonElement
    ).click()
  );
}

it('applies table cell and grid edits from the JSON viewer without replacing the SVG slide', async () => {
  const { deck, table, store, host } = await mount();
  const svgBefore = host.querySelector('svg');
  const otherShapeBefore = host.querySelector(
    `[data-shape-id]:not([data-shape-id="${table.id}"])`
  );
  await startEditing(host);
  const draft = JSON.parse(
    (host.querySelector('textarea') as HTMLTextAreaElement).value
  );
  const edited = draft.shapes.find(
    (shape: { id: string }) => shape.id === table.id
  );
  edited.table.columns[0].widthEMU = 1300000;
  edited.table.rows[0].cells[0].text = 'From JSON';
  await setEditor(host, JSON.stringify(draft, null, 2));
  await applyDraft(host);

  expect(host.querySelector('svg')).toBe(svgBefore);
  expect(
    host.querySelector(`[data-shape-id]:not([data-shape-id="${table.id}"])`)
  ).toBe(otherShapeBefore);
  expect(
    host.querySelector(`[data-shape-id="${table.id}"]`)?.textContent
  ).toContain('From JSON');
  expect(
    deckToJSON(deck).slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.columns[0].widthEMU
  ).toBe(1300000);
  expect(
    deckToJSON(deck).slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.rows[0].cells[0].text
  ).toBe('From JSON');
  expect(host.querySelector('textarea')).toBeNull();
  expect(host.textContent).toContain('From JSON');
  expect(
    store.getState().undoStack[store.getState().undoStack.length - 1]?.label
  ).toBe('Edit slide JSON');

  await act(async () => store.undo());
  expect(host.querySelector('svg')).toBe(svgBefore);
  expect(
    deckToJSON(deck).slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.rows[0].cells[0].text
  ).toBe('');
  await act(async () => store.redo());
  expect(host.querySelector('svg')).toBe(svgBefore);
  expect(
    deckToJSON(deck).slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.rows[0].cells[0].text
  ).toBe('From JSON');
});

it('shows unsupported JSON edits and leaves slide content unchanged', async () => {
  const { deck, table, host } = await mount();
  await startEditing(host);
  const draft = JSON.parse(
    (host.querySelector('textarea') as HTMLTextAreaElement).value
  );
  const edited = draft.shapes.find(
    (shape: { id: string }) => shape.id === table.id
  );
  edited.table.rows[0].cells[0].text = 'Should not appear';
  edited.name = 'Unsupported rename';
  await setEditor(host, JSON.stringify(draft, null, 2));
  await applyDraft(host);
  expect(host.querySelector('[role="alert"]')?.textContent).toMatch(
    /unsupported edit/
  );
  expect(
    deckToJSON(deck).slides[0].shapes.find((shape) => shape.id === table.id)!
      .table!.rows[0].cells[0].text
  ).toBe('');
  expect(
    host.querySelector(`[data-shape-id="${table.id}"]`)?.textContent
  ).not.toContain('Should not appear');
});
