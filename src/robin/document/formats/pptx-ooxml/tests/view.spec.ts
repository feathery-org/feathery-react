import { openDeck } from './harness';

describe('PowerPoint outline, pages and selection', () => {
  it('outlines the deck one line per slide, and a slide in full by its page', () => {
    const deck = openDeck();
    const outline = deck.call('outline', {}) as { lines: string };
    const lines = outline.lines.split('\n');
    expect(lines.every((line) => / slide /.test(line))).toBe(true);
    expect(lines).toHaveLength(deck.engine.readDeck()!.slides.length);

    const page = deck.call('outline', { pageNumber: 2, depth: 3 }) as {
      lines: string;
      page: string;
    };
    expect(page.page).toMatch(/^Page 2 of /);
    expect(page.lines).toMatch(/ paragraph /);
    expect(page.lines.split('\n').filter((line) => / slide /.test(line))).toHaveLength(1);
  });

  it('describes the selected shapes as the span of their text', () => {
    const deck = openDeck();
    const slide = deck.engine.readDeck()!.slides[0];
    const subtitle = slide.shapes.find((shape) =>
      shape.text?.paragraphs.some((p) => p.runs.some((r) => r.text === 'Company Name'))
    )!;
    deck.store.selectMany([subtitle.id]);
    const descriptor = deck.session.descriptor();
    expect(descriptor.selection).toEqual(
      expect.objectContaining({ text: 'Company Name' })
    );
  });
});
