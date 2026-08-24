import { setFormElementError } from './formHelperFunctions';
import { InlineErrors } from './inlineErrors';

// Regression coverage for the button error path: writing an error for a
// repeated button (e.g. an action failure) must scope to that button's repeat
// row and merge into the current error map rather than replacing it, and
// clearing it must remove only that row.
describe('setFormElementError (inline, button-style writes)', () => {
  const write = (
    inlineErrors: InlineErrors,
    fieldKey: string,
    message: string,
    index?: number | null
  ) =>
    setFormElementError({
      errorType: 'inline',
      fieldKey,
      message,
      index,
      inlineErrors,
      // triggerErrors:false → mutate the passed map without a setState publish,
      // so the test can assert the resulting structure directly.
      triggerErrors: false
    });

  it('scopes a repeated-button failure to its row and preserves other errors', async () => {
    const inlineErrors: InlineErrors = { name: { message: 'keep me' } };

    await write(inlineErrors, 'btn', 'action failed', 1);

    // Other field errors are untouched (no full-map replace).
    expect(inlineErrors.name).toEqual({ message: 'keep me' });
    // Button error is scoped to row 1, not field-wide.
    expect(inlineErrors.btn).toEqual({
      byIndex: { 1: { message: 'action failed' } }
    });
  });

  it('clears only the failed row and leaves siblings and other fields', async () => {
    const inlineErrors: InlineErrors = { name: { message: 'keep me' } };
    await write(inlineErrors, 'btn', 'row 0 failed', 0);
    await write(inlineErrors, 'btn', 'row 1 failed', 1);

    await write(inlineErrors, 'btn', '', 0);

    expect(inlineErrors.btn).toEqual({
      byIndex: { 1: { message: 'row 1 failed' } }
    });
    expect(inlineErrors.name).toEqual({ message: 'keep me' });
  });
});
