import { openDeck } from './harness';

type Node = Record<string, any>;

const SLIDE = 'n7';

const writings: Record<string, (node: Node) => void> = {
  'as read': () => {},
  'without the slide id': (node) => delete node.id,
  'without shape ids': (node) => {
    for (const shape of node.shapes) {
      delete shape.id;
      for (const member of shape.shapes ?? []) delete member.id;
    }
  },
  'without any id': function strip(node) {
    delete node.id;
    for (const list of ['shapes', 'paragraphs', 'runs'])
      for (const child of node[list] ?? []) strip(child);
  },
  'without text ids': (node) => {
    for (const shape of node.shapes)
      for (const paragraph of shape.paragraphs ?? []) {
        delete paragraph.id;
        for (const run of paragraph.runs) delete run.id;
      }
  },
  'without the path': (node) => delete node.path
};

const edits: Record<string, (node: Node) => void> = {
  unchanged: () => {},
  'new text': (node) => {
    node.shapes[0].paragraphs[0].runs[0].text = 'Copied';
  },
  'a renamed shape': (node) => {
    node.shapes[0].name = 'Renamed';
  },
  'shapes reordered': (node) => {
    node.shapes = [node.shapes[1], node.shapes[0]];
  },
  'a shape left out': (node) => {
    node.shapes = [node.shapes[1]];
  },
  'a group member left out': (node) => {
    node.shapes[1].shapes = node.shapes[1].shapes.slice(1);
  }
};

const LANDS = new Set(['unchanged', 'new text', 'a shape left out']);
const KEEPS_IDS = new Set(['as read', 'without text ids', 'without the path']);

/** What a reader sees of a slide: everything but ids, hashes and the path the editor mints */
function content(node: Node): unknown {
  const own = Object.fromEntries(
    Object.entries(node).filter(
      ([key, value]) =>
        !['id', 'base', 'shape', 'pending', 'path'].includes(key) &&
        !Array.isArray(value)
    )
  );
  const children = ['shapes', 'paragraphs', 'runs'].flatMap((list) =>
    (node[list] ?? []).map(content)
  );
  return { own, children };
}

describe('PowerPoint slide copies', () => {
  for (const [writing, write] of Object.entries(writings))
    for (const [edit, change] of Object.entries(edits)) {
      const lands = KEEPS_IDS.has(writing) && LANDS.has(edit);
      it(`${
        lands ? 'lands' : 'refuses'
      } a copy written ${writing} with ${edit}`, () => {
        const deck = openDeck('template1-text-group.pptx');
        const node = JSON.parse(JSON.stringify(deck.read(SLIDE)));
        change(node);
        write(node);
        const result = deck.write({
          intent: 'Copy the slide.',
          scope: { ids: [SLIDE] },
          changes: [{ kind: 'insert_after', anchor: SLIDE, node }]
        });
        if (!lands) {
          expect(result).toEqual(
            expect.objectContaining({
              ok: false,
              refusal: expect.objectContaining({ invariant: 'limits' })
            })
          );
          return;
        }
        expect(result).toEqual(
          expect.objectContaining({ ok: true, committed: true })
        );
        const slides = (deck.call('outline', {}) as { lines: string }).lines
          .split('\n')
          .map((line) => line.trim().split(' ')[0]);
        const copy = slides[slides.indexOf(SLIDE) + 1];
        const expected = JSON.parse(JSON.stringify(deck.read(SLIDE)));
        change(expected);
        expect(content(deck.read(copy))).toEqual(content(expected));
      }, 20000);
    }

  it('keeps every slide id on its slide when copies go before and after the original in one write', () => {
    const deck = openDeck('template1-text-group.pptx');
    const titleOf = (id: string) =>
      (deck.read(id).shapes as Node[])[0].paragraphs[0].runs[0].text;
    const node = deck.read(SLIDE);
    const result = deck.write({
      intent: 'Copy the slide before the first slide and after itself.',
      scope: { ids: ['n1', SLIDE] },
      changes: [
        { kind: 'insert_before', anchor: 'n1', node },
        { kind: 'insert_after', anchor: SLIDE, node }
      ]
    }) as { ok: boolean; facts: Array<{ kind: string; ids: string[] }> };
    expect(result.ok).toBe(true);
    const inserted = result.facts
      .filter((fact) => fact.kind === 'inserted')
      .flatMap((fact) => fact.ids);
    const slides = (deck.call('outline', {}) as { lines: string }).lines
      .split('\n')
      .map((line) => line.trim().split(' ')[0]);
    expect(slides).toEqual([inserted[0], 'n1', SLIDE, inserted[1]]);
    expect(deck.read(SLIDE).pending).toBeUndefined();
    for (const id of inserted) {
      expect(deck.read(id).pending).toEqual(
        expect.objectContaining({ insertion: expect.anything() })
      );
      expect(titleOf(id)).toBe(titleOf(SLIDE));
    }
  });

  it('refuses copying a slide that still has a pending suggestion', () => {
    const deck = openDeck();
    const shape = deck.find('Q1')[0].within[0];
    deck.write(
      {
        intent: 'Remove the quarter label.',
        scope: { ids: [shape] },
        changes: [{ kind: 'delete', id: shape, base: deck.read(shape).base }]
      },
      'turn-1'
    );
    const slide = deck.read('n1', 'turn-2');
    expect(
      deck.write(
        {
          intent: 'Copy the title slide.',
          scope: { ids: ['n1'] },
          changes: [{ kind: 'insert_after', anchor: 'n1', node: slide }]
        },
        'turn-2'
      )
    ).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'limits' })
      })
    );
  });

  it('refuses a slide number in a new text box', () => {
    const deck = openDeck();
    const slide = 'n1';
    const last = (deck.read(slide).shapes as Node[]).slice(-1)[0].id;
    expect(
      deck.write({
        intent: 'Add a numbered note.',
        scope: { ids: [slide] },
        changes: [
          {
            kind: 'insert_after',
            anchor: last,
            node: {
              kind: 'shape',
              frame: { x: 0, y: 0, cx: 914400, cy: 457200 },
              paragraphs: [
                {
                  runs: [
                    { text: 'Page ' },
                    { kind: 'field', text: '1', field: 'slidenum' }
                  ]
                }
              ]
            }
          }
        ]
      })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'limits' })
      })
    );
  });
});
