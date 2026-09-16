import {
  getNumberBoundReferences,
  hasDynamicBounds,
  movingBoundSides,
  resolveNumberBounds,
  widenBoundsToValue
} from '../numberBounds';
import { condition, ref } from './numberBounds-test-utils';
import { fieldValues } from '../init';

const numberServar = (boundFields?: any, servar: any = {}) => ({
  type: 'integer_field',
  key: 'amount',
  min_length: 1,
  max_length: 1000,
  metadata: { bound_fields: boundFields },
  ...servar
});

const ruleServar = (rules: any, servar: any = {}) => ({
  type: 'integer_field',
  key: 'amount',
  min_length: 1,
  max_length: 1000,
  metadata: { dynamic_bounds: rules },
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

  it('applies the first rule whose conditions all pass', () => {
    Object.assign(fieldValues, { range: '20-30' });
    const servar = ruleServar([
      {
        id: 'low',
        conditions: [condition('range', 'equal', ['10-20'])],
        min: 10,
        max: 20
      },
      {
        id: 'mid',
        conditions: [condition('range', 'equal', ['20-30'])],
        min: 20,
        max: 30
      },
      { id: 'always', conditions: [], min: 0, max: 5 }
    ]);

    expect(resolveNumberBounds(servar)).toEqual({
      min: 20,
      max: 30
    });

    Object.assign(fieldValues, { range: 'other' });
    expect(resolveNumberBounds(servar)).toEqual({
      min: 0,
      max: 5
    });
  });

  it('falls back to the static columns when no rule matches', () => {
    Object.assign(fieldValues, { range: 'other' });
    const servar = ruleServar([
      {
        id: 'low',
        conditions: [condition('range', 'equal', ['10-20'])],
        min: 10,
        max: 20
      }
    ]);
    expect(resolveNumberBounds(servar)).toEqual({
      min: 1,
      max: 1000
    });
  });

  it('resolves a rule per repeat row and reads row 0 from outside a repeat', () => {
    Object.assign(fieldValues, {
      range: ['10-20', '20-30'],
      cap: [15, 25]
    });
    const servar = ruleServar([
      {
        id: 'low',
        conditions: [condition('range', 'equal', ['10-20'])],
        min: 10,
        max: ref('cap')
      },
      {
        id: 'mid',
        conditions: [condition('range', 'equal', ['20-30'])],
        min: 20,
        max: ref('cap')
      }
    ]);

    expect(resolveNumberBounds(servar, 0)).toEqual({
      min: 10,
      max: 15
    });
    expect(resolveNumberBounds(servar, 1)).toEqual({
      min: 20,
      max: 25
    });
    // Without a row the comparison sees every row, so the first rule matches
    expect(resolveNumberBounds(servar)).toEqual({
      min: 10,
      max: 15
    });
  });

  it('falls back to a bound bound to another field before the columns', () => {
    Object.assign(fieldValues, { ceiling: 250, range: 'other' });
    // numberServar's overrides replace metadata wholesale, so build it here
    const servar = {
      type: 'integer_field',
      key: 'amount',
      min_length: 1,
      max_length: 1000,
      metadata: {
        bound_fields: { min: null, max: ref('ceiling') },
        dynamic_bounds: [
          {
            id: 'low',
            conditions: [condition('range', 'equal', ['10-20'])],
            min: 10,
            max: 20
          }
        ]
      }
    };

    // No rule matches, so the base applies: column min, referenced max
    expect(resolveNumberBounds(servar)).toEqual({
      min: 1,
      max: 250
    });
    expect(hasDynamicBounds(servar)).toBe(true);

    // A matching rule still takes priority over the base
    Object.assign(fieldValues, { range: '10-20' });
    expect(resolveNumberBounds(servar)).toEqual({
      min: 10,
      max: 20
    });

    // An empty referenced field leaves that side unbounded
    Object.assign(fieldValues, { ceiling: '', range: 'other' });
    expect(resolveNumberBounds(servar).max).toBeNull();
  });

  it('treats bound_fields alone as dynamic without any rules', () => {
    Object.assign(fieldValues, { ceiling: 80 });
    const servar = {
      type: 'integer_field',
      min_length: 5,
      max_length: 100,
      metadata: { bound_fields: { min: null, max: ref('ceiling') } }
    };
    expect(resolveNumberBounds(servar)).toEqual({
      min: 5,
      max: 80
    });
    expect(
      hasDynamicBounds({ metadata: { bound_fields: { min: null, max: null } } })
    ).toBe(false);
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
  // side can move
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
  beforeEach(clearFieldValues);

  it('answers per side, not per field', () => {
    expect(
      movingBoundSides(numberServar({ min: null, max: ref('c') }))
    ).toEqual({ min: false, max: true });
    expect(movingBoundSides(numberServar())).toEqual({
      min: false,
      max: false
    });
  });

  it('counts a side some rule can set, even while the columns supply it', () => {
    const servar = ruleServar(
      [
        {
          id: 'mid',
          conditions: [condition('range', 'equal', ['20-30'])],
          min: null,
          max: 30
        }
      ],
      { min_length: 1, max_length: 20 }
    );
    expect(movingBoundSides(servar)).toEqual({ min: false, max: true });
  });
});

describe('widenBoundsToValue at the no-match boundary', () => {
  beforeEach(clearFieldValues);

  // A driver moving off every rule is exactly when a stored value is stranded,
  // so the mask must still widen even though the columns supplied the bounds.
  it('is reached for a rule-only field once no rule matches', () => {
    Object.assign(fieldValues, { range: 'unmatched' });
    const servar = ruleServar(
      [
        {
          id: 'mid',
          conditions: [condition('range', 'equal', ['20-30'])],
          min: 20,
          max: 30
        }
      ],
      { min_length: 1, max_length: 20 }
    );

    expect(hasDynamicBounds(servar)).toBe(true);
    const bounds = resolveNumberBounds(servar);
    expect(bounds).toEqual({ min: 1, max: 20 });
    expect(widenBoundsToValue(bounds, 25, movingBoundSides(servar))).toEqual({
      min: 1,
      max: 25
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

  it('collects rule condition, value and bound references', () => {
    const refs = getNumberBoundReferences(
      elements({
        servar: ruleServar([
          {
            id: 'r1',
            conditions: [condition('range', 'equal', [ref('other')])],
            min: ref('floor'),
            max: 30
          }
        ])
      })
    );
    expect([...refs].sort()).toEqual(['floor', 'other', 'range']);
  });

  // This runs inside a step-level memo, so a throw blanks the whole step
  it('survives malformed rules rather than throwing', () => {
    expect(() =>
      getNumberBoundReferences(
        elements(
          { servar: ruleServar('not-an-array') },
          { servar: ruleServar([null]) },
          { servar: ruleServar([{ id: 'r1' }]) },
          { servar: ruleServar([{ id: 'r2', conditions: [null] }]) },
          {
            servar: ruleServar([
              { id: 'r3', conditions: [condition('range', 'equal', null)] }
            ])
          }
        )
      )
    ).not.toThrow();

    expect([
      ...getNumberBoundReferences(
        elements({
          servar: ruleServar([null, { id: 'ok', min: ref('floor') }])
        })
      )
    ]).toEqual(['floor']);
  });
});
