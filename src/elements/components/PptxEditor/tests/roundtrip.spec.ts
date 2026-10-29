import { resolve } from 'path';
import { readFileSync } from 'fs';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import {
  setShapeText,
  setShapeGeometry,
  addTextBox,
  deleteShape
} from '../core/model/edit';
import { emuToPx } from '../core/model/units';

const fixture = resolve(__dirname, 'fixtures/sample.pptx');
const bytes = () => new Uint8Array(readFileSync(fixture));

describe('OPC + model round trip', () => {
  it('imports the deck: size + slides + shapes', () => {
    const deck = importDeck(bytes());
    expect(deck.slides.length).toBe(9);
    expect(deck.size.cx).toBeGreaterThan(0);
    expect(deck.size.cy).toBeGreaterThan(0);
    // slide 1 should have some shapes with geometry
    const s1 = deck.slides[0];
    expect(s1.shapes.length).toBeGreaterThan(0);
    const withText = s1.shapes.find(
      (s) =>
        s.text &&
        s.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))
    );
    expect(withText).toBeTruthy();
  });

  it('no-op export re-imports with the same slide count', () => {
    const deck = importDeck(bytes());
    const out = exportDeckBytes(deck);
    const deck2 = importDeck(out);
    expect(deck2.slides.length).toBe(deck.slides.length);
    expect(deck2.size).toEqual(deck.size);
  });

  it('edits text and it survives export -> reimport', () => {
    const deck = importDeck(bytes());
    // find first text shape on any slide
    let slideIdx = -1;
    let shape;
    for (let i = 0; i < deck.slides.length; i++) {
      const s = deck.slides[i].shapes.find(
        (sh) =>
          sh.text &&
          sh.text.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))
      );
      if (s) {
        slideIdx = i;
        shape = s;
        break;
      }
    }
    expect(shape).toBeTruthy();
    setShapeText(deck, deck.slides[slideIdx], shape!, 'HELLO ROUND TRIP');

    const out = exportDeckBytes(deck);
    const deck2 = importDeck(out);
    const found = deck2.slides[slideIdx].shapes.some((sh) =>
      sh.text?.paragraphs.some((p) =>
        p.runs.some((r) => r.text === 'HELLO ROUND TRIP')
      )
    );
    expect(found).toBe(true);
  });

  it('moves a shape and the new EMU offset survives round trip', () => {
    const deck = importDeck(bytes());
    const slide = deck.slides[0];
    const shape = slide.shapes.find((s) => s.xfrm)!;
    expect(shape).toBeTruthy();
    setShapeGeometry(deck, slide, shape, { x: 1234567, y: 2345678 });

    const out = exportDeckBytes(deck);
    const deck2 = importDeck(out);
    const moved = deck2.slides[0].shapes.find((s) => s.id === shape.id)!;
    expect(moved.xfrm!.x).toBe(1234567);
    expect(moved.xfrm!.y).toBe(2345678);
  });

  it('adds a text box and deletes a shape; both survive round trip', () => {
    const deck = importDeck(bytes());
    const slide = deck.slides[0];
    const before = slide.shapes.length;
    const box = addTextBox(
      deck,
      slide,
      500000,
      500000,
      2000000,
      800000,
      'NEW BOX'
    );
    expect(slide.shapes.length).toBe(before + 1);

    deleteShape(deck, slide, slide.shapes[0]);

    const out = exportDeckBytes(deck);
    const deck2 = importDeck(out);
    const hasBox = deck2.slides[0].shapes.some((s) =>
      s.text?.paragraphs.some((p) => p.runs.some((r) => r.text === 'NEW BOX'))
    );
    expect(hasBox).toBe(true);
    expect(box.xfrm && emuToPx(box.xfrm.cx)).toBeGreaterThan(0);
  });
});
