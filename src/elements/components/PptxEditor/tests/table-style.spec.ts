import { readFileSync } from 'fs';
import { resolve } from 'path';
import { importDeck } from '../core/model/import';
import { tableColumns, tableNode, tableRows } from '../core/model/table';
import { child, childrenOf, el, getAttr, root, setAttr } from '../core/opc/xml';
import { tableCellLook } from '../core/render/tableStyle';

const sampleDeck = () =>
  importDeck(
    new Uint8Array(readFileSync(resolve(__dirname, 'fixtures/sample.pptx')))
  );

// Slide 4's table without its total row, so row 2 is a plain band2H row
function band2HLook(deck = sampleDeck()) {
  const shape = deck.slides[3].shapes.find((candidate) =>
    tableNode(candidate)
  )!;
  const tbl = tableNode(shape)!;
  setAttr(child(tbl, 'a:tblPr')!, 'lastRow', '0');
  return tableCellLook(
    tbl,
    deck.pkg,
    2,
    1,
    tableRows(shape).length,
    tableColumns(shape).length
  );
}

it('keeps the whole-table text colour under a band style that sets none', () => {
  const textColor = band2HLook().textColor!;
  expect(getAttr(child(textColor, 'a:srgbClr')!, 'val')).toBe('000000');
});

it('clears a weaker part fill when a stronger part sets no fill', () => {
  const deck = sampleDeck();
  const style = childrenOf(root(deck.pkg.tree('ppt/tableStyles.xml'))).find(
    (node) =>
      getAttr(node, 'styleId') === '{4C3C2611-4C71-4FC5-86AE-919BDF0F9419}'
  )!;
  const fill = child(child(child(style, 'a:band2H')!, 'a:tcStyle')!, 'a:fill')!;
  childrenOf(fill).splice(0, childrenOf(fill).length, el('a:noFill'));
  expect(band2HLook(deck).fill).toBeUndefined();
});
