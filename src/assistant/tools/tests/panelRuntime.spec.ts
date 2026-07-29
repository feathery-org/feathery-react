import internalState from '../../../utils/internalState';
import { getPanelRuntimeSnapshot } from '../panelRuntime';

const FORM = 'panel-runtime-form';

afterEach(() => {
  delete (internalState as any)[FORM];
});

it('normalizes runtime-only values at the panelRuntime source and retains empty hidden keys', () => {
  const file = new File(['policy'], 'policy.pdf', {
    type: 'application/pdf'
  });
  const pending = Promise.resolve('runtime only');
  const currentStep = {
    id: 'step-1',
    key: 'intro',
    subgrids: [],
    texts: [],
    images: [],
    buttons: [],
    tables: [],
    tabs: [],
    progress_bars: [],
    next_conditions: [],
    servar_fields: [
      {
        servar: { id: 'field-1', key: 'upload', type: 'file_upload' },
        properties: {},
        position: []
      }
    ]
  };
  (internalState as any)[FORM] = {
    currentStep,
    steps: { intro: currentStep },
    fields: {
      upload: { value: { file, nested: { pending } } },
      hidden_file: { value: file },
      hidden_null: { value: null },
      hidden_empty_string: { value: '' },
      hidden_empty_array: { value: [] }
    },
    visiblePositions: {},
    inlineErrors: {},
    logicRules: []
  };

  const snapshot = getPanelRuntimeSnapshot(FORM)!;

  const filePresence = {
    kind: 'file',
    present: true,
    name: 'policy.pdf',
    type: 'application/pdf',
    size: 6
  };
  expect(snapshot.values.upload).toEqual({
    file: filePresence,
    nested: { pending: { kind: 'promise', present: true } }
  });
  expect(snapshot.currentStepFields[0].value).toEqual(snapshot.values.upload);
  expect(snapshot.hiddenFieldValues).toEqual({ hidden_file: filePresence });
  expect(snapshot.hiddenFieldsEmpty).toEqual([
    'hidden_null',
    'hidden_empty_string',
    'hidden_empty_array'
  ]);
  expect(snapshot.hiddenFieldValues).not.toHaveProperty('not_present');
  expect(snapshot.hiddenFieldsEmpty).not.toContain('not_present');
  expect(() => JSON.stringify(snapshot)).not.toThrow();
});
