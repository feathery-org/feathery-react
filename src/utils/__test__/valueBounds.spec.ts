import { renderHook } from '@testing-library/react';
import useOffset from '@rc-component/slider/lib/hooks/useOffset';
import { fieldValues } from '../init';
import { alignToSlider, getValueBoundReferences } from '../valueBounds';

const field = (type: string, metadata?: any) => ({
  servar: { type, metadata }
});

describe('getValueBoundReferences', () => {
  it("collects the fields that set a slider's range", () => {
    const step = {
      servar_fields: [
        field('slider', { min_value_field_key: 'floor' }),
        field('slider', { max_value_field_key: 'limit' }),
        // Number fields only use their linked bounds on submit
        field('integer_field', { max_value_field_key: 'number_limit' }),
        field('slider', { min_value_field_key: null }),
        field('slider')
      ]
    };
    expect([...getValueBoundReferences(step)].sort()).toEqual([
      'floor',
      'limit'
    ]);
  });

  it('returns an empty set without a step', () => {
    expect(getValueBoundReferences(undefined).size).toBe(0);
    expect(getValueBoundReferences({}).size).toBe(0);
  });
});

describe('alignToSlider', () => {
  const slider = (stepSize: any, metadata = {}) => ({
    min_length: 0,
    max_length: 100,
    metadata: {
      step_size: stepSize,
      min_value_field_key: 'floor',
      max_value_field_key: 'limit',
      ...metadata
    }
  });

  it('snaps to the step counted from a linked min, as the handle does', () => {
    Object.assign(fieldValues, { floor: 2, limit: 100 });
    expect(alignToSlider(10, slider(5))).toBe(12);
    // The max is a stop even off-step, and wins a tie with the step below it
    Object.assign(fieldValues, { floor: 2, limit: 13 });
    expect(alignToSlider(13, slider(5))).toBe(13);
    Object.assign(fieldValues, { floor: 0, limit: 10 });
    expect(alignToSlider(9, slider(4))).toBe(10);
    // A fractional linked min isn't rounded: steps of 0.5 from 0.3
    Object.assign(fieldValues, { floor: 0.3, limit: 10 });
    expect(alignToSlider(1, slider(0.5))).toBe(0.8);
    Object.assign(fieldValues, { floor: 0, limit: 10 });
    // A missing or non-positive step renders as 1
    expect(alignToSlider(3.4, slider(undefined))).toBe(3);
    expect(alignToSlider(3.4, slider(-5))).toBe(3);
  });

  it('leaves a slider without a link alone', () => {
    const unlinked = slider(5, {
      min_value_field_key: null,
      max_value_field_key: null
    });
    expect(alignToSlider(7, unlinked)).toBe(7);
    expect(alignToSlider(150, unlinked)).toBe(150);
  });

  // The handle falls back to the fixed 0..100 range, so the value follows it
  it.each([[''], [null], ['abc']])(
    'snaps into the fixed range while a linked source holds %p',
    (empty: any) => {
      Object.assign(fieldValues, { floor: empty, limit: empty });
      expect(alignToSlider(150, slider(1))).toBe(100);
      expect(alignToSlider(7, slider(5))).toBe(5);
    }
  );

  // The rendered handle is rc-slider's formatValue, so match it exactly
  it("matches rc-slider's own snapping", () => {
    const steps = [1, 3, 5, 0.1, 0.25, 7];
    const fixedMaxes = [100, 10.5, 33];
    const floors = [-7, 0, 1.25, 2, 13];
    for (const step of steps)
      for (const max of fixedMaxes)
        for (const floor of floors) {
          Object.assign(fieldValues, { floor, limit: '' });
          const servar = { ...slider(step), max_length: max };
          const { result } = renderHook(() =>
            useOffset(floor, Math.max(floor, max), step, [], false, false)
          );
          const [formatValue] = result.current;
          for (let value = floor - 5; value <= max + 5; value += 0.7)
            expect(alignToSlider(value, servar)).toBe(formatValue(value));
        }
  });
});
