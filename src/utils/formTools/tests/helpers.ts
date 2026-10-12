import internalState from '../../internalState';

export const emptyStepArrays = {
  subgrids: [],
  texts: [],
  images: [],
  buttons: [],
  tables: [],
  tabs: [],
  progress_bars: [],
  next_conditions: []
};

export const field = (overrides: Record<string, any>) => {
  const key = overrides.servar?.key ?? 'f';
  return {
    id: `${key}-element-id`,
    position: [],
    properties: {},
    ...overrides,
    servar: {
      id: `${key}-servar-id`,
      metadata: {},
      ...overrides.servar
    }
  };
};

export const fileField = (key: string, metadata: Record<string, any> = {}) =>
  field({
    id: `${key}-el`,
    servar: {
      id: `${key}-sv`,
      key,
      type: 'file_upload',
      metadata: { file_types: [], ...metadata }
    }
  });

type SeedOptions = {
  fields?: any[];
  fieldValues?: Record<string, any>;
  // Extra keys merged over the current step (buttons, subgrids, ...).
  step?: Record<string, any>;
  stepId?: string;
  stepKey?: string;
  // Other steps by key, e.g. a navigation target.
  steps?: Record<string, any>;
  nextStepKey?: string;
  visiblePositions?: Record<string, boolean[]>;
  changeValue?: (value: any, f: any, index: number | null) => boolean | void;
  callbacks?: Record<string, any>;
  // Extra form-state keys, e.g. formToolsLastSave.
  state?: Record<string, any>;
  // Isolated internalState module, when a test needs its own module graph.
  internalState?: any;
};

// Seeds a form with a current step and the callbacks the tools drive. The
// tick bump in awaitChangeRules stands in for <Form/>'s useLayoutEffect;
// without it waitForNextCommit would poll forever, as no <Form/> mounts here.
export function seedForm(form: string, opts: SeedOptions = {}) {
  const store = opts.internalState ?? internalState;
  const currentStep = {
    id: opts.stepId ?? 'step-1',
    key: opts.stepKey ?? 'step-1',
    servar_fields: opts.fields ?? [],
    ...emptyStepArrays,
    ...opts.step
  };
  const callOrder: string[] = [];
  const bumpRenderTick = () => {
    store[form].formToolsRenderTick =
      (store[form].formToolsRenderTick ?? 0) + 1;
  };

  const getNextStepKey = jest.fn(() => opts.nextStepKey);
  const changeValue = jest.fn((value: any, f: any, index: number | null) => {
    callOrder.push('changeValue');
    if (opts.changeValue) return opts.changeValue(value, f, index);
    store[form].fields[f.servar.key] = { value };
    return true;
  });
  const fieldOnChangeInner = jest.fn();
  const fieldOnChange = jest.fn((args: any) => {
    callOrder.push('fieldOnChange');
    return (o: any) => fieldOnChangeInner(args, o);
  });
  const awaitChangeRules = jest.fn(async () => {
    callOrder.push('awaitChangeRules');
    bumpRenderTick();
  });

  store[form] = {
    currentStep,
    steps: { [currentStep.key]: currentStep, ...opts.steps },
    fields: Object.fromEntries(
      Object.entries(opts.fieldValues ?? {}).map(([k, v]) => [k, { value: v }])
    ),
    visiblePositions: opts.visiblePositions ?? {},
    inlineErrors: {},
    logicRules: [],
    formToolsRenderTick: 0,
    client: {
      submitQueue: Promise.resolve(),
      eventQueue: Promise.resolve(),
      whenUserEventsReplayed: () => Promise.resolve()
    },
    formToolsCallbacks: {
      changeValue,
      flushRerender: jest.fn(),
      fieldOnChange,
      getNextStepKey,
      awaitChangeRules,
      ...opts.callbacks
    },
    ...opts.state
  };

  return {
    currentStep,
    callOrder,
    bumpRenderTick,
    changeValue,
    fieldOnChange,
    fieldOnChangeInner,
    awaitChangeRules,
    getNextStepKey
  };
}
