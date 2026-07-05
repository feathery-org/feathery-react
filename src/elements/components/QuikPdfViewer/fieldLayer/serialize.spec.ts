import { extractFieldValues, toFormFields } from './serialize';

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
          { id: 'r1', type: 'radiobutton', value: 'Off', exportValues: 'Married' },
          { id: 'r2', type: 'radiobutton', value: 'Off', exportValues: 'Single' }
        ]
      },
      { r2: { value: true } }
    );
    expect(await extractFieldValues(doc)).toEqual({
      '1own.MaritalStatus': 'Single'
    });
  });

  it('returns {} for documents without fields', async () => {
    const doc = makeDoc(null, {});
    expect(await extractFieldValues(doc)).toEqual({});
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
