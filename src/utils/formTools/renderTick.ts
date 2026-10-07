import internalState from '../internalState';
import { featheryWindow } from '../browser';

// A write through changeValue/fieldOnChange updates fieldValues (and thus
// Field.value) synchronously, but visibility (visiblePositions) and inline
// errors only reach internalState when <Form/>'s function body runs again -
// which a debounced rerender (hideIf rerenders, Field.ts's rule-triggered
// rerender) can trail by up to several hundred ms. <Form/> bumps
// formToolsRenderTick once per commit (see its useLayoutEffect) so callers
// here can wait for that specific commit instead of guessing how long it
// takes.
export const captureRenderTick = (formUuid: string): number =>
  internalState[formUuid]?.formToolsRenderTick ?? 0;

// Polls on a requestAnimationFrame + macrotask cadence - the same flush
// pattern used elsewhere in this codebase to wait for a real commit/paint in
// tests - rather than a fixed sleep, since the wait here can be anywhere
// from ~0ms (an immediate, non-debounced rerender) to several hundred ms (a
// debounced one). No cap: a commit that never lands is a real stall the
// caller should surface by hanging, not a timeout to paper over.
export const waitForNextCommit = (
  formUuid: string,
  sinceTick: number
): Promise<void> =>
  new Promise((resolve) => {
    const check = () => {
      if (captureRenderTick(formUuid) !== sinceTick) {
        resolve();
        return;
      }
      featheryWindow().requestAnimationFrame(() => setTimeout(check, 0));
    };
    check();
  });
