import React from 'react';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function mountWithSample() {
  mounted = await mountEditor(
    <>
      <Toolbar />
      <SvgSlide />
    </>
  );
  await act(async () => mounted!.store.loadFile(sampleBytes(), 'sample.pptx'));
  return mounted;
}

it('keeps the SVG slide mounted when a toolbar text edit changes one shape', async () => {
  const { host, store } = await mountWithSample();
  const deck = store.getState().deck!;
  const slideIndex = deck.slides.findIndex((s) =>
    s.shapes.some((sh) => sh.text)
  );
  const shape = deck.slides[slideIndex].shapes.find((sh) => sh.text)!;
  await act(async () => store.setActiveSlide(slideIndex));
  await act(async () => store.select(shape.id));

  const svgBefore = host.querySelector('svg[data-svg-uid]');
  const otherShapeBefore = host.querySelector(
    `[data-shape-id]:not([data-shape-id="${shape.id}"])`
  );
  expect(svgBefore).not.toBeNull();
  const bold = host.querySelector('button[title="Bold"]') as HTMLButtonElement;
  expect(bold.disabled).toBe(false);
  await act(async () => bold.click());

  expect(host.querySelector('svg[data-svg-uid]')).toBe(svgBefore);
  expect(
    host.querySelector(`[data-shape-id]:not([data-shape-id="${shape.id}"])`)
  ).toBe(otherShapeBefore);
  expect(
    deck.slides[slideIndex].shapes.find((sh) => sh.id === shape.id)?.text
      ?.paragraphs[0].runs[0].bold
  ).toBe(true);
});

it('undo and redo update the mounted SVG without rebuilding it', async () => {
  const { host, store } = await mountWithSample();
  const deck = store.getState().deck!;
  const slide = deck.slides[0];
  const shape = slide.shapes.find((sh) => sh.xfrm)!;
  const startX = shape.xfrm!.x;
  await act(async () =>
    store.executeCommand(
      {
        type: 'set-shape-geometries',
        slideId: slide.path,
        updates: [{ shapeId: shape.id, geometry: { x: startX + 914400 } }]
      },
      'Move shape'
    )
  );
  const svgBefore = host.querySelector('svg[data-svg-uid]');
  await act(async () => store.undo());
  expect(shape.xfrm!.x).toBe(startX);
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svgBefore);
  await act(async () => store.redo());
  expect(shape.xfrm!.x).toBe(startX + 914400);
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svgBefore);
});
