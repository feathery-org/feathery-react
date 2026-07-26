import { act, render, renderHook } from '@testing-library/react';
import {
  INDEX_POLL_MS,
  postDocumentIndex,
  REINDEX_DEBOUNCE_MS,
  useDocumentIndex,
  _resetDocumentIndexState
} from '../documentIndex';
import { registerDocxEditor, _clearDocxEditors } from '../docxEditorRegistry';
import AssistantChat from '../../AssistantChat';

// The assistant panel pulls in the AI SDK transport and the voice pipeline;
// neither is part of this wiring and neither runs in jsdom.
jest.mock('@ai-sdk/react', () => ({
  Chat: class {},
  useChat: () => ({
    messages: [],
    sendMessage: jest.fn(),
    status: 'ready',
    setMessages: jest.fn(),
    stop: jest.fn(),
    addToolResult: jest.fn()
  })
}));
// Ships as ESM (via `streamdown`) and renders nothing relevant here.
jest.mock('../../MarkdownText', () => ({
  __esModule: true,
  default: () => null
}));
jest.mock('../../voice/useAssistantVoice', () => ({
  useAssistantVoice: () => ({
    active: false,
    start: jest.fn(),
    stop: jest.fn(),
    speaking: false,
    listening: false
  })
}));
jest.mock('../../../utils/init', () => ({
  initInfo: () => ({ sdkKey: 'SDK-KEY', userId: 'user-1' }),
  fieldValues: {},
  filePathMap: {}
}));

const BASE_URL = 'https://api.test/agent/assistant/';
const DOC_ID = 'doc-template-123';
const headers = () => ({ Authorization: 'Bearer JWT' });

const BLANK_SFDT = { sections: [{ blocks: [] }] };

const targets = (documentId?: string) => () =>
  documentId
    ? [
        { type: 'panel', id: 'panel-1' },
        { type: 'generated_document', id: documentId }
      ]
    : [{ type: 'panel', id: 'panel-1' }];

// Stands in for the live SyncFusion DocumentEditor: `serialize()` returns a blank
// document until the source finishes opening, exactly as the real one does.
const fakeEditor = () => {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    loaded: false,
    text: 'Total premium: $2,691',
    serialize() {
      if (!this.loaded) return JSON.stringify(BLANK_SFDT);
      return JSON.stringify({
        sections: [{ blocks: [{ inlines: [{ text: this.text }] }] }]
      });
    },
    addEventListener(event: string, fn: () => void) {
      (listeners[event] ||= []).push(fn);
    },
    removeEventListener(event: string, fn: () => void) {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
    },
    emit(event: string) {
      (listeners[event] ?? []).forEach((fn) => fn());
    }
  };
};

let fetchMock: jest.Mock;

beforeEach(() => {
  _clearDocxEditors();
  _resetDocumentIndexState();
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  (global as any).fetch = fetchMock;
});
afterEach(() => {
  delete (global as any).fetch;
  jest.restoreAllMocks();
});

const indexPosts = () =>
  fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('document-index'));

describe('postDocumentIndex', () => {
  it('POSTs to <baseUrl>document-index keyed by the generated_document id', async () => {
    const sent = await postDocumentIndex({
      baseUrl: BASE_URL,
      generatedDocumentId: DOC_ID,
      blocks: [{ anchor: 's0:b0', kind: 'paragraph', text: 'hi' }],
      headers
    });
    expect(sent).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/agent/assistant/document-index');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer JWT'
    });
    const body = JSON.parse(init.body);
    // ai-services takes `envelopeId ?? documentId` as the scope key on write and
    // resolves the read scope from the same generated_document target, so both
    // fields must carry that id or search silently returns nothing.
    expect(body.envelopeId).toBe(DOC_ID);
    expect(body.documentId).toBe(DOC_ID);
    expect(body.blocks).toEqual([
      { anchor: 's0:b0', kind: 'paragraph', text: 'hi' }
    ]);
  });

  it('sends nothing when the scope key or the blocks are missing', async () => {
    expect(
      await postDocumentIndex({
        baseUrl: BASE_URL,
        generatedDocumentId: '',
        blocks: [{ anchor: 's0:b0', kind: 'paragraph', text: 'hi' }],
        headers
      })
    ).toBe(false);
    // An empty inventory would embed nothing and clobber the existing index.
    expect(
      await postDocumentIndex({
        baseUrl: BASE_URL,
        generatedDocumentId: DOC_ID,
        blocks: [],
        headers
      })
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx so the caller can report it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(
      postDocumentIndex({
        baseUrl: BASE_URL,
        generatedDocumentId: DOC_ID,
        blocks: [{ anchor: 's0:b0', kind: 'paragraph', text: 'hi' }],
        headers
      })
    ).rejects.toThrow(/document-index failed \(500\)/);
  });
});

describe('useDocumentIndex', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const mount = (documentId?: string) =>
    renderHook(() =>
      useDocumentIndex({
        baseUrl: BASE_URL,
        getTargets: targets(documentId),
        headers
      })
    );

  it('waits for the document to load, then POSTs the inventory', async () => {
    const editor = fakeEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);

    // The editor registers as soon as SyncFusion is created - before the .docx
    // is converted and opened - so at that moment there is nothing to index.
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 3);
    });
    expect(indexPosts()).toHaveLength(0);

    editor.loaded = true;
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    expect(indexPosts()).toHaveLength(1);
    const body = JSON.parse(indexPosts()[0][1].body);
    expect(body.envelopeId).toBe(DOC_ID);
    expect(body.blocks).toHaveLength(1);
    expect(body.blocks[0].text).toContain('Total premium');
  });

  it('indexes an editor that registered before the chat mounted', async () => {
    const editor = fakeEditor();
    editor.loaded = true;
    registerDocxEditor(undefined, editor);

    mount(DOC_ID);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(1);
  });

  it('does not re-POST unchanged content across remounts or re-registrations', async () => {
    const editor = fakeEditor();
    editor.loaded = true;

    const first = mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(1);

    first.unmount();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 2);
    });
    expect(indexPosts()).toHaveLength(1);
  });

  it('re-indexes after the content actually changes, debounced', async () => {
    const editor = fakeEditor();
    editor.loaded = true;
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(1);

    // A burst of edits that nets out to no change costs nothing.
    editor.emit('contentChange');
    editor.emit('contentChange');
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    expect(indexPosts()).toHaveLength(1);

    // Real new content (e.g. Robin's bulk edit, or a regenerate reopening a new
    // document into the same editor instance) does re-index - once.
    editor.text = 'Total premium: $3,400';
    editor.emit('contentChange');
    editor.emit('contentChange');
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    expect(indexPosts()).toHaveLength(2);
    expect(JSON.parse(indexPosts()[1][1].body).blocks[0].text).toContain(
      '$3,400'
    );
  });

  it('waits for a generated_document target instead of guessing a scope key', async () => {
    const editor = fakeEditor();
    editor.loaded = true;
    mount(undefined);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 3);
    });
    expect(indexPosts()).toHaveLength(0);
  });

  it('fails soft and warns when the POST is rejected', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 403 });
    const editor = fakeEditor();
    editor.loaded = true;
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    expect(indexPosts()).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('document index POST failed'),
      expect.anything()
    );
  });

  it('warns instead of polling forever when content never appears', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const editor = fakeEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 200);
    });
    expect(indexPosts()).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('gave up indexing')
    );
  });
});

// The regression this ports back was never a broken function - it was a correct
// function nobody called. These assert the call site itself: they fail if
// AssistantChat stops invoking useDocumentIndex, whatever else still passes.
describe('AssistantChat wiring (the regression guard)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('POSTs the document index when an editor with a loaded document appears', async () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={targets(DOC_ID)}
        getJwt={() => 'JWT'}
      />
    );

    const editor = fakeEditor();
    editor.loaded = true;
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    expect(indexPosts()).toHaveLength(1);
    const [url, init] = indexPosts()[0];
    expect(url).toBe('https://api.test/agent/assistant/document-index');
    const body = JSON.parse(init.body);
    expect(body.blocks.length).toBeGreaterThan(0);
    // Keyed on the same generated_document id the chat sends as its target, and
    // authenticated with the same headers.
    expect(body.envelopeId).toBe(DOC_ID);
    expect(init.headers.Authorization).toBe('Bearer JWT');
  });

  it('sends no index request while the form has no document target', async () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={targets(undefined)}
        getJwt={() => 'JWT'}
      />
    );
    const editor = fakeEditor();
    editor.loaded = true;
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 4);
    });
    expect(indexPosts()).toHaveLength(0);
  });
});
