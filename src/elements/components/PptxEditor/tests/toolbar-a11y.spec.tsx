import React from 'react';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import {
  act,
  mountEditor,
  openMenu,
  sampleBytes,
  type Mounted
} from './harness';

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

function accessibleName(el: Element): string {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    (el.textContent || '').trim()
  );
}

it('every toolbar control has a tooltip/accessible name; toggles expose pressed state', async () => {
  mounted = await mountEditor(
    <>
      <Toolbar devJson />
      <SvgSlide />
    </>
  );
  const { host, store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  // Select a text shape so Home controls enable, then walk every tab.
  const slide = store.getState().deck!.slides[0];
  const text = slide.shapes.find((sh) => sh.text)!;
  await act(async () => store.select(text.id));

  // Walk the persistent row plus both dropdown menus.
  await openMenu(host, 'Insert');
  await openMenu(host, 'Slide');
  const controls = Array.from(
    host.querySelectorAll('button, select, input:not([type="file"])')
  );
  const unnamed = controls.filter((el) => !accessibleName(el));
  expect(unnamed.map((el) => el.outerHTML.slice(0, 60))).toEqual([]);
  // Buttons carry an explicit tooltip (title) unless they are menu rows or
  // the table-size grid cells, whose aria-labels are the accessible name.
  const untitled = Array.from(host.querySelectorAll('button')).filter(
    (el) =>
      !el.getAttribute('title') &&
      !el.getAttribute('aria-label') &&
      !el.closest('[role="group"]')
  );
  expect(untitled.map((el) => el.outerHTML.slice(0, 60))).toEqual([]);

  // Toggle state: Bold exposes aria-pressed and flips it.
  const bold = host.querySelector('button[title^="Bold"]') as HTMLButtonElement;
  const before = bold.getAttribute('aria-pressed');
  await act(async () => bold.click());
  const boldAfter = host.querySelector(
    'button[title^="Bold"]'
  ) as HTMLButtonElement;
  expect(boldAfter.getAttribute('aria-pressed')).not.toBe(before);
  expect(['true', 'false']).toContain(
    boldAfter.getAttribute('aria-pressed') || ''
  );

  // Menus: buttons expose aria-haspopup/aria-expanded and Escape closes.
  const insertBtn = host.querySelector(
    'button[title="Insert"]'
  ) as HTMLButtonElement;
  expect(insertBtn.getAttribute('aria-haspopup')).toBe('true');
  expect(insertBtn.getAttribute('aria-expanded')).toBe('true');
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  expect(
    (
      host.querySelector('button[title="Insert"]') as HTMLButtonElement
    ).getAttribute('aria-expanded')
  ).toBe('false');
});
