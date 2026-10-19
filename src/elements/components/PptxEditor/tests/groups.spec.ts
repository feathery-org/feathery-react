import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { exportDeckBytes } from '../core/model/export';
import { PptxEditorEngine } from '../engine';
import { child, childrenOf } from '../core/opc/xml';
import { readShapeNode } from '../core/model/read';
import { canUngroup } from '../core/model/groups';

const load = () =>
  importDeck(
    new Uint8Array(
      readFileSync(resolve(__dirname, 'fixtures/template1-text-group.pptx'))
    )
  );

it('preserves translated group members, text, and paint order through export and history', () => {
  const deck = load();
  const slide = deck.slides[1];
  const group = slide.shapes.find((shape) => shape.type === 'group')!;
  const members = childrenOf(group.node)
    .map((node) => readShapeNode(node))
    .filter(Boolean);
  const before = members.map((member) => ({
    id: member!.id,
    xfrm: { ...member!.xfrm! }
  }));
  const engine = new PptxEditorEngine(deck);
  engine.execute({
    type: 'set-shape-geometries',
    slideId: slide.path,
    updates: [
      {
        shapeId: group.id,
        geometry: { x: group.xfrm!.x + 95250, y: group.xfrm!.y + 190500 }
      }
    ]
  });
  engine.execute({
    type: 'ungroup-shape',
    slideId: slide.path,
    shapeId: group.id
  });
  const reopened = importDeck(exportDeckBytes(deck)).slides[1];
  expect(
    reopened.shapes.slice(-before.length).map((shape) => shape.id)
  ).toEqual(before.map((shape) => shape.id));
  for (const member of before) {
    expect(
      reopened.shapes.find((shape) => shape.id === member.id)!.xfrm
    ).toEqual({
      ...member.xfrm,
      x: member.xfrm.x + 95250,
      y: member.xfrm.y + 190500
    });
  }
  expect(
    reopened.shapes.some(
      (shape) => shape.text?.paragraphs[0].runs[0]?.text === 'Responsible'
    )
  ).toBe(true);
  engine.undo();
  expect(
    slide.shapes.some(
      (shape) => shape.id === group.id && shape.type === 'group'
    )
  ).toBe(true);
  engine.redo();
  expect(slide.shapes.some((shape) => shape.id === group.id)).toBe(false);
});

it('keeps transformed groups intact rather than silently changing their appearance', () => {
  const deck = load();
  const slide = deck.slides[1];
  const group = slide.shapes.find((shape) => shape.type === 'group')!;
  expect(child(group.spPr!, 'a:xfrm')).toBeTruthy();
  group.xfrm!.rot = 15;
  expect(canUngroup(group)).toBe(false);
  const engine = new PptxEditorEngine(deck);
  expect(() =>
    engine.execute({
      type: 'ungroup-shape',
      slideId: slide.path,
      shapeId: group.id
    })
  ).toThrow('cannot be ungrouped');
  expect(slide.shapes).toContain(group);
});
