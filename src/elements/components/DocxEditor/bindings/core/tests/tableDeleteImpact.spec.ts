// The dry run behind the delete-table confirmation: which formulas outside a
// table stop evaluating once it is gone. The engine is the reference resolver;
// these specs pin the diffing on top of it.
import {
  analyzeRangeDeleteImpact,
  analyzeRowDeleteImpact,
  analyzeTableDeleteImpact
} from '../tableDeleteImpact';
import { buildCostsFixture } from './fixtures/costsFixture';
import { SfdtDocument } from '../sfdtTypes';

// Fixture top-level blocks: 0 heading, 1 project para, 2 costs wrapper,
// 3 spacer, 4 amount-due para (grand_total repeat), 5 heading, 6 expenses
// wrapper, 7 spacer, 8 combined_total para, 9 empty.
const COSTS_BLOCK = 2;
const EXPENSES_BLOCK = 6;
const COMBINED_PARA = 8;
const AMOUNT_DUE_PARA = 4;

function fixture(): SfdtDocument {
  return buildCostsFixture();
}

describe('analyzeTableDeleteImpact', () => {
  it('returns null for a block that is not a table', () => {
    expect(analyzeTableDeleteImpact(fixture(), 0, 0)).toBeNull();
    expect(analyzeTableDeleteImpact(fixture(), 0, AMOUNT_DUE_PARA)).toBeNull();
    expect(analyzeTableDeleteImpact(fixture(), 2, 99)).toBeNull();
  });

  it('reads the bound table id off the wrapper', () => {
    expect(analyzeTableDeleteImpact(fixture(), 0, COSTS_BLOCK)?.tableId).toBe(
      'costs'
    );
    expect(
      analyzeTableDeleteImpact(fixture(), 0, EXPENSES_BLOCK)?.tableId
    ).toBe('expenses');
  });

  it('finds every formula the deletion strands, dependents included', () => {
    // Deleting costs strands the grand_total repeat in prose (its inputs die
    // with the table) and, through it, combined_total.
    const impact = analyzeTableDeleteImpact(fixture(), 0, COSTS_BLOCK);
    expect(impact?.orphans.map((orphan) => orphan.name)).toEqual([
      'combined_total',
      'grand_total'
    ]);
    for (const orphan of impact?.orphans ?? [])
      expect(orphan.tags.length).toBeGreaterThan(0);
  });

  it('formulas that die with the table are not orphans', () => {
    // expenses_total lives only inside the expenses table; only the outside
    // reader combined_total is stranded.
    const impact = analyzeTableDeleteImpact(fixture(), 0, EXPENSES_BLOCK);
    expect(impact?.orphans.map((orphan) => orphan.name)).toEqual([
      'combined_total'
    ]);
  });

  it('ignores formulas that were already failing before the deletion', () => {
    const doc = fixture();
    // With expenses gone, combined_total is already broken; deleting costs is
    // then only responsible for grand_total.
    doc.sections?.[0]?.blocks?.splice(EXPENSES_BLOCK, 1);
    const impact = analyzeTableDeleteImpact(doc, 0, COSTS_BLOCK);
    expect(impact?.orphans.map((orphan) => orphan.name)).toEqual([
      'grand_total'
    ]);
  });

  it('reports no orphans when nothing outside the table reads it', () => {
    const doc = fixture();
    // Drop the prose consumers (descending so indexes stay valid).
    doc.sections?.[0]?.blocks?.splice(COMBINED_PARA, 1);
    doc.sections?.[0]?.blocks?.splice(AMOUNT_DUE_PARA, 1);
    const impact = analyzeTableDeleteImpact(doc, 0, COSTS_BLOCK);
    expect(impact?.tableId).toBe('costs');
    expect(impact?.orphans).toEqual([]);
    expect(impact?.scope).toBe('table');
  });
});

// Costs table rows: 0 header, 1 r-1, 2 r-2, 3 Subtotal, 4 Tax, 5 Total.
describe('analyzeRowDeleteImpact', () => {
  it('a data row dies without orphans - aggregates re-read the survivors', () => {
    const impact = analyzeRowDeleteImpact(fixture(), 0, COSTS_BLOCK, 1, 1);
    expect(impact?.scope).toBe('row');
    expect(impact?.tableId).toBe('costs');
    expect(impact?.orphans).toEqual([]);
  });

  it('deleting the Subtotal row strands everything that reads it', () => {
    // costs_tax = mul(costs_subtotal, ...), grand_total = sum(costs_subtotal,
    // costs_tax), combined_total = sum(grand_total, ...): all fail.
    const impact = analyzeRowDeleteImpact(fixture(), 0, COSTS_BLOCK, 3, 3);
    expect(impact?.orphans.map((orphan) => orphan.name)).toEqual([
      'combined_total',
      'costs_tax',
      'grand_total'
    ]);
  });

  it('deleting every row reports as a table deletion', () => {
    const impact = analyzeRowDeleteImpact(fixture(), 0, COSTS_BLOCK, 0, 5);
    expect(impact?.scope).toBe('table');
  });

  it('rejects out-of-range rows and non-table blocks', () => {
    expect(analyzeRowDeleteImpact(fixture(), 0, COSTS_BLOCK, 4, 9)).toBeNull();
    expect(analyzeRowDeleteImpact(fixture(), 0, COSTS_BLOCK, -1, 0)).toBeNull();
    expect(analyzeRowDeleteImpact(fixture(), 0, 0, 0, 0)).toBeNull();
  });
});

describe('analyzeRangeDeleteImpact', () => {
  const GRAND_TOTAL_TAG = () =>
    require('./fixtures/costsFixture').GRAND_TOTAL_TAG();

  it('scope is range and null table id', () => {
    const impact = analyzeRangeDeleteImpact(fixture(), []);
    expect(impact.scope).toBe('range');
    expect(impact.tableId).toBeNull();
  });

  it('removing every occurrence of an input strands the formulas that read it', () => {
    // grand_total feeds combined_total; wiping all its occurrences breaks it.
    const impact = analyzeRangeDeleteImpact(fixture(), [GRAND_TOTAL_TAG()]);
    expect(impact.orphans.map((o) => o.name)).toEqual(['combined_total']);
  });

  it('removing a self-contained value strands nothing', () => {
    // project.name is read by no formula.
    const projectTag = fixture()
      .sections![0].blocks!.flatMap((b) => b.inlines ?? [])
      .map((i) => String(i.contentControlProperties?.tag ?? ''))
      .find((t) => t.includes('project.name'))!;
    expect(analyzeRangeDeleteImpact(fixture(), [projectTag]).orphans).toEqual(
      []
    );
  });

  it('no removed tags means no orphans', () => {
    expect(analyzeRangeDeleteImpact(fixture(), []).orphans).toEqual([]);
  });
});
