import React from 'react';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

it('changes a shape fill from the toolbar, renders it, and round-trips undo', async () => {
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  const { host, store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  const slide = store.getState().deck!.slides[0];
  let created = '';
  await act(async () => {
    const res = store.executeCommand({
      type: 'insert-shape',
      slideId: slide.path,
      shape: {
        kind: 'auto-shape',
        geometry: 'rect',
        x: 0,
        y: 0,
        cx: 914400,
        cy: 914400
      }
    });
    created = res!.createdShapeIds[0];
    store.select(created);
  });
  const fill = host.querySelector(
    'input[title="Shape fill color"]'
  ) as HTMLInputElement;
  expect(fill.disabled).toBe(false);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )!.set!.call(fill, '#ff0000');
    fill.dispatchEvent(new Event('input', { bubbles: true }));
    fill.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const shape = slide.shapes.find((sh) => sh.id === created)!;
  expect(shape.fillColor).toBe('FF0000');
  // Mounted SVG shows the fill without a rebuild.
  const geom = host.querySelector(
    `svg[data-svg-uid] [data-shape-id="${created}"] [fill="#FF0000"], svg[data-svg-uid] [data-shape-id="${created}"] [fill="#ff0000"]`
  );
  expect(geom).toBeTruthy();
  expect(
    store.getState().undoStack[store.getState().undoStack.length - 1].label
  ).toBe('Change fill color');
  await act(async () => store.undo());
  // Undo may rebuild shape objects (raw-XML restore path): re-read the model.
  const restored = store
    .getState()
    .deck!.slides[0].shapes.find((sh) => sh.id === created)!;
  expect(restored.fillColor).not.toBe('FF0000');
});
