import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { addSlide, deleteSlide } from '../core/model/slides';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);

function loadedEngine() {
  const engine = new PptxEditorEngine();
  engine.load(fixture);
  return engine;
}

const paths = (engine: PptxEditorEngine) =>
  engine.snapshot().document!.slides.map((s) => s.path);

describe('slide add / delete / duplicate', () => {
  it('adds a blank slide at an index and is undoable', () => {
    const engine = loadedEngine();
    const before = paths(engine);
    engine.execute({ type: 'add-slide', atIndex: 1 });
    const after = paths(engine);
    expect(after.length).toBe(before.length + 1);
    // Inserted at position 1; the surrounding order is preserved.
    expect(after[0]).toBe(before[0]);
    expect(after[2]).toBe(before[1]);
    const added = after[1];
    expect(before).not.toContain(added);

    engine.undo();
    expect(paths(engine)).toEqual(before);
    engine.redo();
    expect(paths(engine)).toEqual(after);
  });

  it('duplicates a slide, copying its shapes, and is undoable', () => {
    const engine = loadedEngine();
    const doc = engine.snapshot().document!;
    const sourceIndex = doc.slides.findIndex((s) => s.shapes.length > 0);
    const source = doc.slides[sourceIndex];
    const before = paths(engine);

    engine.execute({
      type: 'add-slide',
      atIndex: sourceIndex + 1,
      duplicateOf: source.path
    });
    const after = engine.snapshot().document!;
    expect(after.slides.length).toBe(before.length + 1);
    const copy = after.slides[sourceIndex + 1];
    expect(copy.path).not.toBe(source.path);
    // Same number of shapes as the source (body was cloned).
    expect(copy.shapes.length).toBe(source.shapes.length);

    engine.undo();
    expect(paths(engine)).toEqual(before);
  });

  it('deletes a slide and restores it (with content) on undo', () => {
    const engine = loadedEngine();
    const before = paths(engine);
    const victim = before[1];
    const victimJson = JSON.stringify(
      engine.snapshot().document!.slides.find((s) => s.path === victim)
    );

    engine.execute({ type: 'delete-slide', slideId: victim });
    expect(paths(engine)).not.toContain(victim);
    expect(paths(engine).length).toBe(before.length - 1);

    engine.undo();
    expect(paths(engine)).toEqual(before);
    // The restored slide keeps its shapes/content.
    const restored = JSON.stringify(
      engine.snapshot().document!.slides.find((s) => s.path === victim)
    );
    expect(restored).toBe(victimJson);
  });

  it('exports a valid package after add and delete (reimports cleanly)', () => {
    const deck = importDeck(fixture);
    const original = deck.slides.length;
    addSlide(deck, original); // blank at the end
    const dup = addSlide(deck, 0, deck.slides[deck.slides.length - 1].path);
    expect(dup).toBeTruthy();
    deleteSlide(deck, deck.slides[1].path);

    // original + 2 added - 1 deleted, and it re-imports and re-exports cleanly.
    const redeck = importDeck(new Uint8Array(exportDeckBytes(deck).buffer));
    expect(redeck.slides.length).toBe(original + 1);
    const again = importDeck(new Uint8Array(exportDeckBytes(redeck).buffer));
    expect(again.slides.length).toBe(original + 1);
  });
});
