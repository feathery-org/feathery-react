import React from 'react';
import PptxChangesPanel from '../ui/PptxChangesPanel';
import { act, mountEditor, sampleBytes } from './harness';

it('lists an added slide under that slide, not the first one', async () => {
  const mounted = await mountEditor(<PptxChangesPanel />);
  try {
    await act(async () => mounted.store.loadFile(sampleBytes(), 'sample.pptx'));
    const count = mounted.store.getState().deck!.slides.length;
    await act(async () => {
      mounted.store.transaction({ origin: 'assistant' }, () =>
        mounted.store.engine.execute({ type: 'add-slide', atIndex: count })
      );
    });

    expect(mounted.host.textContent).toContain(
      `Slide ${count + 1} · assistant`
    );
  } finally {
    await mounted.unmount();
  }
});
