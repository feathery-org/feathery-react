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

  // Every rendered toolbar button must be explicitly type=button, including
  // the buttons inside the Insert and Slide dropdown menus.
  await openMenu(host, 'Insert');
  await openMenu(host, 'Slide');
  const untyped = Array.from(host.querySelectorAll('button')).filter(
    (button) => button.type !== 'button'
  );
  expect(untyped.map((b) => b.title || b.textContent)).toEqual([]);

  // Enter inside a toolbar input must not reach the form as a submit.
  const sizeInput = host.querySelector(
    'input[title="Size"]'
  ) as HTMLInputElement;
  await act(async () => {
    sizeInput.focus();
    sizeInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
    );
  });

  expect(submits).toHaveLength(0);
});
