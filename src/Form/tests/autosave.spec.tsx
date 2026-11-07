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
  servar: { key: 'name', type: 'text_field', repeat_trigger: '' }
};
const fileField = {
  id: 'el-resume',
  servar: { key: 'resume', type: 'file_upload', repeat_trigger: '' }
};

// Renders a one-step form with the autosave setting on or off and hands back
// the form context the grid receives, so a test can change a field exactly
// the way a rendered input would.
const renderForm = async (autosave: boolean, id: string) => {
  ClientMod._spies.state.autosave = autosave;
  render(<JSForm formId='f1' _internalId={`iid-autosave-${id}`} />);
  await screen.findByTestId('btn');
  return GridMod._spies.form;
};

const changeField = (form: any, value: any, field: any) =>
  act(() => {
    form.changeValue(value, field);
  });

describe('autosave on field change', () => {
  beforeEach(() => {
    // The grid mock reads no positions; the validity check is mocked, so the
    // form only needs positions to exist to attempt an autosave
    HideAndRepeatsMod._spies.visiblePositions = { k: [true] };
    ValidationMod._spies.fieldValid = true;
    delete fieldValues.name;
    delete fieldValues.resume;
  });

  afterEach(() => {
    jest.clearAllMocks();
    cleanup();
    ClientMod._spies.state.autosave = false;
    HideAndRepeatsMod._spies.visiblePositions = {};
    FieldHelperMod.FILE_FIELD_TYPES.length = 0;
  });

  it('flushes a valid field through the debounced custom submit', async () => {
    const form = await renderForm(true, 'valid');

    changeField(form, 'Ada', textField);

    expect(ValidationMod.isFieldValid).toHaveBeenCalledWith(
      expect.objectContaining({ fieldKey: 'name' })
    );
    expect(ClientMod._spies.submitCustom).toHaveBeenCalledTimes(1);
    expect(ClientMod._spies.submitCustom).toHaveBeenCalledWith({ name: 'Ada' });
  });

  it('holds an invalid field back without surfacing an error', async () => {
    ValidationMod._spies.fieldValid = false;
    const form = await renderForm(true, 'invalid');

    changeField(form, 'A', textField);

    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
    expect(ValidationMod.validateElements).not.toHaveBeenCalled();
  });

  it('does nothing when the form setting is off', async () => {
    const form = await renderForm(false, 'off');

    changeField(form, 'Ada', textField);

    expect(ValidationMod.isFieldValid).not.toHaveBeenCalled();
    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
  });

  it('skips a change that leaves the value as it was', async () => {
    const form = await renderForm(true, 'unchanged');
    changeField(form, 'Ada', textField);
    ClientMod._spies.submitCustom.mockClear();

    changeField(form, 'Ada', textField);

    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
  });

  it('uploads a valid file through the file submit path', async () => {
    FieldHelperMod.FILE_FIELD_TYPES.push('file_upload');
    const form = await renderForm(true, 'file');
    const file = Promise.resolve(new File([], 'r.pdf'));

    changeField(form, [file], fileField);

    expect(ClientMod._spies.submitCustom).not.toHaveBeenCalled();
    expect(ClientMod._spies.submitFiles).toHaveBeenCalledWith([
      {
        servar: { key: 'resume', file_upload: [file], repeated: false },
        stepKey: expect.any(String)
      }
    ]);
  });
});
