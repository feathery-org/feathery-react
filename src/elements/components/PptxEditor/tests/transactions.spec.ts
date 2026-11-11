import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine } from '../engine/PptxEditorEngine';
import { canUngroup } from '../core/model/groups';
import type { EditorCommand } from '../engine/commands';

const marketingDeck = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/marketing-parity.pptx'))
);

const onePixelPng = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120,
  156, 99, 248, 15, 4, 0, 9, 251, 3, 253, 227, 85, 242, 156, 0, 0, 0, 0, 73, 69,
  78, 68, 174, 66, 96, 130
]);

interface DeckTargets {
  slideId: string;
  otherSlideId: string;
  textShapeId: string;
  pictureId: string;
  groupId: string;
  tableId: string;
}

function loadedEngine(): { engine: PptxEditorEngine; targets: DeckTargets } {
  const engine = new PptxEditorEngine();
  engine.load(marketingDeck);
  const deck = engine.readDeck()!;
  const slide = deck.slides[2];
  const table = engine.execute({
    type: 'insert-shape',
    slideId: slide.path,
    shape: {
      kind: 'table',
      rows: 2,
      columns: 2,
      x: 0,
      y: 0,
      cx: 914400,
      cy: 457200
    }
  });
  return {
    engine,
    targets: {
      slideId: slide.path,
      otherSlideId: deck.slides[3].path,
      textShapeId: slide.shapes.find((shape) => shape.type === 'text')!.id,
      pictureId: slide.shapes.find((shape) => shape.type === 'pic')!.id,
      groupId: slide.shapes.find((shape) => canUngroup(shape))!.id,
      tableId: table.createdShapeIds[0]
    }
  };
}

const commandFor: {
  [Type in EditorCommand['type']]: (
    targets: DeckTargets
  ) => Extract<EditorCommand, { type: Type }>;
} = {
  'set-presentation-size': () => ({
    type: 'set-presentation-size',
    cx: 9144000,
    cy: 6858000
  }),
  'set-slide-background': ({ slideId }) => ({
    type: 'set-slide-background',
    slideId,
    background: { type: 'solid', color: 'FF0000' }
  }),
  'format-text': ({ slideId, textShapeId }) => ({
    type: 'format-text',
    slideId,
    shapeId: textShapeId,
    style: { bold: true, sizePt: 31 }
  }),
  'set-paragraph-align': ({ slideId, textShapeId }) => ({
    type: 'set-paragraph-align',
    slideId,
    shapeId: textShapeId,
    align: 'just'
  }),
  'set-paragraph-bullet': ({ slideId, textShapeId }) => ({
    type: 'set-paragraph-bullet',
    slideId,
    shapeId: textShapeId,
    bullet: { kind: 'char', char: '-' }
  }),
  'replace-rich-text': ({ slideId, textShapeId }) => ({
    type: 'replace-rich-text',
    slideId,
    shapeId: textShapeId,
    paragraphs: [{ runs: [{ text: 'Rewritten by the assistant' }] }]
  }),
  'set-shape-geometries': ({ slideId, textShapeId }) => ({
    type: 'set-shape-geometries',
    slideId,
    updates: [{ shapeId: textShapeId, geometry: { x: 123456 } }]
  }),
  'set-picture-crop': ({ slideId, pictureId }) => ({
    type: 'set-picture-crop',
    slideId,
    shapeId: pictureId,
    crop: {
      clipGeometry: 'ellipse',
      cropPct: { left: 10, top: 0, right: 0, bottom: 0 }
    }
  }),
  'edit-table': ({ slideId, tableId }) => ({
    type: 'edit-table',
    slideId,
    shapeId: tableId,
    operations: [{ kind: 'add-row' }]
  }),
  'insert-shape': ({ slideId }) => ({
    type: 'insert-shape',
    slideId,
    shape: {
      kind: 'image',
      bytes: onePixelPng,
      extension: 'png',
      x: 0,
      y: 0,
      cx: 9525,
      cy: 9525
    }
  }),
  'toggle-deck-slide-numbers': () => ({
    type: 'toggle-deck-slide-numbers',
    enabled: true
  }),
  'set-shape-fill': ({ slideId, textShapeId }) => ({
    type: 'set-shape-fill',
    slideId,
    shapeId: textShapeId,
    color: '00FF00'
  }),
  'set-line-color': ({ slideId, textShapeId }) => ({
    type: 'set-line-color',
    slideId,
    shapeId: textShapeId,
    color: '0000FF'
  }),
  'delete-shapes': ({ slideId, textShapeId }) => ({
    type: 'delete-shapes',
    slideId,
    shapeIds: [textShapeId]
  }),
  'ungroup-shape': ({ slideId, groupId }) => ({
    type: 'ungroup-shape',
    slideId,
    shapeId: groupId
  }),
  'reorder-shape': ({ slideId, textShapeId }) => ({
    type: 'reorder-shape',
    slideId,
    shapeId: textShapeId,
    operation: 'front'
  }),
  'add-slide': () => ({ type: 'add-slide', atIndex: 1 }),
  'delete-slide': ({ otherSlideId }) => ({
    type: 'delete-slide',
    slideId: otherSlideId
  }),
  'move-slide': () => ({ type: 'move-slide', fromIndex: 3, toIndex: 5 })
};

describe('engine transactions', () => {
  it.each(Object.keys(commandFor) as EditorCommand['type'][])(
    '%s inside a transaction lands as one undo entry and one record',
    (type) => {
      const { engine, targets } = loadedEngine();
      const before = engine.snapshot();
      const recordsBefore = engine.changes().length;
      const command = commandFor[type](targets) as EditorCommand;
      engine.transaction({ origin: 'assistant', authorId: 'turn-1' }, () => {
        engine.execute(command);
        engine.execute({
          type: 'set-slide-background',
          slideId: engine.readDeck()!.slides[0].path,
          background: { type: 'solid', color: '123456' }
        });
      });

      expect(engine.snapshot().undoDepth).toBe(before.undoDepth + 1);
      const added = engine.changes().slice(recordsBefore);
      expect(added).toHaveLength(1);
      expect(added[0].status).toBe('pending');
      expect(added[0].author.id).toBe('turn-1');
      engine.undo();
      expect(engine.snapshot().document).toEqual(before.document);
    }
  );

  it('emits one change event for the whole transaction', () => {
    const { engine, targets } = loadedEngine();
    const events: string[] = [];
    engine.subscribe((event) => events.push(event.kind));
    engine.transaction({ label: 'Retitle' }, () => {
      engine.execute(commandFor['format-text'](targets));
      engine.execute(commandFor['set-shape-fill'](targets));
    });
    expect(events).toEqual(['change']);
    expect(engine.snapshot().undoLabel).toBe('Retitle');
  });

  it('keeps what ran before a failure as the one entry and rethrows, like an undo group', () => {
    const { engine, targets } = loadedEngine();
    const before = engine.snapshot();
    expect(() =>
      engine.transaction({ origin: 'assistant' }, () => {
        engine.execute(commandFor['format-text'](targets));
        engine.execute({
          type: 'delete-shapes',
          slideId: targets.slideId,
          shapeIds: ['no-such-shape']
        });
      })
    ).toThrow(/no-such-shape/);
    expect(engine.snapshot().undoDepth).toBe(before.undoDepth + 1);
    engine.undo();
    expect(engine.snapshot().document).toEqual(before.document);
  });

  it('joins a nested transaction into the open one', () => {
    const { engine, targets } = loadedEngine();
    const before = engine.snapshot();
    engine.transaction({}, () => {
      engine.execute(commandFor['format-text'](targets));
      engine.transaction({}, () =>
        engine.execute(commandFor['set-shape-fill'](targets))
      );
    });
    expect(engine.snapshot().undoDepth).toBe(before.undoDepth + 1);
  });

  it('records nothing when the commands change nothing', () => {
    const { engine } = loadedEngine();
    const before = engine.snapshot();
    engine.transaction({ origin: 'assistant' }, () => {});
    expect(engine.snapshot().undoDepth).toBe(before.undoDepth);
    expect(engine.pendingChangeCount()).toBe(0);
  });
});

it('lists each target once when a transaction edits the same shape twice', () => {
  const { engine, targets } = loadedEngine();
  engine.transaction({ origin: 'assistant' }, () => {
    engine.execute(commandFor['format-text'](targets));
    engine.execute(commandFor['set-shape-fill'](targets));
    engine.execute(commandFor['reorder-shape'](targets));
  });
  const record = engine.changes()[engine.changes().length - 1];
  expect(record.targets).toEqual([
    { slideId: targets.slideId, shapeId: targets.textShapeId }
  ]);
});
