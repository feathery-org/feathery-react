import {
  applyInlineError,
  firstInlineErrorMessage,
  inlineEntryHasMessage,
  InlineErrors,
  resolveInlineErrorMessage,
  shiftInlineErrorRows
} from './inlineErrors';

describe('shiftInlineErrorRows', () => {
  it('drops the removed row and shifts higher rows down', () => {
    const errors: InlineErrors = {
      f: {
        byIndex: {
          0: { message: 'r0' },
          1: { message: 'r1' },
          2: { message: 'r2' }
        }
      }
    };

    const next = shiftInlineErrorRows(errors, ['f'], 1);

    // r1 removed; r2 shifted down into slot 1; r0 untouched.
    expect(next.f).toEqual({
      byIndex: { 0: { message: 'r0' }, 1: { message: 'r2' } }
    });
  });

  it('shifts BUTTON errors too, not just servar fields', () => {
    // Removing row 0 must not leave the button error sitting on the new row 0.
    const errors: InlineErrors = {
      btn: { byIndex: { 0: { message: 'row 0 failed' } } },
      name: { byIndex: { 1: { message: 'row 1 required' } } }
    };

    const next = shiftInlineErrorRows(errors, ['name', 'btn'], 0);

    // The removed row's button error is gone entirely.
    expect(next.btn).toBeUndefined();
    // The servar error from row 1 moved down to row 0.
    expect(next.name).toEqual({
      byIndex: { 0: { message: 'row 1 required' } }
    });
  });

  it('shifts higher button rows down when a lower row is removed', () => {
    const errors: InlineErrors = {
      btn: { byIndex: { 1: { message: 'b1' }, 2: { message: 'b2' } } }
    };

    const next = shiftInlineErrorRows(errors, ['btn'], 0);

    expect(next.btn).toEqual({
      byIndex: { 0: { message: 'b1' }, 1: { message: 'b2' } }
    });
  });

  it('preserves a field-wide message and leaves untouched owners alone', () => {
    const errors: InlineErrors = {
      f: { message: 'field-wide', byIndex: { 0: { message: 'r0' } } },
      other: { byIndex: { 0: { message: 'keep' } } }
    };

    const next = shiftInlineErrorRows(errors, ['f'], 0);

    expect(next.f).toEqual({ message: 'field-wide' });
    // Not in ownerKeys => untouched.
    expect(next.other).toEqual({ byIndex: { 0: { message: 'keep' } } });
  });
});

describe('applyInlineError', () => {
  it('stores a field-wide message and clears the whole field when emptied', () => {
    const errors: InlineErrors = {};
    applyInlineError(errors, 'f', 'required');
    expect(errors.f).toEqual({ message: 'required' });

    applyInlineError(errors, 'f', '');
    expect(errors.f).toBeUndefined();
  });

  it('stores a per-row message and clears only that row when emptied', () => {
    const errors: InlineErrors = {};
    applyInlineError(errors, 'f', 'row 0', 0);
    applyInlineError(errors, 'f', 'row 2', 2);
    expect(errors.f).toEqual({
      byIndex: { 0: { message: 'row 0' }, 2: { message: 'row 2' } }
    });

    // Indexed empty write clears only its row, leaving the others.
    applyInlineError(errors, 'f', '', 0);
    expect(errors.f).toEqual({ byIndex: { 2: { message: 'row 2' } } });

    // Clearing the last row removes the entry entirely.
    applyInlineError(errors, 'f', '', 2);
    expect(errors.f).toBeUndefined();
  });

  it('a non-indexed empty write clears row errors too (reviewer scenario)', () => {
    // setFieldErrors({ f: { index: 1, message: 'row error' } })
    const errors: InlineErrors = {};
    applyInlineError(errors, 'f', 'row error', 1);
    expect(resolveInlineErrorMessage(errors.f, 1)).toBe('row error');
    expect(inlineEntryHasMessage(errors.f)).toBe(true);

    // setFieldErrors({ f: '' }) -> field-wide clear must drop the row too, so
    // row 1 no longer renders and aggregate validation is no longer invalid.
    applyInlineError(errors, 'f', '');
    expect(errors.f).toBeUndefined();
    expect(resolveInlineErrorMessage(errors.f, 1)).toBeUndefined();
    expect(inlineEntryHasMessage(errors.f)).toBe(false);
  });

  it('keeps a field-wide message when clearing an individual row', () => {
    const errors: InlineErrors = {};
    applyInlineError(errors, 'f', 'field-wide');
    applyInlineError(errors, 'f', 'row 1', 1);
    applyInlineError(errors, 'f', '', 1);
    expect(errors.f).toEqual({ message: 'field-wide' });
  });

  it('never collides a repeated field with a literal `key-0` field', () => {
    const errors: InlineErrors = {};
    applyInlineError(errors, 'f', 'repeat row 0', 0);
    applyInlineError(errors, 'f-0', 'plain field');
    expect(errors.f).toEqual({ byIndex: { 0: { message: 'repeat row 0' } } });
    expect(errors['f-0']).toEqual({ message: 'plain field' });

    // Clearing the plain field must not touch the repeated field's row.
    applyInlineError(errors, 'f-0', '');
    expect(errors['f-0']).toBeUndefined();
    expect(resolveInlineErrorMessage(errors.f, 0)).toBe('repeat row 0');
  });

  it('ignores writes with no field key', () => {
    const errors: InlineErrors = {};
    applyInlineError(errors, '', 'nope');
    expect(errors).toEqual({});
  });
});

describe('inline error readers', () => {
  const errors: InlineErrors = {
    plain: { message: 'plain err' },
    rep: { byIndex: { 0: { message: 'r0' }, 2: { message: 'r2' } } },
    wide: { message: 'wide', byIndex: { 1: { message: 'r1' } } }
  };

  it('resolveInlineErrorMessage scopes per row with field-wide fallback', () => {
    expect(resolveInlineErrorMessage(errors.plain)).toBe('plain err');
    expect(resolveInlineErrorMessage(errors.rep, 0)).toBe('r0');
    expect(resolveInlineErrorMessage(errors.rep, 1)).toBeUndefined();
    expect(resolveInlineErrorMessage(errors.rep, 2)).toBe('r2');
    // Row without its own error falls back to the field-wide message.
    expect(resolveInlineErrorMessage(errors.wide, 5)).toBe('wide');
    expect(resolveInlineErrorMessage(undefined, 0)).toBeUndefined();
  });

  it('inlineEntryHasMessage detects field-wide and per-row messages', () => {
    expect(inlineEntryHasMessage(errors.plain)).toBe(true);
    expect(inlineEntryHasMessage(errors.rep)).toBe(true);
    expect(inlineEntryHasMessage({})).toBe(false);
    expect(inlineEntryHasMessage({ byIndex: {} })).toBe(false);
    expect(inlineEntryHasMessage({ byIndex: { 0: { message: '' } } })).toBe(
      false
    );
  });

  it('firstInlineErrorMessage returns any non-empty message', () => {
    expect(firstInlineErrorMessage(errors.plain)).toBe('plain err');
    expect(firstInlineErrorMessage(errors.rep)).toBe('r0');
    expect(firstInlineErrorMessage({})).toBeUndefined();
  });
});
