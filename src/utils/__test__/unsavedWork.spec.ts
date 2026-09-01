import {
  clearUnsavedWork,
  confirmLeavingUnsavedWork,
  hasUnsavedWork,
  setUnsavedWork,
  unsavedWorkMessage,
  unsavedWorkSources,
  _clearUnsavedWorkRegistry
} from '../unsavedWork';
import { featheryWindow } from '../browser';

const beforeUnload = () => {
  const event = new Event('beforeunload', { cancelable: true });
  featheryWindow().dispatchEvent(event);
  return event;
};

afterEach(() => {
  _clearUnsavedWorkRegistry();
  jest.restoreAllMocks();
});

describe('unsavedWork registry', () => {
  test('tracks sources per form', () => {
    setUnsavedWork('form-1', 'table:a', 'Table dirty.');
    expect(hasUnsavedWork('form-1')).toBe(true);
    expect(hasUnsavedWork('form-2')).toBe(false);
    expect(unsavedWorkSources('form-1')).toEqual(['table:a']);
  });

  test('stays dirty until every source on the form clears', () => {
    setUnsavedWork('form-1', 'table:a', 'Table dirty.');
    setUnsavedWork('form-1', 'docx:b', 'Doc dirty.');

    clearUnsavedWork('form-1', 'table:a');
    expect(hasUnsavedWork('form-1')).toBe(true);

    clearUnsavedWork('form-1', 'docx:b');
    expect(hasUnsavedWork('form-1')).toBe(false);
  });

  test('stacks distinct messages and de-duplicates repeats', () => {
    setUnsavedWork('form-1', 'docx:b', 'Doc dirty.');
    setUnsavedWork('form-1', 'table:a', 'Table dirty.');
    expect(unsavedWorkMessage('form-1')).toBe('Doc dirty.\n\nTable dirty.');

    // Two tables on one step should not say the same thing twice.
    setUnsavedWork('form-1', 'table:c', 'Table dirty.');
    expect(unsavedWorkMessage('form-1')).toBe('Doc dirty.\n\nTable dirty.');
  });

  test('a source with no form id falls back to a shared key', () => {
    setUnsavedWork(undefined, 'table:a', 'Table dirty.');
    expect(hasUnsavedWork(undefined)).toBe(true);
    expect(hasUnsavedWork('form-1')).toBe(false);
  });

  test('arms the unload listener only while something is unsaved', () => {
    expect(beforeUnload().defaultPrevented).toBe(false);

    setUnsavedWork('form-1', 'table:a', 'Table dirty.');
    expect(beforeUnload().defaultPrevented).toBe(true);

    clearUnsavedWork('form-1', 'table:a');
    expect(beforeUnload().defaultPrevented).toBe(false);
  });

  test('another form being dirty still arms the page-level warning', () => {
    // The browser cannot unload one form and keep another, so the listener is
    // global even though the prompt is per form.
    setUnsavedWork('form-2', 'table:a', 'Table dirty.');
    expect(beforeUnload().defaultPrevented).toBe(true);
    expect(hasUnsavedWork('form-1')).toBe(false);
  });

  test('confirmLeaving passes straight through when nothing is unsaved', () => {
    const confirm = jest
      .spyOn(featheryWindow(), 'confirm')
      .mockReturnValue(false);
    expect(confirmLeavingUnsavedWork('form-1')).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  test('confirmLeaving relays the user answer', () => {
    const confirm = jest
      .spyOn(featheryWindow(), 'confirm')
      .mockReturnValue(false);
    setUnsavedWork('form-1', 'table:a', 'Table dirty.');

    expect(confirmLeavingUnsavedWork('form-1')).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Table dirty.');

    confirm.mockReturnValue(true);
    expect(confirmLeavingUnsavedWork('form-1')).toBe(true);
  });
});
