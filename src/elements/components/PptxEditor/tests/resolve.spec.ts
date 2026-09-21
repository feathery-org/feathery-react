import { resolve } from 'path';
import { readFileSync } from 'fs';
import { importDeck } from '../core/model/import';
import { resolveListProps } from '../core/model/resolve';

const fx = resolve(__dirname, 'fixtures/inherited.pptx');

describe('inheritance resolver', () => {
  it('resolves inherited placeholder geometry into the model', () => {
    const deck = importDeck(new Uint8Array(readFileSync(fx)));
    const shapes = deck.slides[0].shapes;
    // both placeholders (title + body) inherit geometry from the layout/master
    expect(shapes.length).toBeGreaterThanOrEqual(2);
    expect(shapes.every((s) => !!s.xfrm)).toBe(true);
  });

  it('resolves inherited bullets from the master/layout list style', () => {
    const deck = importDeck(new Uint8Array(readFileSync(fx)));
    const slide = deck.slides[0];
    const body = slide.shapes.find((s) => s.name.startsWith('Content'))!;
    expect(body).toBeTruthy();
    // paragraphs have no explicit bullet, but the resolver finds one from the master body style
    const bulletless = body.text!.paragraphs.every(
      (p) => p.bullet === undefined
    );
    expect(bulletless).toBe(true);
    const resolved = resolveListProps(deck, slide, body, 0);
    expect(resolved.bullet?.kind).toBe('char');
  });
});
