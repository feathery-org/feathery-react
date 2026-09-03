import { setFormElementError } from './formHelperFunctions';
import { getInlineError } from '../Form/grid/Element/utils/utils';
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

// Payment failures (Stripe setup on submit, and purchase_products) are written
// through the same writer with the failing row's index. A failure in one
// repeated row must stay on that row rather than rendering on its siblings.
describe('setFormElementError (inline, payment-style writes)', () => {
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
      triggerErrors: false
    });

  it('isolates a payment-setup failure to the submitted row', async () => {
    const inlineErrors: InlineErrors = {};
    // submitStep passes its `repeat` argument as the index.
    await write(inlineErrors, 'card', 'Card declined', 1);

    expect(inlineErrors.card).toEqual({
      byIndex: { 1: { message: 'Card declined' } }
    });
    // Sibling rows are unaffected, and there is no field-wide fallback that
    // would render on every row.
    expect(inlineErrors.card?.message).toBeUndefined();
  });

  it('isolates a purchase failure to the triggering row', async () => {
    const inlineErrors: InlineErrors = { other: { message: 'keep me' } };
    // purchaseProductsAction passes triggerElement.repeat as the index.
    await write(inlineErrors, 'card', 'Purchase failed', 2);

    expect(inlineErrors.card).toEqual({
      byIndex: { 2: { message: 'Purchase failed' } }
    });
    expect(inlineErrors.other).toEqual({ message: 'keep me' });
  });

  it('still writes field-wide for a non-repeated payment field', async () => {
    const inlineErrors: InlineErrors = {};
    // Not in a repeat container -> index is undefined.
    await write(inlineErrors, 'card', 'Card declined', undefined);

    expect(inlineErrors.card).toEqual({ message: 'Card declined' });
    // The non-repeat renderer (no `repeat` on the element) finds it.
    expect(getInlineError({ servar: { key: 'card' } }, inlineErrors)).toBe(
      'Card declined'
    );
  });

  it('row 0 is NOT interchangeable with a field-wide write', async () => {
    // Guards the submit path: collapsing a non-repeated element's absent
    // repeat to 0 would store the error under byIndex[0], which the
    // non-repeat renderer never reads -- the message would silently vanish.
    const asRowZero: InlineErrors = {};
    await write(asRowZero, 'card', 'Card declined', 0);
    expect(asRowZero.card).toEqual({
      byIndex: { 0: { message: 'Card declined' } }
    });
    expect(
      getInlineError({ servar: { key: 'card' } }, asRowZero)
    ).toBeUndefined();

    // Passing the absent repeat through instead renders correctly.
    const asFieldWide: InlineErrors = {};
    await write(asFieldWide, 'card', 'Card declined', undefined);
    expect(getInlineError({ servar: { key: 'card' } }, asFieldWide)).toBe(
      'Card declined'
    );
  });
});
