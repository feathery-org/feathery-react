import { getValueBoundReferences } from '../valueBounds';

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
