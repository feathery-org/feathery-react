/**
 * A container does not need an input field to repeat.
 *
 * A text or button that references an array-valued `{{key}}` renders once per
 * entry, which is how a list fetched from an API is shown. Those rows are as
 * real as any other - the filler can see them and may want them in a different
 * order - so the keys behind them have to reach the same row model the reorder
 * controls consult. Reordering used to look only at the container's own
 * repeated fields, so a list built this way had no controls at all.
 */
import {
  getRepeatBoundImageKeys,
  getRepeatCarriedKeys,
  getRepeatContainerRowCount,
  getRepeatRowKeys,
  getRepeatTextVariableKeys,
  moveRepeatRowValue
} from '../repeat';
import { getDefaultFieldValue } from '../fieldHelperFunctions';

jest.mock('../init', () => ({
  initInfo: () => ({ sdkKey: 'key', userId: 'user' }),
  initFormsPromise: Promise.resolve(),
  initState: { defaultErrors: {}, language: '', formSessions: {} },
  fieldValues: {},
  filePathMap: {},
  fileDeduplicationCount: {},
  fileRetryStatus: {},
  setFieldValues: () => {},
  markStepCompleted: () => {},
  registerKnownFieldKeys: () => {},
  registerTextVariableFormats: () => {}
}));

const { fieldValues } = jest.requireMock('../init');

const container = { position: [6, 0], id: 'c', repeated: true };

/** A text inside the container, referencing the given copy. */
const text = (copy: string, position = [6, 0, 0]) => ({
  properties: { text: copy },
  position
});

const field = (key: string, position = [6, 0, 1]) => ({
  servar: { key, type: 'text_field', repeated: true, metadata: {} },
  position
});

const step = (overrides: any = {}) => ({
  servar_fields: [],
  texts: [],
  buttons: [],
  ...overrides
});

beforeEach(() => {
  Object.keys(fieldValues).forEach((k) => delete fieldValues[k]);
});

describe('getRepeatTextVariableKeys', () => {
  it('finds the array-valued key a row renders', () => {
    fieldValues.recipe = ['pizza', 'cookies'];
    const s = step({ texts: [text('{{recipe}}')] });
    expect(getRepeatTextVariableKeys(s as any, container as any)).toEqual([
      'recipe'
    ]);
  });

  it('reads buttons as well as texts', () => {
    fieldValues.label = ['a', 'b'];
    const s = step({ buttons: [text('Pick {{label}}')] });
    expect(getRepeatTextVariableKeys(s as any, container as any)).toEqual([
      'label'
    ]);
  });

  it('takes every reference in one string', () => {
    fieldValues.first = ['a'];
    fieldValues.last = ['b'];
    const s = step({ texts: [text('{{first}} {{last}}')] });
    expect(
      getRepeatTextVariableKeys(s as any, container as any).sort()
    ).toEqual(['first', 'last']);
  });

  it('ignores a scalar reference, which repeats a value rather than rows', () => {
    // The same greeting in every row is not row data and must not be permuted.
    fieldValues.greeting = 'hello';
    fieldValues.recipe = ['pizza', 'cookies'];
    const s = step({ texts: [text('{{greeting}} {{recipe}}')] });
    expect(getRepeatTextVariableKeys(s as any, container as any)).toEqual([
      'recipe'
    ]);
  });

  it('ignores copy outside the container', () => {
    fieldValues.outside = ['x', 'y'];
    const s = step({ texts: [text('{{outside}}', [7, 0])] });
    expect(getRepeatTextVariableKeys(s as any, container as any)).toEqual([]);
  });

  it('survives an element with no position', () => {
    // A button reached through an action carries none, and getPositionKey
    // returns null for it.
    fieldValues.recipe = ['pizza'];
    const s = step({ buttons: [{ properties: { text: '{{recipe}}' } }] });
    expect(getRepeatTextVariableKeys(s as any, container as any)).toEqual([]);
  });
});

describe('getRepeatRowKeys', () => {
  it('returns the container fields and its text variables together', () => {
    fieldValues.name = ['a', 'b'];
    fieldValues.recipe = ['pizza', 'cookies'];
    const s = step({
      servar_fields: [field('name')],
      texts: [text('{{recipe}}')]
    });
    expect(getRepeatRowKeys(s as any, container as any).sort()).toEqual([
      'name',
      'recipe'
    ]);
  });

  it('does not list a key twice when copy references its own field', () => {
    fieldValues.name = ['a', 'b'];
    const s = step({
      servar_fields: [field('name')],
      texts: [text('{{name}}')]
    });
    expect(getRepeatRowKeys(s as any, container as any)).toEqual(['name']);
  });

  it('is empty for a container with nothing behind its rows', () => {
    const s = step({ texts: [text('static copy')] });
    expect(getRepeatRowKeys(s as any, container as any)).toEqual([]);
  });
});

describe('getRepeatContainerRowCount', () => {
  it('counts rows a text variable alone renders', () => {
    // The whole point: no field in the container, five rows on screen.
    fieldValues.recipe = ['a', 'b', 'c', 'd', 'e'];
    const s = step({ texts: [text('{{recipe}}')] });
    expect(getRepeatContainerRowCount(s as any, container as any)).toBe(5);
  });

  it('takes the longest of field and text-variable sources', () => {
    // Matches the renderer, which maxes the same two counts. Disagreeing would
    // leave a visible row the controls refuse to move.
    fieldValues.name = ['a', 'b'];
    fieldValues.recipe = ['a', 'b', 'c', 'd'];
    const s = step({
      servar_fields: [field('name')],
      texts: [text('{{recipe}}')]
    });
    expect(getRepeatContainerRowCount(s as any, container as any)).toBe(4);
  });

  it('is still zero when nothing drives the rows', () => {
    const s = step({ texts: [text('static copy')] });
    expect(getRepeatContainerRowCount(s as any, container as any)).toBe(0);
  });
});

describe('the synthetic field a text variable is moved with', () => {
  // A text variable has no servar to borrow from, so Form builds one to pass
  // through the same permutation helpers. It has to satisfy everything those
  // helpers read - getDefaultFieldValue reaches into `servar.metadata`
  // unguarded, and an incomplete shape threw on every move in the browser
  // while every mocked unit test still passed.
  const synthetic = {
    servar: { key: 'recipe', type: 'text_field', repeated: true, metadata: {} }
  };

  it('is complete enough for getDefaultFieldValue', () => {
    expect(() => getDefaultFieldValue(synthetic)).not.toThrow();
  });

  it('permutes a copy-driven array through moveRepeatRowValue', () => {
    const moved = moveRepeatRowValue(
      ['pizza', 'cookies', 'pasta'],
      0,
      2,
      3,
      synthetic
    );
    expect(moved).toEqual(['cookies', 'pasta', 'pizza']);
  });

  it('fills an interior hole with a plain empty value', () => {
    // A short array padded and moved must not leave the sentinel behind.
    const moved = moveRepeatRowValue(['a'], 0, 2, 3, synthetic);
    expect(moved).toEqual(['', '', 'a']);
  });
});

describe('images bound to a field, which are row data without being fields', () => {
  // An image takes its source from fieldValues[key][repeat] - the same
  // indexing a repeated field uses - but nothing about it looks like a
  // {{variable}}. Missing it let the copy reorder while the pictures stayed
  // put, so row 1 showed row 3's photograph.
  const image = (key: string, position = [6, 0, 1]) => ({
    properties: { uploaded_image_file_field_key: key },
    position
  });

  it('finds an image bound to an array', () => {
    fieldValues['recipe image'] = ['a.png', 'b.png'];
    const s = step({ images: [image('recipe image')] });
    expect(getRepeatBoundImageKeys(s as any, container as any)).toEqual([
      'recipe image'
    ]);
  });

  it('finds a container background bound through styles', () => {
    fieldValues.bg = ['x.png', 'y.png'];
    const s = step({
      subgrids: [
        { styles: { uploaded_image_file_field_key: 'bg' }, position: [6, 0, 2] }
      ]
    });
    expect(getRepeatBoundImageKeys(s as any, container as any)).toEqual(['bg']);
  });

  it('ignores a binding outside the container', () => {
    fieldValues.other = ['x.png'];
    const s = step({ images: [image('other', [7, 0])] });
    expect(getRepeatBoundImageKeys(s as any, container as any)).toEqual([]);
  });

  it('ignores a binding whose value is not an array', () => {
    fieldValues.logo = 'one.png';
    const s = step({ images: [image('logo')] });
    expect(getRepeatBoundImageKeys(s as any, container as any)).toEqual([]);
  });

  it('carries the image alongside the copy that counts the rows', () => {
    fieldValues.recipe = ['pizza', 'cookies'];
    fieldValues['recipe image'] = ['a.png', 'b.png'];
    const s = step({
      texts: [text('{{recipe}}')],
      images: [image('recipe image')]
    });
    expect(getRepeatCarriedKeys(s as any, container as any).sort()).toEqual([
      'recipe',
      'recipe image'
    ]);
  });

  it('does not let a bound image invent rows', () => {
    // The renderer counts fields and text variables only, so an image array
    // longer than the copy must not make the controls promise a row that is
    // not on screen.
    fieldValues.recipe = ['pizza', 'cookies'];
    fieldValues['recipe image'] = ['a.png', 'b.png', 'c.png', 'd.png'];
    const s = step({
      texts: [text('{{recipe}}')],
      images: [image('recipe image')]
    });
    expect(getRepeatContainerRowCount(s as any, container as any)).toBe(2);
    expect(getRepeatRowKeys(s as any, container as any)).toEqual(['recipe']);
  });
});
