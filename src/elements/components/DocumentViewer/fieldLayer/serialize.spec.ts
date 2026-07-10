import { extractFieldValues, toFormFields, toQuikFieldName } from './serialize';

const makeDoc = (fieldObjects: any, storage: Record<string, any>) => ({
  getFieldObjects: async () => fieldObjects,
  annotationStorage: { getAll: () => storage }
});

describe('extractFieldValues', () => {
  it('returns edited text values from annotationStorage', async () => {
    const doc = makeDoc(
      { '1own.FName': [{ id: 'a1', type: 'text', value: 'Prefill' }] },
      { a1: { value: 'Edited' } }
    );
    expect(await extractFieldValues(doc)).toEqual({ '1own.FName': 'Edited' });
  });

  it('falls back to prefilled values when untouched', async () => {
    const doc = makeDoc(
      { '1own.FName': [{ id: 'a1', type: 'text', value: 'Prefill' }] },
      {}
    );
    expect(await extractFieldValues(doc)).toEqual({ '1own.FName': 'Prefill' });
  });

  it('serializes checked checkboxes to their export value', async () => {
    const doc = makeDoc(
      {
        '1own.Married': [
          { id: 'c1', type: 'checkbox', value: 'Off', exportValues: 'Yes' }
        ]
      },
      { c1: { value: true } }
    );
    expect(await extractFieldValues(doc)).toEqual({ '1own.Married': 'Yes' });
  });

  it('serializes unchecked checkboxes to empty string', async () => {
    const doc = makeDoc(
      {
        '1own.Married': [
          { id: 'c1', type: 'checkbox', value: 'Yes', exportValues: 'Yes' }
        ]
      },
      { c1: { value: false } }
    );
    expect(await extractFieldValues(doc)).toEqual({ '1own.Married': '' });
  });

  it('picks the selected radio sibling export value', async () => {
    const doc = makeDoc(
      {
        '1own.MaritalStatus': [
          {
            id: 'r1',
            type: 'radiobutton',
            value: 'Off',
            exportValues: 'Married'
          },
          {
            id: 'r2',
            type: 'radiobutton',
            value: 'Off',
            exportValues: 'Single'
          }
        ]
      },
      { r2: { value: true } }
    );
    expect(await extractFieldValues(doc)).toEqual({
      '1own.MaritalStatus': 'Single'
    });
  });

  it('maps a qualified leaf field key to the Quik API field name', async () => {
    const doc = makeDoc(
      {
        '1own.1own_FName': [{ id: 'a1', type: 'text', value: 'Prefill' }]
      },
      { a1: { value: 'Edited' } }
    );
    expect(await extractFieldValues(doc)).toEqual({ '1own.FName': 'Edited' });
  });

  it('returns {} for documents without fields', async () => {
    const doc = makeDoc(null, {});
    expect(await extractFieldValues(doc)).toEqual({});
  });

  it('warns when the document has no fillable form fields', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const doc = makeDoc(null, {});
    await extractFieldValues(doc);
    expect(warnSpy).toHaveBeenCalledWith(
      'Feathery: document has no fillable form fields'
    );
    warnSpy.mockRestore();
  });
});

describe('toQuikFieldName', () => {
  it('decodes an underscore-encoded leaf segment', () => {
    expect(toQuikFieldName('1own.1own_FName')).toBe('1own.FName');
  });

  it('decodes a nested underscore-encoded leaf segment', () => {
    expect(toQuikFieldName('1own.H.1own_H_Addr123')).toBe('1own.H.Addr123');
  });

  it('falls back to the full qualified name when the leaf has no underscore', () => {
    expect(toQuikFieldName('1own.FName')).toBe('1own.FName');
  });
});

describe('toFormFields', () => {
  it('maps values to FieldName/FieldValue pairs', () => {
    expect(toFormFields({ '1own.FName': 'J', '1own.LName': '' })).toEqual([
      { FieldName: '1own.FName', FieldValue: 'J' },
      { FieldName: '1own.LName', FieldValue: '' }
    ]);
  });
});
