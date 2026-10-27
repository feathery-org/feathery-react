/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import { addTextBox } from '../core/model/edit';
import { refreshShapeText } from '../core/model/read';
import type { Shape } from '../core/model/types';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  window.getSelection()?.removeAllRanges();
});

const textbody = (host: HTMLElement, id: string) =>
  host.querySelector(`[data-shape-id="${id}"] [data-textbody]`) as HTMLElement;

it('double-clicking an unselected text shape selects it and enters editing', async () => {
  mounted = await mountEditor(<SvgSlide />);
  const store = mounted.store;
  let shape!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    const deck = store.getState().deck!;
    shape = addTextBox(deck, deck.slides[0], 914400, 914400, 3000000, 900000, 'Edit me');
    refreshShapeText(shape);
    store.resetHistory();
  });
  const host = mounted.host;

  // Nothing selected, not yet editing.
  expect(store.getState().selectedIds).not.toContain(shape.id);
  expect(textbody(host, shape.id).getAttribute('contenteditable')).not.toBe(
    'true'
  );

  await act(async () =>
    textbody(host, shape.id).dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true })
    )
  );

  expect(store.getState().selectedIds).toContain(shape.id);
  expect(textbody(host, shape.id).getAttribute('contenteditable')).toBe('true');
});
