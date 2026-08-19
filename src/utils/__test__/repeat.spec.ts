import { fieldValues } from '../init';
import {
  getDynamicContainerRepeatCap,
  getMaxRepeatsFieldReferences,
  MAX_DYNAMIC_REPEATS,
  resolveMaxRepeats,
  sanitizeRepeatLimit
} from '../repeat';
import { getVisiblePositions } from '../hideAndRepeats';
import { ACTION_ADD_REPEATED_ROW } from '../elementActions';

const clearFieldValues = () =>
  Object.keys(fieldValues).forEach((k) => delete (fieldValues as any)[k]);

const addAction = (overrides: any = {}) => ({
  type: ACTION_ADD_REPEATED_ROW,
  repeat_container: 'c1',
  ...overrides
});

const stepWithActions = (actions: any[]) => ({
  subgrids: [],
  servar_fields: [],
  texts: [],
  buttons: [{ properties: { actions } }],
  images: []
});

describe('sanitizeRepeatLimit', () => {
  it('returns null for empty, non-numeric, or non-positive values', () => {
    [null, undefined, '', 'abc', NaN, 0, -3, -0.5].forEach((v) =>
      expect(sanitizeRepeatLimit(v)).toBeNull()
    );
  });

  it('floors valid positive numbers (numbers or numeric strings)', () => {
    expect(sanitizeRepeatLimit(3)).toBe(3);
    expect(sanitizeRepeatLimit('4')).toBe(4);
    expect(sanitizeRepeatLimit(2.9)).toBe(2);
  });

  it('reads the first entry of an array (repeated hidden field)', () => {
    expect(sanitizeRepeatLimit(['5', '9'])).toBe(5);
    expect(sanitizeRepeatLimit([])).toBeNull();
  });

  it('clamps to the safety ceiling', () => {
    expect(sanitizeRepeatLimit(10_000)).toBe(MAX_DYNAMIC_REPEATS);
  });
});

describe('resolveMaxRepeats', () => {
  beforeEach(clearFieldValues);

  it('uses the static max_repeats by default (backward compatible)', () => {
    expect(resolveMaxRepeats({ max_repeats: 3 })).toBe(3);
    expect(resolveMaxRepeats({ max_repeats: '' })).toBeNull();
    expect(resolveMaxRepeats({})).toBeNull();
  });

  it('resolves a referenced field value when the type is field', () => {
    Object.assign(fieldValues, { limit_field: 4 });
    expect(
      resolveMaxRepeats({
        max_repeats_type: 'field',
        max_repeats_field_key: 'limit_field'
      })
    ).toBe(4);
  });

  it('returns null when the referenced field is empty, invalid, or unset', () => {
    Object.assign(fieldValues, { empty_field: '' });
    expect(
      resolveMaxRepeats({
        max_repeats_type: 'field',
        max_repeats_field_key: 'empty_field'
      })
    ).toBeNull();
    expect(
      resolveMaxRepeats({
        max_repeats_type: 'field',
        max_repeats_field_key: 'missing_field'
      })
    ).toBeNull();
    expect(resolveMaxRepeats({ max_repeats_type: 'field' })).toBeNull();
  });
});

describe('getDynamicContainerRepeatCap', () => {
  beforeEach(clearFieldValues);

  it('never derives a render cap from a static max (legacy behavior)', () => {
    const step = stepWithActions([addAction({ max_repeats: 3 })]);
    expect(getDynamicContainerRepeatCap(step, { id: 'c1' })).toBeNull();
  });

  it('resolves a dynamic cap from the referenced field, matching container only', () => {
    Object.assign(fieldValues, { limit_field: 2 });
    const step = stepWithActions([
      addAction({
        max_repeats_type: 'field',
        max_repeats_field_key: 'limit_field'
      })
    ]);
    expect(getDynamicContainerRepeatCap(step, { id: 'c1' })).toBe(2);
    expect(getDynamicContainerRepeatCap(step, { id: 'other' })).toBeNull();
  });

  it('treats an empty referenced field as uncapped', () => {
    Object.assign(fieldValues, { limit_field: '' });
    const step = stepWithActions([
      addAction({
        max_repeats_type: 'field',
        max_repeats_field_key: 'limit_field'
      })
    ]);
    expect(getDynamicContainerRepeatCap(step, { id: 'c1' })).toBeNull();
  });
});

describe('getMaxRepeatsFieldReferences', () => {
  it('collects field keys from dynamic max-repeats actions', () => {
    const step = stepWithActions([
      addAction({ max_repeats_type: 'field', max_repeats_field_key: 'a' }),
      addAction({ max_repeats: 3 })
    ]);
    expect([...getMaxRepeatsFieldReferences(step)]).toEqual(['a']);
  });
});

describe('render-time clamp via getVisiblePositions', () => {
  const buildStep = (actions: any[]) => ({
    subgrids: [
      { id: 'c1', repeated: true, position: [0], properties: { actions } }
    ],
    servar_fields: [
      {
        position: [0, 0],
        servar: { key: 'k', repeated: true, type: 'text_field', metadata: {} }
      }
    ],
    texts: [],
    buttons: [],
    progress_bars: [],
    images: [],
    videos: [],
    tables: [],
    tabs: []
  });

  beforeEach(() => {
    clearFieldValues();
    // Four rows of data in the repeated field.
    Object.assign(fieldValues, { k: ['a', 'b', 'c', 'd'] });
  });

  it('renders the data-driven count when there is no cap', () => {
    const vp = getVisiblePositions(buildStep([]), 'internal');
    expect(vp['0,0'].length).toBe(4);
  });

  it('does not clamp rendering for a static max (legacy behavior preserved)', () => {
    const vp = getVisiblePositions(
      buildStep([addAction({ max_repeats: 2 })]),
      'internal'
    );
    expect(vp['0,0'].length).toBe(4);
  });

  it('clamps to a dynamic cap resolved from a field', () => {
    Object.assign(fieldValues, { limit_field: 3 });
    const vp = getVisiblePositions(
      buildStep([
        addAction({
          max_repeats_type: 'field',
          max_repeats_field_key: 'limit_field'
        })
      ]),
      'internal'
    );
    expect(vp['0,0'].length).toBe(3);
  });

  it('never collapses below one row when the cap is invalid/empty', () => {
    Object.assign(fieldValues, { limit_field: 0 });
    const vp = getVisiblePositions(
      buildStep([
        addAction({
          max_repeats_type: 'field',
          max_repeats_field_key: 'limit_field'
        })
      ]),
      'internal'
    );
    // 0 is treated as "no limit", so the data-driven count is used.
    expect(vp['0,0'].length).toBe(4);
  });
});
