import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';
import { slideNumberShapes } from '../core/model/edit';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);

describe('deck-wide slide numbers', () => {
  it('toggles slide numbers on and off across every slide as one entry', () => {
    const engine = new PptxEditorEngine();
    engine.load(fixture);
    const deck = (engine as any).deck;

    engine.execute({ type: 'toggle-deck-slide-numbers', enabled: true });
    for (const slide of deck.slides)
      expect(slideNumberShapes(slide)).toHaveLength(1);
    expect(engine.snapshot().undoDepth).toBe(1);

    // Toggling on again is a no-op (no duplicate boxes, no history entry).
    const repeat = engine.execute({
      type: 'toggle-deck-slide-numbers',
      enabled: true
    });
    expect(repeat.changed).toBe(false);
    for (const slide of deck.slides)
      expect(slideNumberShapes(slide)).toHaveLength(1);

    engine.execute({ type: 'toggle-deck-slide-numbers', enabled: false });
    for (const slide of deck.slides)
      expect(slideNumberShapes(slide)).toHaveLength(0);

    engine.undo();
    for (const slide of deck.slides)
      expect(slideNumberShapes(slide)).toHaveLength(1);
    engine.dispose();
  });

  it('re-toggling on fills only slides missing a number (per-slide opt-out)', () => {
    const engine = new PptxEditorEngine();
    engine.load(fixture);
    const deck = (engine as any).deck;
    engine.execute({ type: 'toggle-deck-slide-numbers', enabled: true });
    // The user deletes one slide's number box: that slide is opted out.
    const optOut = deck.slides[2];
    engine.execute({
      type: 'delete-shapes',
      slideId: optOut.path,
      shapeIds: [slideNumberShapes(optOut)[0].id]
    });
    expect(slideNumberShapes(optOut)).toHaveLength(0);
    expect(slideNumberShapes(deck.slides[0])).toHaveLength(1);
    engine.dispose();
  });
});
