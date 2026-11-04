import React, { useState } from 'react';
import { SvgSlide, ZOOM_MAX, ZOOM_MIN } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

// Trackpad pinch arrives as ctrlKey+wheel; Ctrl/Cmd+scroll zoom the stage,
// plain scrolling must not.
function ZoomHost() {
  const [zoom, setZoom] = useState(75);
  return (
    <>
      <span data-zoom-label>{zoom}%</span>
      <SvgSlide zoom={zoom} onZoomChange={setZoom} />
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

async function mountStage() {
  mounted = await mountEditor(<ZoomHost />);
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
