import Field from '../entities/Field';
import { buildHubFileRefs } from '../hubFileRefs';
import { fieldValues } from '../init';

const steps = {
  docs_step: {
    key: 'docs_step',
    servar_fields: [
      { servar: { key: 'uploads', type: 'file_upload', repeated: true } },
      { servar: { key: 'name', type: 'text_field' } }
    ]
  },
  sign_step: {
    key: 'sign_step',
    servar_fields: [{ servar: { key: 'sig', type: 'signature' } }]
  }
};

const fileA = Promise.resolve(new File(['a'], 'a.pdf'));
const fileB = Promise.resolve(new File(['b'], 'b.pdf'));
const sig = Promise.resolve(new File(['s'], 'sig.png'));

beforeEach(() => {
  Object.assign(fieldValues, {
    uploads: [fileA, null, fileB],
    sig,
    name: 'Ann'
  });
});

describe('buildHubFileRefs', () => {
  it('turns a form file field into a reference and lists it for upload', () => {
    const { data, submissions } = buildHubFileRefs(
      {
        name: 'Ann',
        docs: new Field('uploads', 'form'),
        signature: fieldValues.sig
      },
      steps
    );
    expect(data).toEqual({
      name: 'Ann',
      docs: [{ form_field: 'uploads' }],
      signature: [{ form_field: 'sig' }]
    });
    expect(submissions).toEqual([
      {
        servar: {
          key: 'uploads',
          file_upload: [fileA, null, fileB],
          repeated: true
        },
        stepKey: 'docs_step'
      },
      {
        servar: { key: 'sig', signature: sig, repeated: false },
        stepKey: 'sign_step'
      }
    ]);
  });

  it('names the repeat rows of a partial selection by their index', () => {
    const whole = buildHubFileRefs({ docs: [fileA, fileB] }, steps);
    expect(whole.data).toEqual({ docs: [{ form_field: 'uploads' }] });

    const some = buildHubFileRefs({ docs: [fileB] }, steps);
    expect(some.data).toEqual({
      docs: [{ form_field: 'uploads', indices: [2] }]
    });
    // A file named twice is still one row, not the whole field.
    const repeated = buildHubFileRefs({ docs: [fileB, fileB] }, steps);
    expect(repeated.data).toEqual({
      docs: [{ form_field: 'uploads', indices: [2] }]
    });
  });

  it('leaves values that are not form files untouched', () => {
    const stray = Promise.resolve(new File(['x'], 'x.pdf'));
    const items = [{ url: 'https://x', path: 'p' }];
    const rows = [{ docs: new Field('uploads', 'form') }];
    expect(buildHubFileRefs({ docs: [stray], other: items }, steps)).toEqual({
      data: { docs: [stray], other: items },
      submissions: []
    });
    // Batch rows are staged imports, never form uploads.
    expect(buildHubFileRefs(rows, steps)).toEqual({
      data: rows,
      submissions: []
    });
  });
});
