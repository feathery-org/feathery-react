import { hiddenEditorConverter } from './convertOriginal';
import { waitForEj } from '../ejLoader';
import { featheryDoc } from '../../../../utils/browser';

jest.mock('../ejLoader', () => ({
  ...jest.requireActual('../ejLoader'),
  waitForEj: jest.fn()
}));

const doc = { sections: [{ blocks: [{ inlines: [{ text: 'Original' }] }] }] };

// A stand-in editor whose open either loads the document or fails its Import.
function fakeEj(open: 'loads' | 'fails') {
  const destroy = jest.fn();
  class Container {
    private listeners: Record<string, () => void> = {};
    documentEditor: any;
    constructor() {
      const listeners: Record<string, (() => void)[]> = {};
      const emit = (name: string) =>
        (listeners[name] ?? []).forEach((f) => f());
      this.documentEditor = {
        addEventListener: (name: string, f: () => void) =>
          (listeners[name] = [...(listeners[name] ?? []), f]),
        removeEventListener: jest.fn(),
        // Like Syncfusion: a failed Import never settles the open promise.
        openAsync: () =>
          open === 'loads'
            ? Promise.resolve().then(() => emit('documentChange'))
            : (setTimeout(() => emit('serviceFailure'), 0),
              new Promise(() => undefined)),
        serialize: () => JSON.stringify(doc)
      };
    }

    addEventListener(name: string, f: () => void) {
      this.listeners[name] = f;
    }

    appendTo() {
      this.listeners.created?.();
    }

    destroy = destroy;
  }
  (waitForEj as jest.Mock).mockResolvedValue({
    documenteditor: { DocumentEditorContainer: Container }
  });
  return { destroy };
}

describe('hiddenEditorConverter', () => {
  const bytes = new ArrayBuffer(4);

  it('returns the opened document and tears the editor down', async () => {
    const { destroy } = fakeEj('loads');

    const result = await hiddenEditorConverter('https://svc/')(bytes);

    expect(result.sections[0].blocks[0].inlines[0].text).toBe('Original');
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(featheryDoc().body.children).toHaveLength(0);
  });

  it('fails as soon as the Import request fails, without waiting out the load timeout', async () => {
    const { destroy } = fakeEj('fails');
    const started = Date.now();

    await expect(hiddenEditorConverter('https://svc/')(bytes)).rejects.toThrow(
      'import failed'
    );

    expect(Date.now() - started).toBeLessThan(1000);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(featheryDoc().body.children).toHaveLength(0);
  });
});
