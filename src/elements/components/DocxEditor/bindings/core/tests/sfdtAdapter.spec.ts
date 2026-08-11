// Ported from the POC's test/adapter.test.js. The structural-sharing assertions
// matter beyond tidiness: the controller uses `next === previous` as its "nothing
// changed, do not touch the editor" check, so identity preservation is a
// behavioural contract, not an optimisation.
import {
  addLineItem,
  createRowIdGenerator,
  getAt,
  readLineItems,
  readTaggedValue,
  removeLineItem,
  scanBindings,
  setOccurrenceText,
  setTaggedValue,
  validateSfdt
} from '../sfdtAdapter';
import { buildCostsFixture } from './fixtures/costsFixture';

describe('scanBindings', () => {
  it('finds fields, formulas, tables and rows', () => {
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    expect(index.diagnostics).toEqual([]);

    expect(index.fields.get('project.name')).toHaveLength(2);
    // Total row + the prose repeat.
    expect(index.formulas.get('grand_total')).toHaveLength(2);

    const costs = index.tables.get('costs');
    expect(costs).toBeDefined();
    expect(costs!.rows.map((row) => row.rowId)).toEqual(['r-1', 'r-2']);
    expect([...costs!.rows[0].bindings.keys()].sort()).toEqual([
      'item',
      'line_total',
      'quantity',
      'unit_cost'
    ]);
  });

  // Encodes the Phase 0 finding: minified SFDT contains the same bindings under
  // renamed keys, so scanning it must fail loudly instead of reporting an empty
  // document that looks exactly like an unbound template.
  it('refuses minified SFDT instead of reporting zero bindings', () => {
    const index = scanBindings({
      sec: [{ b: [] }]
    } as any);
    expect(index.occurrences).toEqual([]);
    expect(index.diagnostics.map((entry) => entry.code)).toEqual([
      'optimized-sfdt'
    ]);
  });
});

describe('reading', () => {
  it('returns canonical values from tags and line items', () => {
    const doc = buildCostsFixture();
    expect(readTaggedValue(doc, 'project.name')).toBe('Website relaunch');

    const items = readLineItems(doc, 'costs');
    expect(items).toHaveLength(2);
    expect(items[0].values.quantity.canonical).toBe('12');
    expect(items[0].values.unit_cost.canonical).toBe('150'); // "$150.00" parsed
    expect(items[1].values.line_total.canonical).toBe('6000'); // "$6,000.00"
  });
});

describe('writing', () => {
  it('updates every occurrence of a field and nothing else', () => {
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    const next = setTaggedValue(doc, 'project.name', 'Rebrand 2027', index);

    const after = scanBindings(next);
    for (const occurrence of after.fields.get('project.name')!) {
      expect(occurrence.text).toBe('Rebrand 2027');
    }

    // Structural sharing: untouched subtrees are the SAME objects.
    expect(next).not.toBe(doc);
    expect(next.styles).toBe(doc.styles);
    const tablePath = index.tables.get('costs')!.tablePath!;
    expect(getAt(next, tablePath)).toBe(getAt(doc, tablePath));
    // And the original document is untouched.
    expect(scanBindings(doc).fields.get('project.name')![0].text).toBe(
      'Website relaunch'
    );
  });

  it('preserves the run characterFormat', () => {
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    const total = index.formulas.get('grand_total')![0]; // bold run in total row
    const next = setOccurrenceText(doc, total, '$9,999.99');
    const control = getAt(next, total.path);
    expect(control.inlines).toHaveLength(1);
    expect(control.inlines[0].text).toBe('$9,999.99');
    expect(control.inlines[0].characterFormat.bold).toBe(true);
  });

  it('returns the same document when the text is unchanged', () => {
    // The controller's no-op detection depends on this identity.
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    const occurrence = index.fields.get('project.name')![0];
    expect(setOccurrenceText(doc, occurrence, occurrence.text)).toBe(doc);
  });
});

describe('row operations', () => {
  it('clones layout, resets values and mints fresh identity', () => {
    const doc = buildCostsFixture();
    const { sfdt: next, rowId } = addLineItem(
      doc,
      'costs',
      'r-1',
      scanBindings(doc),
      'r-new'
    );
    expect(rowId).toBe('r-new');

    const index = scanBindings(next);
    expect(index.tables.get('costs')!.rows.map((row) => row.rowId)).toEqual([
      'r-1',
      'r-new',
      'r-2'
    ]);

    const row = index.tables.get('costs')!.rows[1];
    expect(row.bindings.get('item')!.text).toBe(''); // text default
    expect(row.bindings.get('quantity')!.text).toBe('0'); // numeric default
    expect(row.bindings.get('unit_cost')!.text).toBe('$0.00');
    // The formula keeps its tag; the engine recomputes the text this transaction.
    const lineTotal = row.bindings.get('line_total')!.def;
    expect(lineTotal.kind === 'formula' ? lineTotal.expression : null).toBe(
      'mul(quantity,unit_cost)'
    );
    // Cloned cells kept their formatting.
    const control = getAt(next, row.bindings.get('line_total')!.path);
    expect(control.contentControlProperties.lockContents).toBe(true);
    // Source row identity is untouched.
    expect(scanBindings(doc).tables.get('costs')!.rows).toHaveLength(2);
  });

  it('deletes a row and its bindings', () => {
    const doc = buildCostsFixture();
    const next = removeLineItem(doc, 'costs', 'r-1');
    const index = scanBindings(next);
    expect(index.tables.get('costs')!.rows.map((row) => row.rowId)).toEqual([
      'r-2'
    ]);
    expect(() => removeLineItem(doc, 'costs', 'r-404')).toThrow(/not found/);
  });

  it('refuses a row hosting a non-deletable document binding', () => {
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    // Graft the doc-level grand_total occurrence into r-1's item cell.
    const grand = index.formulas.get('grand_total')![0];
    const itemCell = index.tables.get('costs')!.rows[0].bindings.get('item')!;
    const paragraph = getAt(doc, itemCell.path.slice(0, -2));
    paragraph.inlines.push(JSON.parse(JSON.stringify(getAt(doc, grand.path))));
    expect(() => removeLineItem(doc, 'costs', 'r-1')).toThrow(/non-deletable/);
  });

  it('mints row ids per generator rather than from shared global state', () => {
    // Isolation means one generator's counter is not advanced by another's use,
    // so a second document starts its own sequence at the beginning.
    const first = createRowIdGenerator(() => 0);
    const second = createRowIdGenerator(() => 0);
    const firstIds = [first(), first(), first()];
    expect(firstIds).toEqual(['r-1-0', 'r-2-0', 'r-3-0']);
    expect(second()).toBe('r-1-0');

    // And ids stay unique within one generator even when randomness repeats.
    expect(new Set(firstIds).size).toBe(3);
  });
});

describe('validateSfdt', () => {
  it('reports malformed tags and invalid input without throwing', () => {
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    // Corrupt a quantity value and a tag.
    const quantity = index.tables
      .get('costs')!
      .rows[0].bindings.get('quantity')!;
    getAt(doc, quantity.path).inlines[0].text = 'twelve';
    getAt(
      doc,
      index.fields.get('project.name')![0].path
    ).contentControlProperties.tag = '[[v1|field|bad name|text|rw|delete]]';

    const diagnostics = validateSfdt(doc);
    expect(
      diagnostics.some(
        (entry) => entry.code === 'invalid-input' && /quantity/.test(entry.message)
      )
    ).toBe(true);
    expect(diagnostics.some((entry) => entry.code === 'malformed-tag')).toBe(
      true
    );
  });

  it('rejects a sectionless document', () => {
    expect(validateSfdt({})[0].code).toBe('malformed-sfdt');
  });
});
