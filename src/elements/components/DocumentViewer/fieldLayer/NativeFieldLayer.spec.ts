import { NativeFieldLayer } from './NativeFieldLayer';

const REQUIRED_FLAG = 2;

const makeEntry = (
  formId: string,
  groupIndex: number,
  fieldObjects: any,
  storage: Record<string, any>,
  annotations: any[] = []
) => ({
  doc: { type: 'form', form_id: formId, group_index: groupIndex } as any,
  pdfProxy: {
    numPages: 1,
    getFieldObjects: async () => fieldObjects,
    annotationStorage: { getAll: () => storage },
    getPage: async () => ({ getAnnotations: async () => annotations })
  }
});

it('builds per-document overrides', async () => {
  const entry = makeEntry(
    '44233',
    0,
    { '1own.FName': [{ id: 'a1', type: 'text', value: 'x' }] },
    { a1: { value: 'y' } }
  );
  const layer = new NativeFieldLayer(() => [entry], jest.fn());
  expect(await layer.getOverrides()).toEqual([
    {
      form_id: '44233',
      group_index: 0,
      form_fields: [{ FieldName: '1own.FName', FieldValue: 'y' }]
    }
  ]);
});

it('skips attachments and reports required-empty fields', async () => {
  const attachment = {
    doc: { type: 'attachment' } as any,
    pdfProxy: {
      getFieldObjects: async () => null,
      annotationStorage: { getAll: () => ({}) }
    }
  };
  const form = makeEntry(
    '44233',
    0,
    { '1own.SSN': [{ id: 'a1', type: 'text', value: '' }] },
    {},
    [
      {
        fieldName: '1own.SSN',
        fieldFlags: REQUIRED_FLAG,
        fieldType: 'Tx'
      }
    ]
  );
  const layer = new NativeFieldLayer(
    () => [attachment, form] as any,
    jest.fn()
  );
  expect(await layer.getOverrides()).toHaveLength(1);
  expect(await layer.validate()).toEqual([
    { docIndex: 1, fieldName: '1own.SSN' }
  ]);
});

it('builds flat per-envelope overrides keyed by envelope_id for the generic review flow', async () => {
  const entry = {
    doc: { type: 'form', envelope_id: 'env-1' } as any,
    pdfProxy: {
      numPages: 1,
      getFieldObjects: async () => ({
        field_a: [{ id: 'a1', type: 'text', value: 'x' }]
      }),
      annotationStorage: {
        getAll: () => ({ a1: { value: 'override-value' } })
      },
      getPage: async () => ({ getAnnotations: async () => [] })
    }
  };
  const layer = new NativeFieldLayer(() => [entry], jest.fn());
  expect(await layer.getEnvelopeOverrides()).toEqual([
    { envelopeId: 'env-1', fieldOverrides: { field_a: 'override-value' } }
  ]);
});

it('skips attachments and docs without an envelope_id when building envelope overrides', async () => {
  const attachment = {
    doc: { type: 'attachment', envelope_id: 'env-attachment' } as any,
    pdfProxy: {
      getFieldObjects: async () => null,
      annotationStorage: { getAll: () => ({}) }
    }
  };
  const noEnvelopeId = {
    doc: { type: 'form' } as any,
    pdfProxy: {
      getFieldObjects: async () => ({}),
      annotationStorage: { getAll: () => ({}) }
    }
  };
  const layer = new NativeFieldLayer(
    () => [attachment, noEnvelopeId] as any,
    jest.fn()
  );
  expect(await layer.getEnvelopeOverrides()).toEqual([]);
});

it('reset calls remount', () => {
  const remount = jest.fn();
  new NativeFieldLayer(() => [], remount).reset();
  expect(remount).toHaveBeenCalled();
});

it('normalizes qualified field names when reporting required-empty fields', async () => {
  const form = makeEntry(
    '44233',
    0,
    { '1own.1own_SSN': [{ id: 'a1', type: 'text', value: '' }] },
    {},
    [
      {
        fieldName: '1own.1own_SSN',
        fieldFlags: REQUIRED_FLAG,
        fieldType: 'Tx'
      }
    ]
  );
  const layer = new NativeFieldLayer(() => [form] as any, jest.fn());
  expect(await layer.validate()).toEqual([
    { docIndex: 0, fieldName: '1own.SSN' }
  ]);
});

it('deduplicates required-field issues by docIndex and fieldName', async () => {
  const form = makeEntry(
    '44233',
    0,
    { '1own.MaritalStatus': [{ id: 'a1', type: 'radio', value: '' }] },
    {},
    [
      {
        fieldName: '1own.MaritalStatus',
        fieldFlags: REQUIRED_FLAG,
        fieldType: 'Btn'
      },
      {
        fieldName: '1own.MaritalStatus',
        fieldFlags: REQUIRED_FLAG,
        fieldType: 'Btn'
      }
    ]
  );
  const layer = new NativeFieldLayer(() => [form] as any, jest.fn());
  expect(await layer.validate()).toEqual([
    { docIndex: 0, fieldName: '1own.MaritalStatus' }
  ]);
});
