// Phase 4: one document holding both assistant-computed cells and live bindings.
//
// Two independent problems, both measured against a real bound document rather
// than reasoned about:
//
//   READS - a content control nests its runs one level down, and a table marker
//   wraps its table in a block-level control. Before this, every bound value was
//   invisible to the engine and BOTH configured tables flattened to empty
//   paragraphs: the assistant, table facts, and the search index all saw a
//   document with no tables and holes where the values were.
//
//   WRITES - the write primitive here is select-a-range-then-insertText, which
//   DELETES a content control rather than replacing its contents. A write aimed
//   at a bound cell destroys the author's binding, so it is refused.
import 'jest-canvas-mock';
import { flattenSfdt, getDocumentInventory } from '../syncfusionDocumentOps';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import {
  getAt,
  scanBindings
} from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';

const flatten = () => flattenSfdt(buildCostsFixture() as any);
const byAnchor = (anchor: string) =>
  flatten().find((block) => block.anchor === anchor);

const legacyControlText = (node: any): string =>
  (node?.inlines ?? [])
    .map((inline: any) =>
      inline?.contentControlProperties
        ? legacyControlText(inline)
        : typeof inline?.text === 'string'
        ? inline.text
        : ''
    )
    .join('');

describe('reading a bound document', () => {
  it('sees text held inside bound fields', () => {
    // "Website relaunch" lives in a content control, one inline level down.
    expect(byAnchor('0;1')?.text).toBe(
      'Project: Website relaunch    Prepared: 2026-08-11'
    );
    expect(byAnchor('0;4')?.text).toBe(
      'Amount due for Website relaunch: $7,800.00.'
    );
  });

  it('sees through a table marker to the table it wraps', () => {
    const blocks = flatten();
    const cells = blocks.filter((block) => block.kind === 'table_cell');
    // Two configured tables, both wrapped in [[table=...]] markers.
    expect(cells.length).toBeGreaterThan(20);
    expect(byAnchor('0;2;1;1;0')?.text).toBe('12');
    expect(byAnchor('0;2;1;3;0')?.text).toBe('$1,800.00');
  });

  it('uses the anchors SyncFusion itself reports', () => {
    // Measured on the live editor in the Phase 2 spikes: with the caret in the
    // quantity cell, selection.startOffset is "0;2;1;1;0;0". The wrapper does not
    // consume a block index, so the table is block 2 - and the walker must agree
    // or every anchored write lands in the wrong place.
    expect(byAnchor('0;2;1;1;0')).toBeDefined();
    expect(byAnchor('0;3;1;1;0')).toBeUndefined();
  });

  it('reports the bound tables in the inventory', () => {
    const editor = {
      serialize: () => JSON.stringify(buildCostsFixture()),
      documentHelper: {}
    };
    const inventory: any = getDocumentInventory(editor as any, {
      scope: 'full'
    });
    const text = JSON.stringify(inventory);
    expect(text).toContain('Design work');
    expect(text).toContain('$1,800.00');
  });

  it('enriches bound blocks with friendly binding facts', () => {
    const editor = {
      serialize: () => JSON.stringify(buildCostsFixture()),
      documentHelper: {}
    };
    const inventory: any = getDocumentInventory(editor as any, {
      scope: 'full'
    });
    const quantity = inventory.inventory.find(
      (block: any) => block.anchor === '0;2;1;1;0'
    );
    expect(quantity.binding).toEqual({
      field: 'quantity',
      identity: { id: 'quantity', global: false },
      kind: 'input',
      table: 'costs',
      row: 'r-1'
    });
    const formula = inventory.inventory.find(
      (block: any) => block.anchor === '0;2;1;3;0'
    );
    expect(formula.binding).toEqual({
      field: 'line_total',
      identity: { id: 'line_total', global: false },
      kind: 'formula',
      expr: 'mul(quantity,unit_cost)',
      table: 'costs',
      row: 'r-1'
    });
  });

  it('enriches structure and table_facts reads for bound tables', () => {
    const editor = {
      serialize: () => JSON.stringify(buildCostsFixture()),
      documentHelper: {}
    };
    const structure: any = getDocumentInventory(editor as any, {
      scope: 'structure'
    });
    expect(structure.structure.tables[0].binding).toEqual({
      kind: 'bound',
      tableId: 'costs',
      rowIds: ['r-1', 'r-2'],
      columns: ['item', 'quantity', 'unit_cost', 'line_total']
    });

    const facts: any = getDocumentInventory(editor as any, {
      scope: 'table_facts',
      tableAnchor: '0;2'
    });
    expect(facts.table.binding).toEqual(structure.structure.tables[0].binding);
    expect(facts.table.rows[1].binding).toEqual({ rowId: 'r-1' });
    expect(facts.table.rows[1].cells[1].binding).toEqual({
      field: 'quantity',
      identity: { id: 'quantity', global: false },
      kind: 'input',
      table: 'costs',
      row: 'r-1'
    });
  });

  it('marks only an explicit global tag as a global wire identity', () => {
    const editor = {
      serialize: () =>
        JSON.stringify(buildCostsFixture({ globalTaxRate: true })),
      documentHelper: {}
    };
    const inventory: any = getDocumentInventory(editor as any, {
      scope: 'full'
    });
    const taxRates = inventory.inventory.filter(
      (block: any) => block.binding?.field === 'tax_rate'
    );
    expect(taxRates).toHaveLength(2);
    expect(
      taxRates.map((block: any) => block.binding.identity)
    ).toEqual([
      { id: 'tax_rate', global: true },
      { id: 'tax_rate', global: true }
    ]);
  });

  it('leaves documents without content controls byte-identical', () => {
    // The expansion must be a no-op for every document that predates bindings.
    const plain = {
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Hello' }] },
            {
              rows: [
                {
                  cells: [{ blocks: [{ inlines: [{ text: 'Cell' }] }] }]
                }
              ]
            }
          ]
        }
      ]
    };
    const blocks = flattenSfdt(plain as any);
    expect(blocks.map((block) => [block.anchor, block.text])).toEqual([
      ['0;0', 'Hello'],
      ['0;1;0;0;0', 'Cell']
    ]);
    const editor = {
      serialize: () => JSON.stringify(plain),
      documentHelper: {}
    };
    const inventory = getDocumentInventory(editor as any, { scope: 'full' });
    expect(JSON.stringify(inventory)).not.toContain('"binding"');
  });

  it('round-trips a bindings-free document with identical reads', () => {
    const plain = {
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Before' }] },
            {
              rows: [
                {
                  cells: [{ blocks: [{ inlines: [{ text: 'Plain cell' }] }] }]
                }
              ]
            }
          ]
        }
      ]
    };
    const before = flattenSfdt(plain as any);
    const serialized = JSON.stringify(plain);
    const roundTripped = JSON.parse(serialized);

    expect(flattenSfdt(roundTripped)).toEqual(before);
    expect(JSON.stringify(roundTripped)).toBe(serialized);
    expect(scanBindings(roundTripped).occurrences).toEqual([]);
  });

  it('reads a bound document with zero revisions exactly as legacy concatenation did', () => {
    const sfdt: any = buildCostsFixture();
    expect(sfdt.revisions ?? []).toEqual([]);

    const before = scanBindings(sfdt);
    for (const occurrence of before.occurrences)
      expect(occurrence.text).toBe(
        legacyControlText(getAt(sfdt, occurrence.path))
      );

    const after = scanBindings(JSON.parse(JSON.stringify(sfdt)));
    expect(
      after.occurrences.map((occurrence) => [occurrence.key, occurrence.text])
    ).toEqual(
      before.occurrences.map((occurrence) => [occurrence.key, occurrence.text])
    );
  });
});

describe('bound-block marking', () => {
  it('marks bound cells and prose, and only those', () => {
    const blocks = flatten();
    // A bound input cell.
    expect(byAnchor('0;2;1;1;0')?.boundTag).toBe(
      '[[name=quantity|type=integer|row=r-1]]'
    );
    // A locked formula cell.
    expect(byAnchor('0;2;1;3;0')?.boundTag).toContain('expr=');
    // A plain label cell in the same table is not bound.
    expect(byAnchor('0;2;0;0;0')?.boundTag).toBeUndefined();
    // Nothing outside the bound document is marked.
    expect(blocks.filter((block) => block.boundTag).length).toBeGreaterThan(8);
  });

  it('does not mark a foreign content control as a binding', () => {
    // A control this engine did not author is ordinary text, not a binding.
    const foreign = {
      sections: [
        {
          blocks: [
            {
              inlines: [
                {
                  contentControlProperties: { tag: 'customer-name' },
                  inlines: [{ text: 'Acme' }]
                }
              ]
            }
          ]
        }
      ]
    };
    const [block] = flattenSfdt(foreign as any);
    // Its text is still read...
    expect(block.text).toBe('Acme');
    // ...but it is writable, because nothing owns it.
    expect(block.boundTag).toBeUndefined();
  });
});
