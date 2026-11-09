import React from 'react';
import { insertImage, readPictureCrop } from '../core/model/edit';
import type { Shape } from '../core/model/types';
import { Toolbar } from '../ui/PptxToolbar';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
);

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

it('edits a selected picture as a circle and changes its source crop from the toolbar', async () => {
  mounted = await mountEditor(<Toolbar />);
  const store = mounted.store;
  const host = mounted.host;
  let picture!: Shape;
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    const deck = store.getState().deck!;
    picture = insertImage(
      deck,
      deck.slides[0],
      PNG,
      'png',
      100000,
      100000,
      1200000,
      800000
    );
    store.resetHistory();
  });
  await act(async () => store.select(picture.id));

  expect(host.textContent).toContain('Picture crop');
  const geometry = host.querySelector(
    'select[title="Crop shape"]'
  ) as HTMLSelectElement;
  await act(async () => {
    geometry.value = 'circle';
    geometry.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(picture.geom).toBe('ellipse');
  expect(picture.xfrm?.cx).toBe(picture.xfrm?.cy);

  const left = host.querySelector(
    'input[title="left source crop percent"]'
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(left, '12');
    left.dispatchEvent(new Event('input', { bubbles: true }));
    left.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(readPictureCrop(picture).cropPct.left).toBe(12);
});
