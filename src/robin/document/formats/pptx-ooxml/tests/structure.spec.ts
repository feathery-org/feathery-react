import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { serializeDeck } from '../native';
import { fixture, openDeck, type WriteResult } from './harness';

function expectCard(result: WriteResult) {
  expect(result).toEqual(
    expect.objectContaining({ ok: true, committed: true, landed: 'card' })
  );
  expect(result.trace.proof).toEqual(
    expect.objectContaining({ outcome: 'passed' })
  );
}

const expectLimits = (result: WriteResult) =>
  expect(result).toEqual(
    expect.objectContaining({
      ok: false,
      refusal: expect.objectContaining({ invariant: 'limits' })
    })
  );

const slides = (deck: ReturnType<typeof openDeck>) =>
  (deck.call('outline', {}) as { lines: string }).lines
    .split('\n')
    .map((line) => line.trim().split(' ')[0]);

const slidesOf = (deck: ReturnType<typeof openDeck>) =>
  JSON.parse(serializeDeck(deck.engine)).slides as Array<{ path: string }>;

function rejectAll(deck: ReturnType<typeof openDeck>) {
  for (const record of deck.pending().reverse())
    expect(deck.engine.rejectChange(record.id).ok).toBe(true);
}

describe('PowerPoint structure', () => {
  it('removes a shape as one suggestion that rejecting brings back', () => {
    const deck = openDeck();
    const original = slidesOf(deck);
    const shape = deck.find('Q1')[0].within[0];
    expectCard(
      deck.write({
        intent: 'Remove the quarter label.',
        scope: { ids: [shape] },
        changes: [{ kind: 'delete', id: shape, base: deck.read(shape).base }]
      })
    );
    expect(deck.find('Q1')[0]).toBeDefined(); // still shown, as a suggested removal
    rejectAll(deck);
    expect(slidesOf(deck)).toEqual(original);
  });

  it('moves and resizes a shape', () => {
    const deck = openDeck();
    const shape = deck.find('Q1')[0].within[0];
    const node = deck.read(shape);
    const frame = node.frame as Record<string, number>;
    expectCard(
      deck.write({
        intent: 'Move the quarter label down.',
        scope: { ids: [shape] },
        changes: [
          {
            kind: 'replace',
            id: shape,
            base: node.base,
            node: {
              ...node,
              frame: { ...frame, y: frame.y + 100000, cx: frame.cx * 2 }
            }
          }
        ]
      })
    );
    expect((deck.read(shape).frame as Record<string, number>).cx).toBe(
      frame.cx * 2
    );
  });

  it('refuses a new text box the deck cannot hold', () => {
    const deck = openDeck();
    const [slide] = slides(deck);
    const last = (deck.read(slide).shapes as Array<{ id: string }>).slice(-1)[0]
      .id;
    const box = (frame: Record<string, number>, paragraphs: unknown[]) =>
      deck.write({
        intent: 'Add a note.',
        scope: { ids: [slide] },
        changes: [
          {
            kind: 'insert_after',
            anchor: last,
            node: { kind: 'shape', frame, paragraphs }
          }
        ]
      });
    const note = [{ runs: [{ text: 'Note' }] }];
    expectLimits(box({ x: 0, y: 0, cx: -1, cy: 0 }, note));
    expectLimits(box({ x: 1e300, y: 0, cx: 1e300, cy: 100 }, note));
    expectLimits(box({ x: 27273042329600, y: 0, cx: 100, cy: 100 }, note));
    expectLimits(box({ x: 0, y: 0, cx: 100, cy: 100 }, []));
  });

  it('adds a text box on top of a slide', () => {
    const deck = openDeck();
    const [slide] = slides(deck);
    const node = deck.read(slide);
    const last = (node.shapes as Array<{ id: string }>).slice(-1)[0].id;
    expectCard(
      deck.write({
        intent: 'Add a confidentiality note.',
        scope: { ids: [slide] },
        changes: [
          {
            kind: 'insert_after',
            anchor: last,
            node: {
              kind: 'shape',
              frame: { x: 457200, y: 4572000, cx: 3000000, cy: 400000 },
              paragraphs: [{ runs: [{ text: 'Confidential', italic: true }] }]
            }
          }
        ]
      })
    );
    const added = deck.read(deck.find('Confidential')[0].within[0]);
    expect(added.shapeId).toBeDefined();
    expect((added.paragraphs as any[])[0].runs[0]).toEqual(
      expect.objectContaining({ text: 'Confidential', italic: true, size: 18 })
    );
  });

  it('copies a slide with new text, dropping a shape, as one suggestion', () => {
    const deck = openDeck();
    const original = slidesOf(deck);
    const [first] = slides(deck);
    const source = deck.read(first);
    const shapes = (source.shapes as Array<Record<string, any>>).filter(
      (shape) => shape.paragraphs?.[0]?.runs?.[0]?.text !== 'Q1'
    );
    const title = shapes.find(
      (shape) => shape.placeholder === 'title'
    ) as Record<string, any>;
    title.paragraphs[0].runs[0].text = 'Pilot roadmap';
    expectCard(
      deck.write({
        intent: 'Add a pilot roadmap slide after the title slide.',
        scope: { ids: [first] },
        changes: [
          {
            kind: 'insert_after',
            anchor: first,
            node: { ...source, shapes }
          }
        ]
      })
    );
    const now = slides(deck);
    expect(now).toHaveLength(original.length + 1);
    expect(deck.find('Pilot roadmap')).toHaveLength(1);
    expect(deck.pending()).toHaveLength(1);
    rejectAll(deck);
    expect(slidesOf(deck)).toEqual(original);
  });

  it('copies a slide whose file holds an alignment and a font the editor never writes', () => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const path = 'ppt/slides/slide24.xml';
    files[path] = strToU8(
      strFromU8(files[path])
        .replace('algn="r"', 'algn="dist"')
        .replace('<a:latin typeface="Nunito Sans"', '<a:latin typeface=""')
    );
    const deck = openDeck('marketing-parity.pptx', zipSync(files));
    const slide = deck.find('Execution and launch')[0].within.slice(-1)[0];
    expectCard(
      deck.write({
        intent: 'Copy the launch slide.',
        scope: { ids: [slide] },
        changes: [
          { kind: 'insert_after', anchor: slide, node: deck.read(slide) }
        ]
      })
    );
  });

  it('withdraws a copied slide card after a later card on another slide, keeping that one', () => {
    const deck = openDeck();
    const original = slidesOf(deck);
    const [first] = slides(deck);
    expectCard(
      deck.write(
        {
          intent: 'Copy the title slide.',
          scope: { ids: [first] },
          changes: [
            { kind: 'insert_after', anchor: first, node: deck.read(first) }
          ]
        },
        'turn-0001'
      )
    );
    const shape = deck.find('Q1', 'turn-0002')[0].within[0];
    const run = (deck.read(shape, 'turn-0002').paragraphs as any)[0].runs[0].id;
    expectCard(
      deck.write(
        {
          intent: 'Rename the quarter.',
          scope: { ids: [run] },
          changes: [
            {
              kind: 'replace',
              id: run,
              base: deck.read(run, 'turn-0002').base as string,
              node: { ...deck.read(run, 'turn-0002'), text: 'Q2' }
            }
          ]
        },
        'turn-0002'
      )
    );

    const withdrawn = deck.call(
      'resolve',
      { cards: ['turn-0001'], accept: false },
      'turn-0003'
    );
    expect(withdrawn).toEqual(
      expect.objectContaining({ ok: true, cards: ['turn-0001'] })
    );
    expect(slidesOf(deck).map((slide) => slide.path)).toEqual(
      original.map((slide) => slide.path)
    );
    expect(deck.find('Q2', 'turn-0003')).toHaveLength(1);
    expect(deck.pending().map((record) => record.author.id)).toEqual([
      'turn-0002'
    ]);
  });

  it('refuses to resolve a card that is not pending', () => {
    const deck = openDeck();
    expect(
      deck.call('resolve', { cards: ['turn-0009'], accept: false })
    ).toEqual(
      expect.objectContaining({
        ok: false,
        refusal: expect.objectContaining({ invariant: 'card-not-pending' })
      })
    );
  });

  it('leaves the deck and both cards as they were when one of two rejects conflicts', () => {
    const deck = openDeck();
    const rename = (text: string, to: string, turnId: string) => {
      const shape = deck.find(text, turnId)[0].within[0];
      const run = (deck.read(shape, turnId).paragraphs as any)[0].runs[0];
      expectCard(
        deck.write(
          {
            intent: `Rename ${text}.`,
            scope: { ids: [run.id] },
            changes: [
              {
                kind: 'replace',
                id: run.id,
                base: deck.read(run.id, turnId).base as string,
                node: { ...run, text: to }
              }
            ]
          },
          turnId
        )
      );
      return shape;
    };
    const older = rename('Q1', 'ONE', 'turn-0001');
    rename('Meet the team', 'TWO', 'turn-0002');
    const slide = deck.read(
      deck.find('ONE', 'turn-0003')[0].within[1],
      'turn-0003'
    );
    deck.engine.execute({
      type: 'format-text',
      slideId: slide.path as string,
      shapeId: deck.read(older, 'turn-0003').shapeId as string,
      style: { italic: true }
    });
    const edited = serializeDeck(deck.engine);

    expect(
      deck.call(
        'resolve',
        { cards: ['turn-0001', 'turn-0002'], accept: false },
        'turn-0003'
      )
    ).toEqual(expect.objectContaining({ ok: false }));
    expect(serializeDeck(deck.engine)).toEqual(edited);
    expect(deck.pending().map((record) => record.author.id)).toEqual([
      'turn-0001',
      'turn-0002'
    ]);
    deck.store.redo();
    expect(serializeDeck(deck.engine)).toEqual(edited);
    expect(deck.pending()).toHaveLength(2);
    expect(deck.store.getState().redoStack).toHaveLength(0);
  });

  it("keeps the person's own redo when the first reject conflicts", () => {
    const deck = openDeck();
    const rename = (text: string, to: string, turnId: string) => {
      const shape = deck.find(text, turnId)[0].within[0];
      const run = (deck.read(shape, turnId).paragraphs as any)[0].runs[0];
      expectCard(
        deck.write(
          {
            intent: `Rename ${text}.`,
            scope: { ids: [run.id] },
            changes: [
              {
                kind: 'replace',
                id: run.id,
                base: deck.read(run.id, turnId).base as string,
                node: { ...run, text: to }
              }
            ]
          },
          turnId
        )
      );
    };
    rename('Q1', 'ONE', 'turn-0001');
    rename('ONE', 'TWO', 'turn-0002');
    const subtitle = deck.find('Company Name', 'turn-0003')[0].within;
    deck.engine.execute({
      type: 'format-text',
      slideId: deck.read(subtitle[1], 'turn-0003').path as string,
      shapeId: deck.read(subtitle[0], 'turn-0003').shapeId as string,
      style: { italic: true }
    });
    const italic = serializeDeck(deck.engine);
    deck.store.undo();

    expect(
      deck.call(
        'resolve',
        { cards: ['turn-0001'], accept: false },
        'turn-0003'
      )
    ).toEqual(expect.objectContaining({ ok: false }));
    deck.store.redo();
    expect(serializeDeck(deck.engine)).toEqual(italic);
  });

  it('removes and moves slides', () => {
    const deck = openDeck();
    const original = slidesOf(deck);
    const [first, second, third] = slides(deck);
    expectCard(
      deck.write({
        intent:
          'Drop the agenda and move the title slide after the team slide.',
        scope: { ids: [first, second, third] },
        changes: [
          { kind: 'delete', id: second, base: deck.read(second).base },
          {
            kind: 'move',
            id: first,
            shape: deck.read(first).shape,
            anchor: third,
            position: 'after'
          }
        ]
      })
    );
    const paths = slidesOf(deck).map((slide) => slide.path);
    expect(paths.slice(0, 2)).toEqual([original[2].path, original[0].path]);
    rejectAll(deck);
    expect(slidesOf(deck)).toEqual(original);
  });

  it('refuses a slide written from scratch, a text box under others, and a reorder', () => {
    const deck = openDeck();
    const [first] = slides(deck);
    expectLimits(
      deck.write({
        intent: 'Add a blank slide.',
        scope: { ids: [first] },
        changes: [
          {
            kind: 'insert_after',
            anchor: first,
            node: { kind: 'slide', shapes: [] }
          }
        ]
      })
    );
    const node = deck.read(first);
    const [bottom, next] = node.shapes as Array<{ id: string }>;
    expectLimits(
      deck.write({
        intent: 'Add a note under everything.',
        scope: { ids: [first] },
        changes: [
          {
            kind: 'insert_before',
            anchor: bottom.id,
            node: {
              kind: 'shape',
              frame: { x: 0, y: 0, cx: 10, cy: 10 },
              paragraphs: [{ runs: [{ text: 'x' }] }]
            }
          }
        ]
      })
    );
    expectLimits(
      deck.write({
        intent: 'Put the second shape at the back.',
        scope: { ids: [first] },
        changes: [
          {
            kind: 'move',
            id: next.id,
            shape: deck.read(next.id).shape,
            anchor: bottom.id,
            position: 'before'
          }
        ]
      })
    );
    expect(deck.pending()).toHaveLength(0);
  });

  it('copies every slide of a deck with tables, refusing only a copy that changes a table or the stacking order', () => {
    const deck = openDeck('sample.pptx');
    const copy = (slide: string, edit: (node: any) => void = () => {}) => {
      const node = JSON.parse(JSON.stringify(deck.read(slide)));
      edit(node);
      return deck.write({
        intent: 'Copy the slide.',
        scope: { ids: [slide] },
        changes: [{ kind: 'insert_after', anchor: slide, node }]
      });
    };
    for (const slide of slides(deck)) {
      expectCard(copy(slide));
      deck.engine.undo();
    }
    const withTable = slides(deck).find((slide) =>
      (deck.read(slide).shapes as Array<{ kind: string }>).some(
        (shape) => shape.kind === 'table'
      )
    ) as string;
    expectLimits(
      copy(withTable, (node) => {
        const table = node.shapes.find((shape: any) => shape.kind === 'table');
        table.rows[0].cells[0].paragraphs[0].runs[0].text = 'changed';
      })
    );
    expectLimits(
      copy(slides(deck)[0], (node) => {
        node.shapes = [node.shapes[1], node.shapes[0], ...node.shapes.slice(2)];
      })
    );
  });

  it('removes a whole table, but refuses removing one of its rows', () => {
    const tableOf = (deck: ReturnType<typeof openDeck>) =>
      (deck.call('outline', { depth: 6 }) as { lines: string }).lines
        .split('\n')
        .find((line) => / table /.test(line))
        ?.trim()
        .split(' ')[0] as string;
    const remove = (deck: ReturnType<typeof openDeck>, id: string) =>
      deck.write({
        intent: 'Remove it.',
        scope: { ids: [id] },
        changes: [{ kind: 'delete', id, base: deck.read(id).base }]
      });
    const deck = openDeck('sample.pptx');
    expectCard(remove(deck, tableOf(deck)));
    const other = openDeck('sample.pptx');
    const row = (other.read(tableOf(other)).rows as Array<{ id: string }>)[0]
      .id;
    expectLimits(remove(other, row));
  });

  it('refuses changing a table cell, which the editor writes only as plain text', () => {
    const deck = openDeck('sample.pptx');
    const lines = (
      deck.call('outline', { depth: 6 }) as { lines: string }
    ).lines.split('\n');
    const table = lines
      .find((line) => / table /.test(line))
      ?.trim()
      .split(' ')[0] as string;
    const cellParagraph = lines
      .slice(lines.findIndex((line) => line.includes(` ${table} `)))
      .find((line) => / paragraph /.test(line))
      ?.trim()
      .split(' ')[0] as string;
    const node = deck.read(cellParagraph);
    expectLimits(
      deck.write({
        intent: 'Change a cell.',
        scope: { ids: [cellParagraph] },
        changes: [
          {
            kind: 'replace',
            id: cellParagraph,
            base: node.base,
            node: { ...node, runs: [{ text: 'changed' }] }
          }
        ]
      })
    );
  });
});

describe('PowerPoint suggestions beside the person\'s own edits', () => {
  const copyFirstSlide = (deck: ReturnType<typeof openDeck>, turnId: string) => {
    const [first] = slides(deck);
    return deck.write(
      {
        intent: 'Copy the title slide.',
        scope: { ids: [first] },
        changes: [
          { kind: 'insert_after', anchor: first, node: deck.read(first, turnId) }
        ]
      },
      turnId
    );
  };
  const renameSubtitle = (deck: ReturnType<typeof openDeck>) => {
    const run = (deck.read(deck.find('Company Name')[0].id).runs as any)[0];
    expectCard(
      deck.write({
        intent: 'Rename the company.',
        scope: { ids: [run.id] },
        changes: [
          {
            kind: 'replace',
            id: run.id,
            base: deck.read(run.id).base as string,
            node: { ...run, text: 'Acme' }
          }
        ]
      })
    );
  };
  const italicSubtitle = (
    deck: ReturnType<typeof openDeck>,
    text: string,
    italic: boolean
  ) => {
    const [slide] = slidesOf(deck);
    const shape = deck.engine
      .readDeck()!
      .slides[0].shapes.find((candidate) =>
        candidate.text?.paragraphs.some((p) =>
          p.runs.some((r) => r.text === text)
        )
      )!;
    deck.engine.execute({
      type: 'format-text',
      slideId: slide.path,
      shapeId: shape.id,
      style: { italic }
    });
  };
  const rejectsKept = (deck: ReturnType<typeof openDeck>) =>
    [
      ...(
        deck.engine as unknown as {
          settledSuggestions: Map<string, { status: string }>;
        }
      ).settledSuggestions.values()
    ].filter((settled) => settled.status === 'rejected').length;

  it('keeps an accepted slide copy when redo would replay its undone reject', () => {
    const deck = openDeck();
    const count = slidesOf(deck).length;
    expectCard(copyFirstSlide(deck, 'turn-0001'));
    deck.call('resolve', { cards: ['turn-0001'], accept: false }, 'turn-0002');
    deck.store.undo();
    deck.call('resolve', { cards: ['turn-0001'], accept: true }, 'turn-0002');
    deck.store.redo();
    expect(slidesOf(deck)).toHaveLength(count + 1);
    expect(
      deck.engine.changes().find((record) => record.author.id === 'turn-0001')
        ?.status
    ).toBe('accepted');
  });

  it("keeps redo of the person's slide added before an undone reject of what is now accepted", () => {
    const deck = openDeck();
    const count = slidesOf(deck).length;
    renameSubtitle(deck);
    deck.store.addSlide(count, slidesOf(deck)[0].path);
    expect(deck.store.rejectChange(deck.pending()[0].id).ok).toBe(true);
    deck.store.undo();
    deck.store.undo();
    expect(deck.store.acceptChange(deck.pending()[0].id)).toBe(true);
    expect(deck.store.getState().redoStack).toHaveLength(1);
    deck.store.redo();
    expect(slidesOf(deck)).toHaveLength(count + 1);
    expect(deck.engine.canRedo()).toBe(false);
    expect(rejectsKept(deck)).toBe(0);
  });

  it('lets go of the slides a suggestion kept once it is accepted or rejected', () => {
    const deck = openDeck();
    expectCard(copyFirstSlide(deck, 'turn-0001'));
    expectCard(copyFirstSlide(deck, 'turn-0002'));
    const [accepted, rejected] = deck.pending().map((record) => record.id);
    const kept = (id: string) => {
      const record = deck.engine.changes().find((each) => each.id === id)!;
      return [record.beforeSlides, record.beforeSlideRels, record.changedSlides];
    };
    expect(deck.engine.acceptChange(accepted)).toBe(true);
    expect(kept(accepted)).toEqual([undefined, undefined, undefined]);
    expect(deck.engine.rejectChange(rejected).ok).toBe(true);
    expect(kept(rejected)).toEqual([undefined, undefined, undefined]);
    deck.store.undo();
    expect(kept(rejected)[1]).toBeDefined();
    deck.store.redo();
    expect(kept(rejected)).toEqual([undefined, undefined, undefined]);
  });

  it('forgets a reject once its undo step is discarded or leaves history', () => {
    const undone = openDeck();
    renameSubtitle(undone);
    expect(undone.engine.rejectChange(undone.pending()[0].id).ok).toBe(true);
    undone.store.undo();
    italicSubtitle(undone, 'Acme', true);
    expect(rejectsKept(undone)).toBe(0);

    const aged = openDeck();
    renameSubtitle(aged);
    expect(aged.engine.rejectChange(aged.pending()[0].id).ok).toBe(true);
    for (let i = 0; i < 100; i++)
      italicSubtitle(aged, 'Company Name', i % 2 === 0);
    expect(rejectsKept(aged)).toBe(0);
  }, 60000);

  it("lets Robin copy a slide the person added after Robin's own copy", () => {
    const deck = openDeck();
    expectCard(copyFirstSlide(deck, 'turn-1'));
    deck.store.addSlide(slidesOf(deck).length, slidesOf(deck)[2].path);
    const added = slides(deck).slice(-1)[0];
    expect(deck.read(added, 'turn-2').pending).toBeUndefined();
    expectCard(
      deck.write(
        {
          intent: 'Copy the new slide.',
          scope: { ids: [added] },
          changes: [
            {
              kind: 'insert_after',
              anchor: added,
              node: deck.read(added, 'turn-2')
            }
          ]
        },
        'turn-2'
      )
    );
  });

  it('marks a shape Robin renamed in the same write that copied its slide', () => {
    const deck = openDeck();
    const [first] = slides(deck);
    const run = (deck.read(deck.find('Company Name')[0].id).runs as any)[0];
    expectCard(
      deck.write({
        intent: 'Copy the title slide and rename the company.',
        scope: { ids: [first, run.id] },
        changes: [
          { kind: 'insert_after', anchor: first, node: deck.read(first) },
          {
            kind: 'replace',
            id: run.id,
            base: deck.read(run.id).base as string,
            node: { ...run, text: 'Acme' }
          }
        ]
      })
    );
    const renamed = deck.find('Acme', 'turn-2')[0].within[0];
    expect(deck.read(renamed, 'turn-2').pending).toEqual({
      insertion: 'turn-1'
    });
  });

  it("does not mark the person's new shape as part of Robin's edit on that slide", () => {
    const deck = openDeck();
    renameSubtitle(deck);
    const [slide] = slidesOf(deck);
    deck.engine.execute({
      type: 'insert-shape',
      slideId: slide.path,
      shape: { kind: 'text-box', x: 0, y: 0, cx: 914400, cy: 457200 }
    });
    const [first] = slides(deck);
    const shapes = deck.read(first, 'turn-2').shapes as Array<{ id: string }>;
    expect(deck.read(shapes.slice(-1)[0].id, 'turn-2').pending).toBeUndefined();
  });
});

describe('PowerPoint shapes sharing an id on one slide', () => {
  const openSharing = () => {
    const files = unzipSync(fixture('marketing-parity.pptx'));
    const path = 'ppt/slides/slide1.xml';
    files[path] = strToU8(
      strFromU8(files[path]).replace(
        '<p:cNvPr id="474" name="Google Shape;474;p57"',
        '<p:cNvPr id="473" name="Google Shape;474;p57"'
      )
    );
    return openDeck('marketing-parity.pptx', zipSync(files));
  };
  const shapeOf = (deck: ReturnType<typeof openDeck>, text: string) =>
    deck.find(text)[0].within[0];

  it('reads each shape as it is', () => {
    const deck = openSharing();
    const q1 = shapeOf(deck, 'Q1');
    const month = shapeOf(deck, 'Month');
    expect(q1).not.toEqual(month);
    expect(JSON.stringify(deck.read(q1).paragraphs)).toContain('Q1');
    expect(JSON.stringify(deck.read(month).paragraphs)).toContain('Month');
  });

  it('refuses editing, removing or copying either one, and still edits the rest', () => {
    const deck = openSharing();
    const month = shapeOf(deck, 'Month');
    const run = (deck.read(month).paragraphs as any)[0].runs[0];
    expectLimits(
      deck.write({
        intent: 'Rename the month.',
        scope: { ids: [run.id] },
        changes: [
          {
            kind: 'replace',
            id: run.id,
            base: deck.read(run.id).base as string,
            node: { ...run, text: 'June' }
          }
        ]
      })
    );
    const q1 = shapeOf(deck, 'Q1');
    expectLimits(
      deck.write({
        intent: 'Drop the quarter.',
        scope: { ids: [q1] },
        changes: [{ kind: 'delete', id: q1, base: deck.read(q1).base }]
      })
    );
    expectLimits(
      deck.write({
        intent: 'Copy the title slide.',
        scope: { ids: ['n1'] },
        changes: [{ kind: 'insert_after', anchor: 'n1', node: deck.read('n1') }]
      })
    );
    const year = (deck.read(shapeOf(deck, 'Year')).paragraphs as any)[0]
      .runs[0];
    expectCard(
      deck.write({
        intent: 'Set the year.',
        scope: { ids: [year.id] },
        changes: [
          {
            kind: 'replace',
            id: year.id,
            base: deck.read(year.id).base as string,
            node: { ...year, text: '2027' }
          }
        ]
      })
    );
  });
});
