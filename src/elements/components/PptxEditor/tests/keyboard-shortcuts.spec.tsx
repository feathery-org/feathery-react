import React from 'react';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; });

function stageHost(host: HTMLElement): HTMLElement {
  return host.querySelector('div[tabindex="-1"]') as HTMLElement;
}
function press(el: HTMLElement, key: string, init: KeyboardEventInit = {}) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
}

it('supports the well-known editor shortcuts on the stage', async () => {
  mounted = await mountEditor(<><Toolbar /><SvgSlide /></>);
  const { host, store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  const slide = store.getState().deck!.slides[0];
  const shape = slide.shapes.find((sh) => sh.text && sh.xfrm)!;
  await act(async () => store.select(shape.id));
  const stage = stageHost(host);

  // Ctrl+B toggles bold on the selected shape.
  const boldBefore = !!shape.text!.paragraphs[0].runs[0].bold;
  await act(async () => press(stage, 'b', { ctrlKey: true }));
  expect(!!shape.text!.paragraphs[0].runs[0].bold).toBe(!boldBefore);

  // Arrow nudges: 1px right, then a Shift x10 nudge down.
  const { x, y } = shape.xfrm!;
  await act(async () => press(stage, 'ArrowRight'));
  expect(shape.xfrm!.x).toBe(x + 9525);
  await act(async () => press(stage, 'ArrowDown', { shiftKey: true }));
  expect(shape.xfrm!.y).toBe(y + 95250);

  // Ctrl+A selects every positioned shape; Escape deselects.
  await act(async () => press(stage, 'a', { ctrlKey: true }));
  expect(store.getState().selectedIds.length).toBe(
    slide.shapes.filter((sh) => sh.xfrm).length
  );
  await act(async () => press(stage, 'Escape'));
  expect(store.getState().selectedIds).toEqual([]);
});

it('tooltips carry the platform shortcut hints', async () => {
  mounted = await mountEditor(<><Toolbar /><SvgSlide /></>);
  const { host, store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  // jsdom is not a Mac platform, so hints render as Ctrl+.
  expect(host.querySelector('button[title="Bold (Ctrl+B)"]')).toBeTruthy();
  expect(host.querySelector('button[title="Italic (Ctrl+I)"]')).toBeTruthy();
  // The undo tooltip gains the hint once there is something to undo.
  const slide = store.getState().deck!.slides[0];
  const shape = slide.shapes.find((sh) => sh.xfrm)!;
  await act(async () =>
    store.executeCommand(
      {
        type: 'set-shape-geometries',
        slideId: slide.path,
        updates: [{ shapeId: shape.id, geometry: { x: shape.xfrm!.x + 9525 } }]
      },
      'Move shape'
    )
  );
  expect(
    host.querySelector('button[title="Undo Move shape (Ctrl+Z)"]')
  ).toBeTruthy();
});
