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
      awaitChangeRules: awaitChangeRulesMock
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
});
