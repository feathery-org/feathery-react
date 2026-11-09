import {
  ClientMod,
  FieldHelperMod,
  GridMod,
  HideAndRepeatsMod,
  ValidationMod
} from './testMocks';
import { act, cleanup, render, screen } from '@testing-library/react';
import { JSForm } from '..';
import { fieldValues } from '../../utils/init';

const textField = {
  id: 'el-name',
  properties: {},
  servar: { id: 's-name', key: 'name', type: 'text_field', repeat_trigger: '' }
};
const cityField = {
  id: 'el-city',
  properties: {},
  servar: { id: 's-city', key: 'city', type: 'text_field', repeat_trigger: '' }
};
const fileField = {
  id: 'el-resume',
  properties: {},
  servar: {
    id: 's-resume',
    key: 'resume',
    type: 'file_upload',
    repeat_trigger: ''
  }
};

// Renders a one-step form holding the test fields, with the autosave setting
// on or off, and hands back the form context the grid receives
const renderForm = async (autosave: boolean, id: string) => {
  ClientMod._spies.state.autosave = autosave;
  ClientMod._spies.state.steps = [
    {
      key: 'step-1',
      id: 's1',
      servar_fields: [textField, cityField, fileField],
      buttons: [],
      subgrids: [],
      next_conditions: []
    }
  ];
  render(<JSForm formId='f1' _internalId={`iid-autosave-${id}`} />);
  await screen.findByTestId('btn');
  return GridMod._spies.form;
};

// Changes a field the way a rendered input does: the value, then its handler
const changeField = (
  form: any,
  value: any,
  field: any,
  options: Record<string, any> = {}
) =>
  act(() => {
    GridMod._spies.form.changeValue(value, field);
    GridMod._spies.form.fieldOnChange({
      fieldID: field.id,
      fieldKey: field.servar.key,
      servarId: field.servar.id
    })(options);
  });

describe('autosave on field change', () => {
  beforeEach(() => {
    // The validity check is mocked, so the form only needs positions to exist
    HideAndRepeatsMod._spies.visiblePositions = { k: [true] };
    ValidationMod._spies.fieldValid = true;
    delete fieldValues.name;
    delete fieldValues.city;
    delete fieldValues.resume;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    cleanup();
    ClientMod._spies.state.autosave = false;
    ClientMod._spies.state.steps = null;
    HideAndRepeatsMod._spies.visiblePositions = {};
    FieldHelperMod.FILE_FIELD_TYPES.length = 0;
  });

  it('saves a valid field through the debounced custom submit', async () => {
    const form = await renderForm(true, 'valid');

    changeField(form, 'Ada', textField);

    expect(ValidationMod.isFieldValid).toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'name' })
    );
    expect(ClientMod._spies.submitCustom).toHaveBeenCalledWith({ name: 'Ada' });
  });

  it('withdraws an unsent save once the field turns invalid', async () => {
    const form = await renderForm(true, 'invalid');
    changeField(form, 'Ada', textField);
    ClientMod._spies.submitCustom.mockClear();

    ValidationMod._spies.fieldValid = false;
    changeField(form, 'A', textField);

    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
    expect(ClientMod._spies.discardPendingCustomField).toHaveBeenCalledWith(
      'name',
      'Ada'
    );
    expect(ValidationMod.validateElements).not.toHaveBeenCalled();
  });

  it('does nothing when the form setting is off', async () => {
    const form = await renderForm(false, 'off');

    changeField(form, 'Ada', textField);

    expect(ValidationMod.isFieldValid).not.toHaveBeenCalled();
    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
  });

  it('skips a value written without the change handler, like a rollback', async () => {
    const form = await renderForm(true, 'rollback');

    act(() => {
      form.changeValue('Ada', textField);
    });

    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
  });

  it('also saves the fields an address selection filled in', async () => {
    const form = await renderForm(true, 'address');
    act(() => {
      form.changeValue('Paris', cityField);
    });

    changeField(form, '1 Rue', textField, { relatedServarIds: ['s-city'] });

    expect(ClientMod._spies.submitCustom).toHaveBeenCalledWith({
      name: '1 Rue'
    });
    expect(ClientMod._spies.submitCustom).toHaveBeenCalledWith({
      city: 'Paris'
    });
  });

  it('resets a saved field on the server once it hides', async () => {
    const form = await renderForm(true, 'hide');
    changeField(form, 'Ada', textField);
    ClientMod._spies.submitCustom.mockClear();

    HideAndRepeatsMod._spies.visiblePositions = { k: [false] };
    act(() => {
      form.changeValue('Paris', cityField);
    });

    expect(ClientMod._spies.submitCustom).toHaveBeenCalledWith({ name: '' });
  });

  it('uploads a file once its changes settle, outside the step queue', async () => {
    FieldHelperMod.FILE_FIELD_TYPES.push('file_upload');
    const form = await renderForm(true, 'file');
    jest.useFakeTimers();
    const first = Promise.resolve(new File([], 'a.pdf'));
    const second = Promise.resolve(new File([], 'b.pdf'));

    changeField(form, [first], fileField);
    changeField(form, [first, second], fileField);
    expect(ClientMod._spies.autosaveFiles).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
    expect(ClientMod._spies.submitFiles).not.toHaveBeenCalled();
    expect(ClientMod._spies.autosaveFiles).toHaveBeenCalledTimes(1);
    expect(ClientMod._spies.autosaveFiles).toHaveBeenCalledWith([
      {
        servar: expect.objectContaining({
          key: 'resume',
          file_upload: [first, second]
        }),
        stepKey: 'step-1'
      }
    ]);
  });
});
