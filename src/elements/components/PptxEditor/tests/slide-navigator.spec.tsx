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

it('keeps the context menu open on a mousedown inside it (real click path)', async () => {
  const { host } = await mountNav();
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
  expect(duplicate).toBeTruthy();
  // A real click begins with mousedown bubbling to document; the menu must not
  // dismiss itself before the click lands on the item.
  await act(async () =>
    duplicate.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  );
  expect(
    Array.from(host.querySelectorAll('button')).some(
      (b) => b.textContent === 'Duplicate slide'
    )
  ).toBe(true);

  // A mousedown outside the menu closes it.
  await act(async () =>
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  );
  expect(
    Array.from(host.querySelectorAll('button')).some(
      (b) => b.textContent === 'Duplicate slide'
    )
  ).toBe(false);
});

it('reorders slides via drag and drop', async () => {
  const { host, store } = await mountNav();
  const deck = store.getState().deck!;
  const firstPath = deck.slides[0].path;
  const s1 = host.querySelector(
    'button[aria-label="Slide 1"]'
  ) as HTMLButtonElement;
  const s3 = host.querySelector(
    'button[aria-label="Slide 3"]'
  ) as HTMLButtonElement;

  const dt = {
    effectAllowed: '',
    dropEffect: '',
    setData: () => undefined,
    getData: () => '0'
  };
  const dragEvent = (type: string, clientY?: number) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'dataTransfer', { value: dt });
    if (clientY !== undefined)
      Object.defineProperty(e, 'clientY', { value: clientY });
    return e;
  };
  await act(async () => s1.dispatchEvent(dragEvent('dragstart')));
  // Drop below slide 3's vertical midpoint (large clientY forces the lower half).
  await act(async () => s3.dispatchEvent(dragEvent('dragover', 100000)));
  await act(async () => s3.dispatchEvent(dragEvent('drop')));

  // Dropped past slide 3 (index 2): slide 1 lands at index 2, no longer first.
  const after = store.getState().deck!.slides.map((s) => s.path);
  expect(after[0]).not.toBe(firstPath);
  expect(after[2]).toBe(firstPath);
});

it('hides slide-editing affordances in read-only mode', async () => {
  const { host } = await mountNav(true);
  const add = Array.from(host.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'New slide'
  );
  expect(add).toBeUndefined();
});
