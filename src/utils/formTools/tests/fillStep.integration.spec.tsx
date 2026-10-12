// fillStepTool against a minimal, real React host, instead of the shared
// <Form/> test harness (src/Form/tests/testMocks.tsx).
//
// That shared harness replaces internalState, hideAndRepeats
// (getVisiblePositions) and repeat wholesale with trivial stubs - exactly
// the real behavior these two gaps live in (visibility only lands in
// internalState once <Form/> itself re-renders; a later field's change rule
// can rewrite an earlier one). Un-mocking that chain to mount the real
// 4000-line <Form/> pulls in its logic/init/FeatheryClient dependencies too,
// which is a materially bigger undertaking than this fix. Everything under
// test here is still the real production code: internalState, CallbackQueue,
// getPanelRuntimeSnapshot (via fillStepTool) and fillStepTool/renderTick
// themselves. Only the host component below stands in for <Form/>'s
// contract with formTools - a real commit-tick bump (useLayoutEffect, no
// deps, exactly like <Form/>'s own), an immediate rerender for a direct
// write (updateFieldValues's `rerender=true` path) and a REAL (unmocked)
// lodash.debounce for a change rule's rerender: rules write through the real
// Field class, so Field.ts's own debouncedFormRerender, rerenderAllForms and
// the registered render callback are all genuine, not simulated by a mock.
//
// fillStepTool's writes happen from a plain async function, not a simulated
// DOM event, so React warns every update isn't wrapped in act(). Wrapping
// the whole call in one act() instead deadlocks it: act() defers flushing
// React's queued updates until its callback resolves, but that callback
// here only resolves once a commit (which needs that flush) has happened.
// Filtering just that one expected warning keeps the real, unflushed timing
// this test is about, without hiding a genuine error.
jest.mock('../../validation', () => ({
  phoneLib: { parsePhoneNumber: jest.fn() },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn()
}));

import React, { useLayoutEffect, useRef, useState } from 'react';
import { render, cleanup } from '@testing-library/react';
import internalState from '../../internalState';
import CallbackQueue from '../../callbackQueue';
import Field, { flushFormRerender } from '../../entities/Field';
import {
  defaultClient,
  fieldValues,
  initState,
  setFieldValues
} from '../../init';
import { registerRenderCallback } from '../../formHelperFunctions';
import { fillStepTool } from '../fillStep';
import { captureRenderTick, waitForNextCommit } from '../renderTick';

const FORM = 'fill-step-integration-form';

const emptyStepArrays = {
  subgrids: [],
  texts: [],
  images: [],
  buttons: [],
  tables: [],
  tabs: [],
  progress_bars: [],
  next_conditions: []
};

const field = (key: string, position: number[]) => ({
  id: `${key}-el`,
  position,
  properties: {},
  servar: { id: `${key}-sv`, key, type: 'text_field', metadata: {} }
});

const FIELD_DEFS = [
  field('first_name2', [0]),
  field('last_name2', [1]),
  field('residential_state2', [2]),
  field('residential_zip2', [3]),
  field('trigger_a', [4]),
  field('field_b', [5]),
  field('field_c', [6]),
  field('server_trigger', [7]),
  field('rejecting', [8]),
  field('after_rejecting', [9])
];

const KEYS = FIELD_DEFS.map((f) => f.servar.key);

// Each key's change rule: writing it sets another field through the real
// Field class, as a logic rule's `Other.value = ...` does
const CHANGE_RULES: Record<string, () => void> = {
  last_name2: () => {
    const first = new Field('first_name2', FORM);
    first.value = String(first.value).toUpperCase();
  },
  trigger_a: () => {
    new Field('field_b', FORM).value = 'set by rule';
  },
  // A server-side rule's field_data lands through setFieldValues, which
  // rerenders right away instead of through Field.ts's debounce
  server_trigger: () => {
    setFieldValues({ field_b: 'set by server rule' }, true, true);
  }
};

// Rejects before the triggering write has rendered
const REJECTING_RULES = new Set(['rejecting']);

// Mirrors <Form/>'s contract with formTools, at the fidelity the gaps need:
// real commit timing (useLayoutEffect bump), real change rules (above) and
// real hideIfs (residential_zip2 once residential_state2 is filled, field_c
// once field_b is), computed fresh every render the same way <Form/>'s
// visiblePositions useMemo is.
const TestFormHost = () => {
  const [, setRender] = useState(0);
  const queueRef = useRef<CallbackQueue | undefined>(undefined);
  if (!queueRef.current)
    queueRef.current = new CallbackQueue({ buttons: [] }, () => {});

  // What rerenderAllForms (a rule write's debounced rerender) reaches
  useLayoutEffect(() => {
    registerRenderCallback(FORM, 'form', () => {
      internalState[FORM].formToolsRenderOwed = true;
      setRender((r) => r + 1);
    });
  }, []);

  const changeValue = (value: unknown, f: any) => {
    fieldValues[f.servar.key] = value as any;
    // Direct writes rerender immediately (updateFieldValues's rerender=true
    // path), same as fillStep.ts's own changeValue calls do in <Form/>.
    setRender((r) => r + 1);
    return true;
  };

  const fieldOnChange = (args: { fieldKey: string }) => () => {
    if (REJECTING_RULES.has(args.fieldKey)) {
      queueRef.current!.addCallback(Promise.reject(new Error('rule failed')));
      return;
    }
    const rule = CHANGE_RULES[args.fieldKey];
    if (!rule) return;
    // Queued through the same CallbackQueue contract fillStep.ts awaits. Runs
    // after the triggering write has rendered, like a rule that does async
    // work first, so its own writes only reach the screen via the debounced
    // rerender.
    const tick = captureRenderTick(FORM);
    queueRef.current!.addCallback(waitForNextCommit(FORM, tick).then(rule));
  };

  if (!internalState[FORM]) internalState[FORM] = {} as any;
  const state = internalState[FORM];
  const currentStep = {
    id: 'step-1',
    key: 'step-1',
    servar_fields: FIELD_DEFS,
    ...emptyStepArrays
  };
  state.currentStep = currentStep;
  state.steps = { 'step-1': currentStep };
  state.fields = Object.fromEntries(
    KEYS.map((key) => [key, new Field(key, FORM)])
  ) as any;
  state.inlineErrors = state.inlineErrors ?? {};
  state.logicRules = [];
  state.visiblePositions = {
    '0': [true],
    '1': [true],
    '2': [true],
    '3': [!!fieldValues.residential_state2],
    '4': [true],
    '5': [true],
    '6': [!!fieldValues.field_b],
    '7': [true],
    '8': [true],
    '9': [!!fieldValues.rejecting]
  };
  state.formToolsCallbacks = {
    changeValue,
    fieldOnChange,
    getNextStepKey: () => undefined,
    buttonOnClick: async () => undefined,
    flushRerender: flushFormRerender,
    awaitChangeRules: () => queueRef.current!.all(),
    addRepeatedRow: () => undefined,
    submitFiles: async () => undefined
  };
  state.client = state.client ?? {
    submitQueue: Promise.resolve(),
    eventQueue: Promise.resolve(),
    whenUserEventsReplayed: () => Promise.resolve()
  };

  // <Form/>'s own commit signal (src/Form/index.tsx): bumped once per
  // commit, with no deps, so fillStep.ts's waitForNextCommit has a real
  // commit to wait for rather than a mock standing in for one.
  useLayoutEffect(() => {
    internalState[FORM].formToolsRenderTick =
      (internalState[FORM].formToolsRenderTick ?? 0) + 1;
    internalState[FORM].formToolsRenderOwed = false;
  });

  return null;
};

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  initState.sdkKey = 'sdk-key';
  KEYS.forEach((key) => (fieldValues[key] = ''));
  jest.spyOn(defaultClient, 'submitCustom').mockResolvedValue(undefined as any);
  errorSpy = jest.spyOn(console, 'error').mockImplementation((msg, ...rest) => {
    if (typeof msg === 'string' && msg.includes('not wrapped in act')) return;
    // eslint-disable-next-line no-console
    console.warn(msg, ...rest);
  });
});

afterEach(() => {
  // Let any still-pending debounced rerender flush before unmount, so it
  // never fires against a torn-down tree.
  flushFormRerender();
  cleanup();
  delete (internalState as any)[FORM];
  delete initState.renderCallbacks[FORM];
  initState.sdkKey = '';
  jest.restoreAllMocks();
});

describe('fillStepTool against a mounted host', () => {
  it(
    "reports the final value when a later field's change rule rewrites an " +
      'earlier one, and fills a field revealed by an earlier field in the ' +
      'same step',
    async () => {
      render(<TestFormHost />);

      // Not wrapped in act(): fillStepTool's writes happen from this plain
      // async function, and waitForNextCommit needs React's own scheduler to
      // actually flush them, which a spanning act() call would defer until
      // this very call returns (see the file-level comment above).
      const result = await fillStepTool(FORM, {
        values: {
          first_name2: 'Jane',
          last_name2: 'Doe',
          residential_state2: 'PA',
          residential_zip2: '19104'
        }
      });

      // Gap 1: first_name2 was recorded 'filled' the moment it was written,
      // before last_name2's rule rewrote it. Classifying from one final
      // snapshot (after all passes) must report the form's real value.
      expect(result.fields.first_name2).toEqual({
        status: 'changed',
        value: 'JANE',
        message:
          'A rule changed this field to a different value after it was filled.'
      });
      expect(result.fields.last_name2).toEqual({
        status: 'filled',
        value: 'Doe'
      });

      // Gap 2: residential_zip2 is hidden until residential_state2 is
      // filled, and only becomes visible once <Form/> actually re-renders.
      // A single pass over a snapshot taken before that commit would still
      // report it 'not_shown'.
      expect(result.fields.residential_state2).toEqual({
        status: 'filled',
        value: 'PA'
      });
      expect(result.fields.residential_zip2).toEqual({
        status: 'filled',
        value: '19104'
      });
      expect(result.newlyShown).toEqual(['residential_zip2']);

      // The form itself holds the rewritten value, not what fillStepTool
      // wrote - proving this isn't just a reporting fix.
      expect(internalState[FORM].fields.first_name2.value).toBe('JANE');
    }
  );

  it("fills a field revealed by a hideIf on another field's rule-written value", async () => {
    render(<TestFormHost />);

    // trigger_a's rule sets field_b, and field_c is hidden until field_b is
    // filled; the rule's re-render is debounced, so only flushing it lets the
    // re-snapshot see field_c
    const result = await fillStepTool(FORM, {
      values: { trigger_a: 'go', field_c: 'revealed' }
    });

    expect(result.fields.trigger_a).toEqual({ status: 'filled', value: 'go' });
    expect(result.fields.field_c).toEqual({
      status: 'filled',
      value: 'revealed'
    });
    expect(result.newlyShown).toEqual(['field_c']);
  });

  it("fills a field revealed by a server-side rule's write", async () => {
    render(<TestFormHost />);

    const result = await fillStepTool(FORM, {
      values: { server_trigger: 'go', field_c: 'revealed' }
    });

    expect(result.fields.field_c).toEqual({
      status: 'filled',
      value: 'revealed'
    });
  });

  it('waits for the write to render even when its change rule rejects', async () => {
    render(<TestFormHost />);

    const result = await fillStepTool(FORM, {
      values: { rejecting: 'x', after_rejecting: 'revealed' }
    });

    expect(result.fields.rejecting).toEqual({
      status: 'rejected',
      message: 'rule failed'
    });
    expect(result.fields.after_rejecting).toEqual({
      status: 'filled',
      value: 'revealed'
    });
  });
});
