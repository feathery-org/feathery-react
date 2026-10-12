import internalState, { FormToolsCallbacks } from '../internalState';
import { featheryWindow } from '../browser';

// A write updates Field.value synchronously, but visibility and inline errors
// only reach internalState when <Form/> re-renders, which a debounced rerender
// can trail by several hundred ms. <Form/> bumps formToolsRenderTick per
// commit so callers can wait for that commit.
export const captureRenderTick = (formUuid: string): number =>
  internalState[formUuid]?.formToolsRenderTick ?? 0;

// No cap: a commit that never lands is a real stall to surface, not hide
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

// Waits for the change rules, then the write's own re-render (only if it
// changed the value) and any rerender the rules owe. Still waits when a rule
// rejected, so the next field reads the current step. Returns the
// rejection's message, or undefined when every rule ran.
export const settleWrite = async (
  formUuid: string,
  callbacks: FormToolsCallbacks,
  tickBeforeWrite: number,
  changed: boolean
): Promise<string | undefined> => {
  let ruleFailure: string | undefined;
  try {
    await callbacks.awaitChangeRules();
  } catch (e: any) {
    ruleFailure = e?.message ?? '';
  }
  if (changed) await waitForNextCommit(formUuid, tickBeforeWrite);
  callbacks.flushRerender();
  if (internalState[formUuid].formToolsRenderOwed)
    await waitForNextCommit(formUuid, captureRenderTick(formUuid));
  return ruleFailure;
};
