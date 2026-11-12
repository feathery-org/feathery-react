import Field from '../entities/Field';
import { buildHubFileRefs } from '../hubFileRefs';
import { fieldValues } from '../init';

const steps = {
  docs_step: {
    key: 'docs_step',
    servar_fields: [
      { servar: { key: 'uploads', type: 'file_upload', repeated: true } },
      { servar: { key: 'attachments', type: 'file_upload' } },
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
const fileC = Promise.resolve(new File(['c'], 'c.pdf'));
const fileD = Promise.resolve(new File(['d'], 'd.pdf'));

beforeEach(() => {
  Object.assign(fieldValues, {
    uploads: [fileA, null, fileB],
    attachments: [fileC, '', fileD],
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
    // A repeated field's own value carries null for its empty rows.
    const holed = buildHubFileRefs({ docs: fieldValues.uploads }, steps);
    expect(holed.data).toEqual({ docs: [{ form_field: 'uploads' }] });
    expect(holed.submissions).toEqual([
      {
        servar: {
          key: 'uploads',
          file_upload: [fileA, null, fileB],
          repeated: true
        },
        stepKey: 'docs_step'
      }
    ]);
    const holedSome = buildHubFileRefs({ docs: [null, null, fileB] }, steps);
    expect(holedSome.data).toEqual({
      docs: [{ form_field: 'uploads', indices: [2] }]
    });

    const some = buildHubFileRefs({ docs: [fileB] }, steps);
    expect(some.data).toEqual({
      docs: [{ form_field: 'uploads', indices: [2] }]
    });
    // A file named twice is still one row, not the whole field.
    const repeated = buildHubFileRefs({ docs: [fileB, fileB] }, steps);
    expect(repeated.data).toEqual({
      docs: [{ form_field: 'uploads', indices: [2] }]
    });
    // A flat multi-file field's empty entries aren't stored, so don't count.
    const flat = buildHubFileRefs({ docs: [fileD] }, steps);
    expect(flat.data).toEqual({
      docs: [{ form_field: 'attachments', indices: [1] }]
    });
  });

  it('leaves values that are not form files untouched', () => {
    const stray = Promise.resolve(new File(['x'], 'x.pdf'));
    const items = [{ url: 'https://x', path: 'p' }];
    const rows = [{ docs: new Field('uploads', 'form') }];
    expect(
      buildHubFileRefs({ docs: [stray], other: items, empty: [null] }, steps)
    ).toEqual({
      data: { docs: [stray], other: items, empty: [null] },
      submissions: [],
      fields: []
    });
    // Batch rows are staged imports, never form uploads.
    expect(buildHubFileRefs(rows, steps)).toEqual({
      data: rows,
      submissions: [],
      fields: []
    });
  });
});
