import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';

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
      { label: 'Suggest italics', origin: 'assistant', authorLabel: 'Assistant' }
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
      engine.changes().some((candidate) => candidate.summary === 'Reject suggestion')
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
});
