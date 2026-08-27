import { fieldAriaLabel } from '../accessibleName';
import { sensitiveFieldProps } from '../certification';

const build = (servar: any = {}, properties: any = {}) => ({
  servar: { key: 'my_field', ...servar },
  properties
});

describe('fieldAriaLabel', () => {
  it('prefers an explicitly configured aria label', () => {
    const element = build({ name: 'First name' }, { aria_label: 'Given name' });
    expect(fieldAriaLabel(element)).toBe('Given name');
  });

  it('defers to the visible label when the field has a name', () => {
    // A <label htmlFor> is rendered in this case and aria-label would override
    // it for screen readers
    expect(fieldAriaLabel(build({ name: 'First name' }))).toBeUndefined();
  });

  it('falls back to the placeholder when there is no visible label', () => {
    const element = build({}, { placeholder: 'First name' });
    expect(fieldAriaLabel(element)).toBe('First name');
  });

  it('falls back to the field key when there is no placeholder either', () => {
    expect(fieldAriaLabel(build())).toBe('my_field');
  });

  it('returns undefined rather than throwing on a malformed element', () => {
    expect(fieldAriaLabel(undefined)).toBeUndefined();
    expect(fieldAriaLabel({})).toBeUndefined();
  });
});

describe('sensitiveFieldProps', () => {
  it.each(['ssn', 'password', 'payment_method'])(
    'flags %s so its value is hashed rather than recorded',
    (type) => {
      expect(sensitiveFieldProps(build({ type }))).toEqual({
        'data-tf-sensitive': 'true'
      });
    }
  );

  it('leaves ordinary fields unflagged', () => {
    expect(sensitiveFieldProps(build({ type: 'text_field' }))).toEqual({});
  });

  it('does not throw on a malformed element', () => {
    expect(sensitiveFieldProps(undefined)).toEqual({});
  });
});
