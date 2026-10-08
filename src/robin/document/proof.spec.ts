import { comparable, differences, prove, rollback } from './proof';
import { NfNode, NormalForm } from './tree';
import { ToyHost, makeToyPack, para, toyNative } from './tests/toyPack';

const pack = makeToyPack();
const nf = (native: string) => pack.adapter.toNormalForm(native).nf;
const nothingElse = { turnId: 't', intendedResidue: {}, liveResidue: {} };

describe('proof', () => {
  const before = nf(toyNative(para('a'), para('b')));
  const intended: NormalForm = JSON.parse(JSON.stringify(before));
  (intended.root.blocks as NfNode[])[1].text = 'B';

  it('passes a tracked change that landed exactly and rejects back to before (true negative)', () => {
    const live = nf(
      toyNative(
        para('a'),
        para('b', { rev: 'del', by: 't' }),
        para('B', { rev: 'ins', by: 't' })
      )
    );
    expect(prove(pack, { before, intended, live, ...nothingElse })).toEqual({
      passed: true,
      landed: true,
      reversible: true,
      conserved: true,
      authorship: true,
      normalizations: [],
      landedDiff: [],
      reversibleDiff: [],
      conservedDiff: [],
      authorshipDiff: []
    });
  });

  it('fails when the change landed beside the target (true positive for landed)', () => {
    const live = nf(
      toyNative(para('a'), para('b'), para('B', { rev: 'ins', by: 't' }))
    );
    const p = prove(pack, { before, intended, live, ...nothingElse });
    expect([p.passed, p.landed, p.reversible]).toEqual([false, false, true]);
    expect(p.landedDiff[0]).toContain('3 items, expected 2');
  });

  it('fails when rejecting would not restore the document (true positive for reversible)', () => {
    const live = nf(toyNative(para('a'), para('B')));
    const p = prove(pack, { before, intended, live, ...nothingElse });
    expect([p.passed, p.landed, p.reversible]).toEqual([false, true, false]);
    expect(p.reversibleDiff).toEqual([
      '/blocks/1/text: "B" where "b" was intended'
    ]);
  });

  it('admits only the enumerated normalizations and reports the ones it needed', () => {
    const spaced: NormalForm = JSON.parse(JSON.stringify(intended));
    (spaced.root.blocks as NfNode[])[1].text = 'B  ';
    const live = nf(
      toyNative(
        para('a'),
        para('b', { rev: 'del', by: 't' }),
        para('B', { rev: 'ins', by: 't' })
      )
    );
    const p = prove(pack, { before, intended: spaced, live, ...nothingElse });
    expect([p.passed, p.normalizations]).toEqual([true, ['T1']]);
    const strict = makeToyPack({
      projections: { ...pack.projections, normalizations: [] }
    });
    expect(
      prove(strict, { before, intended: spaced, live, ...nothingElse }).passed
    ).toBe(false);
  });

  it('fails when native data the normal form does not show was lost (true positive for conserved)', () => {
    const live = nf(
      toyNative(
        para('a'),
        para('b', { rev: 'del', by: 't' }),
        para('B', { rev: 'ins', by: 't' })
      )
    );
    const ok = prove(pack, {
      before,
      intended,
      live,
      turnId: 't',
      intendedResidue: { t0: { x: 'k' } },
      liveResidue: { t0: { x: 'k' } }
    });
    expect(ok.conserved).toBe(true);
    const lost = prove(pack, {
      before,
      intended,
      live,
      turnId: 't',
      intendedResidue: { t0: { x: 'k' } },
      liveResidue: {}
    });
    expect([lost.passed, lost.conserved, lost.conservedDiff.length]).toEqual([
      false,
      false,
      1
    ]);
  });

  it('fails when a pending change not authored by this turn was re-authored or left ungrouped (true positive for authorship)', () => {
    const userBefore = nf(
      toyNative(para('a', { rev: 'ins', by: 'user' }), para('b'))
    );
    const userIntended: NormalForm = JSON.parse(JSON.stringify(userBefore));
    (userIntended.root.blocks as NfNode[])[1].text = 'B';
    const live = (a: Record<string, string>, b: Record<string, string>) =>
      nf(
        toyNative(
          para('a', { rev: 'ins', ...a }),
          para('b', { rev: 'del', ...b }),
          para('B', { rev: 'ins', ...b })
        )
      );
    const run = (l: NormalForm) =>
      prove(pack, {
        before: userBefore,
        intended: userIntended,
        live: l,
        ...nothingElse
      });
    expect(run(live({ by: 'user' }, { by: 't' })).authorship).toBe(true);
    const reauthored = run(live({ by: 't' }, { by: 't' }));
    expect([reauthored.passed, reauthored.authorship]).toEqual([false, false]);
    expect(reauthored.authorshipDiff[0]).toContain('lost or re-authored');
    const ungrouped = run(live({ by: 'user' }, {}));
    expect(ungrouped.authorshipDiff).toEqual(
      expect.arrayContaining([
        expect.stringContaining('not grouped under this change')
      ])
    );
  });

  it('compares format references by the entry they name, not by key', () => {
    const a = nf(toyNative(para('x', { bold: true })));
    const b: NormalForm = JSON.parse(JSON.stringify(a));
    b.formats = { other: b.formats.s0 };
    (b.root.blocks as NfNode[])[0].style = 'other';
    (b.root.blocks as NfNode[])[0].id = 'zz';
    expect(comparable(pack, a)).toEqual(comparable(pack, b));
  });

  it('lists differing paths, capped', () => {
    expect(differences({ a: [1, 2], b: 'x' }, { a: [1, 3], b: 'y' })).toEqual([
      '/a/1: 2 where 3 was intended',
      '/b: "x" where "y" was intended'
    ]);
    expect(differences({ a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('rollback', () => {
  const A = toyNative(para('a'));

  it('does nothing when the bytes are already equal', () => {
    expect(rollback(new ToyHost(A), A, { undoLimit: 1 })).toEqual({
      byteEqual: true,
      equivalent: true,
      via: 'nothing',
      undoSteps: 0
    });
  });

  it('undoes a native group back to the exact bytes', () => {
    const host = new ToyHost(A);
    host.seamEdit('text', (d) => d.body.push(para('x')));
    expect(rollback(host, A, { undoLimit: 1 })).toEqual({
      byteEqual: true,
      equivalent: true,
      via: 'editor-undo',
      undoSteps: 1
    });
    expect(host.serialize()).toBe(A);
  });

  it('reopens the snapshot when undo cannot get back', () => {
    const host = new ToyHost(A);
    host.open(toyNative(para('replaced')));
    expect(rollback(host, A, { undoLimit: 1 })).toEqual({
      byteEqual: true,
      equivalent: true,
      via: 'snapshot',
      undoSteps: 0
    });
    expect(host.serialize()).toBe(A);
  });
});
