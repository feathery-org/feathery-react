import {
  Pack,
  clearPackRegistry,
  conformanceProblems,
  getPack,
  packProblems,
  registerPack,
  registeredFormats
} from './pack';
import { TOY_FORMAT, box, makeToyPack, para, toyNative } from './tests/toyPack';

const fixtures = {
  plain: toyNative(
    para('Hello', { bold: true }),
    para('World', { x: 'native-only' })
  ),
  boxes: toyNative(
    box([para('a'), para('b', { size: 14, align: 'center' })], {
      name: 'alpha'
    }),
    para('Items: 2', { formula: 'count(alpha)' })
  ),
  tracked: toyNative(para('gone', { rev: 'del' }), para('new', { rev: 'ins' })),
  empty: toyNative()
};

afterEach(() => clearPackRegistry());

describe('pack interface', () => {
  it('the fake pack is complete and passes the conformance suite', () => {
    expect(packProblems(makeToyPack())).toEqual([]);
    expect(conformanceProblems(makeToyPack(), fixtures)).toEqual([]);
  });

  it('names every missing or malformed slot', () => {
    const broken = makeToyPack({
      format: '',
      vocabulary: [],
      seams: { splice: {} as never }
    }) as Pack;
    delete (broken as Partial<Pack>).annotate;
    expect(packProblems(broken)).toEqual(
      expect.arrayContaining([
        'format',
        'vocabulary[]',
        'annotate',
        'seams.splice.apply'
      ])
    );
  });

  it('conformance catches a lossy adapter, repeated ids and dangling format references', () => {
    const base = makeToyPack();
    const lossy = makeToyPack({
      adapter: {
        toNormalForm: base.adapter.toNormalForm,
        fromNormalForm: (nf, residue) =>
          base.adapter.fromNormalForm(nf, residue).replace('Hello', 'Hullo')
      }
    });
    expect(conformanceProblems(lossy, fixtures)).toEqual([
      'plain: round trip is not byte-exact'
    ]);

    const repeated = makeToyPack({
      adapter: {
        toNormalForm: (native) => {
          const out = base.adapter.toNormalForm(native);
          const blocks = out.nf.root.blocks as Array<{
            id: string;
            style?: string;
          }>;
          if (blocks.length > 1) blocks[1].id = blocks[0].id;
          if (blocks.length) blocks[0].style = 'nope';
          return out;
        },
        fromNormalForm: base.adapter.fromNormalForm
      }
    });
    const problems = conformanceProblems(repeated, { plain: fixtures.plain });
    expect(problems.some((p) => p.includes('missing or repeated'))).toBe(true);
    expect(problems.some((p) => p.includes('unknown format nope'))).toBe(true);
  });

  it('registers by format, refuses an incomplete pack and a second pack under one name', () => {
    const pack = makeToyPack();
    registerPack(pack);
    registerPack(pack);
    expect(getPack(TOY_FORMAT)).toBe(pack);
    expect(registeredFormats()).toEqual([TOY_FORMAT]);
    expect(() => registerPack(makeToyPack())).toThrow(/already registered/);
    expect(() =>
      registerPack(
        makeToyPack({ format: 'other', outline: undefined as never })
      )
    ).toThrow(/incomplete: outline.detail, outline.defaultDepth/);
    expect(getPack('other')).toBeUndefined();
  });
});
