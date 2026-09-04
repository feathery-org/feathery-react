import { getRepeatErrorOwnerIds, getServarRepeatNum } from '../repeat';

describe('getRepeatErrorOwnerIds', () => {
  const container = { position: [0], repeated: true, id: 'sg' };
  const step = {
    servar_fields: [
      { servar: { key: 'inside' }, position: [0, 0] },
      { servar: { key: 'outside' }, position: [1, 0] }
    ],
    buttons: [
      { id: 'btnInside', position: [0, 1] },
      { id: 'btnOutside', position: [2] }
    ],
    subgrids: [container, { id: 'nested', position: [0, 2] }]
  };

  it('includes buttons and nested containers, not just servar fields', () => {
    const ids = getRepeatErrorOwnerIds(step, container);
    // Every error-owning element inside the repeat container. The repeated
    // container itself is included too: it is clickable once per row, so its
    // own action errors are per-row and must shift with the rows.
    expect(ids).toEqual(
      expect.arrayContaining(['inside', 'btnInside', 'nested', 'sg'])
    );
    // Elements outside the container are excluded.
    expect(ids).not.toContain('outside');
    expect(ids).not.toContain('btnOutside');
  });

  it('returns nothing without a container', () => {
    expect(getRepeatErrorOwnerIds(step, undefined)).toEqual([]);
  });
});

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
