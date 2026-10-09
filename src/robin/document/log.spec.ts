/**
 * The engine's console diagnostics: a write that does not commit warns, a handler exception is an
 * error, a commit is a debug line; all tagged, all off when logging is off.
 */
import { LOG_TAG, loggingByDefault, setDocumentLogging } from './log';
import { DocumentSession } from './session';
import { NfNode } from './tree';
import { ToyHost, box, makeToyPack, para, toyNative } from './tests/toyPack';

const doc = toyNative(
  para('Insurance proposal'),
  box([para('Motor'), para('Property')], { name: 'lines' })
);
const target = { type: 'envelope', id: 'env_1' };

function mount() {
  const host = new ToyHost(doc);
  const pack = makeToyPack();
  const session = new DocumentSession({ pack, host, target, editorId: 'ed-1' });
  const call = (verb: string, input: unknown, turnId = 't1') =>
    session.dispatch({
      protocolVersion: 1,
      turnId,
      editorId: 'ed-1',
      target,
      verb,
      input
    });
  const node = (id: string) => {
    const out = call('read', { ids: [id] }, 'read');
    if (out.status !== 'ok') throw new Error('read failed');
    return (
      out.response.result as unknown as {
        nodes: Array<NfNode & { base: string; shape: string }>;
      }
    ).nodes[0];
  };
  return { host, pack, session, call, node };
}

describe('console diagnostics', () => {
  let warn: jest.SpyInstance;
  let error: jest.SpyInstance;
  let debug: jest.SpyInstance;
  beforeEach(() => {
    setDocumentLogging(true);
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
    debug = jest.spyOn(console, 'debug').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    setDocumentLogging(false);
  });

  it('is on in development builds and off in production and test builds', () => {
    expect(loggingByDefault('development')).toBe(true);
    expect(loggingByDefault('production')).toBe(false);
    expect(loggingByDefault('test')).toBe(false);
    expect(loggingByDefault(undefined)).toBe(false);
  });

  it('a commit is one debug line: turn, landed, card, warnings, time', () => {
    const { call, node } = mount();
    const n3 = node('n3');
    call('write', {
      intent: 'Rename.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: n3.base,
          node: { text: 'Motor fleet', style: n3.style }
        }
      ]
    });
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(
      LOG_TAG,
      expect.objectContaining({
        turnId: 't1',
        verb: 'write',
        landed: 'card',
        cardId: 't1',
        warnings: expect.any(Array),
        ms: expect.any(Number)
      })
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('a refusal warns with its code, invariant and cards', () => {
    const { call } = mount();
    call('write', {
      intent: 'Rename.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: '0000000000000000',
          node: { text: 'x' }
        }
      ]
    });
    expect(warn).toHaveBeenCalledTimes(1);
    const [tag, payload] = warn.mock.calls[0];
    expect(tag).toBe(LOG_TAG);
    expect(payload).toEqual(
      expect.objectContaining({
        turnId: 't1',
        verb: 'write',
        code: expect.any(String)
      })
    );
    expect(payload.invariant ?? payload.code).toBeTruthy();
    expect(debug).not.toHaveBeenCalled();
  });

  it('a failed proof warns with the proof outcome and how the rollback went, detail truncated', () => {
    const { host, call, node } = mount();
    const n2 = node('n2');
    host.corruptNextSeam = true;
    call('write', {
      intent: 'Add a line.',
      scope: { ids: [] },
      changes: [
        {
          kind: 'insert_after',
          anchor: 'n4',
          container: n2.shape,
          node: { text: 'Cyber' }
        }
      ]
    });
    expect(warn).toHaveBeenCalledWith(
      LOG_TAG,
      expect.objectContaining({
        invariant: 'proof-failed',
        proofOutcome: 'failed',
        rollback: { byteEqual: true, equivalent: true },
        detail: expect.any(String)
      })
    );
    expect((warn.mock.calls[0][1].detail as string).length).toBeLessThanOrEqual(
      303
    );
  });

  it('a handler exception is an error with its message and stack', () => {
    const { pack, call } = mount();
    pack.text = () => {
      throw new Error('broken pack');
    };
    call('find', { text: 'x' });
    expect(error).toHaveBeenCalledWith(
      LOG_TAG,
      expect.objectContaining({
        turnId: 't1',
        verb: 'find',
        message: 'broken pack',
        stack: expect.stringContaining('broken pack')
      })
    );
  });

  it('logs nothing when logging is off (production builds)', () => {
    setDocumentLogging(false);
    const { call } = mount();
    call('write', {
      intent: 'Rename.',
      scope: { ids: ['n3'] },
      changes: [
        {
          kind: 'replace',
          id: 'n3',
          base: '0000000000000000',
          node: { text: 'x' }
        }
      ]
    });
    expect(warn).not.toHaveBeenCalled();
    setDocumentLogging(true);
  });
});
