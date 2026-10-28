import React, { useState } from 'react';
import {
  fitSlideZoom,
  SvgSlide,
  ZOOM_MAX,
  ZOOM_MIN
} from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

// Trackpad pinch arrives as ctrlKey+wheel; Ctrl/Cmd+scroll zoom the stage,
// plain scrolling must not.
function ZoomHost({ initialZoom = 75 }: { initialZoom?: number }) {
  const [zoom, setZoom] = useState(initialZoom);
  return (
    <>
      <span data-zoom-label>{zoom}%</span>
      <SvgSlide zoom={zoom} onZoomChange={setZoom} />
    </>
  );
}

function FitHost() {
  const [zoom, setZoom] = useState(100);
  return (
    <>
      <span data-zoom-label>{zoom}%</span>
      <SvgSlide zoom={zoom} fitToContainer onFitZoomChange={setZoom} />
    </>
  );
}

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

const wheel = (el: Element, init: WheelEventInit) =>
  act(async () => {
    el.dispatchEvent(
      new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
    );
  });

const zoomOf = (host: HTMLElement) =>
  Number(
    host.querySelector('[data-zoom-label]')?.textContent?.replace('%', '')
  );

async function mountStage(initialZoom = 75) {
  mounted = await mountEditor(<ZoomHost initialZoom={initialZoom} />);
  const { host, store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  return {
    host,
    stage: host.querySelector('[data-pptx-stage]') as HTMLElement
  };
}

it('zooms with ctrl/cmd+wheel and ignores plain scrolling', async () => {
  const { host, stage } = await mountStage();
  expect(stage).toBeTruthy();
  expect(zoomOf(host)).toBe(75);

  await wheel(stage, { deltaY: 300 }); // plain scroll: no zoom
  expect(zoomOf(host)).toBe(75);

  await wheel(stage, { deltaY: -100, ctrlKey: true }); // pinch out
  const zoomedIn = zoomOf(host);
  expect(zoomedIn).toBeGreaterThan(75);

  await wheel(stage, { deltaY: 100, metaKey: true }); // cmd+scroll down
  expect(zoomOf(host)).toBeLessThan(zoomedIn);
});

it('clamps wheel zoom to the bounds', async () => {
  const { host, stage } = await mountStage();
  for (let i = 0; i < 60; i++)
    await wheel(stage, { deltaY: -100, ctrlKey: true });
  expect(zoomOf(host)).toBe(ZOOM_MAX);
  for (let i = 0; i < 120; i++)
    await wheel(stage, { deltaY: 100, ctrlKey: true });
  expect(zoomOf(host)).toBe(ZOOM_MIN);
});

it('zooms out from a fitted value below 50% without jumping up', async () => {
  const fitted = fitSlideZoom(800, 180, 16, 9);
  if (fitted === null) throw new Error('Expected a valid fit zoom');
  const { host, stage } = await mountStage(fitted);
  expect(fitted).toBeLessThan(50);
  expect(fitted).toBeGreaterThan(ZOOM_MIN);
  await wheel(stage, { deltaY: 100, ctrlKey: true });
  expect(zoomOf(host)).toBeLessThan(fitted);
  expect(zoomOf(host)).toBeGreaterThanOrEqual(ZOOM_MIN);
});

it('uses the same lower bound for fitting and manual zoom', () => {
  expect(fitSlideZoom(800, 33, 16, 9)).toBe(ZOOM_MIN);
});

it('fits a wide slide by both the stage width and height, including padding', () => {
  expect(fitSlideZoom(800, 300, 16, 9)).toBe(62);
  expect(fitSlideZoom(800, 180, 16, 9)).toBe(34);
  expect(fitSlideZoom(800, 700, 16, 9)).toBe(100);
  expect(fitSlideZoom(0, 300, 16, 9)).toBeNull();
});

it('refits the loaded slide when its host changes size', async () => {
  const originalObserver = global.ResizeObserver;
  const widthDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientWidth'
  );
  const heightDescriptor = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight'
  );
  let resize: ResizeObserverCallback = () => undefined;
  let stageHeight = 300;
  global.ResizeObserver = class {
    constructor(callback: ResizeObserverCallback) {
      resize = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.hasAttribute('data-pptx-stage') ? 800 : 0;
    }
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return this.hasAttribute('data-pptx-stage') ? stageHeight : 0;
    }
  });
  try {
    mounted = await mountEditor(<FitHost />);
    await act(async () => mounted?.store.loadFile(sampleBytes(), 'sample.pptx'));
    await act(async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    const deck = mounted.store.getState().deck;
    if (!deck) throw new Error('Presentation did not load');
    const { cx, cy } = deck.size;
    expect(zoomOf(mounted.host)).toBe(fitSlideZoom(800, 300, cx, cy));

    stageHeight = 700;
    await act(async () => resize([], {} as ResizeObserver));
    await act(async () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    );
    expect(zoomOf(mounted.host)).toBe(fitSlideZoom(800, 700, cx, cy));
  } finally {
    global.ResizeObserver = originalObserver;
    if (widthDescriptor)
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
    if (heightDescriptor)
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDescriptor);
  }
});
