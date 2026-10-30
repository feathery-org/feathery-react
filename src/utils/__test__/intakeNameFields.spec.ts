import internalState from '../internalState';
import * as validation from '../validation';
import * as actionUtils from '../formActions/utils';
import { getIntakeNameFields, saveIntakeNames } from '../intakeNameFields';

const formId = 'intake-name-test';
const ids = { first: 'first-element', last: 'last-element' };

function createState() {
  const field = (id: string, key: string) => ({
    id,
    position: [0, id === ids.first ? 0 : 1],
    validations: [],
    hide_ifs: [],
    properties: {},
    servar: { id: key, key, type: 'text_field', required: true }
  });
  const first = field(ids.first, 'claimant_first');
  const last = field(ids.last, 'claimant_last');
  const state: any = {
    currentStep: { key: 'screening' },
    steps: {
      names: {
        subgrids: [{ position: [], repeated: false }],
        servar_fields: [first, last]
      }
    },
    formSettings: {},
    logicRules: [],
    fields: { claimant_first: { value: '' }, claimant_last: { value: '' } },
    formToolsCallbacks: {
      awaitChangeRules: jest.fn().mockResolvedValue(undefined)
    },
    client: {
      formKey: 'intake-name-test',
      getNoSave: () => false,
      submitCustom: jest.fn().mockResolvedValue(undefined),
      offlineRequestHandler: {
        hasQueuedAnswerWrite: jest.fn().mockResolvedValue(false)
      }
    }
  };
  state.formActions = {
    changeValue: jest.fn((value, target) => {
      state.fields[target.servar.key].value = value;
      return true;
    }),
    runFieldChangeLogic: jest.fn().mockResolvedValue(undefined)
  };
  (internalState as any)[formId] = state;
  return { state, first, last };
}

afterEach(() => {
  delete (internalState as any)[formId];
  jest.restoreAllMocks();
});

it('writes the configured names using the submission client and waits for saving', async () => {
  const { state } = createState();
  jest.spyOn(actionUtils, 'markInteraction').mockImplementation(() => {});
  jest.spyOn(validation, 'getStandardFieldError').mockReturnValue('');
  await saveIntakeNames(formId, ids, { first: 'Ada', last: 'Lovelace' });
  expect(state.client.submitCustom).toHaveBeenCalledWith(
    { claimant_first: 'Ada', claimant_last: 'Lovelace' },
    { override: true, shouldFlush: true }
  );
  expect(state.formActions.runFieldChangeLogic).toHaveBeenCalledTimes(2);
  expect(getIntakeNameFields(formId, ids)?.first.value).toBe('Ada');
});

it('leaves names in the regular form flow when the field has unsupported behavior', () => {
  const { state, first } = createState();
  expect(getIntakeNameFields(formId, ids)).not.toBeNull();
  first.validations.push({ message: 'custom' } as never);
  expect(getIntakeNameFields(formId, ids)).toBeNull();
  first.validations = [];
  state.logicRules = [
    { trigger_event: 'change', elements: ['claimant_first'] }
  ];
  expect(getIntakeNameFields(formId, ids)).toBeNull();
  state.logicRules = [];
  state.steps.names.subgrids[0].hide_ifs = [{ index: 0 }];
  expect(getIntakeNameFields(formId, ids)).toBeNull();
  state.steps.names.subgrids[0].hide_ifs = [];
  state.client.getNoSave = () => true;
  expect(getIntakeNameFields(formId, ids)).toBeNull();
});

it('does not write a name that fails validation or report an offline write as saved', async () => {
  const { state } = createState();
  jest.spyOn(actionUtils, 'markInteraction').mockImplementation(() => {});
  const check = jest
    .spyOn(validation, 'getStandardFieldError')
    .mockReturnValueOnce('Required');
  await expect(
    saveIntakeNames(formId, ids, { first: '', last: 'Lovelace' })
  ).rejects.toThrow('Required');
  expect(state.client.submitCustom).not.toHaveBeenCalled();
  check.mockReturnValue('');
  state.client.offlineRequestHandler.hasQueuedAnswerWrite.mockResolvedValue(
    true
  );
  await expect(
    saveIntakeNames(formId, ids, { first: 'Ada', last: 'Lovelace' })
  ).rejects.toThrow();
});
