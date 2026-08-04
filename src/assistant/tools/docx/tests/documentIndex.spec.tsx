import { act, render, renderHook } from '@testing-library/react';
import {
  getDocumentTargetContentHash,
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
import AssistantChat from '../../../AssistantChat';

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
jest.mock('../../../MarkdownText', () => ({
  __esModule: true,
  default: () => null
}));
jest.mock('../../../voice/useAssistantVoice', () => ({
  useAssistantVoice: () => ({
    active: false,
    start: jest.fn(),
    stop: jest.fn(),
    speaking: false,
    listening: false
  })
}));
jest.mock('../../../../utils/init', () => ({
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
  const documentTarget = getActiveDocxEditorTarget('form-1');
  const envelopeTarget = getActiveDocxEditorEnvelopeTarget('form-1');
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
    expect(body.form_key).toBe('panel-1');
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

    // And the hash the chat will claim must vouch for THAT index - the full one.
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toBe(
      finalBody.contentHash
    );

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
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toBe(
      finalBody.contentHash
    );
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
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toBe(
      lastPost().contentHash
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
    registerDocxEditor(undefined, editor, { formId: 'form-1' });
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
    registerDocxEditor(undefined, editor, { formId: 'form-1' });
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

    expect(transportBody().targets).toEqual([
      { type: 'panel', id: 'panel-1' },
      { type: 'fuser', id: 'user-1' }
    ]);
    expect(transportBody().context).toBeUndefined();

    const editor = fakeEditor();
    editor.loaded = true;
    registerDocxEditor('editor-a', editor, {
      formId: 'form-1',
      stepId: 'edit-proposal',
      documentId: DOC_ID,
      envelopeId: ENV_ID
    });
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });

    expect(transportBody().targets).toEqual([
      { type: 'panel', id: 'panel-1' },
      { type: 'fuser', id: 'user-1' },
      DOCUMENT_TARGET,
      { ...ENVELOPE_TARGET, contentHash: expect.any(String) }
    ]);
    expect(JSON.parse(indexPosts()[0][1].body).targets).toEqual(
      mountedEditorTargets()
    );
  });

  it('compacts only the outbound history and leaves the current tool result exact', () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={targets(DOC_ID)}
        getJwt={() => 'JWT'}
      />
    );
    const transport = (globalThis as any).__capturedTransportOpts;
    const oldOutput = { inventory: [{ text: 'old inventory' }] };
    const recentOutput = { ok: true, occurrences: [{ blockText: 'recent' }] };
    const currentOutput = {
      results: [{ ok: true, echo: 'current exact output' }],
      changeSet: { status: 'applied', groups: [] }
    };
    const messages = [
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'one' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          {
            type: 'tool-getDocumentInventory',
            toolCallId: 'call-old',
            state: 'output-available',
            input: {},
            output: oldOutput
          }
        ]
      },
      { id: 'u2', role: 'user', parts: [{ type: 'text', text: 'two' }] },
      {
        id: 'a2',
        role: 'assistant',
        parts: [
          {
            type: 'tool-findDocumentOccurrences',
            toolCallId: 'call-recent',
            state: 'output-available',
            input: {},
            output: recentOutput
          }
        ]
      },
      { id: 'u3', role: 'user', parts: [{ type: 'text', text: 'three' }] },
      {
        id: 'a3',
        role: 'assistant',
        parts: [
          {
            type: 'tool-applyDocumentEdits',
            toolCallId: 'call-current',
            state: 'output-available',
            input: {},
            output: currentOutput
          }
        ]
      }
    ];

    const request = transport.prepareSendMessagesRequest({
      id: 'chat-id',
      messages,
      body: transport.body(),
      trigger: 'submit-message',
      messageId: 'a3'
    }).body;

    const part = (message: { parts: unknown[] }, index = 0) =>
      message.parts[index] as { output?: any; toolCallId?: string };
    expect(part(messages[1]).output).toBe(oldOutput);
    expect(part(request.messages[1]).output._digest).toContain(
      'digested client-side'
    );
    expect(part(request.messages[3]).output).toBe(recentOutput);
    expect(part(request.messages[5]).toolCallId).toBe('call-current');
    expect(part(request.messages[5]).output).toBe(currentOutput);
    expect(request.thread_id).toEqual(expect.any(String));
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
      formId: 'form-1',
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
      formId: 'form-1',
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
        formId: 'form-1',
        stepId: 'step-a',
        documentId: 'document-a',
        envelopeId: 'envelope-a'
      })
    ).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    // Then the outgoing effect cleans up late.
    unregisterDocxEditor('editor-a', outgoing, 'form-1');

    expect(
      indexPosts().map(
        ([, init]) =>
          JSON.parse(init.body).targets.find(
            (target: any) => target.type === 'envelope'
          ).id
      )
    ).toEqual(['envelope-a', 'envelope-b']);
    expect(
      getDocumentTargetContentHash({ type: 'envelope', id: 'envelope-a' })
    ).toEqual(expect.any(String));
    expect(
      getDocumentTargetContentHash({ type: 'envelope', id: 'envelope-b' })
    ).toEqual(expect.any(String));

    // A stale event from the outgoing editor cannot be mislabeled as B.
    outgoing.text = 'stale outgoing edit';
    outgoing.emit('contentChange');
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    expect(indexPosts()).toHaveLength(2);
  });
});

// The freshness contract, client half: the envelope target the chat sends
// carries the digest of the last snapshot this client computed, the index
// POST stores the same digest server-side, and the server compares the two on
// every index read - match fresh, mismatch stale.
describe('index freshness (target contentHash)', () => {
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

  it('claims the unmatchable sentinel before the first snapshot, then the posted hash', async () => {
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);

    // Nothing to vouch for yet, so the server refuses index reads rather than
    // answering from an index this client cannot match
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toBe(
      'pending:unindexed'
    );

    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    const hash = getDocumentTargetContentHash(ENVELOPE_TARGET);
    expect(hash).toEqual(expect.any(String));
    // The claimed hash IS the hash the server stored with the index.
    const body = JSON.parse(indexPosts()[0][1].body);
    expect(body.contentHash).toBe(hash);
    expect(body.blockCount).toBe(body.blocks.length);
  });

  it('an edit updates the hash on the debounced re-index, in step with the POST', async () => {
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    const initialHash = getDocumentTargetContentHash(ENVELOPE_TARGET);

    editor.text = 'Total premium: $9,999';
    editor.emit('contentChange');
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    expect(indexPosts()).toHaveLength(2);
    const updatedHash = getDocumentTargetContentHash(ENVELOPE_TARGET);
    expect(updatedHash).not.toBe(initialHash);
    expect(JSON.parse(indexPosts()[1][1].body).contentHash).toBe(updatedHash);
  });

  it('the claimed hash goes provisional the instant an edit fires, before the re-index lands', async () => {
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    const initialHash = getDocumentTargetContentHash(ENVELOPE_TARGET);

    editor.text = 'Total premium: $9,999';
    editor.emit('contentChange');
    // Mid-window the claim must not match the stored digest, so the server
    // refuses instead of answering from the pre-edit index
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toBe(
      `pending:${initialHash}`
    );

    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    const updatedHash = getDocumentTargetContentHash(ENVELOPE_TARGET);
    expect(updatedHash).not.toContain('pending:');
    expect(JSON.parse(indexPosts()[1][1].body).contentHash).toBe(updatedHash);
  });

  it('a burst of edits that nets out to no change keeps the hash without a POST', async () => {
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    const initialHash = getDocumentTargetContentHash(ENVELOPE_TARGET);

    editor.emit('contentChange');
    editor.emit('contentChange');
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    // Content matches what the server already holds: no re-POST, same hash.
    expect(indexPosts()).toHaveLength(1);
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toBe(initialHash);
  });

  it('keeps two submissions index state isolated', async () => {
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
    const otherEnvelopeTarget = {
      type: 'envelope',
      id: OTHER_ENV_ID
    };
    const firstHash = getDocumentTargetContentHash(ENVELOPE_TARGET);
    expect(firstHash).toEqual(expect.any(String));

    secondEditor.text = 'Edited second document';
    secondEditor.emit('contentChange');
    await act(async () => {
      jest.advanceTimersByTime(REINDEX_DEBOUNCE_MS);
    });
    expect(getDocumentTargetContentHash(otherEnvelopeTarget)).toBe(
      JSON.parse(indexPosts()[indexPosts().length - 1][1].body).contentHash
    );
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toBe(firstHash);
  });

  it('a failed POST still carries the client hash so the server compare fails loud', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const editor = loadedEditor();
    mount(DOC_ID);
    registerDocxEditor(undefined, editor);
    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    expect(indexPosts()).toHaveLength(1);
    // The server never stored this hash, so its compare refuses reads.
    expect(getDocumentTargetContentHash(ENVELOPE_TARGET)).toEqual(
      expect.any(String)
    );
  });

  it('an incomplete index (failed embeds) warns loud and re-posts on the next trigger', async () => {
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
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'document index for target envelope-456 is incomplete'
      )
    );
  });
});

// The freshness signal is only worth anything if every chat request carries
// it. These exercise the REAL transport body AssistantChat builds - the exact
// bytes a request would send - not a helper in isolation.
describe('AssistantChat sends the envelope target hash (the staleness signal call site)', () => {
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

  const envelopeTargetOf = (body: any) =>
    (body.targets ?? []).find((target: any) => target.type === 'envelope');

  it('carries the current hash on the envelope target, re-read on every request', async () => {
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
    registerDocxEditor(undefined, editor, { formId: 'form-1' });

    // Before the first snapshot the claim is unmatchable, so the server
    // refuses index reads instead of trusting an index this client cannot vouch for
    expect(envelopeTargetOf(transportBody()).contentHash).toBe(
      'pending:unindexed'
    );

    await act(async () => {
      jest.advanceTimersByTime(INDEX_POLL_MS);
    });
    const target = envelopeTargetOf(transportBody());
    expect(target.contentHash).toEqual(expect.any(String));
    expect(target.contentHash).toBe(
      JSON.parse(indexPosts()[0][1].body).contentHash
    );
  });

  it('sends no envelope target before the mounted editor has an envelope', () => {
    render(
      <AssistantChat
        instanceId='form-1'
        baseUrl={BASE_URL}
        getTargets={targets(DOC_ID, null)}
        getJwt={() => 'JWT'}
      />
    );
    expect(envelopeTargetOf(transportBody())).toBeUndefined();
  });
});
