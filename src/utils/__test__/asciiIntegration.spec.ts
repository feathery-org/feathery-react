import { defaultClient, fieldValues, initState, setFieldValues } from '../init';
import {
  mapFormSettingsResponse,
  updateSessionValues
} from '../formHelperFunctions';
import FeatheryClient from '../featheryClient';
import Field from '../entities/Field';
import internalState from '../internalState';

describe('ASCII value ingestion', () => {
  const fields = [
    { servar: { key: 'city', type: 'gmap_city', metadata: {} } },
    { servar: { key: 'state', type: 'gmap_state', metadata: {} } },
    { servar: { key: 'password', type: 'password', metadata: {} } }
  ];
  const schema = { ascii_only: true, steps: [{ servar_fields: fields }] };

  beforeEach(() => {
    initState.formSchemas = { ascii: schema };
    Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
    jest.spyOn(defaultClient, 'submitCustom').mockResolvedValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    initState.formSchemas = {};
    delete internalState['other-instance'];
    Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  });

  it('loads the setting with a backward-compatible default', () => {
    expect(mapFormSettingsResponse({}).asciiOnly).toBe(false);
    expect(mapFormSettingsResponse(schema).asciiOnly).toBe(true);
  });

  it('converts public and logic-rule updates before storing or submitting them', () => {
    setFieldValues({ city: 'São Paulo', password: 'sëcret' }, false);
    expect(fieldValues.city).toBe('Sao Paulo');
    expect(fieldValues.password).toBe('sëcret');
    expect(defaultClient.submitCustom).toHaveBeenCalledWith({
      city: 'Sao Paulo',
      password: 'sëcret'
    });
    new Field('state', 'ascii').value = ['Pará', 'Ceará'];
    expect(fieldValues.state).toEqual(['Para', 'Ceara']);
  });

  it('normalizes loaded defaults and resumed session values', () => {
    const client = new FeatheryClient('ascii');
    client.setDefaultFormValues({
      steps: schema.steps,
      additionalValues: { city: 'İstanbul' }
    });
    expect(fieldValues.city).toBe('Istanbul');
    updateSessionValues({
      servars: ['city'],
      file_values: {},
      field_values: { city: 'Thành phố Hồ Chí Minh' }
    });
    expect(fieldValues.city).toBe('Thanh pho Ho Chi Minh');
  });

  it('leaves values alone when the form setting is disabled', () => {
    initState.formSchemas = { ascii: { ...schema, ascii_only: false } };
    setFieldValues({ city: 'São Paulo' }, false);
    expect(fieldValues.city).toBe('São Paulo');
  });

  it('normalizes configured defaults restored by a logic rule', () => {
    const field = new Field('city', 'ascii');
    field._sourceField = {
      servar: {
        key: 'city',
        type: 'gmap_city',
        metadata: { default_value: 'São Paulo' }
      }
    };
    field.clear();
    expect(fieldValues.city).toBe('Sao Paulo');
  });

  it('honors the owning form for logic writes when an ASCII form is also cached', () => {
    initState.formSchemas.other = { ...schema, ascii_only: false };
    internalState['other-instance'] = { client: { formKey: 'other' } } as any;
    new Field('city', 'other-instance').value = 'São Paulo';
    expect(fieldValues.city).toBe('São Paulo');
    expect(defaultClient.submitCustom).toHaveBeenLastCalledWith({
      city: 'São Paulo'
    });
    updateSessionValues(
      {
        servars: ['city'],
        file_values: {},
        field_values: { city: 'İstanbul' }
      },
      'other'
    );
    expect(fieldValues.city).toBe('İstanbul');
  });

  it('sends ASCII values in step submission requests without altering field identifiers', async () => {
    initState.sdkKey = 'test';
    const client = new FeatheryClient('ascii');
    const request = jest
      .spyOn(client.offlineRequestHandler, 'runOrSaveRequest')
      .mockResolvedValue(undefined);
    await client._submitJSONData(
      [
        { key: 'city', gmap_city: 'São Paulo' },
        { key: 'state', gmap_state: ['Pará', 'Ceará'] },
        { key: 'password', password: 'sëcret' }
      ],
      'step',
      false
    );
    const body = JSON.parse((request.mock.calls[0][2] as any).body);
    expect(body.servars).toEqual([
      { key: 'city', gmap_city: 'Sao Paulo' },
      { key: 'state', gmap_state: ['Para', 'Ceara'] },
      { key: 'password', password: 'sëcret' }
    ]);
    client.destroy();
  });
});
