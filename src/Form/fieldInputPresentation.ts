import { INTERACTION_EVENT_TYPES } from '../utils/interactionState';
import { markInteraction } from '../utils/formActions/utils';
import type { CheckboxRenderer } from '../elements/fields/CheckboxGroupField';

export type FieldInputOptions = {
  renderCheckbox?: CheckboxRenderer;
};

type FieldInputMount = {
  formId: string;
  key: string;
  repeatIndex: number;
  container: HTMLElement;
  flushChange?: () => void;
  options?: FieldInputOptions;
};

const mounts = new Map<string, FieldInputMount>();
const listeners = new Map<string, Set<() => void>>();
const targetKey = (formId: string, key: string, repeatIndex = 0) =>
  JSON.stringify([formId, key, repeatIndex]);

export function presentedFieldInputs(formId: string) {
  return [...mounts.values()]
    .filter((mount) => mount.formId === formId)
    .map(({ key, repeatIndex }) => ({ key, repeatIndex }));
}

export function fieldInputContainer(
  formId: string,
  key: string,
  repeatIndex = 0
) {
  return mounts.get(targetKey(formId, key, repeatIndex))?.container ?? null;
}

export function fieldInputCheckboxRenderer(
  formId: string,
  key: string,
  repeatIndex = 0
) {
  return mounts.get(targetKey(formId, key, repeatIndex))?.options
    ?.renderCheckbox;
}

export function registerFieldInputChange(
  formId: string,
  key: string,
  repeatIndex: number,
  flushChange: () => void
) {
  const mount = mounts.get(targetKey(formId, key, repeatIndex));
  if (!mount) return () => {};
  mount.flushChange = flushChange;
  return () => {
    if (mount.flushChange === flushChange) delete mount.flushChange;
  };
}

export function flushFieldInputChanges(
  formId: string,
  targets: readonly { key: string; repeatIndex?: number }[]
) {
  const pending = targets.map(
    (target) =>
      mounts.get(targetKey(formId, target.key, target.repeatIndex))?.flushChange
  );
  if (pending.some((flushChange) => !flushChange))
    throw new Error('This question is still loading. Please try again.');
  pending.forEach((flushChange) => flushChange?.());
}

export function subscribeFieldInput(
  formId: string,
  key: string,
  repeatIndex: number,
  listener: () => void
) {
  const target = targetKey(formId, key, repeatIndex);
  const subscribers = listeners.get(target) ?? new Set();
  listeners.set(target, subscribers);
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (subscribers.size === 0) listeners.delete(target);
  };
}

export function mountFieldInput(
  formId: string,
  key: string,
  repeatIndex: number,
  container: HTMLElement,
  options?: FieldInputOptions
) {
  const target = targetKey(formId, key, repeatIndex);
  if (mounts.has(target))
    throw new Error('This field is already open in another input card.');
  const mount = { formId, key, repeatIndex, container, options };
  const onInteraction = () => markInteraction();
  INTERACTION_EVENT_TYPES.forEach((event) =>
    container.addEventListener(event, onInteraction, true)
  );
  const notify = () => listeners.get(target)?.forEach((listener) => listener());
  const release = () => {
    if (mounts.get(target) !== mount) return;
    INTERACTION_EVENT_TYPES.forEach((event) =>
      container.removeEventListener(event, onInteraction, true)
    );
    mounts.delete(target);
    notify();
  };
  mounts.set(target, mount);
  notify();
  return release;
}
