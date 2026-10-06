import internalState from '../internalState';
import { initState } from '../init';
import { getRepeatedContainer } from '../repeat';
import { getPositionKey } from '../hideAndRepeats';
import { isButtonDisabled } from '../button';
import { findClickableAncestorSubgrids } from '../panelRuntime';
import {
  awaitPendingInlineErrors,
  diffInlineErrorSnapshots,
  getLiveStepKey,
  InlineErrorReport,
  NOT_LOADED_MESSAGE,
  snapshotInlineErrors,
  validateRepeatIndex
} from './utils';

export type ClickElementResult =
  | {
      ok: true;
      navigated: { fromStepKey: string; toStepKey: string } | null;
      buttonError?: string;
      fieldErrors?: InlineErrorReport[];
    }
  | {
      ok: false;
      reason:
        | 'not_loaded'
        | 'invalid_input'
        | 'not_on_step'
        | 'hidden'
        | 'disabled'
        | 'invalid_row'
        | 'action_failed';
      message: string;
    };

type ElementType = 'button' | 'text' | 'container';

type FoundElement = {
  element: any;
  elementType: ElementType;
  actions: any[];
  position: number[];
};

const findElement = (step: any, elementId: string): FoundElement | null => {
  const sources: Array<[any[] | undefined, ElementType]> = [
    [step.buttons, 'button'],
    [step.texts, 'text'],
    [step.subgrids, 'container']
  ];
  for (const [list, elementType] of sources) {
    const el = (list ?? []).find((e: any) => e?.id === elementId);
    if (!el) continue;
    const actions = el?.properties?.actions;
    return {
      element: el,
      elementType,
      actions: Array.isArray(actions) ? actions : [],
      position: Array.isArray(el.position) ? el.position : []
    };
  }
  return null;
};

export async function clickElement(
  formUuid: string,
  elementId: string,
  repeatIndex?: number
): Promise<ClickElementResult> {
  const state = internalState[formUuid];
  const handlers = state?.formActions;
  if (!state?.currentStep || !handlers) {
    return { ok: false, reason: 'not_loaded', message: NOT_LOADED_MESSAGE };
  }
  if (typeof elementId !== 'string' || elementId.length === 0) {
    return {
      ok: false,
      reason: 'invalid_input',
      message: 'elementId is required.'
    };
  }

  const found = findElement(state.currentStep, elementId);
  if (!found) {
    return {
      ok: false,
      reason: 'not_on_step',
      message: `Element '${elementId}' is not on the current step.`
    };
  }
  const visiblePositions = state.visiblePositions ?? {};
  const flags = visiblePositions[getPositionKey(found.element) ?? 'root'];
  if (Array.isArray(flags) && !flags.some(Boolean)) {
    return {
      ok: false,
      reason: 'hidden',
      message: `Element '${elementId}' is on the current step but is hidden right now.`
    };
  }
  if (found.elementType === 'button') {
    const formReadOnly = !!(
      state.formSettings?.readOnly ||
      initState.collaboratorReview === 'readOnly'
    );
    if (
      isButtonDisabled(
        found.element,
        state.currentStep,
        visiblePositions,
        formReadOnly
      )
    ) {
      return {
        ok: false,
        reason: 'disabled',
        message: `Button '${elementId}' is disabled and cannot be clicked.`
      };
    }
  }
  // A repeated subgrid is its own repeat container, one clickable instance per row
  const repeatContainer = found.element.repeated
    ? found.element
    : getRepeatedContainer(state.currentStep, found.element);
  const rowCount = repeatContainer
    ? (visiblePositions[getPositionKey(repeatContainer) ?? 'root'] ?? []).length
    : 0;
  const repeatFailure = validateRepeatIndex(
    repeatIndex,
    !!repeatContainer,
    rowCount,
    elementId
  );
  if (repeatFailure) {
    return { ok: false, reason: 'invalid_row', message: repeatFailure };
  }
  if (
    typeof repeatIndex === 'number' &&
    Array.isArray(flags) &&
    !flags[repeatIndex]
  ) {
    return {
      ok: false,
      reason: 'hidden',
      message: `Row ${repeatIndex} of element '${elementId}' is hidden right now.`
    };
  }

  const fromStepKey = getLiveStepKey(state) ?? '';
  const errorsBefore = snapshotInlineErrors(state);
  const elementForDispatch =
    typeof repeatIndex === 'number'
      ? { ...found.element, repeat: repeatIndex }
      : found.element;

  try {
    if (found.elementType === 'button') {
      await handlers.buttonOnClick(elementForDispatch);
    } else {
      // Capture ancestors before the child's action runs, it may navigate
      const ancestors = findClickableAncestorSubgrids(
        state.currentStep.subgrids,
        found.position
      );
      await handlers.runElementActions({
        actions: found.actions,
        element: elementForDispatch,
        elementType: found.elementType
      });
      for (const sg of ancestors) {
        const acts = sg?.properties?.actions;
        // Only ancestors inside the repeated container act on the targeted row
        const insideRepeat =
          typeof repeatIndex === 'number' &&
          !!repeatContainer &&
          sg.position.length >= repeatContainer.position.length;
        await handlers.runElementActions({
          actions: Array.isArray(acts) ? acts : [],
          element: insideRepeat ? { ...sg, repeat: repeatIndex } : sg,
          elementType: 'container'
        });
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'action_failed',
      message: err instanceof Error ? err.message : String(err)
    };
  }

  const toStepKey = getLiveStepKey(state) ?? fromStepKey;
  await awaitPendingInlineErrors(state);
  const newErrors = diffInlineErrorSnapshots(
    errorsBefore,
    snapshotInlineErrors(state)
  );
  // A button's own submit error is keyed by its id on the clicked row
  const isOwnError = (e: InlineErrorReport) =>
    found.elementType === 'button' &&
    e.key === elementId &&
    (e.repeatIndex === undefined || e.repeatIndex === repeatIndex);
  const buttonError = newErrors.find(isOwnError)?.message;
  const fieldErrors = newErrors.filter((e) => !isOwnError(e));

  return {
    ok: true,
    navigated: toStepKey !== fromStepKey ? { fromStepKey, toStepKey } : null,
    ...(buttonError ? { buttonError } : {}),
    ...(fieldErrors.length > 0 ? { fieldErrors } : {})
  };
}
