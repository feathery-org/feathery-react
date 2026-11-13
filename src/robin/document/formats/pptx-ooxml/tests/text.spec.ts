import { serializeDeck } from '../native';
import { openDeck, type WriteResult } from './harness';

function expectCard(result: WriteResult) {
  expect(result).toEqual(
    expect.objectContaining({ ok: true, committed: true, landed: 'card' })
  );
  expect(result.trace.proof).toEqual(
    expect.objectContaining({ outcome: 'passed' })
  );
}

function replaceParagraph(
  deck: ReturnType<typeof openDeck>,
  id: string,
  node: Record<string, unknown>,
  turnId = 'turn-1'
) {
  return deck.write(
    {
      intent: 'Edit the subtitle.',
      scope: { ids: [id] },
      changes: [{ kind: 'replace', id, base: deck.read(id, turnId).base, node }]
    },
    turnId
  );
}

const subtitle = (deck: ReturnType<typeof openDeck>) => {
  const hit = deck.find('Company Name')[0];
  const run = (deck.read(hit.id).runs as Array<{ id: string }>)[0].id;
  return { run, paragraph: hit.id, shape: hit.within[0] };
};

describe('PowerPoint text', () => {
  it('adds a run that continues the formatting of the text before it', () => {
    const deck = openDeck();
    const { run, paragraph } = subtitle(deck);
    const before = deck.read(run) as Record<string, unknown>;
    expectCard(
      replaceParagraph(deck, paragraph, {
        ...deck.read(paragraph),
        runs: [{ ...before, text: 'Acme' }, { text: ' Corp' }]
      })
    );
    const runs = deck.read(paragraph).runs as Array<Record<string, unknown>>;
    const after = runs[1];
    expect(after.text).toBe(' Corp');
    for (const key of ['bold', 'italic', 'size', 'color', 'font'])
      expect(after[key]).toEqual(before[key]);
    expect(deck.pending()).toHaveLength(1);
    expect(deck.engine.snapshot().undoDepth).toBe(1);
  });

  it('formats one run and adds a paragraph in one card', () => {
    const deck = openDeck();
    const { run, paragraph, shape } = subtitle(deck);
    const shapeNode = deck.read(shape);
    expectCard(
      deck.write({
        intent: 'Bold the client name and add the quarter under it.',
        scope: { ids: [shape] },
        changes: [
          {
            kind: 'replace',
            id: shape,
            base: shapeNode.base,
            node: {
              ...shapeNode,
              paragraphs: [
                {
                  ...deck.read(paragraph),
                  runs: [{ ...deck.read(run), bold: true, size: 20 }]
                },
                { runs: [{ text: 'Q3 2026' }], align: 'r' }
              ]
            }
          }
        ]
      })
    );
    const lines = (deck.read(shape).paragraphs as any[]).map((p) => ({
      align: p.align,
      runs: p.runs.map((r: any) => [r.text, r.bold, r.size])
    }));
    expect(lines[0].runs[0]).toEqual(['Company Name', true, 20]);
    expect(lines[1]).toEqual(
      // the new line continues the subtitle's own formatting, not the bold just applied
      { align: 'r', runs: [['Q3 2026', undefined, undefined]] }
    );
    expect(deck.pending()).toHaveLength(1);
  });

  it('edits text inside a group', () => {
    const deck = openDeck('template1-text-group.pptx');
    const groups = ((deck.call('outline', { depth: 2 }) as any).lines as string)
      .split('\n')
      .filter((line) => / group /.test(line))
      .map((line) => line.trim().split(' ')[0]);
    const firstRun = (node: any): any =>
      node.kind === 'run'
        ? node
        : [...(node.shapes ?? []), ...(node.paragraphs ?? []), ...(node.runs ?? [])]
            .map(firstRun)
            .find(Boolean);
    const run = groups.map((id) => firstRun(deck.read(id))).find(Boolean);
    expect(run).toBeDefined();
    expectCard(
      deck.write({
        intent: 'Rename the grouped label.',
        scope: { ids: [run.id] },
        changes: [
          { kind: 'replace', id: run.id, base: deck.read(run.id).base, node: { ...deck.read(run.id), text: 'Renamed' } }
        ]
      })
    );
    expect(deck.find('Renamed')).toHaveLength(1);
  });

  it('bolds part of a run from a find hit, splitting it', () => {
    const deck = openDeck();
    const hit = deck.find('Name')[0] as { id: string; span: { start: number; end: number } };
    expectCard(
      deck.write({
        intent: 'Bold the word Name.',
        scope: { ids: [hit.id] },
        changes: [
          {
            kind: 'set',
            target: {
              id: hit.id,
              shape: deck.read(hit.id).shape,
              match: { text: 'Name', span: hit.span }
            },
            props: { bold: true }
          }
        ]
      })
    );
    const runs = (deck.read(hit.id).runs as Array<Record<string, unknown>>).map(
      (run) => [run.text, run.bold]
    );
    expect(runs).toEqual([
      ['Company ', undefined],
      ['Name', true]
    ]);
  });

  it('reports formatting the layout gives a run as inherited', () => {
    const deck = openDeck();
    const { run } = subtitle(deck);
    const node = (
      deck.call('read', { ids: [run], properties: true }) as {
        nodes: Array<{ properties: Record<string, { value: unknown; source: string }> }>;
      }
    ).nodes[0];
    expect(node.properties.size).toEqual({ value: 12, source: 'container' });
    expect(node.properties.underline).toEqual({ value: null, source: 'default' });
  });

  it('edits its own earlier suggestion, and rejecting both newest first restores the deck', () => {
    const deck = openDeck();
    const original = JSON.parse(serializeDeck(deck.engine)).slides;
    const { run } = subtitle(deck);
    const rename = (text: string, turnId: string) => {
      const paragraph = deck.find(text === 'Acme' ? 'Company Name' : 'Acme', turnId)[0].id;
      const id = (deck.read(paragraph, turnId).runs as Array<{ id: string }>)[0].id;
      return deck.write(
        {
          intent: 'Rename the client.',
          scope: { ids: [id] },
          changes: [{ kind: 'replace', id, base: deck.read(id, turnId).base, node: { text } }]
        },
        turnId
      );
    };
    expectCard(rename('Acme', 'turn-1'));
    expectCard(rename('Acme Corp', 'turn-2'));
    expect(run).toBeDefined();
    const [first, second] = deck.pending();
    expect(deck.engine.rejectChange(second.id).ok).toBe(true);
    expect(deck.engine.rejectChange(first.id).ok).toBe(true);
    expect(JSON.parse(serializeDeck(deck.engine)).slides).toEqual(original);
  });

  it('refuses clearing a paragraph alignment before trying it', () => {
    const deck = openDeck();
    const { paragraph } = subtitle(deck);
    const { align: _align, ...rest } = deck.read(paragraph);
    const result = replaceParagraph(deck, paragraph, rest);
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'limits', read: ['limits'] })
      })
    );
    expect(deck.pending()).toHaveLength(0);
  });

  it('refuses text holding a control character a deck cannot hold', () => {
    const deck = openDeck();
    const { run } = subtitle(deck);
    const result = deck.write({
      intent: 'Rename the client.',
      scope: { ids: [run] },
      changes: [
        {
          kind: 'replace',
          id: run,
          base: deck.read(run).base,
          node: { ...deck.read(run), text: 'Acme\u000bCorp' }
        }
      ]
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'limits' })
      })
    );
  });

  it('refuses a size the deck cannot hold and a colour not in capitals', () => {
    const deck = openDeck();
    const { run, paragraph } = subtitle(deck);
    const refusedBy = (result: WriteResult) =>
      (result as { refusal?: { invariant: string } }).refusal?.invariant;
    expect(
      refusedBy(
        deck.write({
          intent: 'Shrink the subtitle.',
          scope: { ids: [run] },
          changes: [
            {
              kind: 'replace',
              id: run,
              base: deck.read(run).base,
              node: { ...deck.read(run), size: 0 }
            }
          ]
        })
      )
    ).toBe('limits');
    expect(
      refusedBy(
        deck.write({
          intent: 'Colour the subtitle.',
          scope: { ids: [paragraph] },
          changes: [
            {
              kind: 'set',
              target: { ids: [run], shape: { [run]: deck.read(run).shape } },
              props: { color: '#ff00aa' }
            }
          ]
        })
      )
    ).toBe('property-invalid');
    expect(deck.pending()).toHaveLength(0);
  });
});

describe('PowerPoint slide number fields', () => {
  const footer = (deck: ReturnType<typeof openDeck>) => {
    const paragraph = deck.find('‹#›')[0].id;
    return { paragraph, node: deck.read(paragraph) };
  };
  const runsOf = (node: Record<string, unknown>) =>
    node.runs as Array<Record<string, unknown>>;

  it('bolds a line holding a slide number, leaving the number as the deck has it', () => {
    const deck = openDeck();
    const { paragraph } = footer(deck);
    expectCard(
      deck.write({
        intent: 'Bold the footer.',
        scope: { ids: [paragraph] },
        changes: [
          {
            kind: 'set',
            target: {
              ids: [paragraph],
              shape: { [paragraph]: deck.read(paragraph).shape }
            },
            props: { bold: true }
          }
        ]
      })
    );
    const runs = runsOf(deck.read(paragraph));
    expect(runs.filter((run) => run.kind === 'run').every((run) => run.bold)).toBe(true);
    expect(runs.find((run) => run.kind === 'field')?.bold).toBeUndefined();
  });

  it('adds text after a slide number as plain text', () => {
    const deck = openDeck();
    const { paragraph, node } = footer(deck);
    expectCard(
      replaceParagraph(deck, paragraph, {
        ...node,
        runs: [...runsOf(node), { text: ' Confidential' }]
      })
    );
    const runs = runsOf(deck.read(paragraph));
    expect(runs.map((run) => run.kind).slice(-2)).toEqual(['field', 'run']);
    expect(runs.filter((run) => run.kind === 'field')).toHaveLength(1);
  });

  it('refuses formatting the slide number itself before trying it', () => {
    const deck = openDeck();
    const { paragraph, node } = footer(deck);
    const result = replaceParagraph(deck, paragraph, {
      ...node,
      runs: runsOf(node).map((run) =>
        run.kind === 'field' ? { ...run, bold: true } : run
      )
    });
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'limits' })
      })
    );
  });
});
