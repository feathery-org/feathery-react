import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createPptxEditorStore } from '../state/PptxEditorStore';
import { renderSlideSvg } from '../core/render/svg';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);

function loadedStore() {
  const store = createPptxEditorStore();
  store.loadFile(fixture, 'sample.pptx');
  return store;
}

describe('PptxEditorStore instance isolation', () => {
  it('keeps selection, history and dirty state isolated between instances', () => {
    const a = loadedStore();
    const b = loadedStore();

    const slideA = a.getState().deck!.slides[0];
    const shapeA = slideA.shapes.find((shape) => shape.xfrm)!;
    a.select(shapeA.id);
    a.executeCommand({
      type: 'set-shape-geometries',
      slideId: slideA.path,
      updates: [{ shapeId: shapeA.id, geometry: { x: 123456 } }]
    });

    expect(a.getState().selectedId).toBe(shapeA.id);
    expect(a.getState().undoStack.length).toBe(1);
    expect(a.engine.snapshot().dirty).toBe(true);

    expect(b.getState().selectedId).toBeNull();
    expect(b.getState().undoStack.length).toBe(0);
    expect(b.engine.snapshot().dirty).toBe(false);
    expect(b.getState().rev).toBe(1);

    a.dispose();
    // Disposing one editor leaves the other fully functional.
    expect(b.engine.snapshot().document?.slideCount).toBe(9);
    b.dispose();
  });

  it('renders two isolated SVG targets with disjoint definition ids', () => {
    const a = loadedStore();
    const b = loadedStore();
    for (const store of [a, b]) {
      // Guarantee at least one <defs> entry per instance.
      store.executeCommand(
        {
          type: 'set-slide-background',
          slideId: store.getState().deck!.slides[0].path,
          background: {
            type: 'gradient',
            color1: '1F4E79',
            color2: 'C0143C',
            angleDeg: 90
          }
        },
        undefined,
        { render: false }
      );
    }
    const stateA = a.getState();
    const stateB = b.getState();
    const svgA = renderSlideSvg(stateA.deck!, stateA.deck!.slides[0]);
    const svgB = renderSlideSvg(stateB.deck!, stateB.deck!.slides[0]);
    const ids = (svg: SVGSVGElement) =>
      Array.from(svg.querySelectorAll('defs [id]')).map((el) => el.id);
    const idsA = ids(svgA);
    const idsB = new Set(ids(svgB));
    expect(idsA.length).toBeGreaterThan(0);
    expect(idsA.filter((id) => idsB.has(id))).toEqual([]);
    a.dispose();
    b.dispose();
  });

  it('undo commits an in-flight text edit first and clears transient selection state', () => {
    const store = loadedStore();
    const slide = store.getState().deck!.slides[0];
    const shape = slide.shapes.find((candidate) => candidate.text)!;
    const committed: string[] = [];
    store.setCommitSvgTextEdit(() => {
      committed.push('commit');
      store.setCommitSvgTextEdit(null);
      store.executeCommand(
        {
          type: 'replace-rich-text',
          slideId: slide.path,
          shapeId: shape.id,
          paragraphs: [{ runs: [{ text: 'typed mid-edit' }] }]
        },
        'Edit text',
        { render: false }
      );
    });
    store.undo();
    expect(committed).toEqual(['commit']);
    // The committed edit became the top history entry and undo reversed it.
    expect(store.getState().redoStack.length).toBe(1);
    store.dispose();
  });

  it('resets local state when a second document is loaded', () => {
    const store = loadedStore();
    const slide = store.getState().deck!.slides[0];
    const shape = slide.shapes.find((candidate) => candidate.xfrm)!;
    store.select(shape.id);
    store.executeCommand({
      type: 'set-shape-geometries',
      slideId: slide.path,
      updates: [{ shapeId: shape.id, geometry: { x: 99999 } }]
    });
    const firstDeck = store.getState().deck;
    store.loadFile(fixture, 'second.pptx');
    expect(store.getState().deck).not.toBe(firstDeck);
    expect(store.getState().fileName).toBe('second.pptx');
    expect(store.getState().selectedId).toBeNull();
    expect(store.getState().undoStack.length).toBe(0);
    expect(store.engine.snapshot().dirty).toBe(false);
    store.dispose();
  });
});
