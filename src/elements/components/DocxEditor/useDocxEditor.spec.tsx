import React from 'react';
import { act, render } from '@testing-library/react';
import { installRevisionGroupIsolation } from '../../../utils/documentEditorPrimitives';
import { dynamicImport } from '../../../integrations/utils';
import {
  configureTrackedChangeReview,
  resizeDocxEditor,
  useDocxEditor
} from './useDocxEditor';

jest.mock('../../../utils/documentEditorPrimitives', () => ({
  findReplaceCounterpart: jest.fn(),
  installRevisionGroupIsolation: jest.fn(),
  preserveDocumentViewDuring: jest.fn((_editor, run) => run())
}));
jest.mock('../../../integrations/utils', () => ({
  dynamicImport: jest.fn()
}));

describe('configureTrackedChangeReview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('leaves a gated-off editor fully native', () => {
    const editor = {
      showRevisions: true,
      commentReviewPane: { isUserClosed: false }
    };

    configureTrackedChangeReview(editor, false);

    expect(editor.showRevisions).toBe(true);
    expect(editor.commentReviewPane.isUserClosed).toBe(false);
    expect(installRevisionGroupIsolation).not.toHaveBeenCalled();
  });

  it('installs review behavior only when the rail is enabled', () => {
    const editor = {
      showRevisions: true,
      commentReviewPane: { isUserClosed: false }
    };

    configureTrackedChangeReview(editor, true);

    expect(editor.showRevisions).toBe(false);
    expect(editor.commentReviewPane.isUserClosed).toBe(true);
    expect(installRevisionGroupIsolation).toHaveBeenCalledWith(editor);
  });
});

describe('resizeDocxEditor', () => {
  it('relayouts an assistant-off host and its status chrome without cursor homing', () => {
    const updateZoomContent = jest.fn();
    const containerResize = jest.fn();
    const handleControlHomeKey = jest.fn();
    const editorResize = jest.fn();
    const fitPage = jest.fn();
    const container = {
      resize: containerResize,
      statusBar: { updateZoomContent }
    };
    const editor = {
      showRevisions: true,
      commentReviewPane: { isUserClosed: false },
      selection: { handleControlHomeKey },
      viewer: { zoomType: 'FitPageWidth' },
      resize: editorResize,
      fitPage
    };

    configureTrackedChangeReview(editor, false);
    resizeDocxEditor(container, editor, true);

    expect(editorResize).toHaveBeenCalledTimes(1);
    expect(fitPage).toHaveBeenCalledWith('FitPageWidth');
    expect(updateZoomContent).toHaveBeenCalledTimes(1);
    expect(containerResize).not.toHaveBeenCalled();
    expect(handleControlHomeKey).not.toHaveBeenCalled();
    expect(editor.showRevisions).toBe(true);
    expect(editor.commentReviewPane.isUserClosed).toBe(false);
  });
});

// A gate flip is not a document change. The host derives the review gate from
// `readOnly` (`assistantEnabled && !readOnly`), so finalizing an envelope for
// signature flips it mid-session and recreates the instance - and the reopen
// used to re-fetch `sourceUrl`, the PRE-SAVE url, silently replacing what the
// user was looking at with older bytes. These drive the real hook against a fake
// EJ2, because the whole behaviour is in how its effects sequence.
describe('useDocxEditor across a review-gate flip', () => {
  const CARRIED = '{"sfdt":"the document as it stood"}';

  type FakeEditor = {
    open: jest.Mock;
    openAsync: jest.Mock;
    serialize: jest.Mock;
    revisions: { length: number };
    isReadOnly: boolean;
    enableContextMenu: boolean;
    addEventListener: jest.Mock;
    removeEventListener: jest.Mock;
    documentHelper: { viewerContainer: { style: Record<string, string> } };
    /** Fire documentChange by hand, for the deferred-load cases. */
    fireDocumentChange: () => void;
  };

  const editors: FakeEditor[] = [];
  let fetchCalls = 0;
  /** Set false before rendering to hold every document mid-load. */
  let autoLoadDocuments = true;

  /**
   * `autoLoad: false` opens WITHOUT announcing documentChange, so a test can
   * hold the document mid-load and release it later.
   */
  const makeEditor = ({ autoLoad = true } = {}): FakeEditor => {
    const listeners: Record<string, Array<() => void>> = {};
    // Real EJ2 raises documentChange once per open, after open()/openAsync() has
    // resolved, and the hook will not settle until it hears it. A fake that
    // never raised it left the open path waiting on its 20s fallback, so the
    // tests below saw an editor that had begun loading and never finished.
    const fireDocumentChange = () => {
      (listeners.documentChange ?? []).slice().forEach((cb) => cb());
    };
    const announce = () => {
      if (autoLoad) fireDocumentChange();
    };
    return {
      open: jest.fn(() => announce()),
      openAsync: jest.fn(async () => {
        announce();
      }),
      serialize: jest.fn(() => CARRIED),
      // Pending assistant edits: work in the document that is not on the server.
      revisions: { length: 1 },
      isReadOnly: false,
      enableContextMenu: false,
      addEventListener: jest.fn((name: string, cb: () => void) => {
        listeners[name] = listeners[name] ?? [];
        listeners[name].push(cb);
      }),
      removeEventListener: jest.fn((name: string, cb: () => void) => {
        listeners[name] = (listeners[name] ?? []).filter(
          (entry) => entry !== cb
        );
      }),
      documentHelper: { viewerContainer: { style: {} } },
      fireDocumentChange
    };
  };

  beforeEach(() => {
    editors.length = 0;
    fetchCalls = 0;
    autoLoadDocuments = true;
    (dynamicImport as jest.Mock).mockResolvedValue(undefined);
    class FakeContainer {
      static Inject = jest.fn();
      documentEditor: FakeEditor;
      private created: (() => void) | undefined;
      constructor() {
        this.documentEditor = makeEditor({ autoLoad: autoLoadDocuments });
        editors.push(this.documentEditor);
      }

      addEventListener(name: string, cb: () => void) {
        if (name === 'created') this.created = cb;
      }

      appendTo() {
        this.created?.();
      }

      destroy() {
        /* no live resources in the fake */
      }
    }
    (globalThis as any).ej = {
      base: { registerLicense: jest.fn() },
      documenteditor: { Toolbar: {}, DocumentEditorContainer: FakeContainer }
    };
    (globalThis as any).ResizeObserver = class {
      observe() {
        /* geometry is irrelevant here */
      }

      disconnect() {
        /* no-op */
      }
    };
    (globalThis as any).fetch = jest.fn(async () => {
      fetchCalls++;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
  });

  afterEach(() => {
    delete (globalThis as any).ej;
    delete (globalThis as any).fetch;
    delete (globalThis as any).ResizeObserver;
  });

  // Rendered, not renderHook: the editor host element has to be attached to the
  // hook's ref before its create effect runs, exactly as in the real component.
  const Harness = ({
    reviewChanges,
    url = 'https://example.test/pre-save.docx'
  }: {
    reviewChanges: boolean;
    url?: string;
  }) => {
    const api = useDocxEditor({
      source: { url },
      serviceUrl: 'https://example.test/service/',
      reviewChanges,
      licenseKey: 'test-key'
    });
    return <div ref={api.containerRef} />;
  };

  const settle = async () => {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  };

  it('recreates the instance with the live document, not the pre-save source', async () => {
    const view = render(<Harness reviewChanges />);
    await settle();
    expect(editors).toHaveLength(1);
    expect(fetchCalls).toBe(1);
    expect(editors[0].openAsync).toHaveBeenCalled();

    // Finalizing for signature flips readOnly, and with it the gate.
    view.rerender(<Harness reviewChanges={false} />);
    await settle();

    expect(editors).toHaveLength(2);
    // The document came back from the instance that had it, not from the url.
    expect(fetchCalls).toBe(1);
    expect(editors[0].serialize).toHaveBeenCalled();
    expect(editors[1].open).toHaveBeenCalledWith(CARRIED);
    expect(editors[1].openAsync).not.toHaveBeenCalled();
  });

  it('waits for documentChange before reporting the document ready', async () => {
    // openAsync resolves BEFORE the converted document is laid out, so settling
    // on it alone hands callers the previous (usually blank) document. This is
    // what the documentChange wait exists for, and it is invisible unless a fake
    // can resolve the open without announcing the load.
    autoLoadDocuments = false;
    const ready = jest.fn();
    const Waiting = () => {
      const api = useDocxEditor({
        source: { url: 'https://example.test/slow.docx' },
        serviceUrl: 'https://example.test/service/',
        reviewChanges: false,
        licenseKey: 'test-key',
        onReady: ready
      });
      return <div ref={api.containerRef} />;
    };

    render(<Waiting />);
    await settle();

    expect(editors).toHaveLength(1);
    expect(editors[0].openAsync).toHaveBeenCalled();
    // Opened, but not yet on screen.
    expect(ready).not.toHaveBeenCalled();

    await act(async () => {
      editors[0].fireDocumentChange();
    });
    await settle();

    expect(ready).toHaveBeenCalled();
  });

  it('stops listening for documentChange once it has heard it', async () => {
    render(<Harness reviewChanges={false} />);
    await settle();
    expect(editors[0].removeEventListener).toHaveBeenCalledWith(
      'documentChange',
      expect.any(Function)
    );
  });

  it('lets a regenerate win over the carried document', async () => {
    const view = render(<Harness reviewChanges />);
    await settle();
    expect(fetchCalls).toBe(1);

    // A gate flip and a NEW source in the same commit: the stash belongs to the
    // document that was open, so the new one must be fetched, not overwritten.
    view.rerender(
      <Harness
        reviewChanges={false}
        url='https://example.test/regenerated.docx'
      />
    );
    await settle();

    expect(editors).toHaveLength(2);
    // The new document is fetched and opened; the stash is not used. (How many
    // times a url change re-opens is the pre-existing open-effect behaviour and
    // not what this asserts.)
    expect(fetchCalls).toBeGreaterThan(1);
    expect(editors[1].openAsync).toHaveBeenCalled();
    expect(editors[1].open).not.toHaveBeenCalledWith(CARRIED);
  });
});
