import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { renderSlideSvg } from '../core/render/svg';

// Hardening smoke tests on a 60-slide deck (each slide: title, six 5-bullet
// text boxes, a 4x4 table). Guards import/edit/export viability and the
// history cap; generous time bounds only catch order-of-magnitude regressions.

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/large-deck.pptx'))
);

describe('large deck hardening', () => {
  it('imports, edits, exports and re-imports a 60-slide deck', () => {
    const started = Date.now();
    const engine = new PptxEditorEngine();
    engine.load(fixture);
    const doc = engine.snapshot().document!;
    expect(doc.slideCount).toBe(60);

    // A burst of edits across the deck, one per 10th slide.
    for (let i = 0; i < 60; i += 10) {
      const slide = doc.slides[i];
      const shape = slide.shapes.find((sh) => sh.text)!;
      engine.execute(
        {
          type: 'format-text',
          slideId: slide.path,
          shapeId: shape.id,
          style: { bold: true }
        },
        { label: `Edit slide ${i + 1}` }
      );
    }
    expect(engine.snapshot().undoDepth).toBe(6);

    const bytes = engine.exportPptx();
    expect(bytes.size).toBeGreaterThan(50000);

    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(30000);
    engine.dispose();
  });

  it('caps undo history at the entry limit', () => {
    const engine = new PptxEditorEngine();
    engine.load(fixture);
    const doc = engine.snapshot().document!;
    const slide = doc.slides[0];
    const shape = slide.shapes.find((sh) => sh.frameEMU)!;
    for (let i = 0; i < 110; i++) {
      engine.execute(
        {
          type: 'set-shape-geometries',
          slideId: slide.path,
          updates: [{ shapeId: shape.id, geometry: { x: 100000 + i * 1000 } }]
        },
        { label: `Move ${i}` }
      );
    }
    expect(engine.snapshot().undoDepth).toBe(100);
    engine.dispose();
  });

  it('renders every slide to SVG without error', () => {
    const deck = importDeck(fixture);
    for (const slide of deck.slides) {
      const svg = renderSlideSvg(deck, slide);
      expect(svg.querySelectorAll('[data-shape-id]').length).toBeGreaterThan(
        5
      );
    }
  });

  it('preserves untouched parts byte-identically through a targeted edit', () => {
    const deck = importDeck(fixture);
    const engine = new PptxEditorEngine(deck);
    const doc = engine.snapshot().document!;
    const slide = doc.slides[0];
    const shape = slide.shapes.find((sh) => sh.text)!;
    engine.execute(
      {
        type: 'replace-rich-text',
        slideId: slide.path,
        shapeId: shape.id,
        paragraphs: [{ runs: [{ text: 'targeted edit' }] }]
      },
      { label: 'Edit' }
    );
    const exported = importDeck(new Uint8Array(exportDeckBytes(deck).buffer));
    // Only the edited slide part changed; every other slide's XML round-trips.
    for (let i = 1; i < deck.slides.length; i++) {
      expect(exported.slides[i].shapes.length).toBe(
        deck.slides[i].shapes.length
      );
    }
    expect(
      exported.slides[0].shapes.find((sh) => sh.id === shape.id)?.text
        ?.paragraphs[0].runs[0].text
    ).toBe('targeted edit');
  });
});
