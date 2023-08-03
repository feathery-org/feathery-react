import {
  evalComparisonRule,
  OPERATOR_CODE,
  ResolvedComparisonRule
} from '../logic';
import { fieldValues } from '../init';

describe('logic', () => {
  const fieldKey = 'text-field-1';
  const fieldKeyRight = 'text-field-2';
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
    const setFieldValues = (...values: any) => {
      Object.assign(fieldValues, {
        [fieldKey]: values.length > 1 ? [...values] : values[0]
      });
    };
    const setFieldValuesLR = (valuesLeft: any[], valuesRight: any[]) => {
      Object.assign(fieldValues, {
        [fieldKey]: valuesLeft.length > 1 ? [...valuesLeft] : valuesLeft[0],
        [fieldKeyRight]:
          valuesRight.length > 1 ? [...valuesRight] : valuesRight[0]
      });
    };
    const field = () => ({
      field_key: fieldKeyRight,
      field_type: 'servar',
      field_id: 'do not care'
    });

    describe('field to field comparisons', () => {
      it('equal (field to field)', () => {
        const op = 'equal';
        setFieldValuesLR([100], [100]);
        expect(evalComparisonRule(rule(op, field()))).toBeTruthy();

        setFieldValuesLR([100], [100, 200]);
        expect(evalComparisonRule(rule(op, field()))).toBeTruthy();

        setFieldValuesLR([300], [100, 200]);
        expect(evalComparisonRule(rule(op, field(), 300))).toBeTruthy();

        setFieldValuesLR([100], [[100, 200]]);
        expect(evalComparisonRule(rule(op, field()))).toBeTruthy();

        setFieldValuesLR([false], ['']);
        expect(evalComparisonRule(rule(op, field()))).toBeTruthy();
      });

      it('greater_than (field to field)', () => {
        const op = 'greater_than';
        setFieldValuesLR([45], [44]);
        expect(evalComparisonRule(rule(op, field()))).toBeTruthy();

        setFieldValuesLR([45], [44, 46]);
        expect(evalComparisonRule(rule(op, field()))).toBeTruthy();

        setFieldValuesLR([45], [46, 47]);
        expect(evalComparisonRule(rule(op, field()))).toBeFalsy();
      });
    });
    describe('field to field comparisons at a repeat index', () => {
      it('equal (field to field indexed)', () => {
        const op = 'equal';
        setFieldValuesLR([100], [100]);
        expect(evalComparisonRule(rule(op, field()), 0)).toBeTruthy();

        setFieldValuesLR([100, 200, 300], [100, 200]);
        expect(evalComparisonRule(rule(op, field()), 1)).toBeTruthy();

        setFieldValuesLR([100, 100], [100, 200]);
        expect(evalComparisonRule(rule(op, field()), 1)).toBeFalsy();

        setFieldValuesLR([100, 200, 300], [200]);
        expect(evalComparisonRule(rule(op, field()), 1)).toBeTruthy();

        setFieldValuesLR([100, 200, 300], [200]);
        expect(evalComparisonRule(rule(op, field()), 2)).toBeFalsy();
      });
    });

    describe('field to free form value comparisons', () => {
      it('equal', () => {
        const op = 'equal';
        setFieldValues(100);
        expect(evalComparisonRule(rule(op, 100))).toBeTruthy();

        setFieldValues('100');
        expect(evalComparisonRule(rule(op, 100))).toBeTruthy();

        setFieldValues('');
        expect(evalComparisonRule(rule(op, 100))).toBeFalsy();

        setFieldValues('');
        expect(evalComparisonRule(rule(op, ''))).toBeTruthy();

        Object.assign(fieldValues, {});
        expect(evalComparisonRule(rule(op, ''))).toBeTruthy();

        setFieldValues('test');
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        // test repeating fields
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, '1'))).toBeFalsy();

        setFieldValues(['1']);
        expect(evalComparisonRule(rule(op, '1'))).toBeTruthy();

        setFieldValues(['1', '2']);
        expect(evalComparisonRule(rule(op, '1'))).toBeTruthy();

        setFieldValues(['1', '2']);
        expect(evalComparisonRule(rule(op, '1', '2'))).toBeTruthy();

        setFieldValues(['1', '2']);
        expect(evalComparisonRule(rule(op, '2', '1'))).toBeTruthy();

        setFieldValues(['1', '2']);
        expect(evalComparisonRule(rule(op, '3'))).toBeFalsy();

        // multi-valued field in a repeat
        setFieldValues([['1', '2'], ['1']]);
        expect(evalComparisonRule(rule(op, '2', '1'))).toBeTruthy();

        setFieldValues([['1', '2', '3'], ['1']]);
        expect(evalComparisonRule(rule(op, '2', '1'))).toBeTruthy();

        // test object
        setFieldValues({ t: ['1', '2'] });
        expect(evalComparisonRule(rule(op, { t: ['1', '2'] }))).toBeTruthy();

        setFieldValues({ t: ['1', '2'], y: '' });
        expect(evalComparisonRule(rule(op, { t: ['1', '2'] }))).toBeFalsy();
      });

      it('not_equal', () => {
        const op = 'not_equal';
        setFieldValues(200);
        expect(evalComparisonRule(rule(op, 100))).toBeTruthy();

        setFieldValues(100);
        expect(evalComparisonRule(rule(op, 100, 200))).toBeFalsy();

        // repeat
        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 100, 200))).toBeFalsy();

        setFieldValues([100, 200, 300]);
        expect(evalComparisonRule(rule(op, 400))).toBeTruthy();

        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 400))).toBeTruthy();

        setFieldValuesLR([false], ['']);
        expect(evalComparisonRule(rule(op, field()))).toBeFalsy();
      });

      it('selections_include', () => {
        const op = 'selections_include';
        // multi valued field
        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 100))).toBeTruthy();

        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 100, 200))).toBeTruthy();

        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 300))).toBeFalsy();
        setFieldValues(['a', 'b']);
        expect(evalComparisonRule(rule(op, 'a'))).toBeTruthy();

        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 300))).toBeFalsy();
        setFieldValues([undefined]);
        expect(evalComparisonRule(rule(op, 300))).toBeFalsy();
        setFieldValues([null]);
        expect(evalComparisonRule(rule(op, 300))).toBeFalsy();
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, ''))).toBeTruthy();

        // for the selections include operator,
        // with a field containing an object the keys are tested against the right side values.
        setFieldValues({ a: 1, b: 2 });
        expect(evalComparisonRule(rule(op, 'a'))).toBeTruthy();
        expect(evalComparisonRule(rule(op, 'a', 'b'))).toBeTruthy();
        expect(evalComparisonRule(rule(op, 'a', 'b', 'c'))).toBeTruthy();
        expect(evalComparisonRule(rule(op, 'c'))).toBeFalsy();
      });

      it('selections_dont_include', () => {
        const op = 'selections_dont_include';
        // multi valued field
        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 300))).toBeTruthy();

        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 100))).toBeFalsy();

        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 100, 200))).toBeFalsy();
        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 100, 300))).toBeFalsy();
        setFieldValues([100, 200]);
        expect(evalComparisonRule(rule(op, 300, 400))).toBeTruthy();

        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 300))).toBeTruthy();
        setFieldValues([undefined]);
        expect(evalComparisonRule(rule(op, 300))).toBeTruthy();
        setFieldValues([null]);
        expect(evalComparisonRule(rule(op, 300))).toBeTruthy();
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, ''))).toBeFalsy();

        // for the selections don't include operator,
        // with a field containing an object the keys are tested against the right side values.
        setFieldValues({ a: 1, b: 2 });
        expect(evalComparisonRule(rule(op, 'a'))).toBeFalsy();
        expect(evalComparisonRule(rule(op, 'a', 'b'))).toBeFalsy();
        expect(evalComparisonRule(rule(op, 'a', 'b', 'c'))).toBeFalsy();
        expect(evalComparisonRule(rule(op, 'c'))).toBeTruthy();
      });

      it('is_filled', () => {
        const op = 'is_filled';
        setFieldValues('');
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(' ');
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues([]);
        expect(evalComparisonRule(rule(op))).toBeFalsy(); // empty repeat

        setFieldValues([1, 2]);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues({});
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(0);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues('0');
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(false);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(true);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues('false');
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        // multi-valued field in a repeat
        setFieldValues([['1', '2'], ['1']]);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues([['1', '2'], []]);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues([['1', '2'], null]);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues([[], null]);
        expect(evalComparisonRule(rule(op))).toBeFalsy();
      });
      it('is_empty', () => {
        const op = 'is_empty';
        setFieldValues('');
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(' ');
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues([]);
        expect(evalComparisonRule(rule(op))).toBeTruthy(); // empty repeat

        setFieldValues([1, 2]);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(['', '']);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues({});
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(0);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues('0');
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(false);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(true);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues('false');
        expect(evalComparisonRule(rule(op))).toBeFalsy();
      });

      it('greater_than', () => {
        const op = 'greater_than';

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, 44))).toBeTruthy();

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, '44'))).toBeTruthy();

        setFieldValues(44);
        expect(evalComparisonRule(rule(op, 44))).toBeFalsy();

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, 45.0001))).toBeFalsy();

        setFieldValues(3e-3);
        expect(evalComparisonRule(rule(op, 3e-4))).toBeTruthy();

        setFieldValues('');
        expect(evalComparisonRule(rule(op, ''))).toBeFalsy();

        setFieldValues('');
        expect(evalComparisonRule(rule(op, 45))).toBeFalsy();

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, ''))).toBeFalsy();

        setFieldValues();
        expect(evalComparisonRule(rule(op, ''))).toBeFalsy();

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, null))).toBeFalsy();

        setFieldValues(null);
        expect(evalComparisonRule(rule(op, 45))).toBeFalsy();

        // repeating
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 44))).toBeFalsy();

        setFieldValues([45]);
        expect(evalComparisonRule(rule(op, 44))).toBeTruthy();

        setFieldValues([45, 46]);
        expect(evalComparisonRule(rule(op, 44))).toBeTruthy();

        setFieldValues([43, 46]);
        expect(evalComparisonRule(rule(op, 44))).toBeTruthy();

        setFieldValues([42, 43]);
        expect(evalComparisonRule(rule(op, 44))).toBeFalsy();
      });
      it('greater_than_or_equal', () => {
        const op = 'greater_than_or_equal';
        setFieldValues(45);
        expect(evalComparisonRule(rule(op, 44))).toBeTruthy();

        setFieldValues(44);
        expect(evalComparisonRule(rule(op, 44))).toBeTruthy();

        setFieldValues('');
        expect(evalComparisonRule(rule(op, ''))).toBeFalsy();

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, ''))).toBeFalsy();

        // repeating
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 44))).toBeFalsy();

        setFieldValues([43, 46]);
        expect(evalComparisonRule(rule(op, 44))).toBeTruthy();

        setFieldValues([42, 43]);
        expect(evalComparisonRule(rule(op, 44))).toBeFalsy();
      });
      it('less_than', () => {
        const op = 'less_than';

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, 44))).toBeFalsy();

        setFieldValues(44);
        expect(evalComparisonRule(rule(op, 44))).toBeFalsy();

        setFieldValues(45);
        expect(evalComparisonRule(rule(op, 45.0001))).toBeTruthy();
      });
      it('less_than_or_equal', () => {
        const op = 'less_than_or_equal';
        setFieldValues(3);
        expect(evalComparisonRule(rule(op, 2))).toBeFalsy();

        setFieldValues(3);
        expect(evalComparisonRule(rule(op, 3))).toBeTruthy();

        setFieldValues(2);
        expect(evalComparisonRule(rule(op, 3))).toBeTruthy();
      });

      it('is_numerical', () => {
        const op = 'is_numerical';

        setFieldValues(3);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(3.04);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(305e-9);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues('3.04');
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues('');
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        // repeating
        setFieldValues([3, 4, '4.09']);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues([3, 4, 'a']);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(['a', '&']);
        expect(evalComparisonRule(rule(op))).toBeFalsy();
      });
      it('is_text', () => {
        const op = 'is_text';
        setFieldValues(3);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues('a');
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues('3.04');
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues('a3');
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues('');
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues();
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(null);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        // repeating
        setFieldValues(['a', 'b']);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(['a', '3']);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(['2', '3']);
        expect(evalComparisonRule(rule(op))).toBeFalsy();
      });

      it('contains', () => {
        const op = 'contains';
        setFieldValues('test');
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        setFieldValues('test');
        expect(
          evalComparisonRule(rule(op, 'test', 'something else'))
        ).toBeTruthy();

        // repeat
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();

        setFieldValues(['test', 'some test']);
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        setFieldValues(['test', 'non-matching']);
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        setFieldValues(['not it', 'non-matching']);
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();
      });
      it('not_contains', () => {
        const op = 'not_contains';

        setFieldValues('test');
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();

        // repeat
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();
      });
      it('contains_ignore_case', () => {
        const op = 'contains_ignore_case';

        setFieldValues('test');
        expect(evalComparisonRule(rule(op, 'Test'))).toBeTruthy();
      });
      it('not_contains_ignore_case', () => {
        const op = 'not_contains_ignore_case';

        setFieldValues('test');
        expect(evalComparisonRule(rule(op, 'Test'))).toBeFalsy();

        setFieldValues('test');
        expect(evalComparisonRule(rule(op, 'non-matching'))).toBeTruthy();
      });

      it('starts_with', () => {
        const op = 'starts_with';

        setFieldValues('test value');
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        setFieldValues('non-matching test value');
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();

        // repeat
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();

        setFieldValues(['test value', 'tester']);
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();
      });
      it('not_starts_with', () => {
        const op = 'not_starts_with';
        setFieldValues('not matching value');
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        setFieldValues('test value');
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();
      });
      it('ends_with', () => {
        const op = 'ends_with';
        setFieldValues('some test');
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        setFieldValues('some test that does not match');

        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();

        // repeat
        setFieldValues([]);
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();

        setFieldValues(['some test', 'a test']);
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();
      });
      it('not_ends_with', () => {
        const op = 'not_ends_with';
        setFieldValues('a test value');
        expect(evalComparisonRule(rule(op, 'test'))).toBeTruthy();

        setFieldValues('does end in test');
        expect(evalComparisonRule(rule(op, 'test'))).toBeFalsy();
      });
      it('is_true', () => {
        const op = 'is_true';
        setFieldValues(true);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(1);
        expect(evalComparisonRule(rule(op))).toBeTruthy();

        setFieldValues(0);
        expect(evalComparisonRule(rule(op))).toBeFalsy();
      });
      it('is_false', () => {
        const op = 'is_false';
        setFieldValues(true);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(1);
        expect(evalComparisonRule(rule(op))).toBeFalsy();

        setFieldValues(0);
        expect(evalComparisonRule(rule(op))).toBeTruthy();
      });
    });
  });
});
