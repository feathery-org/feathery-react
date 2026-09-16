/**
 * moveRepeatedRow as the Form actually wires it.
 *
 * A repeat row has no entity behind it: it is the same index across several
 * independent arrays plus two side channels (uploaded file paths and per-row
 * dropdown options). Nothing checks that those stay in step, so the only way a
 * caller learns they drifted is a submission with one row's answers wearing
 * another row's file. These tests assert they move together.
 */
import { FormHelperMod, GridMod, RepeatMod } from './testMocks';
import { act, render, screen, waitFor } from '@testing-library/react';
import { JSForm } from '..';
import { fieldValues, filePathMap } from '../../utils/init';
import internalState from '../../utils/internalState';

const container = { id: 'repeat-1', position: [0], repeated: true };

const field = (key: string, type: string) => ({
  servar: { key, type, repeated: true, metadata: {} },
  position: [0, 0]
});

const FIELDS = [
  field('name', 'text_field'),
  field('doc', 'file_upload'),
  field('pick', 'dropdown')
];

const setUp = (rows: number) => {
  RepeatMod.getContainerById = () => container;
  RepeatMod.getFieldsInRepeat = () => FIELDS;
  RepeatMod.getRepeatContainerRowCount = () => rows;
};

const reset = () => {
  Object.keys(fieldValues).forEach((k) => delete (fieldValues as any)[k]);
  Object.keys(filePathMap).forEach((k) => delete (filePathMap as any)[k]);
};

const mountForm = async (id: string) => {
  render(<JSForm formId='f1' _internalId={id} />);
  await screen.findByTestId('btn');
  // Per-row dropdown options live on the step, reached through internalState.
  // The mocked form setup does not build that entry, so stand one in and spy
  // on it - the call is how the third side channel gets permuted.
  const moveFieldOptions = jest.fn();
  const insertFieldOptions = jest.fn();
  const updateFieldOptions = jest.fn();
  (internalState as any)[id] = {
    ...((internalState as any)[id] ?? {}),
    moveFieldOptions,
    insertFieldOptions,
    updateFieldOptions
  };
  return {
    form: GridMod._spies.form,
    moveFieldOptions,
    insertFieldOptions,
    updateFieldOptions
  };
};

beforeEach(() => {
  reset();
  RepeatMod.getContainerById = () => undefined;
  RepeatMod.getFieldsInRepeat = () => [];
  RepeatMod.getRepeatContainerRowCount = () => 0;
  RepeatMod.getRepeatMaxRows = () => null;
  RepeatMod.getRepeatErrorOwnerIds = () => [];
  // Rows come from the container's own fields unless a spec says otherwise.
  RepeatMod.getRepeatTextVariableKeys = () => [];
  RepeatMod.getRepeatBoundImageKeys = () => [];
  RepeatMod.getRepeatRowKeys = (step: any, c: any) =>
    RepeatMod.getFieldsInRepeat(step, c).map((f: any) => f.servar.key);
  RepeatMod.getRepeatCarriedKeys = (step: any, c: any) =>
    RepeatMod.getRepeatRowKeys(step, c);
  FormHelperMod.clearBrowserErrors = jest.fn();
});

describe('moveRepeatedRow', () => {
  it('is reachable from the form context the grid receives', async () => {
    const { form } = await mountForm('iid-reorder-exposed');
    expect(typeof form.moveRepeatedRow).toBe('function');
  });

  it('permutes every field in the container together', async () => {
    (fieldValues as any).name = ['first', 'second', 'third'];
    (fieldValues as any).doc = ['a.pdf', 'b.pdf', 'c.pdf'];
    (fieldValues as any).pick = ['x', 'y', 'z'];
    (filePathMap as any).doc = ['a.pdf', 'b.pdf', 'c.pdf'];
    setUp(3);

    const { form, moveFieldOptions } = await mountForm('iid-reorder-all');
    expect(form.moveRepeatedRow(container, 0, 2)).toBe(true);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['second', 'third', 'first']);
    });
    expect((fieldValues as any).doc).toEqual(['b.pdf', 'c.pdf', 'a.pdf']);
    expect((fieldValues as any).pick).toEqual(['y', 'z', 'x']);
    // The file path map is the side channel that decides which S3 object each
    // row submits, so it has to take the identical permutation.
    expect((filePathMap as any).doc).toEqual(['b.pdf', 'c.pdf', 'a.pdf']);
    // And the per-row dropdown options are permuted over the same field set.
    expect(moveFieldOptions).toHaveBeenCalledWith(
      new Set(['name', 'doc', 'pick']),
      0,
      2
    );
  });

  it('keeps a short file array aligned with its longer siblings', async () => {
    // Only the first row ever got a file. Moving row 0 last must carry the
    // upload with it rather than leaving it against whatever lands at row 0.
    (fieldValues as any).name = ['first', 'second', 'third'];
    (fieldValues as any).doc = ['a.pdf'];
    (fieldValues as any).pick = ['x', 'y', 'z'];
    (filePathMap as any).doc = ['a.pdf'];
    setUp(3);

    const { form } = await mountForm('iid-reorder-short');
    form.moveRepeatedRow(container, 0, 2);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['second', 'third', 'first']);
    });
    expect((fieldValues as any).doc).toEqual([null, null, 'a.pdf']);
    expect((filePathMap as any).doc).toEqual([null, null, 'a.pdf']);
  });

  it('refuses a move it cannot carry out', async () => {
    (fieldValues as any).name = ['only'];
    setUp(1);

    const { form } = await mountForm('iid-reorder-refuse');
    // One row, a move onto itself, and an out-of-range target all resolve to
    // nothing to do; the caller needs to know so it skips its own follow-up.
    expect(form.moveRepeatedRow(container, 0, 0)).toBe(false);
    expect(form.moveRepeatedRow(undefined, 0, 1)).toBe(false);
    expect((fieldValues as any).name).toEqual(['only']);
  });

  it('clamps a target past the end onto the last real row', async () => {
    // A drop past the phantom trailing row a set_value trigger renders must
    // land on the last row that actually has data.
    (fieldValues as any).name = ['a', 'b'];
    (fieldValues as any).doc = ['x', 'y'];
    (fieldValues as any).pick = ['p', 'q'];
    setUp(2);

    const { form } = await mountForm('iid-reorder-clamp');
    expect(form.moveRepeatedRow(container, 0, 7)).toBe(true);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['b', 'a']);
    });
  });
});

/**
 * Inserting between rows is the same alignment problem as moving one: every
 * field and both side channels have to open a slot at the same physical row,
 * or the new row inherits fragments of its neighbours.
 */
describe('insertRepeatedRow', () => {
  it('opens a slot in every field at the same position', async () => {
    (fieldValues as any).name = ['first', 'second'];
    (fieldValues as any).doc = ['a.pdf', 'b.pdf'];
    (fieldValues as any).pick = ['x', 'y'];
    (filePathMap as any).doc = ['a.pdf', 'b.pdf'];
    setUp(2);

    const { form, insertFieldOptions } = await mountForm('iid-insert-mid');
    expect(form.insertRepeatedRow(container, 1)).toBe(true);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['first', '', 'second']);
    });
    expect((fieldValues as any).doc).toEqual(['a.pdf', '', 'b.pdf']);
    expect((filePathMap as any).doc).toEqual(['a.pdf', null, 'b.pdf']);
    expect(insertFieldOptions).toHaveBeenCalledWith(
      new Set(['name', 'doc', 'pick']),
      1
    );
  });

  it('inserts at the front', async () => {
    (fieldValues as any).name = ['first', 'second'];
    (fieldValues as any).doc = [];
    (fieldValues as any).pick = ['x', 'y'];
    setUp(2);

    const { form } = await mountForm('iid-insert-front');
    form.insertRepeatedRow(container, 0);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['', 'first', 'second']);
    });
  });

  it('clamps a position past the end onto the end', async () => {
    // The boundary count is one more than the row count, so the row count
    // itself is a legal position but anything beyond it is not.
    (fieldValues as any).name = ['first', 'second'];
    (fieldValues as any).doc = [];
    (fieldValues as any).pick = ['x', 'y'];
    setUp(2);

    const { form } = await mountForm('iid-insert-clamp');
    form.insertRepeatedRow(container, 9);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['first', 'second', '']);
    });
  });

  it('refuses when there is no container to insert into', async () => {
    const { form } = await mountForm('iid-insert-refuse');
    expect(form.insertRepeatedRow(undefined, 0)).toBe(false);
  });

  // Inserting between rows grows the container just as the add-row button
  // does, so it answers to the cap the author set on that button. Without this
  // the seam is a way around a limit the rest of the form enforces.
  it('refuses once the container is at the author row cap', async () => {
    setUp(3);
    RepeatMod.getRepeatMaxRows = () => 3;
    (fieldValues as any).name = ['a', 'b', 'c'];
    const { form } = await mountForm('iid-insert-capped');

    expect(form.insertRepeatedRow(container, 1)).toBe(false);
    expect((fieldValues as any).name).toEqual(['a', 'b', 'c']);
  });

  it('still inserts while the container is below the cap', async () => {
    setUp(2);
    RepeatMod.getRepeatMaxRows = () => 3;
    (fieldValues as any).name = ['a', 'b'];
    const { form } = await mountForm('iid-insert-under-cap');

    expect(form.insertRepeatedRow(container, 1)).toBe(true);
    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['a', '', 'b']);
    });
  });
});

describe('a container that repeats on copy alone', () => {
  // The rows of an API-fed list live in the array a `{{key}}` renders, not in
  // any field of the container. Moving a row has to permute that array or the
  // controls are decoration.
  const withCopyRows = (keys: string[], carried: string[] = keys) => {
    RepeatMod.getFieldsInRepeat = () => [];
    RepeatMod.getRepeatTextVariableKeys = () => keys;
    RepeatMod.getRepeatRowKeys = () => keys;
    RepeatMod.getRepeatCarriedKeys = () => carried;
  };

  it('permutes the array behind the copy', async () => {
    (fieldValues as any).recipe = ['pizza', 'cookies', 'pasta'];
    withCopyRows(['recipe']);
    RepeatMod.getRepeatContainerRowCount = () => 3;

    const { form } = await mountForm('iid-copy-move');
    expect(form.moveRepeatedRow(container, 0, 2)).toBe(true);

    await waitFor(() => {
      expect((fieldValues as any).recipe).toEqual(['cookies', 'pasta', 'pizza']);
    });
  });

  it('moves every referenced array together', async () => {
    // Two columns of one list: they must not shear apart.
    (fieldValues as any).recipe = ['pizza', 'cookies'];
    (fieldValues as any).calories = [800, 200];
    withCopyRows(['recipe', 'calories']);
    RepeatMod.getRepeatContainerRowCount = () => 2;

    const { form } = await mountForm('iid-copy-move-pair');
    form.moveRepeatedRow(container, 0, 1);

    await waitFor(() => {
      expect((fieldValues as any).recipe).toEqual(['cookies', 'pizza']);
    });
    expect((fieldValues as any).calories).toEqual([200, 800]);
  });

  it('carries a bound image with the row that renders it', async () => {
    // The copy counted the rows, the picture just rode along - and used to
    // stay behind, leaving row 1 showing row 3's photograph.
    (fieldValues as any).recipe = ['pizza', 'cookies', 'pasta'];
    (fieldValues as any)['recipe image'] = ['a.png', 'b.png', 'c.png'];
    withCopyRows(['recipe'], ['recipe', 'recipe image']);
    RepeatMod.getRepeatContainerRowCount = () => 3;

    const { form } = await mountForm('iid-copy-image');
    expect(form.moveRepeatedRow(container, 0, 2)).toBe(true);

    await waitFor(() => {
      expect((fieldValues as any).recipe).toEqual(['cookies', 'pasta', 'pizza']);
    });
    expect((fieldValues as any)['recipe image']).toEqual([
      'b.png',
      'c.png',
      'a.png'
    ]);
  });

  it('refuses when nothing at all drives the rows', async () => {
    withCopyRows([]);
    RepeatMod.getRepeatContainerRowCount = () => 0;

    const { form } = await mountForm('iid-copy-none');
    expect(form.moveRepeatedRow(container, 0, 1)).toBe(false);
  });
});

describe('removeRepeatedRowAt', () => {
  it('drops the same slot from every field and side channel', async () => {
    (fieldValues as any).name = ['first', 'second', 'third'];
    (fieldValues as any).doc = ['a.pdf', 'b.pdf', 'c.pdf'];
    (fieldValues as any).pick = ['x', 'y', 'z'];
    (filePathMap as any).doc = ['a.pdf', 'b.pdf', 'c.pdf'];
    setUp(3);

    const { form, updateFieldOptions } = await mountForm('iid-remove-mid');
    expect(form.removeRepeatedRowAt(container, 1)).toBe(true);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['first', 'third']);
    });
    expect((fieldValues as any).doc).toEqual(['a.pdf', 'c.pdf']);
    expect((filePathMap as any).doc).toEqual(['a.pdf', 'c.pdf']);
    expect(updateFieldOptions).toHaveBeenCalledWith(
      { name: null, doc: null, pick: null },
      1
    );
  });

  it('refuses an index the container does not have', async () => {
    (fieldValues as any).name = ['first', 'second'];
    setUp(2);
    const { form } = await mountForm('iid-remove-range');

    expect(form.removeRepeatedRowAt(container, 2)).toBe(false);
    expect(form.removeRepeatedRowAt(container, -1)).toBe(false);
    expect(form.removeRepeatedRowAt(undefined, 0)).toBe(false);
    expect((fieldValues as any).name).toEqual(['first', 'second']);
  });
});

/**
 * The row cap belongs to the container, not to any one field inside it.
 * Deciding per field let a field that trails empty rows keep growing after its
 * siblings had already stopped at the cap, so "add one row" quietly meant
 * "top up the short columns".
 */
describe('addRepeatedRow at the row cap', () => {
  const addRowAction = (maxRepeats: number) => [
    {
      type: 'add_repeated_row',
      repeat_container: 'repeat-1',
      max_repeats: maxRepeats
    }
  ];

  const clickAddRow = async (id: string, maxRepeats: number) => {
    GridMod._spies.actions = addRowAction(maxRepeats);
    render(<JSForm formId='f1' _internalId={id} />);
    const button = await screen.findByTestId('btn');
    button.click();
  };

  afterEach(() => {
    GridMod._spies.actions = [];
  });

  it('adds nothing at all once the container is at the cap', async () => {
    setUp(3);
    (fieldValues as any).name = ['a', 'b', 'c'];
    // Shorter than its siblings, the way a file field is whenever it ends in
    // empty rows. Judging the cap per field would grow this one.
    (fieldValues as any).doc = ['f0'];
    (fieldValues as any).pick = ['x', 'y', 'z'];

    await clickAddRow('iid-add-capped', 3);

    await waitFor(() => expect(screen.getByTestId('btn')).toBeTruthy());
    expect((fieldValues as any).name).toEqual(['a', 'b', 'c']);
    expect((fieldValues as any).doc).toEqual(['f0']);
    expect((fieldValues as any).pick).toEqual(['x', 'y', 'z']);
  });

  it('adds a row to every field while below the cap', async () => {
    setUp(2);
    (fieldValues as any).name = ['a', 'b'];
    (fieldValues as any).doc = ['f0'];
    (fieldValues as any).pick = ['x', 'y'];

    await clickAddRow('iid-add-under-cap', 3);

    await waitFor(() => {
      expect((fieldValues as any).name).toEqual(['a', 'b', '']);
    });
    expect((fieldValues as any).doc).toEqual(['f0', '']);
  });
});

/**
 * Per-row errors are the fourth thing that has to take the same permutation as
 * the values, alongside filePathMap and repeat_options. They live in each
 * owner's `byIndex` map, and the owners are not just the servar fields: a
 * button or nested container inside the container is clickable once per row, so
 * its action failures are per-row too.
 */
describe('per-row errors follow their rows', () => {
  const OWNERS = ['name', 'doc', 'pick', 'btn-in-row'];

  const seedErrors = async (errors: any) => {
    await act(async () => GridMod._spies.form.setInlineErrors(errors));
  };

  it('renumbers a moved row errors, buttons as well as fields', async () => {
    (fieldValues as any).name = ['a', 'b', 'c'];
    (fieldValues as any).doc = ['x', 'y', 'z'];
    (fieldValues as any).pick = ['p', 'q', 'r'];
    setUp(3);
    RepeatMod.getRepeatErrorOwnerIds = () => OWNERS;

    const id = 'iid-reorder-errors-move';
    await mountForm(id);
    await seedErrors({
      name: { byIndex: { 0: { message: 'row 0 required' } } },
      'btn-in-row': { byIndex: { 2: { message: 'row 2 submit failed' } } }
    });

    await act(async () => {
      GridMod._spies.form.moveRepeatedRow(container, 0, 2);
    });

    await waitFor(() => {
      // Row 0 went to the end and took its error with it. Row 2 came up one.
      expect(GridMod._spies.form.inlineErrors).toEqual({
        name: { byIndex: { 2: { message: 'row 0 required' } } },
        'btn-in-row': { byIndex: { 1: { message: 'row 2 submit failed' } } }
      });
    });
  });

  it('shifts the displaced rows errors up when a row is inserted', async () => {
    (fieldValues as any).name = ['a', 'b'];
    (fieldValues as any).doc = ['x', 'y'];
    (fieldValues as any).pick = ['p', 'q'];
    setUp(2);
    RepeatMod.getRepeatErrorOwnerIds = () => OWNERS;

    const id = 'iid-reorder-errors-insert';
    await mountForm(id);
    await seedErrors({
      name: { byIndex: { 1: { message: 'row 1 required' } } }
    });

    await act(async () => {
      GridMod._spies.form.insertRepeatedRow(container, 1);
    });

    await waitFor(() => {
      // The old row 1 is now row 2. The brand new row 1 starts clean, so a row
      // nobody has filled in yet does not inherit its neighbour's error.
      expect(GridMod._spies.form.inlineErrors).toEqual({
        name: { byIndex: { 2: { message: 'row 1 required' } } }
      });
    });
  });

  it('shifts the rows below a removed row up, and drops its own error', async () => {
    (fieldValues as any).name = ['a', 'b', 'c'];
    (fieldValues as any).doc = ['x', 'y', 'z'];
    (fieldValues as any).pick = ['p', 'q', 'r'];
    setUp(3);
    RepeatMod.getRepeatErrorOwnerIds = () => OWNERS;

    const id = 'iid-reorder-errors-remove';
    await mountForm(id);
    await seedErrors({
      name: {
        byIndex: {
          1: { message: 'row 1 required' },
          2: { message: 'row 2 required' }
        }
      }
    });

    await act(async () => {
      GridMod._spies.form.removeRepeatedRowAt(container, 1);
    });

    await waitFor(() => {
      // Row 1 is gone with its error. The old row 2 is now row 1 and keeps its
      // own error, rather than inheriting the removed row's.
      expect(GridMod._spies.form.inlineErrors).toEqual({
        name: { byIndex: { 1: { message: 'row 2 required' } } }
      });
    });
  });

  it('clears browser validity on a move, which cannot be reindexed', async () => {
    // html5 errors live on the DOM node as setCustomValidity state and repeat
    // rows are keyed by array position, so after a move each node holds the
    // previous occupant's validity. Same reason removeRepeatedRow clears.
    (fieldValues as any).name = ['a', 'b'];
    (fieldValues as any).doc = ['x', 'y'];
    (fieldValues as any).pick = ['p', 'q'];
    setUp(2);

    const id = 'iid-reorder-errors-html5';
    await mountForm(id);
    expect(FormHelperMod.clearBrowserErrors).not.toHaveBeenCalled();

    await act(async () => {
      GridMod._spies.form.moveRepeatedRow(container, 0, 1);
    });

    expect(FormHelperMod.clearBrowserErrors).toHaveBeenCalled();
  });

  it('leaves errors alone on a move it refuses', async () => {
    (fieldValues as any).name = ['only'];
    setUp(1);
    RepeatMod.getRepeatErrorOwnerIds = () => OWNERS;

    const id = 'iid-reorder-errors-refused';
    await mountForm(id);
    await seedErrors({
      name: { byIndex: { 0: { message: 'row 0 required' } } }
    });

    await act(async () => {
      expect(GridMod._spies.form.moveRepeatedRow(container, 0, 0)).toBe(false);
    });

    expect(GridMod._spies.form.inlineErrors).toEqual({
      name: { byIndex: { 0: { message: 'row 0 required' } } }
    });
    expect(FormHelperMod.clearBrowserErrors).not.toHaveBeenCalled();
  });
});
