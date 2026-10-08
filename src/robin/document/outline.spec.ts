import { IdTable } from './ids';
import { renderOutline } from './outline';
import { makeView } from './view';
import { box, makeToyPack, para, toyNative } from './tests/toyPack';

const pack = makeToyPack();
const viewOf = (native: string, previous = new IdTable()) =>
  makeView(
    previous.adopt(
      pack.adapter.toNormalForm(native),
      pack.tree,
      pack.formatRefKeys
    ).nf,
    pack
  );

const doc = toyNative(
  para('Title', { bold: true }),
  box([para('one'), para('two')], { name: 'alpha' }),
  para('Items: 2', { formula: 'count(alpha)' })
);

describe('outline', () => {
  it('renders id and kind first, pack detail after, children indented under parents', () => {
    const r = renderOutline(viewOf(doc), pack);
    expect(r.lines.split('\n')).toEqual([
      'n1 para "Title"',
      'n2 box 2 items [name=alpha] usedBy[n5]',
      '  n3 para "one"',
      '  n4 para "two"',
      'n5 para "Items: 2" {formula=count(alpha)}'
    ]);
    expect(r.depth).toBe(2);
    expect(r.outlineHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('renders depth levels below the top level, cuts there and says how much is not shown', () => {
    const nested = makeView(
      {
        root: {
          id: 'root',
          kind: 'doc',
          blocks: [
            {
              id: 'n1',
              kind: 'box',
              items: [
                {
                  id: 'n2',
                  kind: 'box',
                  items: [{ id: 'n3', kind: 'para', text: 'deep', style: 'f1' }]
                }
              ]
            }
          ]
        },
        formats: { f1: {} }
      },
      pack
    );
    expect(renderOutline(nested, pack, 1).lines.split('\n')).toEqual([
      'n1 box 1 items',
      '  n2 box 1 items [+1 below]'
    ]);
    expect(renderOutline(nested, pack, 2).lines).toContain(
      '    n3 para "deep"'
    );
  });

  it('clamps depth to 1..6', () => {
    expect(renderOutline(viewOf(doc), pack, 0).depth).toBe(1);
    expect(renderOutline(viewOf(doc), pack, 99).depth).toBe(6);
  });

  it('the hash is stable while nothing shown changes, and moves when something does', () => {
    const a = renderOutline(viewOf(doc), pack);
    const b = renderOutline(viewOf(doc), pack);
    expect(b.outlineHash).toBe(a.outlineHash);
    const changed = renderOutline(viewOf(doc.replace('"two"', '"zwei"')), pack);
    expect(changed.outlineHash).not.toBe(a.outlineHash);
    // a native-only field the outline does not show leaves the hash alone
    const hidden = renderOutline(
      viewOf(
        doc.replace('"t":"p","text":"one"', '"t":"p","text":"one","x":"z"')
      ),
      pack
    );
    expect(hidden.outlineHash).toBe(a.outlineHash);
  });

  it('prints pack list labels and keeps every node line on one line', () => {
    const labelled = makeToyPack({
      outline: {
        ...pack.outline,
        listLabel: (node) => (node.kind === 'box' ? 'items' : null),
        detail: (node, view) =>
          `${pack.outline.detail(node, view)}\nsecond line`
      }
    });
    const lines = renderOutline(viewOf(doc), labelled).lines.split('\n');
    expect(lines.slice(1, 5)).toEqual([
      'n2 box 2 items [name=alpha] usedBy[n5] second line',
      '  items:',
      '    n3 para "one" second line',
      '    n4 para "two" second line'
    ]);
  });

  it('renders an empty document as no lines', () => {
    expect(renderOutline(viewOf(toyNative()), pack).lines).toBe('');
  });
});
