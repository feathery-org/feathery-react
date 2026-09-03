/**
 * The role spec: what deriveTableStructure owes, WRITTEN BEFORE IT EXISTS.
 *
 * Slice 2 increment 1 - the smallest end-to-end piece of the table structural
 * schema. Roles only, no handler changes, nothing composed yet.
 *
 * The roles are header | item | aggregate | static, and each is derived from
 * evidence rather than guessed:
 *   header     the caller's header-row count, which has one owner elsewhere
 *   item       a row-scoped binding, or banding-majority for an unbound table
 *   aggregate  a formula that depends on THIS table's own column
 *   static     everything else
 */
import * as fs from 'fs';
import * as path from 'path';
import { deriveTableStructure } from '../tableStructure';

const CORPUS = path.join(__dirname, 'corpus');
const readShape = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(CORPUS, `${name}.sfdt.json`), 'utf8'));

/** Every table block in the document, descending content-control wrappers. */
const tablesIn = (sfdt: any): any[] => {
  const out: any[] = [];
  const walk = (blocks: any[] | undefined) =>
    (blocks ?? []).forEach((b) => {
      if (Array.isArray(b?.rows)) {
        out.push(b);
        return;
      }
      if (Array.isArray(b?.blocks)) walk(b.blocks);
    });
  (sfdt.sections ?? []).forEach((s: any) => walk(s.blocks));
  return out;
};

/** name -> expression for every formula tag in the document. */
const documentFormulas = (sfdt: any): Map<string, string> => {
  const out = new Map<string, string>();
  for (const m of JSON.stringify(sfdt).matchAll(
    /\[\[name=([^|\]]+)\|[^\]]*?expr=([^|\]]+)/g
  ))
    out.set(m[1], m[2]);
  return out;
};

describe('deriveTableStructure - roles from evidence', () => {
  const flagship = readShape('flagship-proposal');
  const tables = tablesIn(flagship);
  const inventory = tables[0];
  const formulas = documentFormulas(flagship);

  it('(a) the flagship inventory table: 1 header, 15 items, 3 aggregates', () => {
    const structure = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: formulas
    });
    const roles = structure.rows.map((r) => r.role);
    expect(roles).toHaveLength(19);
    expect(roles[0]).toBe('header');
    expect(roles.slice(1, 16)).toEqual(Array(15).fill('item'));
    expect(roles.slice(16)).toEqual(['aggregate', 'aggregate', 'aggregate']);
  });

  it('(b) the aggregate rows name the formulas that made them aggregates', () => {
    const structure = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: formulas
    });
    expect(structure.rows[16].aggregates).toEqual(['subtotal']);
    expect(structure.rows[17].aggregates).toEqual(['tax']);
    expect(structure.rows[18].aggregates).toEqual(['total']);
  });

  it('(c) an aggregate is TRANSITIVE, not only a direct dotted ref', () => {
    // This is the case the flagship exists to force, and the reason the rule is
    // not "holds a dotted ref to this table". Only `subtotal` says
    // sum(inventory.line_total) outright. `tax` is mul(subtotal, tax_rate) and
    // `total` is sum(subtotal, tax) - neither mentions the table, yet both are
    // wholly determined by its rows, so a fragment that took the item rows away
    // and left them behind would strand two values that silently no longer mean
    // anything. A direct-ref-only rule classifies them as static and gets that
    // wrong.
    const structure = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: formulas
    });
    expect(structure.rows[17].role).toBe('aggregate');
    expect(structure.rows[18].role).toBe('aggregate');

    // NEGATIVE CONTROL: with the chain hidden, only the direct one survives.
    const shallow = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: new Map()
    });
    expect(shallow.rows[16].role).toBe('aggregate');
    expect(shallow.rows[17].role).not.toBe('aggregate');
  });

  it('(d) a formula about ANOTHER table is not this table aggregate', () => {
    const structure = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 1,
      tableId: 'somethingElse',
      documentFormulas: formulas
    });
    expect(structure.rows.filter((r) => r.role === 'aggregate')).toHaveLength(
      0
    );
  });

  it('(e) items carry their binding row id', () => {
    const structure = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: formulas
    });
    expect(structure.rows[1].rowId).toBe('r-1');
    expect(structure.rows[15].rowId).toBe('r-15');
  });

  it('(f) an UNBOUND table treats every non-header row as an item', () => {
    // Named for what it actually asserts. The design calls for banding-majority
    // here - consult the appearance facts and let the rows inside the stripe
    // cycle be the data - and that is NOT what runs yet: the appearance facts
    // only reach this seam once the finalizer exists. Until then every
    // non-header row of an unbound table is an item.
    //
    // The simplification is deliberate and it is load-bearing in one direction
    // only: without it every row of an unbound table would be static and the
    // schema would be useless on unbound documents, which is most of them. When
    // banding arrives, this row gets a table whose stripe cycle and data rows
    // DISAGREE, so it can tell the two rules apart; today's fixture cannot,
    // which is exactly why the name no longer claims it does.
    const unbound = tables[1];
    const structure = deriveTableStructure({
      tableBlock: unbound,
      headerRows: 1,
      tableId: null,
      documentFormulas: formulas
    });
    expect(structure.rows[0].role).toBe('header');
    expect(structure.rows.slice(1).every((r) => r.role === 'item')).toBe(true);
  });

  it("(g) header rows are the caller's count, never re-inferred here", () => {
    // One owner. effectiveHeaderRows decides this elsewhere; asking a second
    // question here is how a style-only header and a filled header disagree.
    const two = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 2,
      tableId: 'inventory',
      documentFormulas: formulas
    });
    expect(two.rows.slice(0, 2).map((r) => r.role)).toEqual([
      'header',
      'header'
    ]);
    expect(two.headerRows).toBe(2);
  });

  it('(h) a formula CYCLE terminates instead of recursing forever', () => {
    // sum(a) where a is sum(b) and b is sum(a). The dependency walk follows refs
    // through other formulas, so without the seen-set this call never returns -
    // and a hang in a planner is worse than a wrong answer, because nothing
    // reports it.
    const cyclic = new Map([
      ['a', 'sum(b)'],
      ['b', 'sum(a)']
    ]);
    const structure = deriveTableStructure({
      tableBlock: inventory,
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: cyclic
    });
    expect(structure.rows).toHaveLength(19);
  });

  it('(i) an EMPTY table yields no rows and does not throw', () => {
    const structure = deriveTableStructure({
      tableBlock: { rows: [] },
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: formulas
    });
    expect(structure.rows).toEqual([]);
    expect(structure.headerRows).toBe(1);
  });

  it('(j) a table that is ONLY a header row has no items', () => {
    // The degenerate shape a split could leave behind. Every row is inside the
    // header band, so nothing may be classified as data.
    const headerOnly = { rows: [(inventory.rows ?? inventory.r)[0]] };
    const structure = deriveTableStructure({
      tableBlock: headerOnly,
      headerRows: 1,
      tableId: 'inventory',
      documentFormulas: formulas
    });
    expect(structure.rows.map((r) => r.role)).toEqual(['header']);
  });
});
