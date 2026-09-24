import React from 'react';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, switchTab, type Mounted } from './harness';

let mounted: Mounted | null = null;
afterEach(async () => { await mounted?.unmount(); mounted = null; });

function accessibleName(el: Element): string {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    (el.textContent || '').trim()
  );
}

it('every toolbar control has a tooltip/accessible name; toggles expose pressed state', async () => {
  mounted = await mountEditor(<><Toolbar devJson /><SvgSlide /></>);
  const { host, store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));
  // Select a text shape so Home controls enable, then walk every tab.
  const slide = store.getState().deck!.slides[0];
  const text = slide.shapes.find((sh) => sh.text)!;
  await act(async () => store.select(text.id));

  for (const tab of ['Home', 'Insert', 'Slide'] as const) {
    await switchTab(host, tab);
    const controls = Array.from(
      host.querySelectorAll('button, select, input:not([type="file"])')
    );
    const unnamed = controls.filter((el) => !accessibleName(el));
    expect(unnamed.map((el) => `${tab}:${el.outerHTML.slice(0, 60)}`)).toEqual(
      []
    );
    // Buttons always carry an explicit tooltip (title), not just text.
    const untitled = Array.from(host.querySelectorAll('button')).filter(
      (el) => el.getAttribute('role') !== 'tab' && !el.getAttribute('title')
    );
    expect(
      untitled.map((el) => `${tab}:${el.outerHTML.slice(0, 60)}`)
    ).toEqual([]);
  }

  // Toggle state: Bold exposes aria-pressed and flips it.
  await switchTab(host, 'Home');
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

  // Tabs: role/aria-selected present, arrow key moves selection.
  const tablist = host.querySelector('[role="tablist"]') as HTMLElement;
  const homeTab = Array.from(
    tablist.querySelectorAll('[role="tab"]')
  ).find((el) => el.textContent === 'Home') as HTMLButtonElement;
  expect(homeTab.getAttribute('aria-selected')).toBe('true');
  await act(async () => {
    homeTab.focus();
    tablist.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
    );
  });
  const insertTab = Array.from(
    host.querySelectorAll('[role="tab"]')
  ).find((el) => el.textContent === 'Insert') as HTMLButtonElement;
  expect(insertTab.getAttribute('aria-selected')).toBe('true');
});
