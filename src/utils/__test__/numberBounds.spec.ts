import {
  getNumberBoundReferences,
  hasDynamicBounds,
  movingBoundSides,
  resolveNumberBounds,
  widenBoundsToValue
} from '../numberBounds';
import { fieldValues } from '../init';

const ref = (fieldKey: string) => ({
  field_type: 'servar' as const,
  field_id: `${fieldKey}-id`,
  field_key: fieldKey
});

const numberServar = (boundFields?: any, servar: any = {}) => ({
  type: 'integer_field',
  key: 'amount',
  min_length: 1,
  max_length: 1000,
  metadata: { bound_fields: boundFields },
  ...servar
});

const clearFieldValues = () =>
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);

describe('resolveNumberBounds', () => {
  beforeEach(clearFieldValues);

  it('falls back to the columns with no references', () => {
    expect(resolveNumberBounds(numberServar())).toEqual({
      min: 1,
      max: 1000
    });
    expect(resolveNumberBounds(numberServar({ min: null, max: null }))).toEqual(
      { min: 1, max: 1000 }
    );
    expect(
      resolveNumberBounds({ type: 'integer_field', metadata: {} })
    ).toEqual({
      min: null,
      max: null
    });
  });

  it('reads a referenced field in place of the column', () => {
    Object.assign(fieldValues, { ceiling: 250 });
    const servar = numberServar({ min: null, max: ref('ceiling') });

    // The referenced max wins; the min still comes from its column
    expect(resolveNumberBounds(servar)).toEqual({
      min: 1,
      max: 250
    });
    expect(hasDynamicBounds(servar)).toBe(true);
  });

  it('treats an empty or non-numeric reference as unbounded', () => {
    const servar = numberServar({ min: ref('floor'), max: ref('ceiling') });
    Object.assign(fieldValues, { floor: '', ceiling: 'abc' });
    expect(resolveNumberBounds(servar)).toMatchObject({ min: null, max: null });

    Object.assign(fieldValues, { floor: '3', ceiling: 250.5 });
    expect(resolveNumberBounds(servar)).toMatchObject({ min: 3, max: 250.5 });
  });

  it('resolves per repeat row and reads row 0 from outside a repeat', () => {
    Object.assign(fieldValues, { cap: [15, 25] });
    const servar = numberServar({ min: null, max: ref('cap') });

    expect(resolveNumberBounds(servar, 0).max).toBe(15);
    expect(resolveNumberBounds(servar, 1).max).toBe(25);
    expect(resolveNumberBounds(servar).max).toBe(15);
  });

  it('survives malformed metadata', () => {
    expect(resolveNumberBounds(numberServar('nope'))).toEqual({
      min: 1,
      max: 1000
    });
    expect(hasDynamicBounds({})).toBe(false);
  });
});

describe('widenBoundsToValue', () => {
  const both = { min: true, max: true };

  it('opens each side just far enough to admit the value', () => {
    const bounds = { min: 10, max: 20 };
    expect(widenBoundsToValue(bounds, 25, both)).toEqual({ min: 10, max: 25 });
    expect(widenBoundsToValue(bounds, '5', both)).toEqual({ min: 5, max: 20 });
    expect(widenBoundsToValue(bounds, 15, both)).toEqual(bounds);
    expect(widenBoundsToValue(bounds, '', both)).toEqual(bounds);
    expect(widenBoundsToValue({ min: null, max: 20 }, -5, both)).toEqual({
      min: null,
      max: 20
    });
  });

  // A side backed by a static column must keep its clamp even when the other
  // side tracks a field
  it('leaves a side alone when that side cannot move', () => {
    const bounds = { min: 10, max: 100 };
    expect(widenBoundsToValue(bounds, 5, { min: false, max: true })).toEqual(
      bounds
    );
    expect(widenBoundsToValue(bounds, 150, { min: true, max: false })).toEqual(
      bounds
    );
    expect(widenBoundsToValue(bounds, 5, { min: true, max: false })).toEqual({
      min: 5,
      max: 100
    });
  });
});

describe('movingBoundSides', () => {
  it('answers per side, not per field', () => {
    expect(
      movingBoundSides(numberServar({ min: null, max: ref('c') }))
    ).toEqual({ min: false, max: true });
    expect(movingBoundSides(numberServar())).toEqual({
      min: false,
      max: false
    });
  });
});

describe('getNumberBoundReferences', () => {
  const elements = (...els: any[]): [any, string][] =>
    els.map((el, i) => [el, String(i)]);

  it('collects every referenced field key', () => {
    const refs = getNumberBoundReferences(
      elements(
        { properties: { text: 'no servar' } },
        { servar: { metadata: {} } },
        { servar: numberServar({ min: ref('floor'), max: ref('ceiling') }) }
      )
    );
    expect([...refs].sort()).toEqual(['ceiling', 'floor']);
  });
});
