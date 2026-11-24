import { deepClone } from '../core/opc/deepClone';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PptxEditorEngine, type EditorEvent } from '../engine';
import { addTextBox, insertTable, setShapeRichText } from '../core/model/edit';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { deckToJSON } from '../core/model/json';
import {
  child,
  childrenOf,
  getAttr,
  root,
  tagOf,
  type ONode
} from '../core/opc/xml';
import {
  tableCell,
  tableCells,
  tableCellText,
  tableColumns,
  tableRows
} from '../core/model/table';

const fixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/sample.pptx'))
);
const bulletsFixture = new Uint8Array(
  readFileSync(resolve(__dirname, 'fixtures/bullets.pptx'))
);
const nativeSlideSize = (bytes: Uint8Array) => {
  const sldSz = child(
    root(importDeck(bytes).pkg.tree('ppt/presentation.xml')),
    'p:sldSz'
  )!;
  return {
    cx: Number(getAttr(sldSz, 'cx')),
    cy: Number(getAttr(sldSz, 'cy')),
    type: getAttr(sldSz, 'type')
  };
};
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
    type: 'set-presentation-size',
    cx: before.cx + 914400,
    cy: before.cy
  });
  expect(changed.changed).toBe(true);
  expect(changed.invalidations).toEqual([{ kind: 'deck' }]);
  expect(changed.snapshot).toMatchObject({
    dirty: true,
    canUndo: true,
    canRedo: false,
    undoLabel: 'Resize slides'
  });
  expect(slide.path).toBe(deck.slides[0].path);
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
    type: 'set-presentation-size',
    cx: currentSize.cx,
    cy: currentSize.cy + 914400
  });
  expect(engine.canRedo()).toBe(false);
  expect(engine.snapshot()).toMatchObject({ undoDepth: 1, redoDepth: 0 });
});

it.each([0, 914400])(
  'restores the native size preset after undo (delta %s)',
  (delta) => {
    const deck = importDeck(bulletsFixture);
    const original = nativeSlideSize(exportDeckBytes(deck));
    expect(original.type).toBe('screen4x3');
    const engine = new PptxEditorEngine(deck);

    engine.execute({
      type: 'set-presentation-size',
      cx: original.cx + delta,
      cy: original.cy
    });
    expect(nativeSlideSize(exportDeckBytes(deck)).type).toBeUndefined();
    expect(engine.isDirty()).toBe(true);

    engine.undo();
    expect(nativeSlideSize(exportDeckBytes(deck))).toEqual(original);
    expect(engine.isDirty()).toBe(false);

    engine.redo();
    expect(nativeSlideSize(exportDeckBytes(deck))).toEqual({
      cx: original.cx + delta,
      cy: original.cy,
      type: undefined
    });
    expect(engine.isDirty()).toBe(true);
  }
);

it('writes a resize to the native presentation size and restores it on undo', () => {
  const deck = importDeck(fixture);
  const engine = new PptxEditorEngine(deck);
  const original = { ...deck.size };
  const a4Portrait = { cx: 7560072, cy: 10689336 };

  engine.execute({ type: 'set-presentation-size', ...a4Portrait });
  expect(deck.size).toEqual(a4Portrait);
  // Every slide's projection follows the presentation-wide size.
  for (const slide of engine.snapshot().document!.slides)
    expect(slide.sizeEMU).toEqual(a4Portrait);
  const exported = exportDeckBytes(deck);
  expect(importDeck(exported).size).toEqual(a4Portrait);
  // PowerPoint reads p:sldSz, and a stale preset name must not contradict it.
  expect(nativeSlideSize(exported)).toEqual({ ...a4Portrait, type: undefined });

  const undone = engine.undo();
  expect(undone.invalidations).toEqual([{ kind: 'deck' }]);
  expect(deck.size).toEqual(original);
  expect(undone.snapshot.dirty).toBe(false);
  expect(nativeSlideSize(exportDeckBytes(deck))).toMatchObject(original);
});

it('does not reuse the previous document snapshot when adopting another deck', () => {
  const engine = new PptxEditorEngine();
  engine.load(fixture);
  // Same slide paths, size and (fresh) mutation sequence as the first deck:
  // exactly what structural snapshot reuse keys on.
  const edited = importDeck(fixture);
  addTextBox(
    edited,
    edited.slides[0],
    914400,
    914400,
    3000000,
    900000,
    'Second'
  );
  const second = exportDeckBytes(edited);
  engine.load(second);
  const expected = JSON.parse(JSON.stringify(deckToJSON(importDeck(second))));
  expect(engine.snapshot().document).toEqual(expected);

  // Also when the other deck differs in size (no path/sequence overlap).
  engine.load(bulletsFixture);
  expect(engine.snapshot().document).toEqual(
    JSON.parse(JSON.stringify(deckToJSON(importDeck(bulletsFixture))))
  );
  engine.load(second);
  expect(engine.snapshot().document).toEqual(expected);

  // Undo after an edit must restore the second deck, not the first one.
  const slide = engine.snapshot().document!.slides[0];
  engine.execute({
    type: 'set-slide-background',
    slideId: slide.path,
    background: { type: 'solid', color: '112233' }
  });
  engine.undo();
  expect(engine.snapshot().document).toEqual(expected);
  expect(engine.isDirty()).toBe(false);
});

it('reopens saved slide XML with a fresh history and no pending suggestions', () => {
  const engine = new PptxEditorEngine();
  engine.load(fixture);
  const saved = engine.readDeck()!.slides.map((slide) => ({
    path: slide.path,
    raw: deepClone(slide.raw)
  }));
  const expected = JSON.parse(JSON.stringify(engine.snapshot().document));

  engine.execute(
    {
      type: 'set-slide-background',
      slideId: saved[0].path,
      background: { type: 'solid', color: '112233' }
    },
    { origin: 'assistant' }
  );
  expect(engine.changes()).toHaveLength(1);

  engine.reopenSlides(saved);
  expect(engine.snapshot().document).toEqual(expected);
  expect(engine.changes()).toEqual([]);
  expect(engine.canUndo()).toBe(false);
  expect(engine.isDirty()).toBe(false);
  expect(() => engine.reopenSlides(saved.slice(1))).toThrow(
    'Reopening a deck with a different set of slides'
  );
});

it('marks only the exported save point clean, keeping later edits dirty', () => {
  const deck = importDeck(fixture);
  const engine = new PptxEditorEngine(deck);
  const slide = deck.slides[0];
  const paint = (color: string) =>
    engine.execute({
      type: 'set-slide-background',
      slideId: slide.path,
      background: { type: 'solid', color }
    });

  paint('112233');
  const savePoint = engine.savePoint();
  engine.exportPptx();
  paint('445566'); // typed while the host request is still pending
  engine.markSaved(savePoint);
  expect(engine.isDirty()).toBe(true);
  engine.undo();
  expect(engine.isDirty()).toBe(false);
  engine.redo();
  expect(engine.isDirty()).toBe(true);
  engine.markSaved();
  expect(engine.isDirty()).toBe(false);
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
  const beforeWidth = Number(getAttr(tableColumns(table)[0], 'w'));
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
  expect(Number(getAttr(tableColumns(table)[0], 'w'))).toBe(
    beforeWidth + 100000
  );

  engine.undo();
  const restored = slide.shapes.find((shape) => shape.id === table.id)!;
  expect(tableRows(restored)).toHaveLength(2);
  expect(tableCellText(tableCell(restored, 1, 1))).toBe('');
  expect(Number(getAttr(tableColumns(restored)[0], 'w'))).toBe(beforeWidth);
});

it("adds a last column before each row's extensions", () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[3];
  const table = slide.shapes.find((shape) => tableColumns(shape).length)!;
  const columns = tableColumns(table).length;
  new PptxEditorEngine(deck).execute({
    type: 'edit-table',
    slideId: slide.path,
    shapeId: table.id,
    operations: [{ kind: 'add-column', index: columns, like: columns - 1 }]
  });

  for (const row of tableRows(table)) {
    const tags = childrenOf(row).map(tagOf);
    expect(tags.indexOf('a:extLst')).toBeGreaterThan(tags.lastIndexOf('a:tc'));
  }
});

it('copies the look of merged cells into a new row and column without the merge', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 3, 3, 100000, 200000, 3000000, 900000);
  const engine = new PptxEditorEngine(deck);
  const edit = (operations: unknown[]) =>
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: table.id,
      operations
    } as Parameters<typeof engine.execute>[0]);
  edit([
    {
      kind: 'merge-cells',
      range: { startRow: 0, startCol: 0, endRow: 0, endCol: 1 }
    },
    {
      kind: 'merge-cells',
      range: { startRow: 1, startCol: 2, endRow: 2, endCol: 2 }
    }
  ]);
  edit([
    { kind: 'add-row', index: 1, like: 0 },
    { kind: 'add-column', index: 3, like: 2 }
  ]);

  const marks = (cell: ONode) =>
    ['gridSpan', 'rowSpan', 'hMerge', 'vMerge'].filter((mark) =>
      getAttr(cell, mark)
    );
  expect(tableCells(tableRows(table)[1]).flatMap(marks)).toEqual([]);
  expect(tableRows(table).map((row) => marks(tableCells(row)[3]))).toEqual([
    [],
    [],
    [],
    []
  ]);
});

it('edits a table cell through the text commands a shape uses', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 2, 2, 100000, 200000, 2000000, 800000);
  const engine = new PptxEditorEngine(deck);
  engine.execute({
    type: 'edit-table',
    slideId: slide.path,
    shapeId: table.id,
    operations: [
      { kind: 'set-cell-text', row: 1, col: 0, value: '$45' },
      {
        kind: 'style-cells',
        range: { startRow: 1, startCol: 0, endRow: 1, endCol: 0 },
        style: { bold: true }
      }
    ]
  });
  const cellRun = () =>
    child(child(child(tableCell(table, 1, 0)!, 'a:txBody')!, 'a:p')!, 'a:r')!;

  engine.execute({
    type: 'replace-rich-text',
    slideId: slide.path,
    shapeId: table.id,
    cell: { row: 1, col: 0 },
    paragraphs: [
      {
        sourceParagraph: 0,
        runs: [
          {
            text: '$40',
            source: { paragraph: 0, run: 0 },
            styleChanged: false
          }
        ]
      }
    ]
  });
  engine.execute({
    type: 'format-text',
    slideId: slide.path,
    shapeId: table.id,
    cell: { row: 1, col: 0 },
    style: { highlight: 'FFFF00' },
    ranges: [{ paragraph: 0, start: 0, end: 3 }]
  });

  expect(tableCellText(tableCell(table, 1, 0))).toBe('$40');
  expect(tableCellText(tableCell(table, 1, 1))).toBe('');
  const rPr = child(cellRun(), 'a:rPr')!;
  expect(getAttr(rPr, 'b')).toBe('1');
  expect(child(rPr, 'a:highlight')).toBeDefined();

  engine.undo();
  engine.undo();
  const restored = slide.shapes.find((shape) => shape.id === table.id)!;
  expect(tableCellText(tableCell(restored, 1, 0))).toBe('$45');
});

it('adds a row and a column that copy the look of the ones beside them', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 2, 2, 100000, 200000, 2000000, 800000);
  const engine = new PptxEditorEngine(deck);
  engine.execute({
    type: 'edit-table',
    slideId: slide.path,
    shapeId: table.id,
    operations: [
      { kind: 'set-cell-text', row: 1, col: 1, value: '$45' },
      {
        kind: 'style-cells',
        range: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
        style: { bold: true, fill: 'FF0000' }
      }
    ]
  });

  engine.execute({
    type: 'edit-table',
    slideId: slide.path,
    shapeId: table.id,
    operations: [
      { kind: 'add-column', index: 2, like: 1 },
      { kind: 'add-row', index: 2, like: 1 }
    ]
  });

  expect(tableRows(table)).toHaveLength(3);
  expect(tableColumns(table)).toHaveLength(3);
  for (const [row, col] of [
    [1, 2],
    [2, 1],
    [2, 2]
  ]) {
    const cell = tableCell(table, row, col)!;
    expect(tableCellText(cell)).toBe('$45');
    const run = child(child(child(cell, 'a:txBody')!, 'a:p')!, 'a:r')!;
    expect(getAttr(child(run, 'a:rPr')!, 'b')).toBe('1');
  }
  expect(getAttr(tableColumns(table)[2], 'w')).toBe(
    getAttr(tableColumns(table)[1], 'w')
  );
  expect(getAttr(tableColumns(table)[2], 'w')).toBeDefined();
});

it('spreads a width over a table, leading columns keeping theirs', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 1, 3, 0, 0, 3000000, 400000);
  const engine = new PptxEditorEngine(deck);
  engine.execute({
    type: 'edit-table',
    slideId: slide.path,
    shapeId: table.id,
    operations: [
      { kind: 'set-column-width', index: 0, width: 1200000 },
      { kind: 'set-column-width', index: 1, width: 900000 },
      { kind: 'set-column-width', index: 2, width: 900000 },
      { kind: 'add-column', index: 3, like: 2 },
      { kind: 'fit-columns', width: 3000000 }
    ]
  });

  expect(tableColumns(table).map((col) => Number(getAttr(col, 'w')))).toEqual([
    1200000, 600000, 600000, 600000
  ]);
});

it.each([
  ['crushing the last', [1600000, 1190000, 1210000]],
  ['flattening a wider label', [1600000, 1210000, 1190000]]
])(
  'spreads a width over nearly equal columns without %s column',
  (_, widths) => {
    const deck = importDeck(fixture);
    const slide = deck.slides[0];
    const table = insertTable(deck, slide, 1, 3, 0, 0, 4000000, 400000);
    new PptxEditorEngine(deck).execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: table.id,
      operations: [
        ...widths.map((width, index) => ({
          kind: 'set-column-width' as const,
          index,
          width
        })),
        { kind: 'add-column', index: 1, like: 1 },
        { kind: 'fit-columns', width: 4000000 }
      ]
    });

    const fitted = tableColumns(table).map((col) => Number(getAttr(col, 'w')));
    expect(Math.min(...fitted)).toBeGreaterThanOrEqual(90000);
    expect(fitted[0]).toBeGreaterThan(Math.max(...fitted.slice(1)));
    expect(fitted.reduce((a, b) => a + b, 0)).toBe(4000000);
  }
);

it('reports a change made inside an open transaction to reads before it closes', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 1, 2, 0, 0, 2000000, 400000);
  const engine = new PptxEditorEngine(deck);
  engine.markSaved();
  engine.transaction({ label: 'Edit' }, () => {
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: table.id,
      operations: [{ kind: 'set-cell-text', row: 0, col: 0, value: 'Now' }]
    });
    expect(engine.isDirty()).toBe(true);
    expect(engine.savePoint()).not.toBeNull();
  });
  expect(engine.isDirty()).toBe(true);
});

it('writes text into a cell that has no text body yet', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 1, 2, 0, 0, 2000000, 400000);
  const cell = tableCell(table, 0, 0)!;
  childrenOf(cell).splice(
    childrenOf(cell).indexOf(child(cell, 'a:txBody')!),
    1
  );
  new PptxEditorEngine(deck).execute({
    type: 'replace-rich-text',
    slideId: slide.path,
    shapeId: table.id,
    cell: { row: 0, col: 0 },
    paragraphs: [{ runs: [{ text: 'Filled' }] }]
  });

  expect(tableCellText(tableCell(table, 0, 0))).toBe('Filled');
});

it.each([
  [
    'keeps an uneven last column usable',
    [1600000, 1190000, 1190000, 1300000],
    4090000,
    (fitted: number[]) =>
      expect(Math.min(...fitted)).toBeGreaterThanOrEqual(900000)
  ],
  [
    'keeps a wide last column the widest',
    [1000000, 1000000, 1000000, 2000000],
    4000000,
    (fitted: number[]) =>
      expect(fitted[3]).toBeGreaterThan(Math.max(...fitted.slice(0, 3)))
  ],
  [
    'shares freed width between nearly equal trailing columns',
    [1200000, 900000, 901000],
    3901000,
    (fitted: number[]) => {
      expect(fitted[0]).toBe(1200000);
      expect(Math.abs(fitted[1] - fitted[2])).toBeLessThanOrEqual(1);
    }
  ]
])('fitting a table to a width %s', (_, widths, width, check) => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(
    deck,
    slide,
    1,
    widths.length,
    0,
    0,
    widths.reduce((a, b) => a + b, 0),
    400000
  );
  new PptxEditorEngine(deck).execute({
    type: 'edit-table',
    slideId: slide.path,
    shapeId: table.id,
    operations: [
      ...widths.map((w, index) => ({
        kind: 'set-column-width' as const,
        index,
        width: w
      })),
      { kind: 'fit-columns', width }
    ]
  });

  const fitted = tableColumns(table).map((col) => Number(getAttr(col, 'w')));
  check(fitted);
  expect(fitted.reduce((a, b) => a + b, 0)).toBe(width);
});

it('rejects a suggestion from inside a transaction that already changed something else', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const table = insertTable(deck, slide, 1, 2, 0, 0, 2000000, 400000);
  const box = addTextBox(deck, slide, 0, 500000, 1000000, 400000, 'Box');
  const engine = new PptxEditorEngine(deck);
  const editCell = () =>
    engine.execute({
      type: 'edit-table',
      slideId: slide.path,
      shapeId: table.id,
      operations: [{ kind: 'set-cell-text', row: 0, col: 0, value: 'Robin' }]
    });
  engine.transaction({ origin: 'assistant' }, editCell);
  const [suggestion] = engine
    .changes()
    .filter((record) => record.status === 'pending');

  let outcome: { ok: boolean } | undefined;
  engine.transaction({ label: 'Edit' }, () => {
    engine.execute({
      type: 'set-shape-geometries',
      slideId: slide.path,
      updates: [{ shapeId: box.id, geometry: { x: 100000 } }]
    });
    outcome = engine.rejectChange(suggestion.id);
  });
  expect(outcome).toEqual(expect.objectContaining({ ok: true }));
});

it('refuses a cell target on a shape that is not a table', () => {
  const deck = importDeck(fixture);
  const slide = deck.slides[0];
  const box = addTextBox(deck, slide, 0, 0, 1000000, 400000, 'Text');
  const engine = new PptxEditorEngine(deck);

  expect(() =>
    engine.execute({
      type: 'replace-rich-text',
      slideId: slide.path,
      shapeId: box.id,
      cell: { row: 0, col: 0 },
      paragraphs: [{ runs: [{ text: 'Other' }] }]
    })
  ).toThrow(/Cell 0,0/);
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
