import React from 'react';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function mountWithShape() {
  mounted = await mountEditor(<SvgSlide />);
  const { store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  // Find a slide with at least two shapes so z-ordering is observable.
  const deck = store.getState().deck!;
  const slideIndex = deck.slides.findIndex((s) => s.shapes.length >= 2);
  await act(async () => store.setActiveSlide(slideIndex));
  return { ...mounted, deck, slideIndex };
}

const rightClick = (el: Element) =>
  act(async () =>
    el.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 120,
        clientY: 120
      })
    )
  );

it('opens a z-ordering menu on right-click and brings a shape to front', async () => {
  const { host, store, deck, slideIndex } = await mountWithShape();
  const slide = deck.slides[slideIndex];
  const firstId = slide.shapes[0].id;
  const node = host.querySelector(
    `[data-shape-id="${firstId}"]`
  ) as HTMLElement;
  expect(node).toBeTruthy();

  await rightClick(node);

  // The menu exposes the four z-order actions plus Delete.
  const labels = Array.from(host.querySelectorAll('button'))
    .map((b) => b.textContent)
    .filter((t) =>
      ['Bring to front', 'Bring forward', 'Send backward', 'Send to back'].includes(
        t || ''
      )
    );
  expect(labels).toEqual([
    'Bring to front',
    'Bring forward',
    'Send backward',
    'Send to back'
  ]);
  expect(store.getState().selectedId).toBe(firstId);

  const front = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === 'Bring to front'
  ) as HTMLButtonElement;
  await act(async () => front.click());

  // The shape is now last in paint order (front), and history recorded it.
  const shapes = store.getState().deck!.slides[slideIndex].shapes;
  expect(shapes[shapes.length - 1].id).toBe(firstId);
  expect(store.getState().undoStack.at(-1)?.label).toBe('Bring to front');
});

it('right-clicking empty space opens no menu', async () => {
  const { host } = await mountWithShape();
  const stage = host.querySelector('[data-pptx-stage]') as HTMLElement;
  await rightClick(stage);
  const hasMenu = Array.from(host.querySelectorAll('button')).some(
    (b) => b.textContent === 'Bring to front'
  );
  expect(hasMenu).toBe(false);
});
