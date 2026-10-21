import { fixtureBytes } from './harness';
import { preparePackage } from '../loading/preparePackage';
import { OPCPackage } from '../core/opc/package';
import { importDeck, importPreparedDeck } from '../core/model/import';
import { createPptxEditorStore } from '../state/PptxEditorStore';
import { unzipPptx, zipPptx } from '../core/opc/zip';

it('preserves prepared raw XML identity through edit, undo, redo and export', () => {
  const bytes = fixtureBytes('sample.pptx');
  const prepared = preparePackage(bytes);
  const deck = importPreparedDeck(
    new OPCPackage(prepared.parts, prepared.trees)
  );
  const slide = deck.slides[0];
  const shape = slide.shapes.find((candidate) => candidate.xfrm);
  if (!shape?.xfrm) throw new Error('Fixture needs an editable shape');
  expect(slide.raw).toBe(deck.pkg.tree(slide.path));
  const original = shape.xfrm.x;
  const store = createPptxEditorStore();
  store.loadDeck(deck, 'prepared.pptx');
  store.executeCommand({
    type: 'set-shape-geometries',
    slideId: slide.path,
    updates: [{ shapeId: shape.id, geometry: { x: original + 12345 } }]
  });
  expect(store.engine.isDirty()).toBe(true);
  store.undo();
  expect(
    store.getState().deck?.slides[0].shapes.find((item) => item.id === shape.id)
      ?.xfrm?.x
  ).toBe(original);
  store.redo();
  const output = deck.pkg.toBytes();
  const reopened = importDeck(output);
  expect(
    reopened.slides[0].shapes.find((item) => item.id === shape.id)?.xfrm?.x
  ).toBe(original + 12345);
  expect(unzipPptx(output).binary).toEqual(unzipPptx(bytes).binary);
  expect(reopened.slides).toHaveLength(deck.slides.length);
  store.dispose();
});

it('preserves unused XML verbatim instead of failing an otherwise readable deck', () => {
  const parts = unzipPptx(fixtureBytes('sample.pptx'));
  const path = 'customXml/opaque.xml';
  const original = '<custom value="unterminated';
  parts.text.set(path, original);
  parts.order.push(path);
  const prepared = preparePackage(zipPptx(parts));
  expect(prepared.trees.has(path)).toBe(false);
  const deck = importPreparedDeck(
    new OPCPackage(prepared.parts, prepared.trees)
  );
  expect(deck.slides).toHaveLength(9);
  expect(unzipPptx(deck.pkg.toBytes()).text.get(path)).toBe(original);
});
