import { EngineHistory } from './history';
import { equivalentNative } from './proof';
import { ToyHost, makeToyPack, para, toyNative } from './tests/toyPack';

const A = toyNative(para('a'));
const B = toyNative(para('b'));
const C = toyNative(para('c'));

describe('undo routing (D4)', () => {
  it('goes to the editor while it has an entry, then to the engine', () => {
    const host = new ToyHost(A);
    const history = new EngineHistory();
    host.open(B); // a structural change set replaced the document
    history.push({ turnId: 't1', kind: 'change-set', before: A, after: B });
    host.userEdit((d) => d.body.push(para('typed')));
    expect(history.undo(host)).toEqual({ via: 'editor' });
    expect(host.serialize()).toBe(B);
    expect(history.undo(host)).toEqual({
      via: 'engine',
      entry: expect.objectContaining({ turnId: 't1' })
    });
    expect(host.serialize()).toBe(A);
    expect(history.undo(host)).toEqual({ via: 'none' });
  });

  it('redoes through the engine after an engine undo, and the editor first when it can', () => {
    const host = new ToyHost(A);
    const history = new EngineHistory();
    host.open(B);
    history.push({ turnId: 't1', kind: 'change-set', before: A, after: B });
    history.undo(host);
    expect(history.canRedo(host)).toBe(true);
    expect(history.redo(host)).toEqual({
      via: 'engine',
      entry: expect.objectContaining({ turnId: 't1' })
    });
    expect(host.serialize()).toBe(B);
    host.userEdit((d) => d.body.push(para('x')));
    host.undo();
    expect(history.redo(host)).toEqual({ via: 'editor' });
  });

  it('drops a stale entry instead of discarding work the editor cannot undo', () => {
    const host = new ToyHost(A);
    const history = new EngineHistory();
    host.open(B);
    history.push({ turnId: 't1', kind: 'change-set', before: A, after: B });
    host.open(C); // the document changed with no editor history (another replacement)
    const out = history.undo(host);
    expect(out).toEqual({
      via: 'none',
      stale: expect.objectContaining({ turnId: 't1' })
    });
    expect(host.serialize()).toBe(C);
    expect(history.depth).toEqual({ undo: 0, redo: 0 });
  });

  it('keeps at most the limit, and a new entry clears redo', () => {
    const host = new ToyHost(A);
    const history = new EngineHistory(2);
    for (const t of ['t1', 't2', 't3'])
      history.push({ turnId: t, kind: 'change-set', before: A, after: A });
    expect(history.depth).toEqual({ undo: 2, redo: 0 });
    history.undo(host);
    expect(history.depth).toEqual({ undo: 1, redo: 1 });
    history.push({ turnId: 't4', kind: 'resolution', before: A, after: A });
    expect(history.depth).toEqual({ undo: 2, redo: 0 });
  });

  it('applies an engine entry to a document equivalent to the one it left, not only a byte-equal one', () => {
    const pack = makeToyPack();
    const host = new ToyHost(A);
    const history = new EngineHistory(10, (x, y) =>
      equivalentNative(pack, x, y)
    );
    host.open(B);
    history.push({ turnId: 't1', kind: 'change-set', before: A, after: B });
    // a user edit and its native undo leave the document equivalent under T1 but not byte-exact
    host.native = toyNative(para('b '));
    expect(history.undo(host)).toEqual(
      expect.objectContaining({ via: 'engine' })
    );
    expect(host.serialize()).toBe(A);
  });

  it('drops only the stale entry, not the whole stack', () => {
    const host = new ToyHost(A);
    const history = new EngineHistory();
    history.push({ turnId: 't1', kind: 'change-set', before: A, after: B });
    history.push({ turnId: 't2', kind: 'change-set', before: B, after: C });
    host.open(toyNative(para('elsewhere')));
    expect(history.undo(host)).toEqual({
      via: 'none',
      stale: expect.objectContaining({ turnId: 't2' })
    });
    expect(history.depth).toEqual({ undo: 1, redo: 0 });
  });
});
