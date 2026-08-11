// Ported from the POC's test/engine.test.js. This is the behavioural contract of
// the whole feature: fan-out, dependency-ordered recalculation, tamper revert,
// the write taxonomy the editor's undo handling depends on, and the self-heal
// mode that keeps undo from fighting the engine.
import { applyRules, hasBlockingErrors } from '../engine';
import {
  addLineItem,
  BindingIndex,
  getAt,
  Occurrence,
  removeLineItem,
  scanBindings,
  setOccurrenceText
} from '../sfdtAdapter';
import { buildCostsFixture } from './fixtures/costsFixture';

function occ(
  index: BindingIndex,
  pick: (occurrence: Occurrence) => boolean
): Occurrence {
  const found = index.occurrences.find(pick);
  if (!found) throw new Error('occurrence not found');
  return found;
}

const costsRows = (index: BindingIndex) => index.tables.get('costs')!.rows;
const textsOf = (index: BindingIndex, name: string) =>
  index.formulas.get(name)!.map((entry) => entry.text);

describe('applyRules', () => {
  it('rewrites nothing on a clean load', () => {
    const doc = buildCostsFixture();
    const result = applyRules(doc, {});
    expect(result.diagnostics).toEqual([]);
    expect(result.sfdt).toBe(doc); // identity: no writes were needed
  });

  it('recalculates row and aggregate in dependency order', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});

    // The user types 13 into r-1 quantity.
    const quantity = occ(
      base.index,
      (entry) => entry.name === 'quantity' && entry.rowId === 'r-1'
    );
    const edited = setOccurrenceText(base.sfdt, quantity, '13');

    const result = applyRules(edited, { prevValues: base.values });
    expect(result.diagnostics).toEqual([]);
    expect(costsRows(result.index)[0].bindings.get('line_total')!.text).toBe(
      '$1,950.00'
    );
    // Grand total updated in BOTH occurrences (total row + prose repeat).
    expect(textsOf(result.index, 'grand_total')).toEqual([
      '$7,950.00',
      '$7,950.00'
    ]);
    expect(
      result.changed.some(
        (entry) => entry.type === 'formula' && entry.name === 'grand_total'
      )
    ).toBe(true);
  });

  it('fans a document field edit out to every occurrence', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    // Edit the repeat, not the "source" - neither is privileged.
    const second = base.index.fields.get('project.name')![1];
    const edited = setOccurrenceText(base.sfdt, second, 'Rebrand 2027');

    const result = applyRules(edited, { prevValues: base.values });
    expect(result.diagnostics).toEqual([]);
    for (const entry of result.index.fields.get('project.name')!) {
      expect(entry.text).toBe('Rebrand 2027');
    }
    expect(
      result.changed.some(
        (entry) => entry.type === 'field' && entry.name === 'project.name'
      )
    ).toBe(true);
  });

  it('blocks on ambiguity when one field gets two values in one snapshot', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const [a, b] = base.index.fields.get('project.name')!;
    let edited = setOccurrenceText(base.sfdt, a, 'Alpha');
    edited = setOccurrenceText(edited, b, 'Beta');

    const result = applyRules(edited, { prevValues: base.values });
    expect(
      result.diagnostics.some((entry) => entry.code === 'ambiguous-edit')
    ).toBe(true);
    expect(hasBlockingErrors(result.diagnostics)).toBe(true);
    // Neither value was propagated over the other.
    expect(
      result.index.fields
        .get('project.name')!
        .map((entry) => entry.text)
        .sort()
    ).toEqual(['Alpha', 'Beta']);
  });

  it('reverts a user edit typed over a locked formula', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const grand = base.index.formulas.get('grand_total')![0];
    const tampered = setOccurrenceText(base.sfdt, grand, '$1.00');

    const result = applyRules(tampered, { prevValues: base.values });
    expect(textsOf(result.index, 'grand_total')).toEqual([
      '$7,800.00',
      '$7,800.00'
    ]);
  });

  it('blocks recalculation on invalid input instead of producing NaN', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const quantity = occ(
      base.index,
      (entry) => entry.name === 'quantity' && entry.rowId === 'r-1'
    );
    const edited = setOccurrenceText(base.sfdt, quantity, 'twelve');

    const result = applyRules(edited, { prevValues: base.values });
    expect(
      result.diagnostics.some((entry) => entry.code === 'invalid-input')
    ).toBe(true);
    // line_total cannot compute...
    expect(
      result.diagnostics.some((entry) => entry.code === 'evaluation-failed')
    ).toBe(true);
    // ...and the stale displayed total is left visible rather than replaced
    // with garbage.
    expect(costsRows(result.index)[0].bindings.get('line_total')!.text).toBe(
      '$1,800.00'
    );
  });

  it('grows the aggregate when a row is added, then recalculates it', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const { sfdt: withRow } = addLineItem(
      base.sfdt,
      'costs',
      'r-2',
      base.index,
      'r-3'
    );

    const result = applyRules(withRow, { prevValues: base.values });
    expect(result.diagnostics).toEqual([]);
    const rows = costsRows(result.index);
    expect(rows).toHaveLength(3);
    expect(rows[2].bindings.get('line_total')!.text).toBe('$0.00'); // 0 x $0.00
    expect(textsOf(result.index, 'grand_total')).toEqual([
      '$7,800.00',
      '$7,800.00'
    ]);

    // Now give the new row values.
    let edited = setOccurrenceText(
      result.sfdt,
      rows[2].bindings.get('quantity')!,
      '4'
    );
    edited = setOccurrenceText(
      edited,
      rows[2].bindings.get('unit_cost')!,
      '250'
    );
    const second = applyRules(edited, { prevValues: result.values });
    expect(costsRows(second.index)[2].bindings.get('line_total')!.text).toBe(
      '$1,000.00'
    );
    expect(textsOf(second.index, 'grand_total')).toEqual([
      '$8,800.00',
      '$8,800.00'
    ]);
  });

  it('shrinks the aggregate when a row is removed', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const removed = removeLineItem(base.sfdt, 'costs', 'r-1', base.index);
    const result = applyRules(removed, { prevValues: base.values });
    expect(result.diagnostics).toEqual([]);
    expect(textsOf(result.index, 'grand_total')).toEqual([
      '$6,000.00',
      '$6,000.00'
    ]);
  });

  it('reports a dependency cycle with its path instead of evaluating it', () => {
    const doc = buildCostsFixture();
    const index = scanBindings(doc);
    // Rewrite grand_total's expression to depend on itself.
    for (const grand of index.formulas.get('grand_total')!) {
      const node = getAt(doc, grand.path);
      node.contentControlProperties = {
        ...node.contentControlProperties,
        tag: '[[v1|formula|grand_total|currency:USD:2|sum(grand_total)|ro|keep]]'
      };
    }
    const result = applyRules(doc, {});
    const cycle = result.diagnostics.find(
      (entry) => entry.code === 'dependency-cycle'
    );
    expect(cycle).toBeDefined();
    expect(cycle!.message).toMatch(/doc:grand_total -> doc:grand_total/);
  });

  it('reports its writes deduped by tag, with a structural flag', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    expect(base.writes).toEqual([]); // consistent fixture: nothing written
    expect(base.structural).toBe(false);

    const quantity = occ(
      base.index,
      (entry) => entry.name === 'quantity' && entry.rowId === 'r-1'
    );
    const result = applyRules(setOccurrenceText(base.sfdt, quantity, '13'), {
      prevValues: base.values
    });
    expect(result.structural).toBe(false);
    const texts = result.writes.map((write) => write.text);
    expect(texts).toContain('$1,950.00'); // r-1 line total
    expect(texts).toContain('$7,950.00'); // costs subtotal + grand total
    expect(texts).toContain('$9,650.00'); // combined total
    // Repeated occurrences of one formula share a tag: writes are deduped.
    const tags = result.writes.map((write) => write.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('rounds at entry, then lines, then aggregates', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const rows = costsRows(base.index);
    // 0.333 becomes $0.33 at input; 0.335 rounds half-up to $0.34.
    let edited = setOccurrenceText(
      base.sfdt,
      rows[0].bindings.get('quantity')!,
      '3'
    );
    edited = setOccurrenceText(
      edited,
      rows[0].bindings.get('unit_cost')!,
      '0.333'
    );
    edited = setOccurrenceText(edited, rows[1].bindings.get('quantity')!, '3');
    edited = setOccurrenceText(
      edited,
      rows[1].bindings.get('unit_cost')!,
      '0.335'
    );

    const result = applyRules(edited, { prevValues: base.values });
    const after = costsRows(result.index);
    // Input display normalized to the rounded canonical value.
    expect(after[0].bindings.get('unit_cost')!.text).toBe('$0.33');
    expect(after[1].bindings.get('unit_cost')!.text).toBe('$0.34');
    expect(after[0].bindings.get('line_total')!.text).toBe('$0.99'); // 3 x 0.33
    expect(after[1].bindings.get('line_total')!.text).toBe('$1.02'); // 3 x 0.34
    expect(textsOf(result.index, 'grand_total')).toEqual(['$2.01', '$2.01']);
  });

  it('restores a stripped "$" as a recordable field write', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const cost = costsRows(base.index)[0].bindings.get('unit_cost')!;
    // The user deletes the $ and grouping; the value is unchanged (150).
    const edited = setOccurrenceText(base.sfdt, cost, '150');

    const result = applyRules(edited, { prevValues: base.values });
    expect(result.diagnostics).toEqual([]);
    expect(costsRows(result.index)[0].bindings.get('unit_cost')!.text).toBe(
      '$150.00'
    );
    // A FIELD write: the adapter must record it in editor history, because a
    // suppressed rewrite of a user-edited cell corrupts that cell's undo.
    expect(
      result.writes.some(
        (write) => write.text === '$150.00' && write.kind === 'field'
      )
    ).toBe(true);
    expect(result.structural).toBe(false);
    // Totals untouched: the value never changed.
    expect(textsOf(result.index, 'grand_total')).toEqual([
      '$7,800.00',
      '$7,800.00'
    ]);
  });

  it('self-heals without fighting undo: formulas recompute, fields stay put', () => {
    const doc = buildCostsFixture();
    const base = applyRules(doc, {});
    const rows = costsRows(base.index);
    // Simulate what an undo restores: raw "150" display (same value) in one
    // cell, and a genuinely reverted quantity in another.
    let restored = setOccurrenceText(
      base.sfdt,
      rows[0].bindings.get('unit_cost')!,
      '150'
    );
    restored = setOccurrenceText(
      restored,
      rows[0].bindings.get('quantity')!,
      '10'
    );

    const result = applyRules(restored, {
      prevValues: base.values,
      mode: 'self-heal'
    });
    expect(result.diagnostics).toEqual([]);
    const after = costsRows(result.index)[0];
    // Field text untouched - no re-normalization fighting the undo.
    expect(after.bindings.get('unit_cost')!.text).toBe('150');
    // But formulas recomputed from the restored inputs (10 x 150).
    expect(after.bindings.get('line_total')!.text).toBe('$1,500.00');
    expect(textsOf(result.index, 'grand_total')).toEqual([
      '$7,500.00',
      '$7,500.00'
    ]);
    // And every write is formula-kind: nothing for the adapter to record.
    expect(result.writes.length).toBeGreaterThan(0);
    expect(result.writes.every((write) => write.kind === 'formula')).toBe(true);
  });
});
