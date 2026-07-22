import { act, renderHook } from '@testing-library/react';
import {
  documentIndexHeaders,
  INDEX_RETRY_MS,
  postDocxDocumentIndex,
  useDocxDocumentIndex
} from '../documentIndex';

jest.mock('../../../utils/init', () => ({
  initInfo: () => ({ sdkKey: 'SDK-KEY' })
}));
jest.mock('../../../utils/browser', () => ({
  getCookie: () => 'SESSION-JWT'
}));

const BLOCKS = [{ anchor: 's0:b0', kind: 'paragraph', text: 'hi' }];

describe('documentIndexHeaders', () => {
  it('uses a Bearer JWT when getJwt is supplied', () => {
    expect(documentIndexHeaders(() => 'JWT-123')).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer JWT-123'
    });
  });

  it('falls back to the SDK key + session cookie', () => {
    expect(documentIndexHeaders()).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Token SDK-KEY',
      'X-Feathery-Session': 'SESSION-JWT'
    });
  });
});

describe('postDocxDocumentIndex', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;
  });
  afterEach(() => {
    delete (global as any).fetch;
  });

  it('POSTs to <baseUrl>document-index keyed by the generated_document id', async () => {
    const ok = await postDocxDocumentIndex({
      baseUrl: 'https://api.test/agent/assistant/',
      generatedDocumentId: 'servar-123',
      blocks: BLOCKS,
      getJwt: () => 'JWT-123'
    });
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/agent/assistant/document-index');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    // Scope key = the generated_document id, in both fields so a6's index +
    // searchGeneratedDocument resolve to the same key.
    expect(body.envelopeId).toBe('servar-123');
    expect(body.documentId).toBe('servar-123');
    expect(body.blocks).toEqual(BLOCKS);
  });

  it('does not POST when the scope key or blocks are missing', async () => {
    expect(
      await postDocxDocumentIndex({
        baseUrl: 'https://api.test/agent/assistant/',
        generatedDocumentId: '',
        blocks: BLOCKS
      })
    ).toBe(false);
    expect(
      await postDocxDocumentIndex({
        baseUrl: 'https://api.test/agent/assistant/',
        generatedDocumentId: 'servar-123',
        blocks: []
      })
    ).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws when the endpoint returns a non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(
      postDocxDocumentIndex({
        baseUrl: 'https://api.test/agent/assistant/',
        generatedDocumentId: 'servar-123',
        blocks: BLOCKS
      })
    ).rejects.toThrow(/document-index failed \(500\)/);
  });
});

// A single populated block so buildDocxIndexBlocks yields content.
const LOADED_SFDT = {
  sections: [{ blocks: [{ inlines: [{ text: 'Premium: $2,691' }] }] }]
};
const BLANK_SFDT = { sections: [{ blocks: [] }] };

describe('useDocxDocumentIndex - fires once the doc actually loads (rf1 gap)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
  });
  afterEach(() => {
    jest.useRealTimers();
    delete (global as any).fetch;
  });

  it('does not POST the blank editor, and DOES POST after the source loads', async () => {
    // onReady fires first for the blank editor (its source loads async), so at
    // ready-time serialize() is empty; it becomes populated a moment later.
    let loaded = false;
    const editor = {
      serialize: () => JSON.stringify(loaded ? LOADED_SFDT : BLANK_SFDT)
    };

    renderHook(() =>
      useDocxDocumentIndex({
        editor,
        ready: true, // onReady already fired (for the blank doc)
        enabled: true,
        baseUrl: 'https://api.test/agent/assistant/',
        generatedDocumentId: 'servar-123',
        getJwt: () => 'JWT'
      })
    );

    // Blank doc -> no POST yet; the hook is retrying.
    expect((global as any).fetch).not.toHaveBeenCalled();

    // The real document finishes loading, then a retry tick fires.
    loaded = true;
    await act(async () => {
      jest.advanceTimersByTime(INDEX_RETRY_MS);
    });

    const fetchMock = (global as any).fetch as jest.Mock;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/agent/assistant/document-index');
    expect(init.headers.Authorization).toBe('Bearer JWT');
    const body = JSON.parse(init.body);
    expect(body.envelopeId).toBe('servar-123');
    expect(body.blocks).toHaveLength(1);
  });

  it('never POSTs while Assist is disabled', async () => {
    const editor = { serialize: () => JSON.stringify(LOADED_SFDT) };
    renderHook(() =>
      useDocxDocumentIndex({
        editor,
        ready: true,
        enabled: false,
        baseUrl: 'https://api.test/agent/assistant/',
        generatedDocumentId: 'servar-123'
      })
    );
    await act(async () => {
      jest.advanceTimersByTime(INDEX_RETRY_MS * 3);
    });
    expect((global as any).fetch).not.toHaveBeenCalled();
  });
});
