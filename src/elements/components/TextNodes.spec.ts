import { replaceTextVariables } from './TextNodes';
import { fieldValues, initState } from '../../utils/init';
import {
  clearOptionLabels,
  registerDynamicOptionLabels,
  registerOptionLabels
} from '../../utils/optionLabels';

const setFieldValues = (values: Record<string, any>) => {
  Object.keys(fieldValues).forEach((key) => delete fieldValues[key]);
  Object.assign(fieldValues, values);
};

describe('replaceTextVariables', () => {
  beforeEach(() => {
    setFieldValues({});
    initState.knownFieldKeys.clear();
    initState.textVariableFormats = {};
    clearOptionLabels();
    initState.sdkKey = 'test-sdk-key';
    initState.userId = 'user-1';
  });

  describe('known fields', () => {
    beforeEach(() => initState.knownFieldKeys.add('f'));

    it('substitutes a filled value', () => {
      setFieldValues({ f: 1 });
      expect(replaceTextVariables('hello: {{f}}')).toBe('hello: 1');
    });

    it.each([
      ['empty string', ''],
      ['null', null],
      ['undefined', undefined],
      ['empty array', []]
    ])('renders empty for %s', (_label, value) => {
      setFieldValues({ f: value });
      expect(replaceTextVariables('hello: {{f}}')).toBe('hello: ');
    });

    it('renders empty when the field has no value at all', () => {
      // Hidden fields the user never filled are absent from fieldValues
      expect(replaceTextVariables('hello: {{f}}')).toBe('hello: ');
    });
  });

  describe('unknown fields', () => {
    it('leaves the token literal so authors see the name they typed', () => {
      expect(replaceTextVariables('hello: {{nope}}')).toBe('hello: {{nope}}');
    });

    it('does not trim whitespace inside the braces', () => {
      setFieldValues({ f: 'val' });
      initState.knownFieldKeys.add('f');
      expect(replaceTextVariables('{{ f }}')).toBe('{{ f }}');
    });

    it('resolves each token independently', () => {
      initState.knownFieldKeys.add('empty');
      setFieldValues({ filled: 'x' });
      initState.knownFieldKeys.add('filled');
      expect(replaceTextVariables('{{filled}}|{{empty}}|{{nope}}')).toBe(
        'x||{{nope}}'
      );
    });
  });

  describe('array values', () => {
    beforeEach(() => {
      initState.knownFieldKeys.add('f');
      setFieldValues({ f: ['a', 'b'] });
    });

    it('joins every entry outside a repeat', () => {
      expect(replaceTextVariables('{{f}}')).toBe('a, b');
    });

    it('picks the entry at the repeat index', () => {
      expect(replaceTextVariables('{{f}}', 1)).toBe('b');
    });

    it('falls back to the first entry past the end of the array', () => {
      expect(replaceTextVariables('{{f}}', 5)).toBe('a');
    });
  });

  describe('number fields showing their format', () => {
    const registerFormatted = (key: string, servar: any = {}) => {
      initState.knownFieldKeys.add(key);
      initState.textVariableFormats[key] = {
        type: 'integer_field',
        format: 'currency',
        metadata: {},
        ...servar
      };
    };

    it('renders the value with its units', () => {
      // No trailing zero, because pad_decimals defaults off — the same value
      // the field's own input shows.
      registerFormatted('amount');
      setFieldValues({ amount: 1234.5 });
      expect(replaceTextVariables('total: {{amount}}')).toBe('total: $1,234.5');
    });

    it('pads to the field precision when the field does', () => {
      registerFormatted('amount', { metadata: { pad_decimals: true } });
      setFieldValues({ amount: 1234.5 });
      expect(replaceTextVariables('total: {{amount}}')).toBe(
        'total: $1,234.50'
      );
    });

    it('leaves an unregistered field raw, which is the default', () => {
      // The opt-in contract. A number field that never enables the option is
      // absent from the registry and must interpolate exactly as before.
      initState.knownFieldKeys.add('amount');
      setFieldValues({ amount: 1234.5 });
      expect(replaceTextVariables('total: {{amount}}')).toBe('total: 1234.5');
    });

    it('renders empty for an unfilled field rather than a bare symbol', () => {
      registerFormatted('amount');
      expect(replaceTextVariables('total: {{amount}}')).toBe('total: ');
    });

    it('formats every entry of a repeating field', () => {
      registerFormatted('amount');
      setFieldValues({ amount: [1234.5, 6] });
      expect(replaceTextVariables('{{amount}}')).toBe('$1,234.5, $6');
    });

    it('formats the entry at the repeat index', () => {
      registerFormatted('amount');
      setFieldValues({ amount: [1234.5, 6] });
      expect(replaceTextVariables('{{amount}}', 1)).toBe('$6');
    });

    it('formats only the fields that opted in', () => {
      registerFormatted('amount');
      initState.knownFieldKeys.add('plain');
      setFieldValues({ amount: 1234.5, plain: 1234.5 });
      expect(replaceTextVariables('{{amount}} vs {{plain}}')).toBe(
        '$1,234.5 vs 1234.5'
      );
    });

    it('honors the field precision and affixes', () => {
      registerFormatted('rate', {
        format: 'percentage',
        metadata: { decimal_places: 1, pad_decimals: true }
      });
      setFieldValues({ rate: 7 });
      expect(replaceTextVariables('{{rate}}')).toBe('7.0%');
    });

    it('puts a negative sign in front of the currency symbol', () => {
      registerFormatted('amount');
      setFieldValues({ amount: -1234.5 });
      expect(replaceTextVariables('total: {{amount}}')).toBe(
        'total: -$1,234.5'
      );
    });

    it('signs each entry of a repeating field individually', () => {
      registerFormatted('amount');
      setFieldValues({ amount: [-1234.5, 6] });
      expect(replaceTextVariables('{{amount}}')).toBe('-$1,234.5, $6');
    });
  });

  describe('option labels', () => {
    const registerOptions = (
      key: string,
      options: string[],
      labels?: (string | undefined)[],
      extra: Record<string, any> = {}
    ) => {
      initState.knownFieldKeys.add(key);
      registerOptionLabels({
        key,
        type: 'dropdown',
        metadata: { options, option_labels: labels, ...extra },
        ...extra
      });
    };

    it('renders the label of the selected option', () => {
      registerOptions('plan', ['pro'], ['Professional']);
      setFieldValues({ plan: 'pro' });
      expect(replaceTextVariables('on {{plan}}', undefined, true)).toBe(
        'on Professional'
      );
    });

    it('falls back to the value when the option has no label', () => {
      registerOptions('plan', ['pro', 'ent'], ['', 'Enterprise']);
      setFieldValues({ plan: 'pro' });
      expect(replaceTextVariables('{{plan}}', undefined, true)).toBe('pro');
    });

    it('falls back to the value for an option that no longer exists', () => {
      registerOptions('plan', ['pro'], ['Professional']);
      setFieldValues({ plan: 'legacy' });
      expect(replaceTextVariables('{{plan}}', undefined, true)).toBe('legacy');
    });

    it('leaves the value alone when labels are not opted into', () => {
      registerOptions('plan', ['pro'], ['Professional']);
      setFieldValues({ plan: 'pro' });
      expect(replaceTextVariables('{{plan}}')).toBe('pro');
    });

    it('labels every selection of a multiselect', () => {
      registerOptions('plans', ['a', 'b'], ['Alpha', 'Beta']);
      setFieldValues({ plans: ['a', 'b'] });
      expect(replaceTextVariables('{{plans}}', undefined, true)).toBe(
        'Alpha, Beta'
      );
    });

    it('does not read per-index options for a non-repeating field', () => {
      registerOptions('plans', ['a', 'b'], ['Alpha', 'Beta'], {
        repeat_options: [[{ value: 'a', label: 'Wrong' }]]
      });
      setFieldValues({ plans: ['a', 'b'] });
      expect(replaceTextVariables('{{plans}}', undefined, true)).toBe(
        'Alpha, Beta'
      );
    });

    describe('repeating fields', () => {
      beforeEach(() => {
        registerOptions('plan', ['a'], ['Alpha'], {
          repeated: true,
          repeat_options: [undefined, [{ value: 'b', label: 'Second Beta' }]]
        });
        setFieldValues({ plan: ['a', 'b'] });
      });

      it('labels the entry at the resolved repeat index', () => {
        expect(replaceTextVariables('{{plan}}', 1, true)).toBe('Second Beta');
      });

      it('labels each entry from its own options when joining', () => {
        expect(replaceTextVariables('{{plan}}', undefined, true)).toBe(
          'Alpha, Second Beta'
        );
      });

      it('falls back to the default options for an unoverridden index', () => {
        expect(replaceTextVariables('{{plan}}', 0, true)).toBe('Alpha');
      });
    });

    it('re-registering replaces the labels an earlier load recorded', () => {
      registerOptions('plan', ['pro'], ['Professional']);
      registerOptions('plan', ['pro'], ['Profesional']);
      setFieldValues({ plan: 'pro' });
      expect(replaceTextVariables('{{plan}}', undefined, true)).toBe(
        'Profesional'
      );
    });

    it('releases a key once its labels are cleared', () => {
      registerOptions('plan', ['pro'], ['Professional']);
      registerOptions('plan', ['pro'], []);
      setFieldValues({ plan: 'pro' });
      expect(replaceTextVariables('{{plan}}', undefined, true)).toBe('pro');
    });

    describe('options fetched at runtime', () => {
      it('renders the label of a fetched option', () => {
        initState.knownFieldKeys.add('stage');
        registerDynamicOptionLabels('stage', [
          { value: 'closed_won', label: 'Closed Won' }
        ]);
        setFieldValues({ stage: 'closed_won' });
        expect(replaceTextVariables('{{stage}}', undefined, true)).toBe(
          'Closed Won'
        );
      });

      it('takes precedence over the labels the schema registered', () => {
        registerOptions('stage', ['closed_won'], ['Schema Label']);
        registerDynamicOptionLabels('stage', [
          { value: 'closed_won', label: 'Closed Won' }
        ]);
        setFieldValues({ stage: 'closed_won' });
        expect(replaceTextVariables('{{stage}}', undefined, true)).toBe(
          'Closed Won'
        );
      });

      it('survives a schema reload re-registering the static options', () => {
        registerDynamicOptionLabels('stage', [
          { value: 'closed_won', label: 'Closed Won' }
        ]);
        registerOptions('stage', ['closed_won'], ['Schema Label']);
        setFieldValues({ stage: 'closed_won' });
        expect(replaceTextVariables('{{stage}}', undefined, true)).toBe(
          'Closed Won'
        );
      });

      it('falls back to the schema labels once the key is released', () => {
        registerOptions('stage', ['closed_won'], ['Schema Label']);
        registerDynamicOptionLabels('stage', [
          { value: 'closed_won', label: 'Closed Won' }
        ]);
        registerDynamicOptionLabels('stage', []);
        setFieldValues({ stage: 'closed_won' });
        expect(replaceTextVariables('{{stage}}', undefined, true)).toBe(
          'Schema Label'
        );
      });

      it('labels every selection of a multiselect', () => {
        initState.knownFieldKeys.add('stages');
        registerDynamicOptionLabels('stages', [
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' }
        ]);
        setFieldValues({ stages: ['a', 'b'] });
        expect(replaceTextVariables('{{stages}}', undefined, true)).toBe(
          'Alpha, Beta'
        );
      });

      it('falls back to the value for an option that was not fetched', () => {
        initState.knownFieldKeys.add('stage');
        registerDynamicOptionLabels('stage', [
          { value: 'closed_won', label: 'Closed Won' }
        ]);
        setFieldValues({ stage: 'legacy' });
        expect(replaceTextVariables('{{stage}}', undefined, true)).toBe(
          'legacy'
        );
      });
    });

    it('renders a country name for a code-storing country field', () => {
      initState.knownFieldKeys.add('country');
      registerOptionLabels({
        key: 'country',
        type: 'gmap_country',
        metadata: { store_abbreviation: true }
      });
      setFieldValues({ country: 'US' });
      expect(replaceTextVariables('{{country}}', undefined, true)).toBe(
        'United States'
      );
    });

    it('honors a country field translation override', () => {
      initState.knownFieldKeys.add('country');
      registerOptionLabels(
        {
          key: 'country',
          type: 'gmap_country',
          metadata: { store_abbreviation: true }
        },
        { translate: { US: 'Estados Unidos' } }
      );
      setFieldValues({ country: 'US' });
      expect(replaceTextVariables('{{country}}', undefined, true)).toBe(
        'Estados Unidos'
      );
    });

    it('prefers a number format over an option label', () => {
      initState.knownFieldKeys.add('amount');
      initState.textVariableFormats.amount = {
        type: 'integer_field',
        format: 'currency',
        metadata: { currency: 'USD', show_format_in_text: true }
      };
      registerOptionLabels({
        key: 'amount',
        type: 'dropdown',
        metadata: { options: [100], option_labels: ['A hundred'] }
      });
      setFieldValues({ amount: 100 });
      expect(replaceTextVariables('{{amount}}', undefined, true)).toBe('$100');
    });
  });

  it('substitutes the built-in user id token', () => {
    expect(replaceTextVariables('id: {{feathery_user_id}}')).toBe('id: user-1');
  });

  it('returns empty for empty text', () => {
    expect(replaceTextVariables('')).toBe('');
  });
});
