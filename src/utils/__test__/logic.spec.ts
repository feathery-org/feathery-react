import {
  evalComparisonRule,
  OPERATOR_CODE,
  ResolvedComparisonRule
} from '../logic';

describe('logic', () => {
  const fieldKey = 'text-field-1';
  describe('evalComparisonRule', () => {
    const rule = (
      comparison: OPERATOR_CODE,
      ...values: any
    ): ResolvedComparisonRule => ({
      comparison,
      values: [...values],
      field_key: fieldKey,
      field_type: 'servar',
      field_id: 'do not care'
    });
    const fieldValues = (...values: any) => ({
      [fieldKey]: values.length > 1 ? [...values] : values[0]
    });

    it('equal', () => {
      const op = 'equal';
      expect(evalComparisonRule(rule(op, 100), fieldValues(100))).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, 100), fieldValues('100'))
      ).toBeTruthy();
      expect(evalComparisonRule(rule(op, 100), fieldValues(''))).toBeFalsy();
      expect(evalComparisonRule(rule(op, ''), fieldValues(''))).toBeTruthy();
      expect(evalComparisonRule(rule(op, ''), {})).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('test'))
      ).toBeTruthy();
      // test repeating fields
      expect(evalComparisonRule(rule(op, '1'), fieldValues([]))).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, '1'), fieldValues(['1']))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, '1'), fieldValues(['1', '2']))
      ).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, '1', '2'), fieldValues(['1', '2']))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, '2', '1'), fieldValues(['1', '2']))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, '3'), fieldValues(['1', '2']))
      ).toBeFalsy();
      // multi-valued field in a repeat
      expect(
        evalComparisonRule(rule(op, '2', '1'), fieldValues([['1', '2'], ['1']]))
      ).toBeTruthy();
      expect(
        evalComparisonRule(
          rule(op, '2', '1'),
          fieldValues([['1', '2', '3'], ['1']])
        )
      ).toBeFalsy();
      // test object
      expect(
        evalComparisonRule(
          rule(op, { t: ['1', '2'] }),
          fieldValues({ t: ['1', '2'] })
        )
      ).toBeTruthy();
      expect(
        evalComparisonRule(
          rule(op, { t: ['1', '2'] }),
          fieldValues({ t: ['1', '2'], y: '' })
        )
      ).toBeFalsy();
    });
    it('not_equal', () => {
      const op = 'not_equal';
      expect(evalComparisonRule(rule(op, 100), fieldValues(200))).toBeTruthy();
      expect(evalComparisonRule(rule(op, 100), fieldValues(100))).toBeFalsy();
      // repeat
      expect(
        evalComparisonRule(rule(op, 100, 200), fieldValues([100, 200]))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, 400), fieldValues([100, 200, 300]))
      ).toBeTruthy();
      expect(evalComparisonRule(rule(op, 400), fieldValues([]))).toBeTruthy();
    });

    it('is_filled', () => {
      const op = 'is_filled';
      expect(evalComparisonRule(rule(op), fieldValues(''))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(' '))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues([]))).toBeFalsy(); // empty repeat
      expect(evalComparisonRule(rule(op), fieldValues([1, 2]))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues({}))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(0))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues('0'))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(false))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(true))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues('false'))).toBeTruthy();
      // multi-valued field in a repeat
      expect(
        evalComparisonRule(rule(op), fieldValues([['1', '2'], ['1']]))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op), fieldValues([['1', '2'], []]))
      ).toBeFalsy();
      expect(
        evalComparisonRule(rule(op), fieldValues([['1', '2'], null]))
      ).toBeFalsy();
    });
    it('is_empty', () => {
      const op = 'is_empty';
      expect(evalComparisonRule(rule(op), fieldValues(''))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(' '))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues([]))).toBeTruthy(); // empty repeat
      expect(evalComparisonRule(rule(op), fieldValues([1, 2]))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(['', '']))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues({}))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(0))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues('0'))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(false))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(true))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues('false'))).toBeFalsy();
    });

    it('greater_than', () => {
      const op = 'greater_than';
      expect(evalComparisonRule(rule(op, 44), fieldValues(45))).toBeTruthy();
      expect(evalComparisonRule(rule(op, '44'), fieldValues(45))).toBeTruthy();
      expect(evalComparisonRule(rule(op, 44), fieldValues(44))).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, 45.0001), fieldValues(45))
      ).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, 3e-4), fieldValues(3e-3))
      ).toBeTruthy();
      expect(evalComparisonRule(rule(op, ''), fieldValues(''))).toBeFalsy();
      expect(evalComparisonRule(rule(op, 45), fieldValues(''))).toBeFalsy();
      expect(evalComparisonRule(rule(op, ''), fieldValues(45))).toBeFalsy();
      expect(evalComparisonRule(rule(op, ''), fieldValues())).toBeFalsy();
      expect(evalComparisonRule(rule(op, null), fieldValues(45))).toBeFalsy();
      expect(evalComparisonRule(rule(op, 45), fieldValues(null))).toBeFalsy();
      // repeating
      expect(evalComparisonRule(rule(op, 44), fieldValues([]))).toBeFalsy();
      expect(evalComparisonRule(rule(op, 44), fieldValues([45]))).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, 44), fieldValues([45, 46]))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, 44), fieldValues([43, 46]))
      ).toBeFalsy();
    });
    it('greater_than_or_equal', () => {
      const op = 'greater_than_or_equal';
      expect(evalComparisonRule(rule(op, 44), fieldValues(45))).toBeTruthy();
      expect(evalComparisonRule(rule(op, 44), fieldValues(44))).toBeTruthy();
      expect(evalComparisonRule(rule(op, ''), fieldValues(''))).toBeFalsy();
      expect(evalComparisonRule(rule(op, ''), fieldValues(45))).toBeFalsy();
      // repeating
      expect(evalComparisonRule(rule(op, 44), fieldValues([]))).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, 44), fieldValues([43, 46]))
      ).toBeFalsy();
    });
    it('less_than', () => {
      const op = 'less_than';
      expect(evalComparisonRule(rule(op, 44), fieldValues(45))).toBeFalsy();
      expect(evalComparisonRule(rule(op, 44), fieldValues(44))).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, 45.0001), fieldValues(45))
      ).toBeTruthy();
    });
    it('less_than_or_equal', () => {
      const op = 'less_than_or_equal';
      expect(evalComparisonRule(rule(op, 2), fieldValues(3))).toBeFalsy();
      expect(evalComparisonRule(rule(op, 3), fieldValues(3))).toBeTruthy();
      expect(evalComparisonRule(rule(op, 3), fieldValues(2))).toBeTruthy();
    });

    it('is_numerical', () => {
      const op = 'is_numerical';
      expect(evalComparisonRule(rule(op), fieldValues(3))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(3.04))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(305e-9))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues('3.04'))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(''))).toBeFalsy();
      // repeating
      expect(
        evalComparisonRule(rule(op), fieldValues([3, 4, '4.09']))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op), fieldValues([3, 4, 'a']))
      ).toBeFalsy();
    });
    it('is_text', () => {
      const op = 'is_text';
      expect(evalComparisonRule(rule(op), fieldValues(3))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues('a'))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues('3.04'))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues('a3'))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(''))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues())).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(null))).toBeFalsy();
      // repeating
      expect(
        evalComparisonRule(rule(op), fieldValues(['a', 'b']))
      ).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(['a', '3']))).toBeFalsy();
    });

    it('contains', () => {
      const op = 'contains';
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('test'))
      ).toBeTruthy();
      expect(
        evalComparisonRule(
          rule(op, 'test', 'something else'),
          fieldValues('test')
        )
      ).toBeTruthy();
      // repeat
      expect(evalComparisonRule(rule(op, 'test'), fieldValues([]))).toBeFalsy();
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues(['test', 'some test']))
      ).toBeTruthy();
      expect(
        evalComparisonRule(
          rule(op, 'test'),
          fieldValues(['test', 'non-matching'])
        )
      ).toBeFalsy();
    });
    it('not_contains', () => {
      const op = 'not_contains';
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('test'))
      ).toBeFalsy();
      // repeat
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues([]))
      ).toBeTruthy();
    });
    it('starts_with', () => {
      const op = 'starts_with';
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('test value'))
      ).toBeTruthy();
      expect(
        evalComparisonRule(
          rule(op, 'test'),
          fieldValues('non-matching test value')
        )
      ).toBeFalsy();
      // repeat
      expect(evalComparisonRule(rule(op, 'test'), fieldValues([]))).toBeFalsy();
      expect(
        evalComparisonRule(
          rule(op, 'test'),
          fieldValues(['test value', 'tester'])
        )
      ).toBeTruthy();
    });
    it('not_starts_with', () => {
      const op = 'not_starts_with';
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('not matching value'))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('test value'))
      ).toBeFalsy();
    });
    it('ends_with', () => {
      const op = 'ends_with';
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('some test'))
      ).toBeTruthy();
      expect(
        evalComparisonRule(
          rule(op, 'test'),
          fieldValues('some test that does not match')
        )
      ).toBeFalsy();
      // repeat
      expect(evalComparisonRule(rule(op, 'test'), fieldValues([]))).toBeFalsy();
      expect(
        evalComparisonRule(
          rule(op, 'test'),
          fieldValues(['some test', 'a test'])
        )
      ).toBeTruthy();
    });
    it('not_ends_with', () => {
      const op = 'not_ends_with';
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('a test value'))
      ).toBeTruthy();
      expect(
        evalComparisonRule(rule(op, 'test'), fieldValues('does end in test'))
      ).toBeFalsy();
    });
    it('is_true', () => {
      const op = 'is_true';
      expect(evalComparisonRule(rule(op), fieldValues(true))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(1))).toBeTruthy();
      expect(evalComparisonRule(rule(op), fieldValues(0))).toBeFalsy();
    });
    it('is_false', () => {
      const op = 'is_false';
      expect(evalComparisonRule(rule(op), fieldValues(true))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(1))).toBeFalsy();
      expect(evalComparisonRule(rule(op), fieldValues(0))).toBeTruthy();
    });
  });
});
