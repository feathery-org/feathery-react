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
// lodash.debounce for a change rule's rerender (Field.ts's
// debouncedFormRerender), so the timing this fix depends on is genuine, not
// simulated by a mock.
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
import debounce from 'lodash.debounce';
import internalState from '../../internalState';
import CallbackQueue from '../../callbackQueue';
import { fillStepTool } from '../fillStep';

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
  field('residential_zip2', [3])
];

// Mirrors <Form/>'s contract with formTools, at the fidelity the two gaps
// need: real commit timing (useLayoutEffect bump), a real change rule
// (last_name2 rewrites first_name2, debounced-rerender just like Field.ts),
// and a real hideIf (residential_zip2 only visible once residential_state2
// is filled), computed fresh every render the same way <Form/>'s
// visiblePositions useMemo is.
const TestFormHost = () => {
  const [, setRender] = useState(0);
  const fieldsRef = useRef<Record<string, { value: unknown }>>({
    first_name2: { value: '' },
    last_name2: { value: '' },
    residential_state2: { value: '' },
    residential_zip2: { value: '' }
  });
  const queueRef = useRef<CallbackQueue | undefined>(undefined);
  if (!queueRef.current)
    queueRef.current = new CallbackQueue({ buttons: [] }, () => {});

  // Debounced exactly like Field.ts's debouncedFormRerender (100ms): the
  // rule's own value mutation below is synchronous, only the rerender it
  // needs to become visible lags.
  const debouncedRerenderRef = useRef(
    debounce(() => setRender((r) => r + 1), 100)
  );

  const changeValue = (value: unknown, f: any) => {
    fieldsRef.current[f.servar.key] = { value };
    // Direct writes rerender immediately (updateFieldValues's rerender=true
    // path), same as fillStep.ts's own changeValue calls do in <Form/>.
    setRender((r) => r + 1);
  };

  const fieldOnChange = (args: { fieldKey: string }) => () => {
    if (args.fieldKey !== 'last_name2') return;
    // The one change rule this harness models: last_name2's write triggers
    // `first_name2.value = first_name2.value.toUpperCase()`. Queued through
    // the same CallbackQueue contract fillStep.ts awaits.
    queueRef.current!.addCallback(
      Promise.resolve().then(() => {
        const current = fieldsRef.current.first_name2.value;
        fieldsRef.current.first_name2 = {
          value: String(current).toUpperCase()
        };
        debouncedRerenderRef.current();
      })
    );
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
  // The real Field class's getter reads fieldValues live; a plain
  // { value } stand-in is all getPanelRuntimeSnapshot/fillStepTool read here.
  state.fields = fieldsRef.current as any;
  state.inlineErrors = state.inlineErrors ?? {};
  state.logicRules = [];
  // positionKey '3' (residential_zip2) is the hideIf this test is about: it
  // only reads true once residential_state2 has a value, computed fresh
  // every render exactly like <Form/>'s real visiblePositions useMemo.
  state.visiblePositions = {
    '0': [true],
    '1': [true],
    '2': [true],
    '3': [!!fieldsRef.current.residential_state2.value]
  };
  state.formToolsCallbacks = {
    changeValue,
    fieldOnChange,
    getNextStepKey: () => undefined,
    buttonOnClick: async () => undefined,
    awaitChangeRules: () => queueRef.current!.all()
  };

  // <Form/>'s own commit signal (src/Form/index.tsx): bumped once per
  // commit, with no deps, so fillStep.ts's waitForNextCommit has a real
  // commit to wait for rather than a mock standing in for one.
  useLayoutEffect(() => {
    internalState[FORM].formToolsRenderTick =
      (internalState[FORM].formToolsRenderTick ?? 0) + 1;
  });

  return null;
};

let errorSpy: jest.SpyInstance;
beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation((msg, ...rest) => {
    if (typeof msg === 'string' && msg.includes('not wrapped in act')) return;
    // eslint-disable-next-line no-console
    console.warn(msg, ...rest);
  });
});

afterEach(async () => {
  // Let the 100ms debounced rerender above flush before unmount, so it
  // never fires against a torn-down tree.
  await new Promise((resolve) => setTimeout(resolve, 150));
  cleanup();
  delete (internalState as any)[FORM];
  errorSpy.mockRestore();
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
});
