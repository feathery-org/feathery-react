import { fieldAriaLabel } from '../accessibleName';
import {
  assetName,
  certificationName,
  certificationNameProps,
  sensitiveFieldProps
} from '../certification';

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

  it('names repeated fields even when they have a visible label', () => {
    // Repeated fields render their <label> without htmlFor, so the label does
    // not name the control and the fallback must still apply
    const element = build({ name: 'Email', repeated: true });
    expect(fieldAriaLabel(element)).toBe('my_field');
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

describe('certificationName', () => {
  it('takes the first non-empty candidate, collapsed and trimmed', () => {
    expect(certificationName('', null, '  Plan   card  ', 'x')).toBe('Plan card');
  });

  it('caps the name so a paragraph does not become the label', () => {
    expect(certificationName('a'.repeat(100))).toHaveLength(64);
  });

  it('returns undefined and no props when nothing usable is given', () => {
    expect(certificationName(undefined, '   ')).toBeUndefined();
    expect(certificationNameProps(undefined)).toEqual({});
    expect(certificationNameProps('key')).toEqual({ name: 'key' });
  });
});

describe('assetName', () => {
  it('reduces a signed asset URL to its file name', () => {
    expect(
      assetName('https://cdn.x.com/org/hero%20shot.png?X-Amz-Signature=abc#v')
    ).toBe('hero%20shot.png');
  });

  it('falls back to the raw value when there is no path', () => {
    expect(assetName('https://cdn.x.com')).toBe('https://cdn.x.com');
    expect(assetName('')).toBeUndefined();
  });
});
