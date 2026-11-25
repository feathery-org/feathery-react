import { renderHook } from '@testing-library/react';
import internalState from '../../../../utils/internalState';
import { useFieldCellRules } from '../useFieldCellRules';

const FORM_ID = 'rules-form';
const columns = [
  { name: 'Status', field_id: 's', field_type: 'servar', field_key: 'status' },
  { name: 'Count', field_id: 'c', field_type: 'hidden', field_key: 'count' }
];

describe('useFieldCellRules', () => {
  let statusServar: any;

  beforeEach(() => {
    statusServar = {
      key: 'status',
      type: 'dropdown',
      metadata: { options: ['a', 'b'] }
    };
    (internalState as any)[FORM_ID] = {
      steps: { step1: { servar_fields: [{ servar: statusServar }] } },
      hiddenFields: { count: 'number_value' }
    };
  });

  afterEach(() => {
    delete (internalState as any)[FORM_ID];
  });

  test('resolves servar and hidden field columns off the form state', () => {
    const { result } = renderHook(() =>
      useFieldCellRules(columns, FORM_ID, true)
    );
    expect(result.current).toEqual({
      status: { label: 'Status', type: 'text', options: ['a', 'b'] },
      count: { label: 'Count', type: 'number' }
    });
  });

  test('keeps the same rules object across renders with nothing changed', () => {
    const { result, rerender } = renderHook(() =>
      useFieldCellRules(columns, FORM_ID, true)
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });

  test('picks up options rewritten in place on the form state', () => {
    const { result, rerender } = renderHook(() =>
      useFieldCellRules(columns, FORM_ID, true)
    );
    // `fields[key].options = ...` mutates the servar metadata without
    // replacing the steps object.
    statusServar.metadata.options = ['c', 'd'];
    rerender();
    expect(result.current.status.options).toEqual(['c', 'd']);
  });

  test('is empty when disabled or without form state', () => {
    expect(
      renderHook(() => useFieldCellRules(columns, FORM_ID, false)).result
        .current
    ).toEqual({});
    expect(
      renderHook(() => useFieldCellRules(columns, 'missing', true)).result
        .current
    ).toEqual({});
  });
});
