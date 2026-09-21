/* eslint-disable no-restricted-globals -- jsdom test */
import React from 'react';
import {
  addTextBox,
  insertImage,
  readPictureCrop,
  setPictureCrop
} from '../core/model/edit';
import { deepClone } from '../core/opc/deepClone';
import type { Deck, Shape, Slide } from '../core/model/types';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted, switchTab } from './harness';


const PNG_DATA =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = Uint8Array.from(Buffer.from(PNG_DATA.split(',')[1], 'base64'));

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

// The Escape handler that leaves crop mode listens on the stage host element
// (not window), so keyboard events are dispatched there.
const stageHost = () =>
  mounted!.host.querySelector('div[tabindex="-1"]') as HTMLDivElement;

it('crops a picture directly on the slide with live handles, pan, Done, and double-click entry', async () => {
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
  let deck!: Deck;
  let slide!: Slide;
  let picture!: Shape;
  let originalFrame!: { x: number; y: number; cx: number; cy: number };
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    deck = store.getState().deck!;
    slide = deck.slides[0];
    picture = insertImage(
      deck,
      slide,
      PNG,
      'png',
      100000,
      100000,
      1200000,
      800000
    );
    picture.imageSrc = PNG_DATA;
    originalFrame = { ...picture.xfrm! };
    setPictureCrop(deck, slide, picture, {
      clipGeometry: 'rect',
      cropPct: { left: 10, top: 10, right: 10, bottom: 10 }
    });
    store.resetHistory();
  });
  await act(async () => store.select(picture.id));

  const svg = host.querySelector('svg[data-svg-uid]');
  await switchTab(host, 'Arrange');
  await act(async () =>
    (
      host.querySelector(
        'button[title="Crop picture on slide"]'
      ) as HTMLButtonElement
    ).click()
  );
  expect(store.getState().pictureCropModeId).toBe(picture.id);
  expect(host.querySelector('[data-picture-crop-preview]')).toBeTruthy();
  expect(host.querySelectorAll('[data-picture-crop-handle]')).toHaveLength(8);
  expect(
    parseFloat(
      (
        host.querySelector(
          '[data-picture-crop-preview] img'
        ) as HTMLImageElement
      ).style.left
    )
  ).toBeCloseTo(-12.5);

  const frameLeft = parseFloat(
    (host.querySelector('[data-picture-crop-frame]') as HTMLDivElement).style
      .left
  );
  const leftHandle = host.querySelector(
    '[data-picture-crop-handle="w"]'
  ) as HTMLDivElement;
  await act(async () =>
    leftHandle.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 110, clientY: 100 })
    )
  );
  expect(
    parseFloat(
      (host.querySelector('[data-picture-crop-frame]') as HTMLDivElement).style
        .left
    )
  ).toBeGreaterThan(frameLeft);
  expect(
    Number(
      host
        .querySelector(`[data-shape-id="${picture.id}"] image`)
        ?.getAttribute('x')
    )
  ).toBeLessThan(0);
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 110, clientY: 100 })
    )
  );
  const afterResize = readPictureCrop(picture).cropPct;
  expect(afterResize.left).toBeGreaterThan(17);
  expect(afterResize.right).toBe(10);
  expect(picture.xfrm!.x).toBeGreaterThan(100000);
  expect(picture.xfrm!.cx).toBeLessThan(1200000);
  const resizedVisibleW = 1 - afterResize.left / 100 - afterResize.right / 100;
  expect(picture.xfrm!.cx / resizedVisibleW).toBeCloseTo(
    originalFrame.cx / 0.8,
    3
  );
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(store.getState().undoStack[0]?.label).toBe('Crop picture');

  const resizedFrame = { ...picture.xfrm! };
  const cropRegion = host.querySelector(
    '[data-picture-crop-region]'
  ) as HTMLDivElement;
  await act(async () =>
    cropRegion.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 110, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 115, clientY: 105 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 115, clientY: 105 })
    )
  );
  const afterMove = readPictureCrop(picture).cropPct;
  expect(afterMove.left).toBeLessThan(afterResize.left);
  expect(afterMove.right).toBeGreaterThan(afterResize.right);
  expect(afterMove.top).toBeLessThan(10);
  expect(afterMove.bottom).toBeGreaterThan(10);
  expect(picture.xfrm).toEqual(resizedFrame);
  expect(store.getState().undoStack).toHaveLength(2);

  await switchTab(host, 'Arrange');
  const cropShape = host.querySelector(
    'select[title="Crop shape"]'
  ) as HTMLSelectElement;
  await act(async () => {
    cropShape.value = 'ellipse';
    cropShape.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(
    (host.querySelector('[data-picture-crop-region]') as HTMLDivElement).style
      .borderRadius
  ).toBe('50%');
  expect(store.getState().undoStack).toHaveLength(3);

  await act(async () =>
    (
      host.querySelector(
        'button[title="Finish cropping picture"]'
      ) as HTMLButtonElement
    ).click()
  );
  expect(host.querySelector('[data-picture-crop-preview]')).toBeNull();
  const image = host.querySelector(`[data-shape-id="${picture.id}"] image`)!;
  const clipId = image.parentElement
    ?.getAttribute('clip-path')
    ?.match(/#([^)]*)/)?.[1];
  expect(clipId).toBeTruthy();
  expect(host.querySelectorAll(`clipPath[id="${clipId}"]`)).toHaveLength(1);
  expect(host.querySelector(`clipPath[id="${clipId}"] ellipse`)).toBeTruthy();
  const visibleW = 1 - afterMove.left / 100 - afterMove.right / 100;
  const visibleH = 1 - afterMove.top / 100 - afterMove.bottom / 100;
  expect(Number(image.getAttribute('x'))).toBeCloseTo(
    (-picture.xfrm!.cx * (afterMove.left / 100)) / visibleW,
    3
  );
  expect(Number(image.getAttribute('y'))).toBeCloseTo(
    (-picture.xfrm!.cy * (afterMove.top / 100)) / visibleH,
    3
  );
  expect(Number(image.getAttribute('width'))).toBeCloseTo(
    picture.xfrm!.cx / visibleW,
    3
  );
  expect(Number(image.getAttribute('height'))).toBeCloseTo(
    picture.xfrm!.cy / visibleH,
    3
  );
  await act(async () =>
    image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  );
  expect(store.getState().pictureCropModeId).toBe(picture.id);
  await act(async () =>
    stageHost().dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true
      })
    )
  );
  expect(store.getState().pictureCropModeId).toBeNull();
});

it('repositions an uncropped picture instead of clamping the drag to a no-op', async () => {
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
  let picture!: Shape;
  let originalFrame!: { x: number; y: number; cx: number; cy: number };
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    const deck = store.getState().deck!;
    const slide = deck.slides[0];
    picture = insertImage(
      deck,
      slide,
      PNG,
      'png',
      100000,
      100000,
      1200000,
      800000
    );
    picture.imageSrc = PNG_DATA;
    originalFrame = { ...picture.xfrm! };
    store.resetHistory();
  });
  await act(async () => store.select(picture.id));
  await switchTab(host, 'Arrange');
  await act(async () =>
    (
      host.querySelector(
        'button[title="Crop picture on slide"]'
      ) as HTMLButtonElement
    ).click()
  );

  const region = host.querySelector(
    '[data-picture-crop-region]'
  ) as HTMLDivElement;
  await act(async () =>
    region.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 112, clientY: 108 })
    )
  );
  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 112, clientY: 108 })
    )
  );

  const crop = readPictureCrop(picture).cropPct;
  expect(crop.left + crop.right).toBeGreaterThan(0);
  expect(crop.top + crop.bottom).toBeGreaterThan(0);
  expect(crop.left).not.toBe(crop.right);
  expect(crop.top).not.toBe(crop.bottom);
  const visibleW = 1 - crop.left / 100 - crop.right / 100;
  const visibleH = 1 - crop.top / 100 - crop.bottom / 100;
  expect(picture.xfrm!.cx / visibleW).toBeCloseTo(originalFrame.cx, 3);
  expect(picture.xfrm!.cy / visibleH).toBeCloseTo(originalFrame.cy, 3);
});

it('previews shape movement without history and commits once on mouseup', async () => {
  jest
    .spyOn(SVGSVGElement.prototype, 'getBoundingClientRect')
    .mockReturnValue(STAGE_RECT);
  mounted = await mountEditor(<SvgSlide />);
  const store = mounted.store;
  const host = mounted.host;
  let shape!: Shape;
  let before!: { x: number; y: number; cx: number; cy: number };
  await act(async () => {
    store.loadFile(sampleBytes(), 'sample.pptx');
    const deck = store.getState().deck!;
    const slide = deck.slides[0];
    shape = addTextBox(deck, slide, 100000, 100000, 1200000, 800000, 'Move me');
    before = { ...shape.xfrm! };
    store.resetHistory();
  });
  await act(async () => store.select(shape.id));
  const svg = host.querySelector('svg[data-svg-uid]');
  const group = host.querySelector(
    `[data-shape-id="${shape.id}"]`
  ) as SVGGElement;

  await act(async () =>
    group.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, clientX: 100, clientY: 100 })
    )
  );
  await act(async () => {
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 110, clientY: 108 })
    );
    window.dispatchEvent(
      new MouseEvent('mousemove', { clientX: 125, clientY: 118 })
    );
  });
  expect(shape.xfrm).toMatchObject(before);
  expect(store.getState().undoStack).toHaveLength(0);

  await act(async () =>
    window.dispatchEvent(
      new MouseEvent('mouseup', { clientX: 125, clientY: 118 })
    )
  );
  expect(shape.xfrm!.x).not.toBe(before.x);
  expect(shape.xfrm!.y).not.toBe(before.y);
  expect(store.getState().undoStack).toHaveLength(1);
  expect(store.getState().undoStack[0]?.label).toBe('Move shape');
  expect(host.querySelector('svg[data-svg-uid]')).toBe(svg);
  expect(host.querySelector(`[data-shape-id="${shape.id}"]`)).toBe(group);
});
