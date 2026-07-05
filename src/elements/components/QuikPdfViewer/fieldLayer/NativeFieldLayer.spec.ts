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

it('reset calls remount', () => {
  const remount = jest.fn();
  new NativeFieldLayer(() => [], remount).reset();
  expect(remount).toHaveBeenCalled();
});
