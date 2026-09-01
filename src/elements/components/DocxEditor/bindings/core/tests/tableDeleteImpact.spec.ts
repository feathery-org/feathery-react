// The dry run behind the delete-table confirmation: which formulas outside a
// table stop evaluating once it is gone. The engine is the reference resolver;
// these specs pin the diffing on top of it.
import { analyzeTableDeleteImpact } from '../tableDeleteImpact';
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
  });
});
