import React from 'react';
import { SlideNavigator } from '../ui/SlideNavigator';
import { act, mountEditor, sampleBytes, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

async function mountNav(readOnly = false) {
  mounted = await mountEditor(<SlideNavigator readOnly={readOnly} />);
  await act(async () => mounted!.store.loadFile(sampleBytes(), 'sample.pptx'));
  return mounted;
}

const slideCount = (m: Mounted) => m.store.getState().deck!.slides.length;

it('adds a slide from the New slide button after the active slide', async () => {
  const { host, store } = await mountNav();
  const before = slideCount(mounted!);
  await act(async () => store.setActiveSlide(0));

  const add = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'New slide'
  ) as HTMLButtonElement;
  await act(async () => add.click());

  expect(slideCount(mounted!)).toBe(before + 1);
  // New slide is inserted at index 1 and becomes active.
  expect(store.getState().activeSlide).toBe(1);
});

it('duplicates and deletes via the thumbnail right-click menu (undoable)', async () => {
  const { host, store } = await mountNav();
  const before = slideCount(mounted!);
  const thumb = host.querySelector(
    'button[aria-label="Slide 1"]'
  ) as HTMLButtonElement;

  await act(async () =>
    thumb.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40
      })
    )
  );
  const duplicate = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === 'Duplicate slide'
  ) as HTMLButtonElement;
  await act(async () => duplicate.click());
  expect(slideCount(mounted!)).toBe(before + 1);

  await act(async () => store.undo());
  expect(slideCount(mounted!)).toBe(before);

  // Delete the first slide via the menu.
  await act(async () =>
    thumb.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40
      })
    )
  );
  const del = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent === 'Delete slide'
  ) as HTMLButtonElement;
  await act(async () => del.click());
  expect(slideCount(mounted!)).toBe(before - 1);

  await act(async () => store.undo());
  expect(slideCount(mounted!)).toBe(before);
});

it('hides slide-editing affordances in read-only mode', async () => {
  const { host } = await mountNav(true);
  const add = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'New slide'
  );
  expect(add).toBeUndefined();
});
