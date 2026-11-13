import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';
import { childrenOf, el, tagOf } from '../core/opc/xml';
import { readShapeNode } from '../core/model/read';
import type { Deck } from '../core/model/types';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);

function loadedEngine() {
  const engine = new PptxEditorEngine();
  engine.load(fixture);
  return engine;
}

function firstTextShape(engine: PptxEditorEngine) {
  const doc = engine.snapshot().document!;
  const slide = doc.slides.find((s) => s.shapes.some((sh) => sh.text))!;
  const shape = slide.shapes.find((sh) => sh.text)!;
  return { slide, shape };
}

describe('tracked edits (engine change log)', () => {
  it('records user transactions as immediately accepted, with targets and fragments', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    engine.execute(
      {
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { bold: true }
      },
      { label: 'Bold title' }
    );
    const records = engine.changes();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.status).toBe('accepted');
    expect(record.origin).toBe('editor');
    expect(record.author.kind).toBe('user');
    expect(record.summary).toBe('Bold title');
    expect(record.targets).toEqual([
      { slideId: slide.path, shapeId: shape.id }
    ]);
    const key = `${slide.path}#${shape.id}`;
    expect((record.before as any)[key]).toBeTruthy();
    expect((record.after as any)[key]).toBeTruthy();
    expect(JSON.stringify((record.before as any)[key])).not.toBe(
      JSON.stringify((record.after as any)[key])
    );
  });

  it('marks assistant transactions pending; accept flips status without touching the deck', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    engine.execute(
      {
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { italic: true }
      },
      {
        label: 'Suggest italics',
        origin: 'assistant',
        authorLabel: 'Assistant'
      }
    );
    const record = engine.changes()[0];
    expect(record.status).toBe('pending');
    expect(engine.pendingChangeCount()).toBe(1);
    const revisionBefore = engine.snapshot().revision;
    expect(engine.acceptChange(record.id)).toBe(true);
    expect(engine.changes()[0].status).toBe('accepted');
    expect(engine.pendingChangeCount()).toBe(0);
    // Accepting is metadata-only: no new history entry.
    expect(engine.snapshot().undoDepth).toBe(1);
    expect(engine.snapshot().revision).toBeGreaterThan(revisionBefore);
  });

  it('reject executes the inverse when targets are unchanged', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    const originalBold = shape.text!.paragraphs[0].runs[0].bold;
    engine.execute(
      {
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { bold: !originalBold }
      },
      { label: 'Suggest bold', origin: 'assistant' }
    );
    const record = engine.changes()[0];
    const outcome = engine.rejectChange(record.id);
    expect(outcome.ok).toBe(true);
    const restored = engine
      .snapshot()
      .document!.slides.find((s) => s.path === slide.path)!
      .shapes.find((sh) => sh.id === shape.id)!;
    expect(!!(restored.text!.paragraphs[0].runs[0] as any).bold).toBe(
      !!originalBold
    );
    expect(
      engine.changes().find((candidate) => candidate.id === record.id)?.status
    ).toBe('rejected');
    // The inverse apply is its own accepted transaction.
    expect(
      engine
        .changes()
        .some((candidate) => candidate.summary === 'Reject suggestion')
    ).toBe(true);
  });

  it('reject reports a conflict when the target changed after the suggestion', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    engine.execute(
      {
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { bold: true }
      },
      { label: 'Suggest bold', origin: 'assistant' }
    );
    const suggestion = engine.changes()[0];
    // A later user edit moves the target on.
    engine.execute(
      {
        type: 'set-shape-geometries',
        slideId: slide.path,
        updates: [{ shapeId: shape.id, geometry: { x: 555555 } }]
      },
      { label: 'Move shape' }
    );
    const outcome = engine.rejectChange(suggestion.id);
    expect(outcome).toEqual({ ok: false, reason: 'conflict' });
    expect(
      engine.changes().find((candidate) => candidate.id === suggestion.id)
        ?.status
    ).toBe('pending');
  });

  it('rejecting a created shape deletes it', () => {
    const engine = loadedEngine();
    const doc = engine.snapshot().document!;
    const slide = doc.slides[0];
    const result = engine.execute(
      {
        type: 'insert-shape',
        slideId: slide.path,
        shape: { kind: 'text-box', x: 0, y: 0, cx: 914400, cy: 457200 }
      },
      { label: 'Suggest text box', origin: 'assistant' }
    );
    const createdId = result.createdShapeIds[0];
    expect(createdId).toBeTruthy();
    const record = engine.changes()[0];
    const outcome = engine.rejectChange(record.id);
    expect(outcome.ok).toBe(true);
    const shapes = engine
      .snapshot()
      .document!.slides.find((s) => s.path === slide.path)!.shapes;
    expect(shapes.some((sh) => sh.id === createdId)).toBe(false);
  });

  it('undo shelves the transaction record and redo restores it', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    engine.execute(
      {
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { bold: true }
      },
      { label: 'Bold' }
    );
    expect(engine.changes()).toHaveLength(1);
    engine.undo();
    expect(engine.changes()).toHaveLength(0);
    engine.redo();
    expect(engine.changes()).toHaveLength(1);
    // A fresh edit after an undo clears the shelf with the redo stack.
    engine.undo();
    engine.execute(
      {
        type: 'set-shape-geometries',
        slideId: slide.path,
        updates: [{ shapeId: shape.id, geometry: { x: 777777 } }]
      },
      { label: 'Move' }
    );
    expect(engine.changes()).toHaveLength(1);
    expect(engine.changes()[0].summary).toBe('Move');
  });

  it('rejecting a deleted shape puts it back where it was', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    const orderBefore = slide.shapes.map((candidate) => candidate.id);
    engine.execute(
      { type: 'delete-shapes', slideId: slide.path, shapeIds: [shape.id] },
      { origin: 'assistant' }
    );
    const outcome = engine.rejectChange(engine.changes()[0].id);
    expect(outcome.ok).toBe(true);
    const restored = engine
      .snapshot()
      .document!.slides.find((s) => s.path === slide.path)!;
    expect(restored.shapes.map((candidate) => candidate.id)).toEqual(
      orderBefore
    );
  });

  it('rejecting an added or deleted slide restores the slide set', () => {
    const engine = loadedEngine();
    const pathsBefore = engine
      .snapshot()
      .document!.slides.map((slide) => slide.path);
    engine.execute({ type: 'add-slide', atIndex: 1 }, { origin: 'assistant' });
    engine.execute(
      { type: 'delete-slide', slideId: pathsBefore[3] },
      { origin: 'assistant' }
    );
    const [added, deleted] = engine.changes();
    expect(engine.rejectChange(deleted.id).ok).toBe(true);
    expect(engine.rejectChange(added.id).ok).toBe(true);
    expect(
      engine.snapshot().document!.slides.map((slide) => slide.path)
    ).toEqual(pathsBefore);
  });

  it('rejecting an added slide keeps later edits to other slides', () => {
    const engine = loadedEngine();
    const pathsBefore = engine
      .snapshot()
      .document!.slides.map((slide) => slide.path);
    const { slide, shape } = firstTextShape(engine);
    engine.execute({ type: 'add-slide', atIndex: 1 }, { origin: 'assistant' });
    const suggestion = engine.changes()[0];
    engine.execute({
      type: 'format-text',
      slideId: slide.path,
      shapeId: shape.id,
      style: { italic: true }
    });
    const edited = engine
      .snapshot()
      .document!.slides.find((s) => s.path === slide.path);

    expect(engine.rejectChange(suggestion.id).ok).toBe(true);
    const document = engine.snapshot().document!;
    expect(document.slides.map((s) => s.path)).toEqual(pathsBefore);
    expect(document.slides.find((s) => s.path === slide.path)).toEqual(edited);
  });

  it('rejecting a slide change conflicts once its own slide or the slide order changed after it', () => {
    const engine = loadedEngine();
    engine.execute({ type: 'add-slide', atIndex: 1 }, { origin: 'assistant' });
    const added = engine.changes()[0];
    engine.execute({ type: 'move-slide', fromIndex: 1, toIndex: 2 });
    expect(engine.rejectChange(added.id)).toEqual({
      ok: false,
      reason: 'conflict'
    });
  });

  it('rejects a whole transaction at once and the reject itself can be undone', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    const before = engine.snapshot().document;
    engine.transaction({ origin: 'assistant', authorId: 'turn-7' }, () => {
      engine.execute({
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { bold: true }
      });
      engine.execute({
        type: 'delete-shapes',
        slideId: slide.path,
        shapeIds: [shape.id]
      });
    });
    const suggested = engine.snapshot().document;
    const record = engine.changes()[0];
    expect(engine.rejectChange(record.id).ok).toBe(true);
    expect(engine.snapshot().document).toEqual(before);
    engine.undo();
    expect(engine.snapshot().document).toEqual(suggested);
  });

  it('gives a pending record its target slide XML from before the change, and none to accepted ones', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    const rawBefore = JSON.stringify(engine.readDeck()!.slides.find((s) => s.path === slide.path)!.raw);
    engine.execute({
      type: 'format-text',
      slideId: slide.path,
      shapeId: shape.id,
      style: { bold: true }
    });
    engine.execute(
      { type: 'delete-shapes', slideId: slide.path, shapeIds: [shape.id] },
      { origin: 'assistant' }
    );
    const [accepted, pending] = engine.changes();
    expect(accepted.beforeSlides).toBeUndefined();
    expect(Object.keys(pending.beforeSlides!)).toEqual([slide.path]);
    expect(JSON.stringify(pending.beforeSlides![slide.path])).not.toBe(rawBefore);
    expect(JSON.stringify(pending.beforeSlides![slide.path])).toContain(shape.id);
  });

  it('gives a pending deck change every slide from before it', () => {
    const engine = loadedEngine();
    const order = engine.snapshot().document!.slides.map((s) => s.path);
    engine.execute(
      { type: 'delete-slide', slideId: order[2] },
      { origin: 'assistant' }
    );
    expect(Object.keys(engine.changes()[0].beforeSlides!).sort()).toEqual(
      [...order].sort()
    );
  });

  it('rejecting a delete of several shapes puts each back in its stacking place', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[0];
    const order = slide.shapes.map((shape) => shape.id);
    engine.execute(
      { type: 'delete-shapes', slideId: slide.path, shapeIds: [order[2], order[1]] },
      { origin: 'assistant' }
    );
    expect(engine.rejectChange(engine.changes()[0].id).ok).toBe(true);
    expect(engine.readDeck()!.slides[0].shapes.map((shape) => shape.id)).toEqual(
      order
    );
  });

  it('rejecting a reorder moves the shape back', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[0];
    const order = slide.shapes.map((shape) => shape.id);
    engine.execute(
      { type: 'reorder-shape', slideId: slide.path, shapeId: order[0], operation: 'forward' },
      { origin: 'assistant' }
    );
    expect(engine.rejectChange(engine.changes()[0].id).ok).toBe(true);
    expect(engine.readDeck()!.slides[0].shapes.map((shape) => shape.id)).toEqual(
      order
    );
  });

  it('rejecting a format suggestion keeps the move the person made afterwards', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[0];
    const shape = slide.shapes.find((candidate) => candidate.text)!;
    const xmlBefore = JSON.stringify(shape.node);
    engine.execute(
      {
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { bold: true }
      },
      { origin: 'assistant' }
    );
    const suggestion = engine.changes()[0];
    engine.execute({
      type: 'reorder-shape',
      slideId: slide.path,
      shapeId: shape.id,
      operation: 'front'
    });
    const movedOrder = engine
      .readDeck()!
      .slides[0].shapes.map((candidate) => candidate.id);
    expect(engine.rejectChange(suggestion.id).ok).toBe(true);
    const after = engine.readDeck()!.slides[0];
    expect(after.shapes.map((candidate) => candidate.id)).toEqual(movedOrder);
    expect(
      JSON.stringify(after.shapes.find((candidate) => candidate.id === shape.id)!.node)
    ).toBe(xmlBefore);
  });

  const permutations = (items: number[]): number[][] =>
    items.length <= 1
      ? [items]
      : items.flatMap((item, i) =>
          permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(
            (rest) => [item, ...rest]
          )
        );

  it.each(permutations([0, 1, 2]))(
    'rejecting three shape deletes in order %j never puts shapes out of order',
    (...rejectOrder) => {
      const engine = loadedEngine();
      const slide = engine.readDeck()!.slides[0];
      const order = slide.shapes.map((shape) => shape.id);
      for (const shapeId of order.slice(1, 4))
        engine.execute(
          { type: 'delete-shapes', slideId: slide.path, shapeIds: [shapeId] },
          { origin: 'assistant' }
        );
      const suggestions = engine.changes();
      for (const index of rejectOrder) engine.rejectChange(suggestions[index].id);
      const present = engine.readDeck()!.slides[0].shapes.map((shape) => shape.id);
      expect(present).toEqual(order.filter((id) => present.includes(id)));
    }
  );

  it('rejects separate deletes newest first exactly, and refuses an older one first', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[0];
    const order = slide.shapes.map((shape) => shape.id);
    for (const shapeId of order.slice(1, 4))
      engine.execute(
        { type: 'delete-shapes', slideId: slide.path, shapeIds: [shapeId] },
        { origin: 'assistant' }
      );
    const [first, second, third] = engine.changes();
    expect(engine.rejectChange(first.id)).toEqual({ ok: false, reason: 'conflict' });
    for (const suggestion of [third, second, first])
      expect(engine.rejectChange(suggestion.id).ok).toBe(true);
    expect(engine.readDeck()!.slides[0].shapes.map((shape) => shape.id)).toEqual(order);
  });

  it('rejects two reorders newest first, and refuses an older one first', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[0];
    const order = slide.shapes.map((shape) => shape.id);
    for (const shapeId of [order[0], order[1]])
      engine.execute(
        { type: 'reorder-shape', slideId: slide.path, shapeId, operation: 'front' },
        { origin: 'assistant' }
      );
    const [first, second] = engine.changes();
    expect(engine.rejectChange(first.id)).toEqual({ ok: false, reason: 'conflict' });
    expect(engine.rejectChange(second.id).ok).toBe(true);
    expect(engine.rejectChange(first.id).ok).toBe(true);
    expect(engine.readDeck()!.slides[0].shapes.map((shape) => shape.id)).toEqual(order);
  });

  it('rejects a transaction that edits a shape and then deletes its slide', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[1];
    const shape = slide.shapes.find((candidate) => candidate.text)!;
    const before = engine.snapshot().document;
    engine.transaction({ origin: 'assistant' }, () => {
      engine.execute({
        type: 'format-text',
        slideId: slide.path,
        shapeId: shape.id,
        style: { bold: true }
      });
      engine.execute({ type: 'delete-slide', slideId: slide.path });
    });
    const record = engine.changes()[0];
    expect(record.targets).toEqual([{ slideId: '*' }]);
    expect(engine.rejectChange(record.id).ok).toBe(true);
    expect(engine.snapshot().document).toEqual(before);
  });

  it('never gives a new slide the path of a deleted one, so an old suggestion cannot land on it', () => {
    const engine = loadedEngine();
    const slides = engine.readDeck()!.slides;
    const last = slides[slides.length - 1];
    engine.execute(
      {
        type: 'delete-shapes',
        slideId: last.path,
        shapeIds: [last.shapes[0].id]
      },
      { origin: 'assistant' }
    );
    engine.execute({ type: 'delete-slide', slideId: last.path });
    engine.execute({ type: 'add-slide', atIndex: slides.length - 1 });
    const added = engine.readDeck()!.slides[slides.length - 1];
    expect(added.path).not.toBe(last.path);
    expect(engine.rejectChange(engine.changes()[0].id)).toEqual({
      ok: false,
      reason: 'conflict'
    });
  });

  it('rejects a shape delete after the person edited another shape, keeping their edit', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[0];
    const order = slide.shapes.map((shape) => shape.id);
    const edited = slide.shapes.find(
      (shape) => shape.text && shape.id !== order[2]
    )!;
    engine.execute(
      { type: 'delete-shapes', slideId: slide.path, shapeIds: [order[2]] },
      { origin: 'assistant' }
    );
    engine.execute({
      type: 'format-text',
      slideId: slide.path,
      shapeId: edited.id,
      style: { italic: true }
    });
    const editedXml = JSON.stringify(
      engine.readDeck()!.slides[0].shapes.find((shape) => shape.id === edited.id)!.node
    );
    expect(engine.rejectChange(engine.changes()[0].id).ok).toBe(true);
    const after = engine.readDeck()!.slides[0];
    expect(after.shapes.map((shape) => shape.id)).toEqual(order);
    expect(
      JSON.stringify(after.shapes.find((shape) => shape.id === edited.id)!.node)
    ).toBe(editedXml);
  });

  it('refuses a shape delete as a conflict once the person changed the stacking order', () => {
    const engine = loadedEngine();
    const slide = engine.readDeck()!.slides[0];
    const order = slide.shapes.map((shape) => shape.id);
    engine.execute(
      { type: 'delete-shapes', slideId: slide.path, shapeIds: [order[2]] },
      { origin: 'assistant' }
    );
    engine.execute({
      type: 'reorder-shape',
      slideId: slide.path,
      shapeId: order[0],
      operation: 'front'
    });
    expect(engine.rejectChange(engine.changes()[0].id)).toEqual({
      ok: false,
      reason: 'conflict'
    });
  });

  it.each([
    ['after the first shape', 1],
    ['just before the deleted shape', -1]
  ])(
    'keeps a node the editor does not model %s in place when rejecting a delete',
    (_, at) => {
      const engine = loadedEngine();
      const deck = engine.readDeck()! as Deck;
      const slide = deck.slides[0];
      const kids = childrenOf(slide.spTree);
      const shapeIndexes = kids
        .map((node, index) => (readShapeNode(node) ? index : -1))
        .filter((index) => index >= 0);
      const deletedIndex = shapeIndexes[shapeIndexes.length - 1];
      const deletedId = readShapeNode(kids[deletedIndex])!.id;
      kids.splice(
        at === 1 ? shapeIndexes[0] + 1 : deletedIndex,
        0,
        el('mc:AlternateContent')
      );
      deck.pkg.markDirty(slide.path);
      engine.adopt(deck);
      const layout = () =>
        childrenOf(engine.readDeck()!.slides[0].spTree).map(
          (node) => readShapeNode(node)?.id ?? tagOf(node)
        );
      const expected = layout();
      const edited = engine
        .readDeck()!
        .slides[0].shapes.find((shape) => shape.text && shape.id !== deletedId)!;

      engine.execute(
        { type: 'delete-shapes', slideId: slide.path, shapeIds: [deletedId] },
        { origin: 'assistant' }
      );
      engine.execute({
        type: 'format-text',
        slideId: slide.path,
        shapeId: edited.id,
        style: { italic: true }
      });
      expect(engine.rejectChange(engine.changes()[0].id).ok).toBe(true);
      expect(layout()).toEqual(expected);
    }
  );

  it('tells identical unmodelled nodes apart when rejecting a delete', () => {
    const engine = loadedEngine();
    const deck = engine.readDeck()! as Deck;
    const slide = deck.slides[0];
    const kids = childrenOf(slide.spTree);
    const shapeIndexes = kids
      .map((node, index) => (readShapeNode(node) ? index : -1))
      .filter((index) => index >= 0);
    kids.splice(shapeIndexes[2], 0, el('mc:AlternateContent'));
    kids.splice(shapeIndexes[0] + 1, 0, el('mc:AlternateContent'));
    deck.pkg.markDirty(slide.path);
    engine.adopt(deck);
    const layout = () =>
      childrenOf(engine.readDeck()!.slides[0].spTree).map(
        (node) => readShapeNode(node)?.id ?? tagOf(node)
      );
    const expected = layout();
    const shapes = engine.readDeck()!.slides[0].shapes;
    const deletedId = shapes[2].id;
    const edited = shapes.find((shape) => shape.text && shape.id !== deletedId)!;

    engine.execute(
      { type: 'delete-shapes', slideId: slide.path, shapeIds: [deletedId] },
      { origin: 'assistant' }
    );
    engine.execute({
      type: 'format-text',
      slideId: slide.path,
      shapeId: edited.id,
      style: { italic: true }
    });
    expect(engine.rejectChange(engine.changes()[0].id).ok).toBe(true);
    expect(layout()).toEqual(expected);
  });

  it('drops a suggestion slide XML once it is accepted or rejected', () => {
    const engine = loadedEngine();
    const { slide, shape } = firstTextShape(engine);
    for (const italic of [true, false])
      engine.execute(
        {
          type: 'format-text',
          slideId: slide.path,
          shapeId: shape.id,
          style: { italic }
        },
        { origin: 'assistant' }
      );
    const [older, newer] = engine.changes();
    expect(older.beforeSlides).toBeDefined();
    engine.acceptChange(older.id);
    expect(engine.rejectChange(newer.id).ok).toBe(true);
    const [accepted, rejected] = engine.changes();
    expect(accepted.beforeSlides).toBeUndefined();
    expect(rejected.beforeSlides).toBeUndefined();
  });
});
