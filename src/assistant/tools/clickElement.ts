import internalState from '../../utils/internalState';
import { initState } from '../../utils/init';
import { getRepeatedContainer } from '../../utils/repeat';
import { getPositionKey } from '../../utils/hideAndRepeats';
import { isButtonDisabled } from '../../utils/button';
import {
  findClickableAncestorSubgrids,
  snapshotInlineErrors,
  validateRepeatIndex
} from './utils';

type ClickErrorType =
  | 'not_on_step'
  | 'hidden'
  | 'disabled'
  | 'no_form_state'
  | 'shape_mismatch'
  | 'repeated_index_missing'
  | 'repeated_index_out_of_range'
  | 'repeated_index_unexpected'
  | 'dispatch_failed';

type ClickResult =
  | {
      ok: true;
      navigated: { fromStepKey: string; toStepKey: string } | null;
      buttonError?: string;
      fieldErrors?: Record<string, string>;
    }
  | {
      ok: false;
      errorType: ClickErrorType;
      error: string;
    };

type ElementType = 'button' | 'text' | 'container';

type FoundElement = {
  element: any;
  elementType: ElementType;
  actions: any[];
  position: number[];
};

const findElement = (state: any, elementId: string): FoundElement | null => {
  const step = state?.currentStep;
  if (!step) return null;
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

export async function dispatchClickElement(
  formUuid: string | undefined,
  elementId: string,
  rawRepeatIndex: unknown
): Promise<ClickResult> {
  const repeatIndex = Number.isInteger(rawRepeatIndex)
    ? (rawRepeatIndex as number)
    : null;
  if (!formUuid) {
    return {
      ok: false,
      errorType: 'no_form_state',
      error: 'Form has not loaded yet.'
    };
  }
  const state = internalState[formUuid];
  if (!state || !state.currentStep || !state.assistantClient) {
    return {
      ok: false,
      errorType: 'no_form_state',
      error: 'Form has not loaded yet.'
    };
  }
  if (typeof elementId !== 'string' || elementId.length === 0) {
    return {
      ok: false,
      errorType: 'shape_mismatch',
      error: 'elementId is required.'
    };
  }

  const found = findElement(state, elementId);
  if (!found) {
    return {
      ok: false,
      errorType: 'not_on_step',
      error: `Element '${elementId}' is not on the current step.`
    };
  }
  const visiblePositions = state.visiblePositions ?? {};
  const flags = visiblePositions[getPositionKey(found.element) ?? 'root'];
  if (Array.isArray(flags) && !flags.some(Boolean)) {
    return {
      ok: false,
      errorType: 'hidden',
      error: `Element '${elementId}' is on the current step but is hidden right now.`
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
        errorType: 'disabled',
        error: `Button '${elementId}' is disabled and cannot be clicked.`
      };
    }
  }
  // A repeated subgrid is its own repeat container (one clickable instance per row)
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
  if (repeatFailure) return { ok: false, ...repeatFailure };

  // Reject clicks on a row hidden by a per-row rule
  if (
    typeof repeatIndex === 'number' &&
    Array.isArray(flags) &&
    !flags[repeatIndex]
  ) {
    return {
      ok: false,
      errorType: 'hidden',
      error: `Row ${repeatIndex} of element '${elementId}' is hidden right now.`
    };
  }

  const client = state.assistantClient;
  const fromStepKey = state.currentStep.key;
  const errorsBefore = snapshotInlineErrors(state);

  const elementForDispatch =
    typeof repeatIndex === 'number'
      ? { ...found.element, repeat: repeatIndex }
      : found.element;

  try {
    if (found.elementType === 'button') {
      await client.click(elementForDispatch);
    } else {
      // Capture ancestors before the child's action runs, it may navigate
      const ancestors = findClickableAncestorSubgrids(
        state.currentStep.subgrids,
        found.position
      );
      await client.runActions({
        actions: found.actions,
        element: elementForDispatch,
        elementType: found.elementType
      });
      for (const sg of ancestors) {
        const acts = sg?.properties?.actions;
        // Only ancestors that live inside the repeated container act on the targeted row
        const insideRepeat =
          typeof repeatIndex === 'number' &&
          !!repeatContainer &&
          sg.position.length >= repeatContainer.position.length;
        await client.runActions({
          actions: Array.isArray(acts) ? acts : [],
          element: insideRepeat ? { ...sg, repeat: repeatIndex } : sg,
          elementType: 'container'
        });
      }
    }
  } catch (err) {
    return {
      ok: false,
      errorType: 'dispatch_failed',
      error: err instanceof Error ? err.message : String(err)
    };
  }

  const toStepKey = state.currentStep?.key ?? fromStepKey;
  const errorsAfter = snapshotInlineErrors(state);

  const fieldErrors: Record<string, string> = {};
  for (const key of Object.keys(errorsAfter)) {
    if (errorsAfter[key] !== errorsBefore[key])
      fieldErrors[key] = errorsAfter[key];
  }
  // SDK keys submit-time button errors by element.id, only on the button path.
  const buttonError =
    found.elementType === 'button' ? fieldErrors[elementId] : undefined;
  delete fieldErrors[elementId];

  return {
    ok: true,
    navigated: toStepKey !== fromStepKey ? { fromStepKey, toStepKey } : null,
    ...(buttonError ? { buttonError } : {}),
    ...(Object.keys(fieldErrors).length > 0 ? { fieldErrors } : {})
  };
}
