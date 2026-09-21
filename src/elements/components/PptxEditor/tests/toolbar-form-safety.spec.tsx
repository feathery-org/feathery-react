import React from 'react';
import { Toolbar } from '../ui/PptxToolbar';
import { SvgSlide } from '../ui/SlideStage';
import { act, mountEditor, sampleBytes, switchTab, type Mounted } from './harness';

let mounted: Mounted | null = null;

afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
});

// The editor renders inside the hosted form's <form>: an untyped button
// defaults to type=submit, and Enter in an input triggers implicit submit -
// both reload the page. Guard the whole toolbar against that class of bug.
it('never submits a wrapping form from toolbar buttons or inputs', async () => {
  mounted = await mountEditor(
    <form data-testid='host-form'>
      <Toolbar devJson />
      <SvgSlide />
    </form>
  );
  const { host, store } = mounted;
  await act(async () => store.loadFile(sampleBytes(), 'sample.pptx'));

  const form = host.querySelector('form') as HTMLFormElement;
  const submits: Event[] = [];
  form.addEventListener('submit', (e) => {
    submits.push(e);
    e.preventDefault();
  });

  // Every rendered toolbar button must be explicitly type=button, on every tab.
  for (const tab of ['Home', 'Insert', 'Slide', 'Arrange'] as const) {
    await switchTab(host, tab);
    const untyped = Array.from(host.querySelectorAll('button')).filter(
      (button) => button.type !== 'button'
    );
    expect(untyped.map((b) => `${tab}:${b.title || b.textContent}`)).toEqual(
      []
    );
  }

  // Enter inside a toolbar input must not reach the form as a submit.
  await switchTab(host, 'Slide');
  const width = host.querySelector(
    'input[title="Slide width (inches)"]'
  ) as HTMLInputElement;
  await act(async () => {
    width.focus();
    width.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
  });

  expect(submits).toHaveLength(0);
});
