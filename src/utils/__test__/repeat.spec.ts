import { getServarRepeatNum } from '../repeat';

const makeField = (type: string, repeatTrigger = 'set_value') => ({
  servar: {
    key: 'field',
    type,
    repeated: true,
    repeat_trigger: repeatTrigger,
    metadata: {}
  }
});

describe('getServarRepeatNum', () => {
  it('adds a trailing row once the last row is filled', () => {
    const field = makeField('text_field');
    expect(getServarRepeatNum(field, [''])).toBe(1);
    expect(getServarRepeatNum(field, ['typed'])).toBe(2);
  });

  it('treats a blanked null-default row as empty', () => {
    // updateFieldValues rewrites null entries to '' in repeated arrays, so a
    // field defaulting to null must still recognise '' as its empty state or
    // every filled row appends two more
    ['audio_recording', 'signature', 'file_upload'].forEach((type) => {
      const field = makeField(type);
      const file = Promise.resolve(new File(['x'], 'x'));
      expect(getServarRepeatNum(field, [file, ''])).toBe(2);
      expect(getServarRepeatNum(field, [''])).toBe(1);
      // A genuinely filled last row still earns the trailing row
      expect(getServarRepeatNum(field, [file])).toBe(2);
    });
  });

  it('leaves non-repeating triggers at the stored length', () => {
    const field = makeField('audio_recording', '');
    expect(getServarRepeatNum(field, [Promise.resolve(null), ''])).toBe(2);
  });

  it('ignores values that are not arrays', () => {
    expect(getServarRepeatNum(makeField('audio_recording'), null)).toBe(0);
  });
});
