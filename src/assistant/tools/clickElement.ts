import internalState from '../../utils/internalState';
import { findClickableAncestorSubgrids } from '../utils';

export type ClickErrorType =
  | 'not_on_step'
  | 'hidden'
  | 'no_form_state'
  | 'shape_mismatch'
  | 'dispatch_failed';

export type ClickResult =
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

const isVisible = (state: any, position: number[]): boolean => {
  const positionKey = position.join(',') || 'root';
  const flags = state.visiblePositions?.[positionKey];
  return Array.isArray(flags) ? flags.some(Boolean) : true;
};

const snapshotInlineErrors = (state: any): Record<string, string> => {
  const inlineErrors = state?.inlineErrors ?? {};
  const out: Record<string, string> = {};
  for (const key of Object.keys(inlineErrors)) {
    const message = inlineErrors[key]?.message;
    if (typeof message === 'string' && message.length > 0) {
      out[key] = message;
    }
  }
  return out;
};

export async function dispatchClickElement(
  formUuid: string | undefined,
  elementId: string
): Promise<ClickResult> {
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
  if (!isVisible(state, found.position)) {
    return {
      ok: false,
      errorType: 'hidden',
      error: `Element '${elementId}' is on the current step but is hidden right now.`
    };
  }

  const client = state.assistantClient;
  const fromStepKey = state.currentStep.key;
  const errorsBefore = snapshotInlineErrors(state);

  try {
    if (found.elementType === 'button') {
      await client.click(found.element);
    } else {
      // Capture ancestors before the child's action runs, it may navigate
      const ancestors = findClickableAncestorSubgrids(
        state.currentStep.subgrids,
        found.position
      );
      await client.runActions({
        actions: found.actions,
        element: found.element,
        elementType: found.elementType
      });
      for (const sg of ancestors) {
        const acts = sg?.properties?.actions;
        await client.runActions({
          actions: Array.isArray(acts) ? acts : [],
          element: sg,
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
