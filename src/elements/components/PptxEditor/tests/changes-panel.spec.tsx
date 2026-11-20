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

const addSlideAs = (
  mounted: Awaited<ReturnType<typeof mountEditor>>,
  origin: 'assistant' | 'editor'
) =>
  act(async () => {
    mounted.store.transaction({ origin }, () =>
      mounted.store.engine.execute({
        type: 'add-slide',
        atIndex: mounted.store.getState().deck!.slides.length
      })
    );
  });

it('removes a suggestion card once it is accepted', async () => {
  const mounted = await mountEditor(<PptxChangesPanel />);
  try {
    await act(async () => mounted.store.loadFile(sampleBytes(), 'sample.pptx'));
    await addSlideAs(mounted, 'assistant');
    const accept = [...mounted.host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Accept'
    )!;

    await act(async () => accept.click());

    expect(mounted.host.textContent).not.toContain('assistant');
    expect(mounted.host.textContent).toContain(
      'Edits you make will be tracked here.'
    );
  } finally {
    await mounted.unmount();
  }
});

it('removes a rejected card, and undo and redo bring it back and away', async () => {
  const mounted = await mountEditor(<PptxChangesPanel />);
  const clickButton = (label: string) =>
    act(async () =>
      [...mounted.host.querySelectorAll('button')]
        .find((button) => button.textContent === label)!
        .click()
    );
  const empty = 'Edits you make will be tracked here.';
  try {
    await act(async () => mounted.store.loadFile(sampleBytes(), 'sample.pptx'));
    for (const label of ['Reject', 'Accept']) {
      await addSlideAs(mounted, 'assistant');
      await clickButton(label);
      expect(mounted.host.textContent).toBe(empty);

      await act(async () => mounted.store.undo());
      expect(mounted.host.textContent).toContain('Accept');

      await act(async () => mounted.store.redo());
      expect(mounted.host.textContent).toBe(empty);
    }
  } finally {
    await mounted.unmount();
  }
});

it("keeps the user's own edits listed", async () => {
  const mounted = await mountEditor(<PptxChangesPanel />);
  try {
    await act(async () => mounted.store.loadFile(sampleBytes(), 'sample.pptx'));
    await addSlideAs(mounted, 'editor');

    expect(mounted.host.textContent).toContain('· user');
  } finally {
    await mounted.unmount();
  }
});
