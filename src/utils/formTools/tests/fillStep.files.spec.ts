jest.mock('../../validation', () => ({
  phoneLib: { parsePhoneNumber: jest.fn() },
  phoneLibPromise: Promise.resolve(),
  loadPhoneValidator: jest.fn()
}));

const mockClearFilePathMapEntry = jest.fn();
jest.mock('../../formHelperFunctions', () => ({
  clearFilePathMapEntry: (...args: any[]) => mockClearFilePathMapEntry(...args)
}));

import internalState from '../../internalState';
import { fillStepTool } from '../fillStep';

const FORM = 'fill-step-files-form';

const emptyStepArrays = {
  subgrids: [],
  texts: [],
  images: [],
  buttons: [],
  tables: [],
  tabs: [],
  progress_bars: [],
  next_conditions: []
};

// 'hello world', base64-encoded.
const SMALL_PNG_B64 = 'aGVsbG8gd29ybGQ=';

const fileField = (key: string, metadata: Record<string, any> = {}) => ({
  id: `${key}-el`,
  position: [],
  properties: {},
  servar: {
    id: `${key}-sv`,
    key,
    type: 'file_upload',
    metadata: { file_types: [], ...metadata }
  }
});

let getNextStepKeyMock: jest.Mock;
let changeValueMock: jest.Mock;
let fieldOnChangeInner: jest.Mock;
let fieldOnChangeMock: jest.Mock;
let awaitChangeRulesMock: jest.Mock;
let submitFilesMock: jest.Mock;

const seed = (fields: any[]) => {
  const currentStep = {
    id: 'step-1',
    key: 'step-1',
    servar_fields: fields,
    ...emptyStepArrays
  };
  getNextStepKeyMock = jest.fn(() => undefined);
  changeValueMock = jest.fn((value: any, f: any) => {
    (internalState as any)[FORM].fields[f.servar.key] = { value };
  });
  fieldOnChangeInner = jest.fn();
  fieldOnChangeMock = jest.fn(
    (args: any) => (opts: any) => fieldOnChangeInner(args, opts)
  );
  awaitChangeRulesMock = jest.fn(async () => {
    (internalState as any)[FORM].formToolsRenderTick =
      ((internalState as any)[FORM].formToolsRenderTick ?? 0) + 1;
  });
  submitFilesMock = jest.fn(async () => undefined);

  (internalState as any)[FORM] = {
    currentStep,
    steps: { 'step-1': currentStep },
    fields: {},
    visiblePositions: {},
    inlineErrors: {},
    logicRules: [],
    formToolsRenderTick: 0,
    formToolsCallbacks: {
      changeValue: changeValueMock,
      fieldOnChange: fieldOnChangeMock,
      getNextStepKey: getNextStepKeyMock,
      awaitChangeRules: awaitChangeRulesMock,
      submitFiles: submitFilesMock
    }
  };
};

afterEach(() => {
  delete (internalState as any)[FORM];
  jest.clearAllMocks();
});

describe('fillStepTool: file_upload', () => {
  it('writes one file, clearing the path map entry, and resolves filled with {name, mimeType}', async () => {
    seed([fileField('resume')]);

    const result = await fillStepTool(FORM, {
      values: {
        resume: [
          {
            name: 'resume.txt',
            mimeType: 'text/plain',
            dataBase64: SMALL_PNG_B64
          }
        ]
      }
    });

    expect(mockClearFilePathMapEntry).toHaveBeenCalledWith('resume', null);
    expect(changeValueMock).toHaveBeenCalledTimes(1);
    const [writtenValue, writtenField, writtenIndex] =
      changeValueMock.mock.calls[0];
    expect(writtenIndex).toBeNull();
    expect(writtenField.servar.key).toBe('resume');
    expect(Array.isArray(writtenValue)).toBe(true);
    expect(writtenValue).toHaveLength(1);
    await expect(writtenValue[0]).resolves.toBeInstanceOf(File);

    expect(result.fields.resume).toEqual({
      status: 'filled',
      value: [{ name: 'resume.txt', mimeType: 'text/plain' }]
    });
  });

  it('rejects a second file on a non-multiple field', async () => {
    seed([fileField('resume')]);

    const result = await fillStepTool(FORM, {
      values: {
        resume: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 },
          { name: 'b.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
        ]
      }
    });

    expect(result.fields.resume.status).toBe('rejected');
    expect(result.fields.resume.message).toMatch(/only one file/);
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it("rejects a disallowed file type with FileUploadField's own message text", async () => {
    seed([fileField('resume', { file_types: ['.pdf'] })]);

    const result = await fillStepTool(FORM, {
      values: {
        resume: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
        ]
      }
    });

    expect(result.fields.resume).toEqual({
      status: 'rejected',
      message: 'Invalid file type. Allowed types: .pdf'
    });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized file with FileUploadField's own message text", async () => {
    seed([
      {
        ...fileField('resume'),
        servar: {
          id: 'resume-sv',
          key: 'resume',
          type: 'file_upload',
          max_length: 1, // 1 KB limit
          metadata: { file_types: [] }
        }
      }
    ]);
    // 2000 bytes, well over the 1 KB (1024-byte) limit above.
    const oversizedB64 = Buffer.from('A'.repeat(2000)).toString('base64');

    const result = await fillStepTool(FORM, {
      values: {
        resume: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: oversizedB64 }
        ]
      }
    });

    expect(result.fields.resume).toEqual({
      status: 'rejected',
      message: 'File exceeds max size of 1 kb'
    });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it('throws when more than one file field is in the same values call', async () => {
    seed([fileField('resume'), fileField('photo')]);

    await expect(
      fillStepTool(FORM, {
        values: {
          resume: [
            { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
          ],
          photo: [
            { name: 'b.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
          ]
        }
      })
    ).rejects.toThrow('at most one file field per call');
  });

  it('calls submitFiles once after a successful write, with the submitExtractionFiles-shaped entry', async () => {
    seed([fileField('resume')]);

    await fillStepTool(FORM, {
      values: {
        resume: [
          {
            name: 'resume.txt',
            mimeType: 'text/plain',
            dataBase64: SMALL_PNG_B64
          }
        ]
      }
    });

    expect(submitFilesMock).toHaveBeenCalledTimes(1);
    const [entries] = submitFilesMock.mock.calls[0];
    expect(entries).toEqual([
      {
        servar: {
          key: 'resume',
          file_upload: expect.any(Array),
          repeated: false
        },
        stepKey: 'step-1'
      }
    ]);
  });

  it("resolves 'rejected', not 'filled', when submitFiles fails", async () => {
    seed([fileField('resume')]);
    submitFilesMock.mockRejectedValueOnce(new Error('network down'));

    const result = await fillStepTool(FORM, {
      values: {
        resume: [
          {
            name: 'resume.txt',
            mimeType: 'text/plain',
            dataBase64: SMALL_PNG_B64
          }
        ]
      }
    });

    expect(result.fields.resume).toEqual({
      status: 'rejected',
      message: 'network down'
    });
  });
});

describe('fillStepTool: repeated file_upload', () => {
  const repeatedFileField = () => ({
    id: 'doc-el',
    position: [0, 0],
    properties: {},
    servar: {
      id: 'doc-sv',
      key: 'doc',
      type: 'file_upload',
      repeated: true,
      metadata: { file_types: [] }
    }
  });

  let addRepeatedRowMock: jest.Mock;

  const seedRepeated = (
    opts: { maxRepeats?: number; rowCount?: number } = {}
  ) => {
    const container = { id: 'grp-1', position: [0], repeated: true };
    const currentStep = {
      id: 'step-1',
      key: 'step-1',
      servar_fields: [repeatedFileField()],
      subgrids: [container],
      buttons:
        opts.maxRepeats === undefined
          ? []
          : [
              {
                id: 'add-btn',
                position: [],
                properties: {
                  actions: [
                    {
                      type: 'add_repeated_row',
                      repeat_container: 'grp-1',
                      max_repeats: opts.maxRepeats
                    }
                  ]
                }
              }
            ],
      ...emptyStepArrays
    };

    changeValueMock = jest.fn((value: any, f: any, index: number) => {
      const key = f.servar.key;
      const arr = [...((internalState as any)[FORM].fields[key]?.value ?? [])];
      arr[index] = value;
      (internalState as any)[FORM].fields[key] = { value: arr };
    });
    fieldOnChangeInner = jest.fn();
    fieldOnChangeMock = jest.fn(
      (args: any) => (opts2: any) => fieldOnChangeInner(args, opts2)
    );
    awaitChangeRulesMock = jest.fn(async () => {
      (internalState as any)[FORM].formToolsRenderTick =
        ((internalState as any)[FORM].formToolsRenderTick ?? 0) + 1;
    });
    submitFilesMock = jest.fn(async () => undefined);
    addRepeatedRowMock = jest.fn((_c: any, limit: number | null) => {
      const arr = (internalState as any)[FORM].fields.doc?.value ?? [];
      if (limit != null && arr.length >= limit) return;
      (internalState as any)[FORM].fields.doc = { value: [...arr, null] };
      const vp = (internalState as any)[FORM].visiblePositions;
      vp['0'] = [...vp['0'], true];
      vp['0,0'] = [...vp['0,0'], true];
      (internalState as any)[FORM].formToolsRenderTick =
        ((internalState as any)[FORM].formToolsRenderTick ?? 0) + 1;
    });

    const rowCount = opts.rowCount ?? 1;
    (internalState as any)[FORM] = {
      currentStep,
      steps: { 'step-1': currentStep },
      fields: { doc: { value: Array(rowCount).fill(null) } },
      visiblePositions: {
        '0': Array(rowCount).fill(true),
        '0,0': Array(rowCount).fill(true)
      },
      inlineErrors: {},
      logicRules: [],
      formToolsRenderTick: 0,
      formToolsCallbacks: {
        changeValue: changeValueMock,
        fieldOnChange: fieldOnChangeMock,
        getNextStepKey: jest.fn(() => undefined),
        awaitChangeRules: awaitChangeRulesMock,
        addRepeatedRow: addRepeatedRowMock,
        submitFiles: submitFilesMock
      }
    };
  };

  it('writes one file per row and calls submitFiles once with repeated: true', async () => {
    seedRepeated();

    const result = await fillStepTool(FORM, {
      values: {
        doc: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
        ]
      }
    });

    expect(mockClearFilePathMapEntry).toHaveBeenCalledWith('doc', 0);
    expect(result.fields.doc).toEqual({
      status: 'repeated',
      rows: [
        { status: 'filled', value: { name: 'a.txt', mimeType: 'text/plain' } }
      ]
    });
    expect(submitFilesMock).toHaveBeenCalledTimes(1);
    expect(submitFilesMock).toHaveBeenCalledWith([
      {
        servar: { key: 'doc', file_upload: expect.any(Array), repeated: true },
        stepKey: 'step-1'
      }
    ]);
  });

  it('calls submitFiles once for the whole field after multiple rows are written, not once per row', async () => {
    seedRepeated();

    const result = await fillStepTool(FORM, {
      values: {
        doc: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 },
          { name: 'b.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
        ]
      }
    });

    expect((result.fields.doc as any).rows).toEqual([
      { status: 'filled', value: { name: 'a.txt', mimeType: 'text/plain' } },
      { status: 'filled', value: { name: 'b.txt', mimeType: 'text/plain' } }
    ]);
    expect(submitFilesMock).toHaveBeenCalledTimes(1);
  });

  it('rejects a row given more than one file, even when metadata.multiple is true', async () => {
    seedRepeated();
    (internalState as any)[
      FORM
    ].currentStep.servar_fields[0].servar.metadata.multiple = true;

    const result = await fillStepTool(FORM, {
      values: {
        doc: [
          [
            {
              name: 'a.txt',
              mimeType: 'text/plain',
              dataBase64: SMALL_PNG_B64
            },
            { name: 'b.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
          ]
        ]
      }
    });

    expect((result.fields.doc as any).rows[0]).toEqual({
      status: 'rejected',
      message: "Field 'doc' accepts only one file per row."
    });
    expect(changeValueMock).not.toHaveBeenCalled();
  });

  it("resolves a row 'rejected', not 'filled', when submitFiles fails for that row", async () => {
    seedRepeated();
    submitFilesMock.mockRejectedValueOnce(new Error('network down'));

    const result = await fillStepTool(FORM, {
      values: {
        doc: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
        ]
      }
    });

    expect((result.fields.doc as any).rows[0]).toEqual({
      status: 'rejected',
      message: 'network down'
    });
  });

  it("resolves every written row 'rejected' when the one batched submitFiles call fails", async () => {
    seedRepeated();
    submitFilesMock.mockRejectedValueOnce(new Error('network down'));

    const result = await fillStepTool(FORM, {
      values: {
        doc: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 },
          { name: 'b.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
        ]
      }
    });

    expect((result.fields.doc as any).rows).toEqual([
      { status: 'rejected', message: 'network down' },
      { status: 'rejected', message: 'network down' }
    ]);
    expect(submitFilesMock).toHaveBeenCalledTimes(1);
  });
});
