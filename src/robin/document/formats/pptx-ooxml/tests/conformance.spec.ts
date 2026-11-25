import { readdirSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../../../../../elements/components/PptxEditor/engine/PptxEditorEngine';
import type { EditorCommand } from '../../../../../elements/components/PptxEditor/engine/commands';
import { conformanceProblems } from '../../../pack';
import { canonicalJson } from '../../../tree';
import { pptxPack } from '../index';
import { serializeDeck } from '../native';
import { fixture } from './harness';

const FIXTURES = readdirSync(
  resolve(__dirname, '../../../../../elements/components/PptxEditor/tests/fixtures')
).filter((name) => name.endsWith('.pptx'));

function engineWith(name: string, ...suggestions: Array<(engine: PptxEditorEngine) => EditorCommand>) {
  const engine = new PptxEditorEngine();
  engine.load(fixture(name));
  suggestions.forEach((command, i) =>
    engine.execute(command(engine), { origin: 'assistant', authorId: `turn-${i}` })
  );
  return engine;
}

const firstSlide = (engine: PptxEditorEngine) => engine.readDeck()!.slides[0];
const textShape = (engine: PptxEditorEngine) =>
  firstSlide(engine).shapes.find((shape) => shape.text)!;
const bold = (engine: PptxEditorEngine): EditorCommand => ({
  type: 'format-text',
  slideId: firstSlide(engine).path,
  shapeId: textShape(engine).id,
  style: { bold: true }
});

describe('PowerPoint pack conformance', () => {
  it('round-trips every fixture deck byte-exact', () => {
    const decks = Object.fromEntries(
      FIXTURES.map((name) => [name, serializeDeck(engineWith(name))])
    );
    expect(conformanceProblems(pptxPack, decks)).toEqual([]);
  });

  it('round-trips decks holding each kind of suggestion', () => {
    const decks = {
      format: serializeDeck(engineWith('sample.pptx', bold)),
      chained: serializeDeck(engineWith('sample.pptx', bold, (engine) => ({ ...bold(engine), style: { italic: true } } as EditorCommand))),
      deleteShape: serializeDeck(
        engineWith('sample.pptx', (engine) => ({
          type: 'delete-shapes',
          slideId: firstSlide(engine).path,
          shapeIds: [textShape(engine).id]
        }))
      ),
      addSlide: serializeDeck(
        engineWith('sample.pptx', (engine) => ({
          type: 'add-slide',
          atIndex: 1,
          duplicateOf: firstSlide(engine).path
        }))
      ),
      deleteSlide: serializeDeck(
        engineWith('sample.pptx', (engine) => ({
          type: 'delete-slide',
          slideId: engine.readDeck()!.slides[2].path
        }))
      ),
      moveSlide: serializeDeck(
        engineWith('sample.pptx', () => ({ type: 'move-slide', fromIndex: 0, toIndex: 3 }))
      )
    };
    expect(conformanceProblems(pptxPack, decks)).toEqual([]);
  });

  it('shows a suggestion so rejecting it gives the deck before it', () => {
    const cases: Array<(engine: PptxEditorEngine) => EditorCommand> = [
      bold,
      (engine) => ({ type: 'delete-shapes', slideId: firstSlide(engine).path, shapeIds: [textShape(engine).id] }),
      (engine) => ({ type: 'add-slide', atIndex: 1, duplicateOf: firstSlide(engine).path }),
      (engine) => ({ type: 'delete-slide', slideId: engine.readDeck()!.slides[2].path }),
      () => ({ type: 'move-slide', fromIndex: 0, toIndex: 3 })
    ];
    for (const command of cases) {
      const plain = pptxPack.adapter.toNormalForm(serializeDeck(engineWith('sample.pptx'))).nf;
      const suggested = pptxPack.adapter.toNormalForm(serializeDeck(engineWith('sample.pptx', command))).nf;
      const content = (nf: typeof plain) =>
        // ids are minted per read, and the layout's formatting is not kept on a removed copy
        canonicalJson(
          JSON.parse(JSON.stringify(nf), (key, value) =>
            key === 'id' || key === 'inherited' ? undefined : value
          )
        );
      expect(content(pptxPack.projections.reject(suggested))).toBe(content(plain));
    }
  });
});
