import { act, render, renderHook } from '@testing-library/react';
import {
  getDocumentIndexFreshness,
  INDEX_POLL_MS,
  INDEX_STABLE_POLLS,
  postDocumentIndex,
  REINDEX_DEBOUNCE_MS,
  useDocumentIndex,
  _resetDocumentIndexState
} from '../documentIndex';
import {
  getActiveDocxEditorEnvelopeTarget,
  getActiveDocxEditorTarget,
  registerDocxEditor,
  unregisterDocxEditor,
  _clearDocxEditors
} from '../docxEditorRegistry';
import AssistantChat from '../../AssistantChat';

// Capture the chat transport options so tests can invoke the real `body()`
// AssistantChat wires up - that is the exact payload a chat request carries,
// so asserting on it tests the call site, not a helper. (The real `ai`
// package is already mocked away globally in setupTests.ts; this narrows that
// mock to capture instead of discard.)
jest.mock('ai', () => ({
  DefaultChatTransport: class {
    constructor(opts: any) {
      (globalThis as any).__capturedTransportOpts = opts;
    }
  },
  lastAssistantMessageIsCompleteWithToolCalls: jest.fn()
}));

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
const ENV_ID = 'envelope-456';
const OTHER_ENV_ID = 'envelope-789';
const DOCUMENT_TARGET = { type: 'generated_document', id: DOC_ID };
const ENVELOPE_TARGET = { type: 'envelope', id: ENV_ID };
const headers = () => ({ Authorization: 'Bearer JWT' });

const BLANK_SFDT = { sections: [{ blocks: [] }] };

const targets =
  (
    documentId?: string,
    envelopeId: string | null = documentId ? ENV_ID : null
  ) =>
  () =>
    [
      { type: 'panel', id: 'panel-1' },
      { type: 'fuser', id: 'user-1' },
      ...(documentId ? [{ type: 'generated_document', id: documentId }] : []),
      ...(envelopeId ? [{ type: 'envelope', id: envelopeId }] : [])
    ];

const mountedEditorTargets = () => {
  const documentTarget = getActiveDocxEditorTarget();
  const envelopeTarget = getActiveDocxEditorEnvelopeTarget();
  return [
    { type: 'panel', id: 'panel-1' },
    { type: 'fuser', id: 'user-1' },
    ...(documentTarget ? [documentTarget] : []),
    ...(envelopeTarget ? [envelopeTarget] : [])
  ];
};

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
  it('POSTs the current envelope as the only index scope', async () => {
    const sent = await postDocumentIndex({
      baseUrl: BASE_URL,
      targets: targets(DOC_ID)(),
      blocks: [{ anchor: 's0:b0', kind: 'paragraph', text: 'hi' }],
      headers
    });
    expect(sent.posted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/agent/assistant/document-index');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer JWT'
    });
    const body = JSON.parse(init.body);
    expect(body.targets).toEqual(targets(DOC_ID)());
    expect(body.envelopeId).toBe(ENV_ID);
    expect(body.documentId).toBeUndefined();
    expect(body.scope).toBeUndefined();
    expect(body.blocks).toEqual([
      { anchor: 's0:b0', kind: 'paragraph', text: 'hi' }
    ]);
  });

  it('sends nothing when the envelope target or the blocks are missing', async () => {
    expect(
      await postDocumentIndex({
        baseUrl: BASE_URL,
        targets: targets(DOC_ID, null)(),
        blocks: [{ anchor: 's0:b0', kind: 'paragraph', text: 'hi' }],
        headers
      })
    ).toEqual({ posted: false });
    // An empty inventory would embed nothing and clobber the existing index.
    expect(
      await postDocumentIndex({
        baseUrl: BASE_URL,
        targets: targets(DOC_ID)(),
        blocks: [],
        headers
      })
    ).toEqual({ posted: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on a non-2xx so the caller can report it', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(
      postDocumentIndex({
        baseUrl: BASE_URL,
        targets: targets(DOC_ID)(),
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

    // Content must hold still for INDEX_STABLE_POLLS ticks before the poll
    // vouches for it - a growing mid-load model must never be posted.
    editor.loaded = true;
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * INDEX_STABLE_POLLS);
    });

    expect(indexPosts()).toHaveLength(1);
    const body = JSON.parse(indexPosts()[0][1].body);
    expect(body.targets).toEqual(targets(DOC_ID)());
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

  it('waits for an envelope while the generated_document target mounts tools', async () => {
    const editor = fakeEditor();
    editor.loaded = true;
    renderHook(() =>
      useDocumentIndex({
        baseUrl: BASE_URL,
        getTargets: targets(DOC_ID, null),
        headers
      })
    );
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

// S7 gate §4: a generated document loads progressively (SyncFusion openAsync
// lays out section by section), and the model grows WITHOUT contentChange
// events until `documentChange` fires at load completion. The index must not
// certify a mid-load snapshot as the whole document: "confirmed POST and no
// contentChange since" must imply "the index matches the live document".
describe('index-on-load: a progressively loading document must not be certified fresh while partial', () => {
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

  const paragraph = (text: string) => ({ inlines: [{ text }] });
  const TOC_SECTION = {
    blocks: [paragraph('Table of Contents'), paragraph('Umbrella ... 12')]
  };
  const BODY_SECTIONS = [
    { blocks: [paragraph('General Liability limits and exclusions')] },
    { blocks: [paragraph('Umbrella coverage: $5,000,000 aggregate')] }
  ];

  // The serialized model grows as openAsync lays the document out; no events
  // fire until the load completes.
  const streamingEditor = () => {
    const listeners: Record<string, (() => void)[]> = {};
    return {
      sections: [] as any[],
      serialize() {
        return JSON.stringify({ sections: this.sections });
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

  const lastPost = () =>
    JSON.parse(indexPosts()[indexPosts().length - 1][1].body);

  it('indexes the full document, not the first partial snapshot, when sections stream in without contentChange', async () => {
    const editor = streamingEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);

    // Registration happens at SyncFusion `created`, before the .docx opens:
    // blank model, nothing may be posted.
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(0);

    // The TOC section lands first (exactly what the S7 gate observed live:
    // 212 TOC-only blocks in the model while the body was still loading).
    editor.sections = [TOC_SECTION];
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    // The rest of the body arrives on later layout ticks - still no events.
    editor.sections = [TOC_SECTION, ...BODY_SECTIONS];
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 6);
    });

    // The index the server ends up holding must contain the document body.
    expect(indexPosts().length).toBeGreaterThan(0);
    const finalBody = lastPost();
    const indexedText = JSON.stringify(finalBody.blocks);
    expect(indexedText).toContain('General Liability');
    expect(indexedText).toContain('$5,000,000');

    // And the freshness certificate must vouch for THAT index - the full one.
    const fresh = getDocumentIndexFreshness(ENVELOPE_TARGET);
    expect(fresh.indexDirty).toBe(false);
    expect(fresh.indexHash).toBe(finalBody.contentHash);

    // Cost guard: the load must not burn an embedding run per layout tick.
    expect(indexPosts()).toHaveLength(1);
  });

  it('re-indexes on documentChange when a slow load stalls long enough to fool the poll', async () => {
    const editor = streamingEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);

    // The TOC alone sits in the model across many ticks (a stalled/slow
    // conversion) - long enough that any snapshot heuristic certifies it.
    editor.sections = [TOC_SECTION];
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 8);
    });

    // Load completes: the body lands and SyncFusion fires `documentChange`
    // (its single per-open load-complete signal, viewer.js executeAfterLayout).
    editor.sections = [TOC_SECTION, ...BODY_SECTIONS];
    editor.emit('documentChange');
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    const finalBody = lastPost();
    expect(JSON.stringify(finalBody.blocks)).toContain('General Liability');
    const fresh = getDocumentIndexFreshness(ENVELOPE_TARGET);
    expect(fresh.indexDirty).toBe(false);
    expect(fresh.indexHash).toBe(finalBody.contentHash);
  });

  it('documentChange on a still-blank editor posts nothing (the clobber guard holds)', async () => {
    const editor = streamingEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);

    editor.emit('documentChange');
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 2);
    });
    expect(indexPosts()).toHaveLength(0);
  });

  it('documentChange re-POSTs even identical content for a newly derived envelope', async () => {
    const editor = streamingEditor();
    editor.sections = [TOC_SECTION, ...BODY_SECTIONS];
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS * 4);
    });
    const posted = indexPosts().length;
    expect(posted).toBeGreaterThan(0);

    // A regeneration can reopen byte-identical content under a brand-new
    // envelope. The browser cannot assume the old envelope's index carries.
    editor.emit('documentChange');
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(posted + 1);
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(false);
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
    // The exact chat target manifest is authenticated with the same headers.
    expect(body.targets).toEqual(targets(DOC_ID)());
    expect(init.headers.Authorization).toBe('Bearer JWT');
  });

  it('does not index before generation while the document tools stay mounted', async () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={targets(DOC_ID, null)}
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

  it('cold start gains the mounted editor target, indexes it, and sends it to chat', async () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={mountedEditorTargets}
        getJwt={() => 'JWT'}
      />
    );
    const transportBody = () =>
      (globalThis as any).__capturedTransportOpts.body();

    expect(transportBody().context.targets).toEqual([
      { type: 'panel', id: 'panel-1' },
      { type: 'fuser', id: 'user-1' }
    ]);
    expect(transportBody().context.document_state).toBeUndefined();

    const editor = fakeEditor();
    editor.loaded = true;
    registerDocxEditor('editor-a', editor, {
      stepId: 'edit-proposal',
      documentId: DOC_ID,
      envelopeId: ENV_ID
    });
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    expect(transportBody().context.targets).toEqual([
      { type: 'panel', id: 'panel-1' },
      { type: 'fuser', id: 'user-1' },
      DOCUMENT_TARGET,
      ENVELOPE_TARGET
    ]);
    expect(transportBody().context.document_state).toMatchObject({
      indexDirty: false,
      indexHash: expect.any(String)
    });
    expect(JSON.parse(indexPosts()[0][1].body).targets).toEqual(
      mountedEditorTargets()
    );
  });

  it('indexes the incoming step under mount-before-unmount ordering and preserves the outgoing index', async () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={mountedEditorTargets}
        getJwt={() => 'JWT'}
      />
    );
    const outgoing = fakeEditor();
    outgoing.loaded = true;
    registerDocxEditor('editor-a', outgoing, {
      stepId: 'step-a',
      documentId: 'document-a',
      envelopeId: 'envelope-a'
    });
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    const incoming = fakeEditor();
    incoming.loaded = true;
    incoming.text = 'Second document only';
    // React mounts the incoming step first.
    registerDocxEditor('editor-b', incoming, {
      stepId: 'step-b',
      documentId: 'document-b',
      envelopeId: 'envelope-b'
    });
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    // The outgoing editor can finish resolving its envelope after the handoff
    // and re-run its registration effect before cleanup. That exact editor
    // identity is retired and cannot reclaim the active step.
    expect(
      registerDocxEditor('editor-a', outgoing, {
        stepId: 'step-a',
        documentId: 'document-a',
        envelopeId: 'envelope-a'
      })
    ).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    // Then the outgoing effect cleans up late.
    unregisterDocxEditor('editor-a', outgoing);

    expect(
      indexPosts().map(
        ([, init]) =>
          JSON.parse(init.body).targets.find(
            (target: any) => target.type === 'envelope'
          ).id
      )
    ).toEqual(['envelope-a', 'envelope-b']);
    expect(
      getDocumentIndexFreshness({
        type: 'envelope',
        id: 'envelope-a'
      }).indexDirty
    ).toBe(false);
    expect(
      getDocumentIndexFreshness({
        type: 'envelope',
        id: 'envelope-b'
      }).indexDirty
    ).toBe(false);

    // A stale event from the outgoing editor cannot be mislabeled as B.
    outgoing.text = 'stale outgoing edit';
    outgoing.emit('contentChange');
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    expect(indexPosts()).toHaveLength(2);
  });
});

// S3: staleness must be detectable, not silent. A stale index returning
// plausible-but-wrong anchors is strictly worse than an empty one - these
// tests pin the client half of that contract: the dirty mark is synchronous
// with the edit, the POST carries the document-level hash the server stores,
// and nothing ever reports "fresh" that the server has not confirmed.
describe('index freshness (S3 staleness detection)', () => {
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

  const loadedEditor = () => {
    const editor = fakeEditor();
    editor.loaded = true;
    return editor;
  };

  it('reports dirty until the first POST is confirmed, then fresh with the posted hash', async () => {
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);

    // Before the index lands, this client cannot vouch for whatever the
    // server holds (an earlier session, another submitter) - so: dirty.
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET)).toEqual({
      indexHash: null,
      indexDirty: true
    });

    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    const fresh = getDocumentIndexFreshness(ENVELOPE_TARGET);
    expect(fresh.indexDirty).toBe(false);
    expect(fresh.indexHash).toEqual(expect.any(String));
    // The freshness hash IS the hash the server stored with the index.
    const body = JSON.parse(indexPosts()[0][1].body);
    expect(body.contentHash).toBe(fresh.indexHash);
    expect(body.blockCount).toBe(body.blocks.length);
  });

  it('an edit marks the index stale IMMEDIATELY, before the re-index debounce', async () => {
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(false);

    editor.text = 'Total premium: $9,999';
    editor.emit('contentChange');
    // No timers advanced: the very next chat request must already see stale.
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(true);

    // The debounced re-index repairs it.
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    expect(indexPosts()).toHaveLength(2);
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(false);
    expect(JSON.parse(indexPosts()[1][1].body).contentHash).toBe(
      getDocumentIndexFreshness(ENVELOPE_TARGET).indexHash
    );
  });

  it('a burst of edits that nets out to no change clears dirty without a POST', async () => {
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    editor.emit('contentChange');
    editor.emit('contentChange');
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    // Content matches what the server already holds: fresh again, no re-POST.
    expect(indexPosts()).toHaveLength(1);
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(false);
  });

  it('keeps two submissions index and staleness state isolated', async () => {
    const firstEditor = loadedEditor();
    const first = renderHook(() =>
      useDocumentIndex({
        baseUrl: BASE_URL,
        getTargets: targets(DOC_ID, ENV_ID),
        headers
      })
    );
    registerDocxEditor(undefined, firstEditor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    unregisterDocxEditor(undefined, firstEditor);
    first.unmount();

    const secondEditor = loadedEditor();
    renderHook(() =>
      useDocumentIndex({
        baseUrl: BASE_URL,
        getTargets: targets(DOC_ID, OTHER_ENV_ID),
        headers
      })
    );
    registerDocxEditor(undefined, secondEditor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    expect(
      indexPosts().map(([, init]) => JSON.parse(init.body).envelopeId)
    ).toEqual([ENV_ID, OTHER_ENV_ID]);
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(false);
    const otherEnvelopeTarget = {
      type: 'envelope',
      id: OTHER_ENV_ID
    };
    expect(getDocumentIndexFreshness(otherEnvelopeTarget).indexDirty).toBe(
      false
    );

    secondEditor.emit('contentChange');
    expect(getDocumentIndexFreshness(otherEnvelopeTarget).indexDirty).toBe(
      true
    );
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(false);
  });

  it('a failed POST leaves the scope dirty - never fresh on hope', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(1);
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET)).toEqual({
      indexHash: null,
      indexDirty: true
    });
  });

  it('an incomplete index (failed embeds) warns loud and refuses to report fresh', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        indexed: 0,
        updated: 0,
        removed: 0,
        failed: 1,
        storedBlocks: 0
      })
    });
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(1);
    expect(getDocumentIndexFreshness(ENVELOPE_TARGET).indexDirty).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'document index for target envelope-456 is incomplete'
      )
    );
  });
});

// S3: the freshness signal is only worth anything if every chat request
// carries it. These exercise the REAL transport body AssistantChat builds -
// the exact bytes a request would send - not a helper in isolation.
describe('AssistantChat sends document_state (the staleness signal call site)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    delete (globalThis as any).__capturedTransportOpts;
  });
  afterEach(() => jest.useRealTimers());

  const transportBody = (): any => {
    const opts = (globalThis as any).__capturedTransportOpts;
    expect(opts).toBeDefined();
    return opts.body();
  };

  it('carries the live freshness answer, re-read on every request', async () => {
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

    // Before the index is confirmed: the request already says so.
    expect(transportBody().context.document_state).toEqual({
      indexHash: null,
      indexDirty: true
    });

    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(transportBody().context.document_state).toEqual({
      indexHash: expect.any(String),
      indexDirty: false
    });

    // An edit flips the very next request to stale - each tool round trip
    // rebuilds this body, so mid-turn staleness is visible mid-turn.
    editor.emit('contentChange');
    expect(transportBody().context.document_state).toMatchObject({
      indexDirty: true
    });
  });

  it('sends no document_state before the mounted editor has an envelope', () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={targets(DOC_ID, null)}
        getJwt={() => 'JWT'}
      />
    );
    expect(transportBody().context.document_state).toBeUndefined();
  });
});
