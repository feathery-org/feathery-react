import { createPptxEditorStore } from '../state/PptxEditorStore';
import { savePresentation } from '../persistence';
import { sampleBytes } from './harness';

it('only marks the deck saved after all edits made during a request have persisted', async () => {
  const store = createPptxEditorStore();
  store.loadFile(sampleBytes(), 'sample.pptx');
  store.addSlide(1);
  let finish!: () => void;
  const save = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    )
    .mockResolvedValue(undefined);
  const pending = savePresentation(store, save);
  expect(store.engine.isDirty()).toBe(true);
  store.addSlide(1);
  finish();
  await pending;
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0][0]).toBeInstanceOf(Blob);
  expect(store.engine.isDirty()).toBe(false);
});

it('propagates failed writes without clearing dirty state and permits a successful retry', async () => {
  const store = createPptxEditorStore();
  store.loadFile(sampleBytes(), 'sample.pptx');
  store.addSlide(1);
  await expect(
    savePresentation(store, async () => {
      throw new Error('Offline');
    })
  ).rejects.toThrow('Offline');
  expect(store.engine.isDirty()).toBe(true);
  await savePresentation(store, async () => undefined);
  expect(store.engine.isDirty()).toBe(false);
});

it('flushes the active text edit before export and catches edits committed while saving', async () => {
  const store = createPptxEditorStore();
  store.loadFile(sampleBytes(), 'sample.pptx');
  store.commitSvgTextEdit = jest
    .fn()
    .mockImplementationOnce(() => store.addSlide(1))
    .mockImplementationOnce(() => store.addSlide(1));
  const save = jest.fn().mockResolvedValue(undefined);
  await savePresentation(store, save);
  expect(save).toHaveBeenCalledTimes(2);
  expect(store.engine.isDirty()).toBe(false);
});
