import { resolve } from 'path';
import { readFileSync } from 'fs';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { setShapeRichText, type RichPara } from '../core/model/edit';
import { child, childrenOf, el, getAttr } from '../core/opc/xml';

const fixture = resolve(__dirname, 'fixtures/sample.pptx');
const bytes = () => new Uint8Array(readFileSync(fixture));

function firstTextShape(deck: ReturnType<typeof importDeck>) {
  for (const slide of deck.slides) {
    const shape = slide.shapes.find((s) => s.text);
    if (shape) return { slide, shape };
  }
  throw new Error('no text shape in fixture');
}

describe('setShapeRichText (rich-text commit)', () => {
  it('writes multiple runs with per-run formatting that survive round trip', () => {
    const deck = importDeck(bytes());
    const { slide, shape } = firstTextShape(deck);
    const paras: RichPara[] = [
      {
        align: 'ctr',
        runs: [
          { text: 'Hello there ', bold: false },
          { text: 'world', italic: true }
        ]
      }
    ];
    setShapeRichText(deck, slide, shape, paras);

    const out = importDeck(exportDeckBytes(deck));
    const os = out.slides
      .find((s) => s.path === slide.path)!
      .shapes.find((s) => s.id === shape.id)!;
    const runs = os.text!.paragraphs[0].runs;
    expect(runs.map((r) => r.text)).toEqual(['Hello there ', 'world']); // trailing space preserved
    expect(runs[0].bold ?? false).toBe(false);
    expect(runs[1].italic).toBe(true);
    expect(
      out.slides
        .find((s) => s.path === slide.path)!
        .shapes.find((s) => s.id === shape.id)!.text!.paragraphs[0].align
    ).toBe('ctr');
  });

  it('preserves a paragraph bullet (pPr) when its text is edited', () => {
    const bulletsFix = resolve(__dirname, 'fixtures/bullets.pptx');
    const deck = importDeck(new Uint8Array(readFileSync(bulletsFix)));
    // the shape whose first paragraph has an explicit buChar
    let target: {
      slide: typeof deck.slides[number];
      shape: typeof deck.slides[number]['shapes'][number];
    } | null = null;
    for (const slide of deck.slides) {
      const shape = slide.shapes.find((s) =>
        s.text?.paragraphs.some((p) => p.bullet?.kind === 'char')
      );
      if (shape) {
        target = { slide, shape };
        break;
      }
    }
    expect(target).not.toBeNull();
    const { slide, shape } = target!;
    // edit the text of every paragraph (same paragraph count)
    const paras: RichPara[] = shape.text!.paragraphs.map((p, i) => ({
      align: p.align,
      runs: [{ text: `edited ${i}` }]
    }));
    setShapeRichText(deck, slide, shape, paras);

    const out = importDeck(exportDeckBytes(deck));
    const os = out.slides
      .find((s) => s.path === slide.path)!
      .shapes.find((s) => s.id === shape.id)!;
    expect(os.text!.paragraphs[0].runs[0].text).toBe('edited 0'); // text changed
    expect(os.text!.paragraphs[0].bullet?.kind).toBe('char'); // bullet survived
  });

  it('replaces prior content rather than appending', () => {
    const deck = importDeck(bytes());
    const { slide, shape } = firstTextShape(deck);
    setShapeRichText(deck, slide, shape, [{ runs: [{ text: 'only' }] }]);
    const allText = shape
      .text!.paragraphs.flatMap((p) => p.runs)
      .map((r) => r.text)
      .join('');
    expect(allText).toBe('only');
  });

  it('preserves run-level hyperlink XML and end-paragraph properties for edited source text', () => {
    const deck = importDeck(bytes());
    const { slide, shape } = firstTextShape(deck);
    const para = shape.text!.paragraphs[0];
    const run = para.runs[0];
    const rPr = run.rPr || el('a:rPr');
    if (!run.rPr) childrenOf(run.node).unshift(rPr);
    childrenOf(rPr).push(
      el('a:hlinkClick', { 'r:id': 'rId99', tooltip: 'keep me' })
    );
    childrenOf(para.node).push(
      el('a:endParaRPr', { lang: 'fr-CA', sz: '1800' })
    );

    setShapeRichText(deck, slide, shape, [
      {
        runs: [
          {
            text: 'edited',
            source: { paragraph: 0, run: 0 },
            bold: !!run.bold,
            italic: !!run.italic,
            underline: !!run.underline,
            strike: !!run.strike,
            sizePt: run.sizePt,
            color: run.color,
            font: run.font
          }
        ]
      }
    ]);

    const out = importDeck(exportDeckBytes(deck));
    const os = out.slides
      .find((s) => s.path === slide.path)!
      .shapes.find((s) => s.id === shape.id)!;
    const edited = os.text!.paragraphs[0];
    expect(edited.runs[0].text).toBe('edited');
    expect(getAttr(child(edited.runs[0].rPr!, 'a:hlinkClick')!, 'r:id')).toBe(
      'rId99'
    );
    expect(getAttr(child(edited.node, 'a:endParaRPr')!, 'lang')).toBe('fr-CA');
  });

  it('keeps sparse run properties sparse when only source text changes', () => {
    const deck = importDeck(bytes());
    const { slide, shape } = firstTextShape(deck);
    const run = shape.text!.paragraphs[0].runs[0];
    const originalBold = getAttr(run.rPr!, 'b');
    setShapeRichText(deck, slide, shape, [
      {
        runs: [
          {
            text: 'new text',
            source: { paragraph: 0, run: 0 },
            styleChanged: false,
            bold: true,
            sizePt: 24
          }
        ]
      }
    ]);
    const updated = shape.text!.paragraphs[0].runs[0];
    expect(updated.text).toBe('new text');
    expect(getAttr(updated.rPr!, 'b')).toBe(originalBold);
  });
});
