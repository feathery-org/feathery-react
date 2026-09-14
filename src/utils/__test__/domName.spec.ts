import { MAX_DOM_NAME_LENGTH, nameProps, readableName } from '../domName';

describe('readableName', () => {
  it.each([
    ['field_1-name', 'field_1-name'],
    ['_field-', '_field-'],
    ['  Welcome to\n the plan picker  ', 'Welcome_to_the_plan_picker'],
    ['Contact@name#50% 🎉 now', 'Contact_name_50_now'],
    ['🎉 Welcome! 🎉', 'Welcome'],
    ['"quoted" [name] <tag>', 'quoted_name_tag'],
    [0, '0']
  ])('normalizes %p to a scanner-friendly name', (candidate, expected) => {
    expect(readableName(candidate)).toBe(expected);
  });

  it('tries the next candidate when sanitization removes all content', () => {
    expect(
      readableName(null, undefined, '', ' \n ', '@#%🎉', 'field@key')
    ).toBe('field_key');
  });

  it('omits the name when no candidate has usable content', () => {
    expect(readableName()).toBeUndefined();
    expect(nameProps(null, undefined, ' ', '🎉@#%')).toEqual({});
  });

  it('caps the sanitized name at 64 characters', () => {
    expect(readableName('🎉' + 'a'.repeat(80))).toBe(
      'a'.repeat(MAX_DOM_NAME_LENGTH)
    );
  });

  it('returns sanitized name props', () => {
    expect(nameProps('Contact @ name')).toEqual({ name: 'Contact_name' });
  });
});
