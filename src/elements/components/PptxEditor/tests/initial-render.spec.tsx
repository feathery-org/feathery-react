import React from 'react';
import { SlideNavigator } from '../ui/SlideNavigator';
import { act, mountEditor, fixtureBytes } from './harness';

it('keeps every slide navigable without constructing every thumbnail on first render', async () => {
  jest.useFakeTimers();
  const mounted = await mountEditor(<SlideNavigator />);
  try {
    await act(async () =>
      mounted.store.loadFile(fixtureBytes('large-deck.pptx'), 'large.pptx')
    );
    expect(
      mounted.host.querySelectorAll('button[aria-label^="Slide "]')
    ).toHaveLength(60);
    expect(
      mounted.host.querySelectorAll('button[aria-label^="Slide "] svg').length
    ).toBeLessThanOrEqual(5);
    await act(async () => jest.runAllTimers());
    expect(
      mounted.host.querySelectorAll('button[aria-label^="Slide "] svg').length
    ).toBeLessThanOrEqual(5);
    await act(async () => mounted.store.setActiveSlide(40));
    await act(async () => jest.runAllTimers());
    expect(
      mounted.host.querySelector('button[aria-label="Slide 41"] svg')
    ).not.toBeNull();
    expect(mounted.store.getState().activeSlide).toBe(40);
  } finally {
    await mounted.unmount();
    jest.useRealTimers();
  }
});
