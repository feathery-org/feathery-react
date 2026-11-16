import { openDeck, type WriteResult } from './harness';

type Deck = ReturnType<typeof openDeck>;
type Node = Record<string, any>;

const copyOf = (value: unknown) => JSON.parse(JSON.stringify(value));

const replace = (deck: Deck, id: string, edit: (node: Node) => void) => {
  const node = copyOf(deck.read(id));
  edit(node);
  return deck.write({
    intent: 'Edit.',
    scope: { ids: [id] },
    changes: [{ kind: 'replace', id, base: node.base, node }]
  });
};

const remove = (deck: Deck, id: string) =>
  deck.write({
    intent: 'Remove.',
    scope: { ids: [id] },
    changes: [{ kind: 'delete', id, base: deck.read(id).base }]
  });

const insertAfter = (deck: Deck, anchor: string, scope: string, node: Node) =>
  deck.write({
    intent: 'Add.',
    scope: { ids: [scope] },
    changes: [{ kind: 'insert_after', anchor, node }]
  });

const slides = (deck: Deck) =>
  (deck.call('outline', {}) as { lines: string }).lines
    .split('\n')
    .map((line) => line.trim().split(' ')[0]);

const subtitleRun = (deck: Deck) =>
  (deck.read(deck.find('Company Name')[0].id).runs as Node[])[0].id as string;
const footer = (deck: Deck) => deck.find('‹#›')[0].id;
const lastShape = (deck: Deck, slide: string) =>
  (deck.read(slide).shapes as Node[]).slice(-1)[0].id as string;
const tableOf = (deck: Deck) =>
  (deck.call('outline', { depth: 6 }) as { lines: string }).lines
    .split('\n')
    .find((line) => / table /.test(line))
    ?.trim()
    .split(' ')[0] as string;

const lineOf = (deck: Deck) =>
  (deck.call('outline', { depth: 3 }) as { lines: string }).lines
    .split('\n')
    .find((line) => / connector /.test(line))
    ?.trim()
    .split(' ')[0] as string;

const box = (
  extra: Node = {},
  paragraphs: unknown[] = [{ runs: [{ text: 'Note' }] }]
) => ({
  kind: 'shape',
  frame: { x: 0, y: 0, cx: 914400, cy: 457200 },
  paragraphs,
  ...extra
});
const addBox = (deck: Deck, node: Node) =>
  insertAfter(deck, lastShape(deck, 'n1'), 'n1', node);

const cases: Array<[string, boolean, string, (deck: Deck) => WriteResult]> = [
  [
    'new text',
    true,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.text = 'Acme';
      })
  ],
  [
    'a bold line holding a slide number',
    true,
    'marketing-parity.pptx',
    (d) =>
      d.write({
        intent: 'Bold.',
        scope: { ids: [footer(d)] },
        changes: [
          {
            kind: 'set',
            target: {
              ids: [footer(d)],
              shape: { [footer(d)]: d.read(footer(d)).shape }
            },
            props: { bold: true }
          }
        ]
      })
  ],
  [
    'text after a slide number',
    true,
    'marketing-parity.pptx',
    (d) =>
      replace(d, footer(d), (n) => {
        n.runs.push({ text: ' Confidential' });
      })
  ],
  [
    'a bold slide number',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, footer(d), (n) => {
        n.runs.find((r: Node) => r.kind === 'field').bold = true;
      })
  ],
  [
    'size 0',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.size = 0;
      })
  ],
  [
    'a size past hundredths',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.size = 10.555;
      })
  ],
  [
    'a lowercase colour',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.color = '#ff00aa';
      })
  ],
  [
    'an unknown run key',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.shadow = true;
      })
  ],
  [
    'a control character',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.text = 'a\u000bb';
      })
  ],
  [
    'a break without its text',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, d.find('Company Name')[0].id, (n) => {
        n.runs.push({ kind: 'break' }, { text: 'x' });
      })
  ],
  [
    'text in a shape that has none',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, 'n17', (n) => {
        n.paragraphs = [{ runs: [{ text: 'Added' }] }];
      })
  ],
  [
    'a shape written without its paragraphs',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, d.find('Company Name')[0].within[0], (n) => {
        delete n.paragraphs;
      })
  ],
  [
    'a newline inside a run',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.text = 'Acme\nCorp';
      })
  ],
  [
    'run text that is not a string',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.text = 42;
      })
  ],
  [
    'a cleared alignment',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, d.find('Company Name')[0].id, (n) => {
        delete n.align;
      })
  ],
  ['a new text box', true, 'marketing-parity.pptx', (d) => addBox(d, box())],
  [
    'a new text box with a placeholder',
    false,
    'marketing-parity.pptx',
    (d) => addBox(d, box({ placeholder: 'title' }))
  ],
  [
    'a new text box with a name',
    false,
    'marketing-parity.pptx',
    (d) => addBox(d, box({ name: 'Note' }))
  ],
  [
    'a new text box with a slide number',
    false,
    'marketing-parity.pptx',
    (d) =>
      addBox(
        d,
        box({}, [{ runs: [{ kind: 'field', text: '1', field: 'slidenum' }] }])
      )
  ],
  [
    'a new text box without paragraphs',
    false,
    'marketing-parity.pptx',
    (d) => addBox(d, box({}, []))
  ],
  [
    'a new text box past the deck',
    false,
    'marketing-parity.pptx',
    (d) => addBox(d, box({ frame: { x: 1e300, y: 0, cx: 100, cy: 100 } }))
  ],
  [
    'a moved shape',
    true,
    'marketing-parity.pptx',
    (d) =>
      replace(d, lastShape(d, 'n1'), (n) => {
        n.frame = { ...n.frame, x: n.frame.x + 9525 };
      })
  ],
  [
    'a removed shape',
    true,
    'marketing-parity.pptx',
    (d) => remove(d, lastShape(d, 'n1'))
  ],
  [
    'a renamed shape',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, lastShape(d, 'n1'), (n) => {
        n.name = 'Renamed';
      })
  ],
  [
    'shapes reordered',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, 'n1', (n) => {
        n.shapes = [n.shapes[1], n.shapes[0], ...n.shapes.slice(2)];
      })
  ],
  [
    'an edit of a suggested removal',
    false,
    'marketing-parity.pptx',
    (d) => {
      const shape = d.find('Q1')[0].within[0];
      remove(d, shape);
      return replace(d, shape, (n) => {
        n.paragraphs[0].runs[0].text = 'Q2';
      });
    }
  ],
  [
    'a slide copied before itself',
    true,
    'template1-text-group.pptx',
    (d) =>
      d.write({
        intent: 'Copy.',
        scope: { ids: ['n7'] },
        changes: [{ kind: 'insert_before', anchor: 'n7', node: d.read('n7') }]
      })
  ],
  [
    'a group member moved',
    false,
    'template1-text-group.pptx',
    (d) =>
      replace(d, 'n11', (n) => {
        const m = n.shapes[2];
        m.frame = { ...m.frame, x: m.frame.x + 9525 };
      })
  ],
  [
    'a run moved to another shape',
    false,
    'marketing-parity.pptx',
    (d) => {
      const [target, from] = (d.read('n1').shapes as Node[]).filter(
        (s) => s.paragraphs?.[0]?.runs?.length
      );
      return replace(d, 'n1', (n) => {
        const into = n.shapes.find((s: Node) => s.id === target.id);
        into.paragraphs[0].runs.push(copyOf(from.paragraphs[0].runs[0]));
        n.shapes
          .find((s: Node) => s.id === from.id)
          .paragraphs[0].runs.splice(0, 1);
      });
    }
  ],
  [
    'a moved table',
    true,
    'sample.pptx',
    (d) =>
      replace(d, tableOf(d), (n) => {
        n.frame = { ...n.frame, y: n.frame.y + 9525 };
      })
  ],
  ['a removed table', true, 'sample.pptx', (d) => remove(d, tableOf(d))],
  [
    'a resized table',
    false,
    'sample.pptx',
    (d) =>
      replace(d, tableOf(d), (n) => {
        n.frame = { ...n.frame, cx: n.frame.cx + 9525 };
      })
  ],
  [
    'a moved line',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, lineOf(d), (n) => {
        n.frame = { ...n.frame, x: n.frame.x + 9525 };
      })
  ],
  [
    'a frame with an extra key',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, lastShape(d, 'n1'), (n) => {
        n.frame = { ...n.frame, rot: 90 };
      })
  ],
  [
    'a font with a control character',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, subtitleRun(d), (n) => {
        n.font = 'Ari\u0001al';
      })
  ],
  [
    'run formatting on a paragraph',
    false,
    'marketing-parity.pptx',
    (d) =>
      replace(d, d.find('Company Name')[0].id, (n) => {
        n.color = '#FF0000';
      })
  ],
  [
    'a copied slide with its own property changed',
    false,
    'template1-text-group.pptx',
    (d) =>
      d.write({
        intent: 'Copy.',
        scope: { ids: ['n7'] },
        changes: [
          {
            kind: 'insert_after',
            anchor: 'n7',
            node: { ...copyOf(d.read('n7')), hidden: true }
          }
        ]
      })
  ],
  [
    'a removed table row',
    false,
    'sample.pptx',
    (d) => remove(d, (d.read(tableOf(d)).rows as Node[])[0].id)
  ],
  [
    'an edited table cell',
    false,
    'sample.pptx',
    (d) =>
      replace(d, tableOf(d), (n) => {
        n.rows[0].cells[0].paragraphs[0].runs = [{ text: 'changed' }];
      })
  ],
  [
    'a slide written from scratch',
    false,
    'marketing-parity.pptx',
    (d) =>
      insertAfter(d, slides(d)[0], slides(d)[0], { kind: 'slide', shapes: [] })
  ]
];

describe('PowerPoint writes land as written or are refused by limits', () => {
  for (const [name, lands, file, write] of cases)
    it(`${lands ? 'lands' : 'refuses'} ${name}`, () => {
      const result = write(openDeck(file));
      if (lands)
        expect(result).toEqual(
          expect.objectContaining({ ok: true, committed: true, landed: 'card' })
        );
      else
        expect(result).toEqual(
          expect.objectContaining({
            ok: false,
            refusal: expect.objectContaining({ invariant: 'limits' })
          })
        );
    }, 20000);
});

describe('PowerPoint frames land as written or are refused by limits, on every kind of shape', () => {
  for (const file of [
    'marketing-parity.pptx',
    'sample.pptx',
    'template1-text-group.pptx'
  ])
    for (const [edit, change] of [
      ['moved', (f: Node) => ({ ...f, x: f.x + 9525 })],
      ['resized', (f: Node) => ({ ...f, cx: f.cx + 9525 })]
    ] as const)
      it(`${edit} in ${file}`, () => {
        const firsts = new Map<string, string>();
        for (const slide of slides(openDeck(file)).slice(0, 12)) {
          const deck = openDeck(file);
          for (const shape of deck.read(slide).shapes as Node[])
            if (shape.frame && !firsts.has(shape.kind))
              firsts.set(shape.kind, shape.id);
        }
        for (const [kind, id] of firsts) {
          const result = replace(openDeck(file), id, (n) => {
            n.frame = change(n.frame);
          });
          const outcome = result.ok
            ? 'landed'
            : (result as any).refusal?.invariant;
          expect([kind, outcome]).toEqual([
            kind,
            expect.stringMatching(/^(landed|limits)$/)
          ]);
        }
      }, 120000);
});
