import { deepClone } from '../core/opc/deepClone';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine, type EditorEvent } from '../engine';
import { addTextBox, insertTable, setShapeRichText } from '../core/model/edit';
import { importDeck } from '../core/model/import';
import {
  tableCell,
  tableCellText,
  tableColumns,
  tableRows
} from '../core/model/table';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  ),
  (value) => value.charCodeAt(0)
);

it('executes typed commands and publishes serializable snapshots and invalidations', () => {
  const deck = importDeck(fixture);
  const engine = new PptxEditorEngine(deck);
  const events: EditorEvent[] = [];
  const unsubscribe = engine.subscribe((event) => events.push(event));
  const slide = deck.slides[0];
  const before = engine.snapshot().document!.slides[0].sizeEMU;

  const changed = engine.execute({
    type: 'set-slide-size',
    slideId: slide.path,
    cx: before.cx + 914400,
    cy: before.cy
  });
  expect(changed.changed).toBe(true);
  expect(changed.invalidations).toEqual([
    { kind: 'slide', slideId: slide.path }
  ]);
  expect(changed.snapshot).toMatchObject({
    dirty: true,
    canUndo: true,
    canRedo: false,
    undoLabel: 'Resize slide'
  });
  expect(changed.snapshot.document!.slides[0].sizeEMU.cx).toBe(
    before.cx + 914400
  );
  expect(events.map((event) => event.kind)).toEqual(['change']);

  const undone = engine.undo();
  expect(undone.snapshot.document!.slides[0].sizeEMU).toEqual(before);
  expect(undone.snapshot).toMatchObject({
    dirty: false,
    canUndo: false,
    canRedo: true
  });
  const redone = engine.redo();
  expect(redone.snapshot.document!.slides[0].sizeEMU.cx).toBe(
    before.cx + 914400
  );
  expect(events.map((event) => event.kind)).toEqual(['change', 'undo', 'redo']);
  expect(engine.exportPptx().size).toBeGreaterThan(0);
  unsubscribe();
});

it('applies JSON through the same transaction path and clears redo after a new command', () => {
  const deck = importDeck(fixture);
  const engine = new PptxEditorEngine(deck);
  const slide = deck.slides[0];
  const initial = engine.snapshot().document!.slides[0];
  const shape = initial.shapes.find((candidate) => candidate.frameEMU)!;
  const draft = deepClone(initial);
  draft.shapes.find(
    (candidate) => candidate.id === shape.id
  )!.frameEMU!.x += 100000;

  const applied = engine.applySlideJson(slide.path, draft);
  expect(applied.changed).toBe(true);
  expect(applied.invalidations).toEqual([
    { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
  ]);
  expect(applied.snapshot.undoLabel).toBe('Edit slide JSON');

  engine.undo();
  expect(engine.canRedo()).toBe(true);
  const currentSize = engine.snapshot().document!.slides[0].sizeEMU;
  engine.execute({
    type: 'set-slide-size',
    slideId: slide.path,
    cx: currentSize.cx,
    cy: currentSize.cy + 914400
  });
  expect(engine.canRedo()).toBe(false);
  expect(engine.snapshot()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
});

it('routes solid, gradient, and image backgrounds through typed history', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const engine = new PptxEditorEngine(deck);

  const solid = engine.execute({
    type: 'set-slide-background',
    slideId: slide.path,
    background: { type: 'solid', color: '112233' }
  });
  expect(solid.invalidations).toEqual([
    { kind: 'background', slideId: slide.path }
  ]);
  expect(solid.snapshot).toMatchObject({
    undoDepth: 1,
    undoLabel: 'Set slide background'
  });
  expect(solid.snapshot.document!.slides[0].background).toEqual({
    type: 'solid',
    color: '#112233'
  });

  const gradient = engine.execute({
    type: 'set-slide-background',
    slideId: slide.path,
    background: {
      type: 'gradient',
      color1: '112233',
      color2: 'AABBCC',
      angleDeg: 45
    }
  });
  expect(gradient.snapshot).toMatchObject({
    undoDepth: 2,
    undoLabel: 'Set gradient background'
  });
  expect(gradient.snapshot.document!.slides[0].background).toMatchObject({
    type: 'gradient',
    stops: [
      { posPct: 0, color: '#112233' },
      { posPct: 100, color: '#AABBCC' }
    ]
  });

  const image = engine.execute({
    type: 'set-slide-background',
    slideId: slide.path,
    background: { type: 'image', bytes: png, extension: 'png' }
  });
  expect(image.snapshot).toMatchObject({
    undoDepth: 3,
    undoLabel: 'Set background image'
  });
  expect(image.snapshot.document!.slides[0].background).toEqual({
    type: 'image'
  });
  expect(engine.exportPptx().size).toBeGreaterThan(0);

  expect(engine.undo().snapshot.document!.slides[0].background).toMatchObject({
    type: 'gradient'
  });
  expect(engine.redo().snapshot.document!.slides[0].background).toEqual({
    type: 'image'
  });
});

it('formats a selected text range as one typed command and restores it through history', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    914400,
    914400,
    3000000,
    900000,
    'Hello world'
  );
  const engine = new PptxEditorEngine(deck);

  const formatted = engine.execute({
    type: 'format-text',
    slideId: slide.path,
    shapeId: shape.id,
    ranges: [{ paragraph: 0, start: 0, end: 5 }],
    style: { color: 'FF0000', strike: true }
  });

  expect(formatted.changed).toBe(true);
  expect(formatted.invalidations).toEqual([
    { kind: 'shapes', slideId: slide.path, shapeIds: [shape.id] }
  ]);
  expect(formatted.snapshot.undoLabel).toBe('Format text');
  const formattedShape = formatted.snapshot.document!.slides[0].shapes.find(
    (candidate) => candidate.id === shape.id
  )!;
  expect(
    formattedShape.text!.paragraphs[0].runs.map((run) => [
      run.text,
      run.color,
      run.strike
    ])
  ).toEqual([
    ['Hello', '#FF0000', true],
    [' world', undefined, false]
  ]);

  const undone = engine.undo();
  const undoneShape = undone.snapshot.document!.slides[0].shapes.find(
    (candidate) => candidate.id === shape.id
  )!;
  expect(undoneShape.text!.paragraphs[0].runs.map((run) => run.text)).toEqual([
    'Hello world'
  ]);
  expect(
    engine
      .redo()
      .snapshot.document!.slides[0].shapes.find(
        (candidate) => candidate.id === shape.id
      )!.text!.paragraphs[0].runs[0]
  ).toMatchObject({ text: 'Hello', color: '#FF0000', strike: true });
});

it('routes paragraph formatting and rich-text replacement through typed history entries', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const shape = addTextBox(
    deck,
    slide,
    914400,
    914400,
    3000000,
    900000,
    'First'
  );
  setShapeRichText(deck, slide, shape, [
    { runs: [{ text: 'First' }] },
    { runs: [{ text: 'Second' }] }
  ]);
  const engine = new PptxEditorEngine(deck);

  engine.execute({
    type: 'set-paragraph-align',
    slideId: slide.path,
    shapeId: shape.id,
    align: 'ctr',
    paragraphIndexes: [1]
  });
  const bullet = engine.execute({
    type: 'set-paragraph-bullet',
    slideId: slide.path,
    shapeId: shape.id,
    bullet: { kind: 'autoNum', scheme: 'romanLcPeriod', startAt: 3 },
    paragraphIndexes: [0]
  });
  const edited = engine.execute({
    type: 'replace-rich-text',
    slideId: slide.path,
    shapeId: shape.id,
    paragraphs: [
      {
        sourceParagraph: 0,
        runs: [
          {
            text: 'Edited first',
            source: { paragraph: 0, run: 0 },
            styleChanged: false
          }
        ]
      },
      {
        sourceParagraph: 1,
        align: 'ctr',
        runs: [
          {
            text: 'Edited second',
            source: { paragraph: 1, run: 0 },
            styleChanged: false
          }
        ]
      }
    ]
  });

  expect(bullet.snapshot.undoLabel).toBe('Change bullets');
  expect(edited.snapshot).toMatchObject({
    undoDepth: 3,
    undoLabel: 'Edit text'
  });
  const paragraphs = edited.snapshot.document!.slides[0].shapes.find(
    (candidate) => candidate.id === shape.id
  )!.text!.paragraphs;
  expect(
    paragraphs.map((paragraph) =>
      paragraph.runs.map((run) => run.text).join('')
    )
  ).toEqual(['Edited first', 'Edited second']);
  expect(paragraphs[0].bullet).toMatchObject({
    kind: 'autoNum',
    scheme: 'romanLcPeriod',
    startAt: 3
  });
  expect(paragraphs[1].align).toBe('ctr');

  const undone = engine.undo();
  const priorParagraphs = undone.snapshot.document!.slides[0].shapes.find(
    (candidate) => candidate.id === shape.id
  )!.text!.paragraphs;
  expect(
    priorParagraphs.map((paragraph) =>
      paragraph.runs.map((run) => run.text).join('')
    )
  ).toEqual(['First', 'Second']);
  expect(priorParagraphs[0].bullet).toMatchObject({
    kind: 'autoNum',
    scheme: 'romanLcPeriod'
  });
  expect(priorParagraphs[1].align).toBe('ctr');
});

it('commits a multi-shape geometry gesture as one history entry', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const first = addTextBox(
    deck,
    slide,
    100000,
    200000,
    1000000,
    400000,
    'First'
  );
  const second = addTextBox(
    deck,
    slide,
    300000,
    400000,
    1000000,
    400000,
    'Second'
  );
  const before = [{ ...first.xfrm! }, { ...second.xfrm! }];
  const engine = new PptxEditorEngine(deck);

  const moved = engine.execute(
    {
      type: 'set-shape-geometries',
      slideId: slide.path,
      updates: [
        {
          shapeId: first.id,
          geometry: { x: before[0].x + 50000, y: before[0].y + 70000 }
        },
        {
          shapeId: second.id,
          geometry: { x: before[1].x + 50000, y: before[1].y + 70000 }
        }
      ]
    },
    { label: 'Move shapes' }
  );

  expect(moved.snapshot).toMatchObject({
    undoDepth: 1,
    undoLabel: 'Move shapes'
  });
  expect(moved.invalidations).toEqual([
    { kind: 'shapes', slideId: slide.path, shapeIds: [first.id, second.id] }
  ]);
  expect([first.xfrm!.x, second.xfrm!.x]).toEqual([
    before[0].x + 50000,
    before[1].x + 50000
  ]);

  engine.undo();
  expect([first.xfrm, second.xfrm]).toMatchObject(before);
});

it('commits compound table operations as one typed history entry', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 2, 2, 100000, 200000, 2000000, 800000);
  const beforeWidth = Number(tableColumns(table)[0][':@']?.w);
  const engine = new PptxEditorEngine(deck);

  const edited = engine.execute(
    {
      type: 'edit-table',
      slideId: slide.path,
      shapeId: table.id,
      operations: [
        { kind: 'set-cell-text', row: 1, col: 1, value: 'Edited' },
        { kind: 'add-row' },
        { kind: 'set-column-width', index: 0, width: beforeWidth + 100000 },
        {
          kind: 'style-cells',
          range: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
          style: { bold: true, fill: 'FF0000' }
        }
      ]
    },
    { label: 'Edit table' }
  );

  expect(edited.snapshot).toMatchObject({
    undoDepth: 1,
    undoLabel: 'Edit table'
  });
  expect(edited.invalidations).toEqual([
    { kind: 'shapes', slideId: slide.path, shapeIds: [table.id] }
  ]);
  expect(tableRows(table)).toHaveLength(3);
  expect(tableCellText(tableCell(table, 1, 1))).toBe('Edited');
  expect(Number(tableColumns(table)[0][':@']?.w)).toBe(beforeWidth + 100000);

  engine.undo();
  const restored = slide.shapes.find((shape) => shape.id === table.id)!;
  expect(tableRows(restored)).toHaveLength(2);
  expect(tableCellText(tableCell(restored, 1, 1))).toBe('');
  expect(Number(tableColumns(restored)[0][':@']?.w)).toBe(beforeWidth);
});

it('inserts, reorders, and deletes shapes through typed structural commands', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const initialCount = slide.shapes.length;
  const engine = new PptxEditorEngine(deck);

  const insertedText = engine.execute(
    {
      type: 'insert-shape',
      slideId: slide.path,
      shape: {
        kind: 'text-box',
        x: 100000,
        y: 200000,
        cx: 1200000,
        cy: 400000,
        text: 'Created'
      }
    },
    { label: 'Insert text box' }
  );
  const textId = insertedText.createdShapeIds[0];
  expect(insertedText).toMatchObject({
    changed: true,
    createdShapeIds: [textId],
    invalidations: [
      { kind: 'structure', slideId: slide.path, shapeIds: [textId] }
    ]
  });
  expect(insertedText.snapshot).toMatchObject({
    undoDepth: 1,
    undoLabel: 'Insert text box'
  });

  const insertedTable = engine.execute({
    type: 'insert-shape',
    slideId: slide.path,
    shape: {
      kind: 'table',
      rows: 2,
      columns: 3,
      x: 200000,
      y: 700000,
      cx: 2400000,
      cy: 800000
    }
  });
  const tableId = insertedTable.createdShapeIds[0];
  expect(slide.shapes).toHaveLength(initialCount + 2);
  expect(slide.shapes.at(-1)?.id).toBe(tableId);

  const reordered = engine.execute({
    type: 'reorder-shape',
    slideId: slide.path,
    shapeId: textId,
    operation: 'front'
  });
  expect(reordered.invalidations).toEqual([
    { kind: 'structure', slideId: slide.path, shapeIds: [textId] }
  ]);
  expect(slide.shapes.at(-1)?.id).toBe(textId);

  const deleted = engine.execute({
    type: 'delete-shapes',
    slideId: slide.path,
    shapeIds: [textId, tableId, textId]
  });
  expect(deleted.snapshot).toMatchObject({
    undoDepth: 4,
    undoLabel: 'Delete shapes'
  });
  expect(deleted.invalidations).toEqual([
    { kind: 'structure', slideId: slide.path, shapeIds: [textId, tableId] }
  ]);
  expect(slide.shapes).toHaveLength(initialCount);

  engine.undo();
  expect(slide.shapes.some((shape) => shape.id === textId)).toBe(true);
  expect(slide.shapes.some((shape) => shape.id === tableId)).toBe(true);
  expect(slide.shapes.at(-1)?.id).toBe(textId);
  engine.redo();
  expect(slide.shapes).toHaveLength(initialCount);
});
