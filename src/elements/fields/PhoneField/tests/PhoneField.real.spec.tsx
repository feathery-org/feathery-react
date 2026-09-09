import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as lib from 'libphonenumber-js/min';
import PhoneField from '../index';
import { isCanonicalPhoneNumber } from '../../../../utils/phoneNumber';
import countryData from '../../../components/data/countries';
import {
  createBaseElement,
  mockResponsiveStyles
} from '../../shared/tests/field-test-utils';

jest.mock('../../../../utils/validation', () => {
  const phoneLib = jest.requireActual('libphonenumber-js/min');
  return { phoneLib, phoneLibPromise: Promise.resolve(phoneLib) };
});
jest.mock('country-flag-emoji-polyfill', () => ({
  polyfillCountryFlagEmojis: jest.fn()
}));
jest.mock('../../../components/Overlay', () => () => null);
jest.mock('../../../components/InlineTooltip', () => () => null);
jest.mock('../../../components/Placeholder', () => () => null);

const examples = [
  {
    country: 'US',
    national: '2025550123',
    trunk: '(202) 555-0123',
    canonical: '12025550123'
  },
  {
    country: 'GB',
    national: '2079460018',
    trunk: '(020) 7946-0018',
    canonical: '442079460018'
  },
  {
    country: 'FR',
    national: '612345678',
    trunk: '06.12.34.56.78',
    canonical: '33612345678'
  },
  {
    country: 'IN',
    national: '9876543210',
    trunk: '09876543210',
    canonical: '919876543210'
  },
  {
    country: 'SG',
    national: '81234567',
    trunk: '8123-4567',
    canonical: '6581234567'
  }
];
const formats = (example: typeof examples[number]) => [
  example.national,
  example.trunk,
  example.canonical,
  `+${example.canonical}`,
  lib.parsePhoneNumber(`+${example.canonical}`).formatInternational(),
  `  +${example.canonical.slice(0, 2)} (${example.canonical.slice(
    2,
    5
  )})-${example.canonical.slice(5)}  `
];
async function setup(
  country = 'US',
  locked = false,
  fullNumber: any = '',
  extra: any = {}
) {
  const props = {
    element: createBaseElement(
      'phone',
      'phone',
      { default_country: country, disable_other_countries: locked },
      {}
    ),
    responsiveStyles: mockResponsiveStyles,
    fullNumber,
    onComplete: jest.fn(),
    onEnter: jest.fn(),
    ...extra
  };
  const view = render(<PhoneField {...props} />);
  await act(async () => {});
  return {
    ...view,
    props,
    input: view.container.querySelector('input') as HTMLInputElement
  };
}

describe('PhoneField with real phone metadata', () => {
  describe.each(examples)(
    '$country national and international formats',
    (example) => {
      it.each([false, true])(
        'handles replacement input/autofill for country lock=%s',
        async (locked) => {
          const { input, props } = await setup(example.country, locked);
          for (const value of formats(example)) {
            fireEvent.focus(input);
            fireEvent.change(input, { target: { value } });
            expect(input.value.replace(/\D/g, '')).toBe(example.canonical);
            expect(props.onComplete).toHaveBeenLastCalledWith(
              example.canonical
            );
            fireEvent.blur(input);
          }
        }
      );
      it.each([false, true])(
        'renders externally supplied formatted/national props for country lock=%s without writes',
        async (locked) => {
          const { input, props, rerender } = await setup(
            example.country,
            locked
          );
          for (const fullNumber of formats(example)) {
            await act(async () => {
              rerender(<PhoneField {...props} fullNumber={fullNumber} />);
            });
            expect(input.value.replace(/\D/g, '')).toBe(example.canonical);
          }
          expect(props.onComplete).not.toHaveBeenCalled();
        }
      );
      it('accepts explicit foreign country replacements', async () => {
        const { input, props } = await setup(
          example.country === 'US' ? 'GB' : 'US'
        );
        fireEvent.change(input, { target: { value: `+${example.canonical}` } });
        expect(input.value.replace(/\D/g, '')).toBe(example.canonical);
        expect(props.onComplete).toHaveBeenLastCalledWith(example.canonical);
      });
    }
  );
  it.each([
    ['US', '2025550123', '12025550123'],
    ['GB', '02079460018', '442079460018']
  ])(
    'types national digits after the focus prefix in %s',
    async (country, value, expected) => {
      const { input, props } = await setup(country);
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard(value);
      expect(input.value.replace(/\D/g, '')).toBe(expected);
      expect(props.onComplete).toHaveBeenLastCalledWith(expected);
    }
  );
  it.each(['call 2025550123', '+12025550123 ext 9', '+12025550123#9'])(
    'does not silently remove invalid content: %s',
    async (value) => {
      const { input, props } = await setup();
      fireEvent.change(input, { target: { value } });
      expect(props.onComplete).not.toHaveBeenCalledWith('12025550123');
    }
  );
  it('clears a saved value through select-all delete and blur', async () => {
    const { input, props } = await setup('US', false, '12025550123');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input.value).toBe('');
    expect(props.onComplete).toHaveBeenLastCalledWith('');
  });
  it('keeps incomplete edits until blur and commits Enter', async () => {
    const { input, props } = await setup();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '+1202' } });
    expect(input.value.replace(/\D/g, '')).toBe('1202');
    expect(props.onComplete).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onComplete).toHaveBeenLastCalledWith('1202');
    expect(props.onEnter).toHaveBeenCalledTimes(1);
  });
});

describe('PhoneField input events and field properties', () => {
  it.each([false, true])(
    'accepts explicit foreign numbers with locked country=%s',
    async (locked) => {
      const { input, props, getByTestId } = await setup('US', locked);
      fireEvent.input(input, { target: { value: '+44 (20) 7946-0018' } });
      expect(props.onComplete).toHaveBeenLastCalledWith('442079460018');
      expect(getByTestId('country-trigger')).toHaveTextContent('🇬🇧');
    }
  );
  it.each(['on', 'off'])(
    'accepts native input autofill when autocomplete=%s',
    async (autoComplete) => {
      const { input, props } = await setup('US', false, '', { autoComplete });
      expect(input.autocomplete).toBe(
        autoComplete === 'on' ? 'tel' : 'new-password'
      );
      fireEvent.input(input, { target: { value: '(202) 555-0123' } });
      expect(input.value).toBe('+1 202 555 0123');
      expect(props.onComplete).toHaveBeenLastCalledWith('12025550123');
    }
  );
  it.each([
    ['Europe/London', '020 7946 0018', '442079460018'],
    ['America/New_York', '(202) 555-0123', '12025550123'],
    ['Etc/Unknown', '2025550123', '12025550123']
  ])('infers auto country from %s', async (timeZone, value, expected) => {
    const spy = jest
      .spyOn(Intl, 'DateTimeFormat')
      .mockImplementation(
        () => ({ resolvedOptions: () => ({ timeZone }) } as any)
      );
    try {
      const { input, props } = await setup('auto');
      fireEvent.change(input, { target: { value } });
      expect(props.onComplete).toHaveBeenLastCalledWith(expected);
    } finally {
      spy.mockRestore();
    }
  });
  it.each([undefined, 'ZZ', ''])(
    'falls back safely for default country %s',
    async (country) => {
      const { input, props } = await setup(country);
      fireEvent.change(input, { target: { value: '2025550123' } });
      expect(props.onComplete).toHaveBeenLastCalledWith('12025550123');
    }
  );
  it.each(['+44 20 7946 0018', '(202) 555-0123'])(
    'pastes a complete replacement: %s',
    async (value) => {
      const { input, props } = await setup();
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard('{Control>}a{/Control}');
      await user.paste(value);
      expect(props.onComplete).toHaveBeenLastCalledWith(
        value.startsWith('+44') ? '442079460018' : '12025550123'
      );
    }
  );
  it('accepts an international paste appended to the focus prefix', async () => {
    const { input, props } = await setup();
    const user = userEvent.setup();
    await user.click(input);
    await user.paste('+44 20 7946 0018');
    expect(props.onComplete).toHaveBeenLastCalledWith('442079460018');
  });
  it('preserves the insertion cursor in the middle of a partial number', async () => {
    const { input } = await setup();
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('647');
    input.setSelectionRange(3, 3);
    fireEvent.click(input);
    await user.keyboard('58');
    expect(input.value.replace(/\D/g, '')).toBe('158647');
  });
  it('protects the prefix when deleting it and clears an empty focus on blur', async () => {
    const { input, props } = await setup('GB');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '+4' } });
    expect(input.value).toBe('+44');
    fireEvent.blur(input);
    expect(input.value).toBe('');
    expect(props.onComplete).not.toHaveBeenCalled();
  });
  it.each(['IN', 'SG'])(
    'rejects extra digits past country limit in %s',
    async (country) => {
      const example = examples.find((entry) => entry.country === country)!;
      const { input, props } = await setup(country, false, example.canonical);
      fireEvent.change(input, {
        target: { value: `+${example.canonical}123456789` }
      });
      expect(input.value.replace(/\D/g, '')).toBe(example.canonical);
      expect(props.onComplete).not.toHaveBeenCalled();
    }
  );
  it.each(['+12025550123 ext 9', 'call 2025550123', '+999123456789', '12-34'])(
    'preserves invalid external value visibly: %s',
    async (fullNumber) => {
      const { input, props } = await setup('US', false, fullNumber);
      expect(input.value).toBe(fullNumber);
      expect(props.onComplete).not.toHaveBeenCalled();
    }
  );
  it('clears and reapplies external values without feedback writes', async () => {
    const { input, props, rerender } = await setup('US', false, '12025550123');
    await act(async () => {
      rerender(<PhoneField {...props} fullNumber='' />);
    });
    expect(input.value).toBe('');
    await act(async () => {
      rerender(<PhoneField {...props} fullNumber='442079460018' />);
    });
    expect(input.value.replace(/\D/g, '')).toBe('442079460018');
    expect(props.onComplete).not.toHaveBeenCalled();
  });
  it('renders props on disabled fields while preventing user edits', async () => {
    const { input, props } = await setup('US', true, '(202) 555-0123', {
      disabled: true,
      required: true
    });
    const user = userEvent.setup();
    await user.type(input, '999');
    expect(input).toBeDisabled();
    expect(input).toBeRequired();
    expect(input.value.replace(/\D/g, '')).toBe('12025550123');
    expect(props.onComplete).not.toHaveBeenCalled();
  });
  it.each(countryData.map(({ countryCode }) => countryCode))(
    'renders a supported default country without crashing: %s',
    async (country) => {
      const { input, props } = await setup(country);
      fireEvent.focus(input);
      expect(input.value.startsWith('+')).toBe(true);
      fireEvent.blur(input);
      expect(input.value).toBe('');
      expect(props.onComplete).not.toHaveBeenCalled();
    }
  );
});

describe('PhoneField international and Unicode replacements', () => {
  it.each([
    ['US', '２０２－５５５－０１２３', '12025550123'],
    ['US', '٢٠٢٥٥٥٠١٢٣', '12025550123'],
    ['US', '۲۰۲۵۵۵۰۱۲۳', '12025550123'],
    ['US', '＋１（２０２）５５５－０１２３', '12025550123'],
    ['US', '202–555—0123', '12025550123'],
    ['US', '202/555/0123', '12025550123'],
    ['US', '011 44 20 7946 0018', '442079460018'],
    ['GB', '00 1 202 555 0123', '12025550123'],
    ['DE', '4915123456789', '4915123456789'],
    ['IT', '02 1234 5678', '390212345678']
  ])('normalizes %s replacement %s', async (country, value, expected) => {
    const { input, props } = await setup(country);
    fireEvent.input(input, { target: { value } });
    expect(input.value.replace(/\D/g, '')).toBe(expected);
    expect(props.onComplete).toHaveBeenLastCalledWith(expected);
  });
  it('preserves an ambiguous saved international value while local replacements use the selected country', async () => {
    const saved = await setup('US', false, '6612345678');
    expect(saved.input.value.replace(/\D/g, '')).toBe('6612345678');
    expect(saved.props.onComplete).not.toHaveBeenCalled();
    saved.unmount();
    const local = await setup('US');
    fireEvent.input(local.input, { target: { value: '6612345678' } });
    expect(local.props.onComplete).toHaveBeenLastCalledWith('16612345678');
  });
  it.each(['call 2025550123', '+12025550123 ext 9', '+12025550123#9'])(
    'does not rewrite an invalid external value on focus/blur: %s',
    async (fullNumber) => {
      const { input, props } = await setup('US', false, fullNumber);
      fireEvent.focus(input);
      fireEvent.blur(input);
      expect(input.value).toBe(fullNumber);
      expect(props.onComplete).not.toHaveBeenCalled();
    }
  );
});

describe('PhoneField redundant international trunk prefixes', () => {
  it.each([
    ['GB', '4402079460018', '442079460018'],
    ['FR', '330612345678', '33612345678'],
    ['IN', '9109876543210', '919876543210']
  ])(
    'normalizes stored %s digits with a redundant trunk prefix',
    async (country, fullNumber, expected) => {
      const { input, props } = await setup(country, false, fullNumber);
      expect(input.value.replace(/\D/g, '')).toBe(expected);
      expect(props.onComplete).not.toHaveBeenCalled();
    }
  );
});

describe('PhoneField Unicode keyboard entry', () => {
  it.each([
    ['US', '٢٠٢٥٥٥٠١٢٣', '12025550123'],
    ['US', '۲۰۲۵۵۵۰۱۲۳', '12025550123'],
    ['US', '２０２５５５０１２３', '12025550123'],
    ['GB', '٠٢٠٧٩٤٦٠٠١٨', '442079460018'],
    ['GB', '۰۲۰۷۹۴۶۰۰۱۸', '442079460018'],
    ['GB', '０２０７９４６００１８', '442079460018']
  ])(
    'types %s national Unicode digits %s after the focus prefix',
    async (country, value, expected) => {
      const { input, props } = await setup(country);
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard(value);
      expect(input.value.replace(/\D/g, '')).toBe(expected);
      expect(props.onComplete).toHaveBeenLastCalledWith(expected);
    }
  );
});

describe('PhoneField changing external props', () => {
  it('retains the actual country of a saved phone when the default country changes', async () => {
    const { input, props, rerender, getByTestId } = await setup(
      'US',
      false,
      '442079460018'
    );
    expect(getByTestId('country-trigger')).toHaveTextContent('🇬🇧');
    const element = {
      ...props.element,
      servar: {
        ...props.element.servar,
        metadata: { ...props.element.servar.metadata, default_country: 'FR' }
      }
    };
    await act(async () => {
      rerender(<PhoneField {...props} element={element} />);
    });
    expect(getByTestId('country-trigger')).toHaveTextContent('🇬🇧');
    expect(input.value.replace(/\D/g, '')).toBe('442079460018');
    expect(props.onComplete).not.toHaveBeenCalled();
  });
  it('uses the latest replacement when external props change before parsing resolves', async () => {
    const { input, props, rerender, getByTestId } = await setup('US');
    await act(async () => {
      rerender(<PhoneField {...props} fullNumber='442079460018' />);
      rerender(<PhoneField {...props} fullNumber='33612345678' />);
    });
    expect(input.value.replace(/\D/g, '')).toBe('33612345678');
    expect(getByTestId('country-trigger')).toHaveTextContent('🇫🇷');
    expect(props.onComplete).not.toHaveBeenCalled();
  });
});

describe('PhoneField complete international keyboard replacements', () => {
  it.each(
    ['US', 'GB'].flatMap((country) =>
      [false, true].flatMap((locked) =>
        [
          '+44 20 7946 0018',
          '442079460018',
          '+1 (202) 555-0123',
          '12025550123'
        ].map((value) => ({ country, locked, value }))
      )
    )
  )(
    'types replacement $value in $country locked=$locked',
    async ({ country, locked, value }) => {
      const { input, props } = await setup(country, locked);
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard('{Control>}a{/Control}');
      await user.keyboard(value);
      expect(input.value.replace(/\D/g, '')).toBe(
        value.includes('44') ? '442079460018' : '12025550123'
      );
      expect(props.onComplete).toHaveBeenLastCalledWith(
        value.includes('44') ? '442079460018' : '12025550123'
      );
    }
  );
  it.each([
    ['GB', '442079460018'],
    ['US', '12025550123']
  ])(
    'types included own country code after focus prefix in %s',
    async (country, value) => {
      const { input, props } = await setup(country);
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard(value);
      expect(input.value.replace(/\D/g, '')).toBe(value);
      expect(props.onComplete).toHaveBeenLastCalledWith(value);
    }
  );
});

describe('PhoneField replacement draft safeguards', () => {
  it.each([
    ['DE', '4949123456789'],
    ['FR', '33331234567']
  ])(
    'keeps valid %s numbers whose national digits start with the calling code',
    async (country, expected) => {
      const { input, props } = await setup(country);
      fireEvent.input(input, { target: { value: `+${expected}` } });
      expect(input.value.replace(/\D/g, '')).toBe(expected);
      expect(props.onComplete).toHaveBeenLastCalledWith(expected);
    }
  );
  it('bounds a duplicated country prefix draft using national number length', async () => {
    const { input, props } = await setup('GB');
    fireEvent.input(input, { target: { value: '+444420794600123456789' } });
    expect(input.value).toBe('');
    expect(props.onComplete).not.toHaveBeenCalled();
  });
  it('keeps raw keyboard draft through canonical parent echoes until blur', async () => {
    const element = createBaseElement(
      'phone',
      'phone',
      { default_country: 'GB' },
      {}
    );
    const onComplete = jest.fn();
    function ControlledPhone() {
      const [fullNumber, setFullNumber] = React.useState('');
      return (
        <PhoneField
          element={element}
          responsiveStyles={mockResponsiveStyles}
          fullNumber={fullNumber}
          onComplete={(value: string) => {
            onComplete(value);
            setFullNumber(value);
          }}
        />
      );
    }
    const { container } = render(<ControlledPhone />);
    const input = container.querySelector('input') as HTMLInputElement;
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard('{Control>}a{/Control}');
    await user.keyboard('12025550123');
    expect(onComplete).toHaveBeenLastCalledWith('12025550123');
    expect(input.value).toBe('12025550123');
    await user.tab();
    expect(input.value).toBe('+1 202 555 0123');
  });
});

it('lets the user edit the beginning of a replacement draft', async () => {
  const { input } = await setup('US');
  const user = userEvent.setup();
  await user.click(input);
  await user.keyboard('{Control>}a{/Control}');
  await user.keyboard('302');
  input.setSelectionRange(0, 0);
  fireEvent.click(input);
  expect(input.selectionStart).toBe(0);
  await user.keyboard('2');
  expect(input.value).toBe('2302');
});

describe('PhoneField cleared replacement and length safety', () => {
  it.each(['Backspace', 'Delete'])(
    'types a foreign number after clearing the selected input with %s',
    async (key) => {
      const { input, props } = await setup('US');
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard(`{Control>}a{/Control}{${key}}`);
      await user.keyboard('+44 20 7946 0018');
      expect(input.value.replace(/\D/g, '')).toBe('442079460018');
      expect(props.onComplete).toHaveBeenLastCalledWith('442079460018');
    }
  );
  it.each([
    ['IN', '9112025550123'],
    ['SG', '658955555555']
  ])(
    'never commits unsupported %s replacement as complete',
    async (country, value) => {
      const { input, props } = await setup(country);
      const user = userEvent.setup();
      await user.click(input);
      await user.keyboard('{Control>}a{/Control}');
      await user.keyboard(value);
      expect(props.onComplete).not.toHaveBeenCalledWith(value);
    }
  );
});

it.each([
  ['IN', '919876543210'],
  ['SG', '6581234567']
])(
  'types included %s calling code without emitting unsupported intermediate values',
  async (country, value) => {
    const { input, props } = await setup(country);
    const user = userEvent.setup();
    await user.click(input);
    await user.keyboard(value);
    expect(input.value.replace(/\D/g, '')).toBe(value);
    expect(props.onComplete).toHaveBeenLastCalledWith(value);
    for (const [reported] of props.onComplete.mock.calls) {
      expect(isCanonicalPhoneNumber(reported, lib)).toBe(true);
    }
  }
);
