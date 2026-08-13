import { getImageAltText } from '../accessibility';

describe('getImageAltText', () => {
  it('prefers alt_text', () => {
    expect(
      getImageAltText({ alt_text: 'A team photo', aria_label: 'Stale label' })
    ).toEqual('A team photo');
  });

  it('falls back to the legacy aria_label when alt_text is blank or absent', () => {
    expect(getImageAltText({ aria_label: 'A team photo' })).toEqual(
      'A team photo'
    );
    expect(
      getImageAltText({ alt_text: '', aria_label: 'A team photo' })
    ).toEqual('A team photo');
  });

  it('resolves to empty for a decorative image', () => {
    expect(getImageAltText({})).toEqual('');
    expect(getImageAltText({ alt_text: '', aria_label: '' })).toEqual('');
    expect(getImageAltText(undefined)).toEqual('');
  });

  // Properties come from a free-form JSON field, so callers that type the
  // result as a string (alt={...}, resolveText) must not receive a non-string.
  it('ignores non-string values rather than passing them through', () => {
    expect(getImageAltText({ alt_text: 42 })).toEqual('');
    expect(getImageAltText({ alt_text: { nested: true } })).toEqual('');
    expect(getImageAltText({ alt_text: null, aria_label: ['a'] })).toEqual('');
    expect(
      getImageAltText({ alt_text: 42, aria_label: 'A team photo' })
    ).toEqual('A team photo');
  });
});
