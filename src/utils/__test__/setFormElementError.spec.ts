import { setFormElementError } from '../formHelperFunctions';
import { featheryDoc } from '../browser';

// jsdom's form.elements.namedItem returns only the first match and never a
// RadioNodeList, so model the browser: namedItem matches id OR name and hands
// back a RadioNodeList whenever more than one control matches.
class RadioNodeList extends Array<Element> {}
(global as any).RadioNodeList = RadioNodeList;

const browserFormRef = (form: HTMLFormElement) => ({
  current: {
    elements: {
      namedItem: (key: string) => {
        const matches = Array.from(
          form.querySelectorAll(`[id="${key}"], [name="${key}"]`)
        );
        if (matches.length > 1) return RadioNodeList.from(matches);
        return matches[0] ?? null;
      }
    },
    checkValidity: () => form.checkValidity()
  }
});

const setError = (html: string, fieldKey: string, servarType = '') => {
  featheryDoc().body.innerHTML = `<form id="f">${html}</form>`;
  const formRef = browserFormRef(
    featheryDoc().getElementById('f') as HTMLFormElement
  );
  return setFormElementError({
    formRef,
    errorType: 'html5',
    fieldKey,
    message: 'Required',
    servarType
  });
};

describe('setFormElementError html5 target resolution', () => {
  it('is a no-op when nothing in the form carries the field key', async () => {
    await expect(setError('<div></div>', 'color1')).resolves.toBe(false);
  });

  it('does not throw when only a hidden value mirror carries the field key', async () => {
    // ColorPickerField shape: named swatch button + hidden mirror, no ErrorInput
    await expect(
      setError(
        `<button type="button" name="color1-swatch"></button>
         <input type="hidden" name="color1" value="ff0000" />`,
        'color1',
        'hex_color'
      )
    ).resolves.toBe(false);
  });

  it('does not throw when a plain button resolves under the field key', async () => {
    // Regression: the BUTTON branch used to dereference a missing #error_ child
    await expect(
      setError(
        `<button type="button" name="color1"></button>
         <input type="hidden" name="color1" />`,
        'color1',
        'hex_color'
      )
    ).resolves.toBe(false);
  });

  it('targets the ErrorInput and skips option buttons and the mirror', async () => {
    // RatingField / ButtonGroupField shape
    await setError(
      `<button type="button" name="r-1"></button>
       <input id="r" name="r" />
       <input type="hidden" name="r" value="1" />`,
      'r',
      'rating'
    );
    const errorInput = featheryDoc().getElementById('r') as HTMLInputElement;
    expect(errorInput.validationMessage).toBe('Required');
  });

  it('still redirects a ButtonElement to its nested error input', async () => {
    await setError(
      `<button type="button" id="btn" name="btn">
         <input id="error_btn" />
       </button>`,
      'btn'
    );
    const nested = featheryDoc().getElementById(
      'error_btn'
    ) as HTMLInputElement;
    expect(nested.validationMessage).toBe('Required');
  });
});
