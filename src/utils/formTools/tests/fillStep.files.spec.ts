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
import { fileField, seedForm } from './helpers';

const FORM = 'fill-step-files-form';

// 'hello world', base64-encoded.
const SMALL_PNG_B64 = 'aGVsbG8gd29ybGQ=';

let getNextStepKeyMock: jest.Mock;
let changeValueMock: jest.Mock;
let fieldOnChangeInner: jest.Mock;
let fieldOnChangeMock: jest.Mock;
let awaitChangeRulesMock: jest.Mock;
let submitFilesMock: jest.Mock;

const seed = (fields: any[], opts: Record<string, any> = {}) => {
  submitFilesMock = jest.fn(async () => undefined);
  ({
    changeValue: changeValueMock,
    fieldOnChange: fieldOnChangeMock,
    fieldOnChangeInner,
    awaitChangeRules: awaitChangeRulesMock,
    getNextStepKey: getNextStepKeyMock
  } = seedForm(FORM, {
    fields,
    ...opts,
    callbacks: { submitFiles: submitFilesMock, ...opts.callbacks }
  }));
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

  it('rolls back the write and leaves the field left_for_user when writing it would navigate', async () => {
    seed([fileField('resume')]);
    getNextStepKeyMock.mockReturnValue('step-2');

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
      status: 'left_for_user',
      message:
        'Filling this field would submit or navigate the form; left for the user to do themselves.'
    });
    expect((internalState as any)[FORM].fields.resume.value).toBeUndefined();
    // A rolled-back write never clears the path map, so the S3 dedup entry
    // for the (restored) prior value survives.
    expect(mockClearFilePathMapEntry).not.toHaveBeenCalled();
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

  const seedRepeated = (
    opts: { maxRepeats?: number; rowCount?: number } = {}
  ) => {
    const rowCount = opts.rowCount ?? 1;
    seed([repeatedFileField()], {
      step: {
        subgrids: [{ id: 'grp-1', position: [0], repeated: true }],
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
              ]
      },
      fieldValues: { doc: Array(rowCount).fill(null) },
      visiblePositions: {
        '0': Array(rowCount).fill(true),
        '0,0': Array(rowCount).fill(true)
      },
      // index === null mirrors the real changeValue: replace the field's whole
      // value outright (how fillStep.ts's row-level rollback restores it),
      // rather than writing into one row.
      changeValue: (value, f, index) => {
        const key = f.servar.key;
        const state = (internalState as any)[FORM];
        if (index === null) {
          state.fields[key] = { value };
          return;
        }
        const arr = [...(state.fields[key]?.value ?? [])];
        arr[index] = value;
        state.fields[key] = { value: arr };
        return true;
      },
      callbacks: {
        addRepeatedRow: jest.fn((_c: any, limit: number | null) => {
          const state = (internalState as any)[FORM];
          const arr = state.fields.doc?.value ?? [];
          if (limit != null && arr.length >= limit) return;
          state.fields.doc = { value: [...arr, null] };
          state.visiblePositions['0'] = [...state.visiblePositions['0'], true];
          state.visiblePositions['0,0'] = [
            ...state.visiblePositions['0,0'],
            true
          ];
          state.formToolsRenderTick += 1;
        })
      }
    });
  };

  it.each([1, 2])(
    'writes one file per row and calls submitFiles once for the whole field (%i rows)',
    async (rows) => {
      seedRepeated();
      const files = ['a.txt', 'b.txt'].slice(0, rows).map((name) => ({
        name,
        mimeType: 'text/plain',
        dataBase64: SMALL_PNG_B64
      }));

      const result = await fillStepTool(FORM, { values: { doc: files } });

      expect(mockClearFilePathMapEntry).toHaveBeenCalledWith('doc', 0);
      expect(result.fields.doc).toEqual({
        status: 'repeated',
        rows: files.map(({ name }) => ({
          status: 'filled',
          value: { name, mimeType: 'text/plain' }
        }))
      });
      expect(submitFilesMock).toHaveBeenCalledTimes(1);
      expect(submitFilesMock).toHaveBeenCalledWith([
        {
          servar: {
            key: 'doc',
            file_upload: expect.any(Array),
            repeated: true
          },
          stepKey: 'step-1'
        }
      ]);
    }
  );

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

  it('reports an earlier written row as filled and rolls back only the row whose write would navigate', async () => {
    seedRepeated({ rowCount: 2 });
    getNextStepKeyMock
      .mockReturnValueOnce(undefined) // row 0's write doesn't navigate
      .mockReturnValueOnce('step-2'); // row 1's write would

    const result = await fillStepTool(FORM, {
      values: {
        doc: [
          { name: 'a.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 },
          { name: 'b.txt', mimeType: 'text/plain', dataBase64: SMALL_PNG_B64 }
        ]
      }
    });

    expect(result.fields.doc).toEqual({
      status: 'repeated',
      rows: [
        { status: 'filled', value: { name: 'a.txt', mimeType: 'text/plain' } },
        {
          status: 'left_for_user',
          message:
            'Filling this field would submit or navigate the form; left for the user to do themselves.'
        }
      ]
    });
    // Row 1 rolled back to its pre-write (unset) value; row 0's write stands.
    expect((internalState as any)[FORM].fields.doc.value[1]).toBeNull();
    // Row 1's rollback never clears its path map entry.
    expect(mockClearFilePathMapEntry).not.toHaveBeenCalledWith('doc', 1);
  });
});
