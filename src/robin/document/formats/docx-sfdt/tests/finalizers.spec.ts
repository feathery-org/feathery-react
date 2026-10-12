/**
 * The restripe finalizer: rows that move band take their band's fill, and a cell that already has
 * its band's fill keeps its format entry exactly, whichever way the editor spelled "no fill".
 */
import * as fs from 'fs';
import * as path from 'path';
import { WriteInput } from '../../../envelope';
import { DocumentSession } from '../../../session';
import { NfNode, baseOf, shapeOf } from '../../../tree';
import { docxTree } from '../tree';
import { prepareWrite } from '../../../verbs';
import { docxPack } from '../index';
import { setControlText } from '../finalizers/formulas';
import { arr } from '../util';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');
const state = () => {
  let doc = flagship;
  const host = { serialize: () => doc, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
  return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
};
const tableAt = (root: NfNode, s: number, b: number): NfNode =>
  arr<NfNode>(arr<NfNode>(arr<NfNode>(root.sections)[s].blocks)[b].blocks)[0];
const fill = (formats: Record<string, Record<string, unknown>>, cell: NfNode) => {
  const shading = formats[String(cell.style)]?.shading as Record<string, unknown> | undefined;
  const raw = typeof shading?.backgroundColor === 'string' ? shading.backgroundColor : '';
  return !raw || raw.toLowerCase() === 'empty' ? 'NONE' : raw.toUpperCase();
};

describe('restripe finalizer', () => {
  it('deleting a body row restripes only the rows that changed band', () => {
    const s = state();
    const table = tableAt(s.view.nf.root, 3, 10);
    const rows = arr<NfNode>(table.rows);
    const row = rows[2];
    const r = prepareWrite(s, { intent: 'test', scope: { ids: [row.id] }, changes: [{ kind: 'delete', id: row.id, base: baseOf(row) }] } as WriteInput);
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    const after = arr<NfNode>(tableAt(r.intended.root, 3, 10).rows);
    // the band cycle of the original body, read back from the original rows
    const bandOf = rows.map((x) => fill(s.view.nf.formats, arr<NfNode>(x.cells)[0]));
    const restriped = new Set(r.facts.filter((f) => f.kind === 'finalizer' && f.name === 'restripe').flatMap((f) => f.ids));
    after.forEach((x, i) => {
      for (const [j, cell] of arr<NfNode>(x.cells).entries()) {
        const was = arr<NfNode>(rows[i].cells)[j];
        if (fill(r.intended.formats, cell) === fill(s.view.nf.formats, was) && !restriped.has(cell.id)) continue;
        // a restriped cell carries the fill of the row that used to sit at its index
        expect(fill(r.intended.formats, cell)).toBe(bandOf[i]);
      }
    });
    // rows above the deletion are untouched, including the unfilled ones spelled "empty"
    for (const x of after.slice(0, 2))
      for (const cell of arr<NfNode>(x.cells)) expect(restriped.has(cell.id)).toBe(false);
    expect(restriped.size).toBeGreaterThan(0);
  });
});

describe('table identity finalizer', () => {
  it('a copied bound table gets its own table id; the original keeps its own', () => {
    const s = state();
    const sections = arr<NfNode>(s.view.nf.root.sections);
    const control = arr<NfNode>(sections[1].blocks)[10];
    const original = (control.binding as { table?: string }).table;
    expect(typeof original).toBe('string');
    const strip = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['id', 'base', 'shape', 'pending'].includes(k)).map(([k, x]) => [k, strip(x)])) : v;
    const r = prepareWrite(s, {
      intent: 'Repeat the property premium table.',
      scope: { ids: [control.id] },
      changes: [{ kind: 'insert_after', anchor: control.id, container: shapeOf(sections[1], docxTree), node: strip(control) }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 700));
    const blocks = arr<NfNode>(arr<NfNode>(r.intended.root.sections)[1].blocks);
    const ids = [blocks[10], blocks[11]].map((b) => (b.binding as { table?: string }).table);
    expect(ids[0]).toBe(original);
    expect(ids[1]).not.toBe(original);
    expect(typeof ids[1]).toBe('string');
    expect(r.facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'finalizer', name: 'tables' })]));
  });
});

describe('formula finalizer: writing a control text', () => {
  it('replaces the runs and keeps every other inline (a bookmark end, a field) where it was', () => {
    const control = {
      id: 'c1',
      kind: 'control',
      inlines: [
        { id: 'b1', kind: 'bookmark', name: 'total', type: 0 },
        { id: 'r1', kind: 'run', text: '$1', style: 'f1' },
        { id: 'r2', kind: 'run', text: '0.00' },
        { id: 'b2', kind: 'bookmark', name: 'total', type: 1 }
      ]
    } as unknown as NfNode;
    const changed = setControlText(control, '$12.00');
    expect((control.inlines as NfNode[]).map((i) => [i.id, i.kind, i.text])).toEqual([
      ['b1', 'bookmark', undefined],
      ['r1', 'run', '$12.00'],
      ['b2', 'bookmark', undefined]
    ]);
    expect(changed).toEqual(expect.arrayContaining(['c1', 'r1']));
    // already right: nothing written
    expect(setControlText(control, '$12.00')).toEqual([]);
  });

  it('leaves a pending deletion inside the control where it is: it belongs to another card', () => {
    const control = {
      id: 'c1',
      kind: 'control',
      inlines: [
        { id: 'r0', kind: 'run', text: '$5.00', pending: { kind: 'Deletion', author: 'Robin', group: 'turn-1' } },
        { id: 'r1', kind: 'run', text: '$6.00', pending: { kind: 'Insertion', author: 'Robin', group: 'turn-1' } }
      ]
    } as unknown as NfNode;
    setControlText(control, '$7.00');
    expect((control.inlines as NfNode[]).map((i) => [i.id, i.text])).toEqual([
      ['r0', '$5.00'],
      ['r1', '$7.00']
    ]);
    // the live text already reads right: nothing to write
    expect(setControlText(control, '$7.00')).toEqual([]);
  });
});

describe('width units finalizer', () => {
  // a table laid out 100 + 300 points: the header row in percent, the body rows Auto (laid out)
  const cell = (text: string, cf: Record<string, unknown>) => ({ cellFormat: { ...cf, columnSpan: 1, rowSpan: 1 }, blocks: [{ inlines: [{ text }] }] });
  const sfdt = JSON.stringify({
    sections: [
      {
        blocks: [
          {
            tableFormat: { preferredWidth: 100, preferredWidthType: 'Percent' },
            grid: [100, 300],
            columnCount: 2,
            rows: [
              { rowFormat: {}, cells: [cell('Coverage', { preferredWidth: 25, preferredWidthType: 'Percent', cellWidth: 100 }), cell('Premium', { preferredWidth: 75, preferredWidthType: 'Percent', cellWidth: 300 })] },
              { rowFormat: {}, cells: [cell('Auto', { preferredWidthType: 'Auto', cellWidth: 100 }), cell('$1', { preferredWidthType: 'Auto', cellWidth: 300 })] }
            ]
          }
        ]
      }
    ]
  });
  const mount = () => {
    let d = sfdt;
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
  };

  it('a percent width on one cell of a row of Auto cells gives the others their laid-out width in percent', () => {
    const s = mount();
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const firsts = arr<NfNode>(table.rows).map((r) => arr<NfNode>(r.cells)[0]);
    const r = prepareWrite(s, {
      intent: 'Narrow the first column to 20%.',
      scope: { ids: firsts.map((c) => c.id) },
      changes: [{ kind: 'set', target: { ids: firsts.map((c) => c.id), shape: Object.fromEntries(firsts.map((c) => [c.id, shapeOf(c, docxTree)])) }, props: { preferredWidth: 20, preferredWidthType: 'Percent' } }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 500));
    const body = arr<NfNode>(arr<NfNode>(arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[0].rows)[1].cells);
    const w = (c: NfNode) => r.intended.formats[String(c.style)];
    expect(w(body[0])).toEqual(expect.objectContaining({ preferredWidth: 20, preferredWidthType: 'Percent' }));
    // the Auto sibling, laid out at 300 of 400 points, becomes 75 percent: the row has one unit
    expect(w(body[1])).toEqual(expect.objectContaining({ preferredWidth: 75, preferredWidthType: 'Percent' }));
    expect(r.facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'finalizer', name: 'width-units' })]));
  });

  it('a percent width written into a row of point widths converts the row to percent', () => {
    let d = sfdt.replace(/"preferredWidthType":"Auto","cellWidth":(\d+)/g, '"preferredWidth":$1,"preferredWidthType":"Point","cellWidth":$1');
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const c = arr<NfNode>(arr<NfNode>(table.rows)[1].cells)[0];
    const r = prepareWrite(s, { intent: 'x', scope: { ids: [c.id] }, changes: [{ kind: 'set', target: { ids: [c.id], shape: { [c.id]: shapeOf(c, docxTree) } }, props: { preferredWidth: 20, preferredWidthType: 'Percent' } }] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(r.outcome);
    const body = arr<NfNode>(arr<NfNode>(arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[0].rows)[1].cells);
    expect(r.intended.formats[String(body[1].style)]).toEqual(expect.objectContaining({ preferredWidth: 75, preferredWidthType: 'Percent' }));
  });

  it('leaves a row alone when every cell already has the unit, or none was written', () => {
    const s = mount();
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const head = arr<NfNode>(arr<NfNode>(table.rows)[0].cells)[0];
    const r = prepareWrite(s, { intent: 'x', scope: { ids: [head.id] }, changes: [{ kind: 'set', target: { ids: [head.id], shape: { [head.id]: shapeOf(head, docxTree) } }, props: { preferredWidth: 30, preferredWidthType: 'Percent' } }] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(r.outcome);
    expect(r.facts.some((f) => f.kind === 'finalizer' && f.name === 'width-units')).toBe(false);
  });
});

describe('column fit finalizer', () => {
  // a letter page, one inch margins: 468 points between them
  const cell = (text: string, width: number) => ({ cellFormat: { preferredWidth: width, preferredWidthType: 'Point', cellWidth: width, columnSpan: 1, rowSpan: 1 }, blocks: [{ inlines: [{ text }] }] });
  const sfdtOf = (widths: number[]) =>
    JSON.stringify({
      sections: [
        {
          sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72 },
          blocks: [
            {
              tableFormat: {},
              grid: widths,
              columnCount: widths.length,
              rows: [
                { rowFormat: {}, cells: widths.map((w, i) => cell(`Head ${i}`, w)) },
                { rowFormat: {}, cells: widths.map((w, i) => cell(`Body ${i}`, w)) }
              ]
            }
          ]
        }
      ]
    });
  const addColumn = (widths: number[]) => {
    let d = sfdtOf(widths);
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const rows = arr<NfNode>(table.rows);
    const lasts = rows.map((r) => arr<NfNode>(r.cells)[arr<NfNode>(r.cells).length - 1]);
    const r = prepareWrite(s, {
      intent: 'Add a column.',
      scope: { ids: lasts.map((c) => c.id) },
      changes: lasts.map((c, i) => ({
        kind: 'insert_after',
        anchor: c.id,
        container: shapeOf(rows[i], docxTree),
        node: { kind: 'cell', style: c.style, blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: 'New' }] }] }
      }))
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    const out = arr<NfNode>(arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[0].rows).map((row) =>
      arr<NfNode>(row.cells).map((c) => r.intended.formats[String(c.style)]?.preferredWidth)
    );
    return { widths: out, facts: r.facts };
  };

  it('a column added to a table that fit the page narrows the other columns in proportion, so it still fits', () => {
    const { widths, facts } = addColumn([156, 312]);
    // the new column keeps its width; the others share the rest of the 468 points, 1:2 as before
    // (the new cell copies the last one's format: 312 points)
    expect(widths).toEqual([[52, 104, 312], [52, 104, 312]]);
    expect(facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'finalizer', name: 'column-fit' })]));
  });

  it('a width set wider than the text scales the row to fit and says the widths it fitted (matrix-1 T2)', () => {
    let d = sfdtOf([156, 312]);
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const columns = [0, 1].map((k) => arr<NfNode>(table.rows).map((r) => arr<NfNode>(r.cells)[k]));
    const setWidth = (cells: NfNode[], width: number) => ({ kind: 'set', target: { ids: cells.map((c) => c.id), shape: Object.fromEntries(cells.map((c) => [c.id, shapeOf(c, docxTree)])) }, props: { preferredWidth: width, preferredWidthType: 'Point' } });
    const r = prepareWrite(s, { intent: 'Set the widths.', scope: { ids: columns.flat().map((c) => c.id) }, changes: [setWidth(columns[0], 200), setWidth(columns[1], 400)] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    const widths = arr<NfNode>(arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[0].rows).map((row) => arr<NfNode>(row.cells).map((c) => r.intended.formats[String(c.style)]?.preferredWidth));
    // 600 asked on 468 between the margins: 1:2 kept
    expect(widths).toEqual([[156, 312], [156, 312]]);
    const fact = r.facts.find((f) => f.name === 'column-fit');
    expect(fact?.summary).toMatch(/200, 400 .*600.*468.*156, 312/);
  });

  it('leaves a table that still fits, and one that did not fit before, as written', () => {
    expect(addColumn([100, 100]).widths).toEqual([[100, 100, 100], [100, 100, 100]]);
    expect(addColumn([300, 300]).facts.some((f) => f.name === 'column-fit')).toBe(false);
  });
});

describe('restripe on cell changes and splits (matrix-1 T3, T4, T11: the model\'s own writes)', () => {
  const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', 'matrix-1-run.json'), 'utf8')) as { writes: Array<{ task: string; fixture: string; input: WriteInput }> };
  const replay = (task: string, only?: (input: WriteInput) => WriteInput) => {
    const found = run.writes.find((x) => x.task === task) as { fixture: string; input: WriteInput };
    const w = { ...found, input: only ? only(found.input) : found.input };
    let doc = fs.readFileSync(path.join(__dirname, 'corpus', w.fixture), 'utf8');
    const host = { serialize: () => doc, open: (s: string) => { doc = s; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const r = prepareWrite(s, w.input);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    return { before: s, r };
  };
  const borders = (formats: Record<string, Record<string, unknown>>, cell: NfNode) => JSON.stringify(formats[String(cell.style)]?.borders ?? null);
  // the property table's body rows before: Buildings, Contents, Stock, Business interruption, Machinery breakdown
  const BANDS = ['NONE', '#E6E6E6FF', 'NONE', '#E6E6E6FF', 'NONE'];

  it.each(['T3', 'T11'])('%s: a new column\'s cells take their row\'s fill and borders', (task) => {
    const { before, r } = replay(task);
    const table = tableAt(r.intended.root, 1, 10);
    const old = before.view.get(table.id) as NfNode;
    const rows = arr<NfNode>(table.rows);
    rows.forEach((row, i) => {
      const cells = arr<NfNode>(row.cells);
      const had = new Set(arr<NfNode>(arr<NfNode>(old.rows)[i]?.cells).map((c) => c.id));
      const kept = cells.filter((c) => had.has(c.id));
      const fresh = cells.filter((c) => !had.has(c.id));
      for (const c of fresh) {
        expect([task, i, fill(r.intended.formats, c)]).toEqual([task, i, fill(r.intended.formats, kept[kept.length - 1])]);
        expect(borders(r.intended.formats, c)).toBe(borders(r.intended.formats, kept[kept.length - 1]));
      }
    });
    expect(r.facts.some((f) => f.name === 'restripe')).toBe(true);
  });

  it('T4: both tables that came out of a split carry the banding from their first body row', () => {
    // the split alone: its two summary rewrites name controls by the ids of the rig's session, whose
    // fixture the editor had laid out first (ids after the tables run differently there)
    const { r } = replay('T4', (input) => ({ ...input, scope: { ids: ['n118', 'n187', 'n204', 'n119'] }, changes: input.changes.slice(0, 4) }));
    const control = arr<NfNode>(arr<NfNode>(r.intended.root.sections)[1].blocks);
    const tables = control.filter((b) => b.kind === 'control' && arr<NfNode>(b.blocks)[0]?.kind === 'table').map((b) => arr<NfNode>(b.blocks)[0]).slice(0, 2);
    const bodyFills = (t: NfNode) => arr<NfNode>(t.rows).slice(1).filter((row) => !/subtotal/i.test(JSON.stringify(row))).map((row) => fill(r.intended.formats, arr<NfNode>(row.cells)[0]));
    expect(bodyFills(tables[0])).toEqual(BANDS.slice(0, 3));
    expect(bodyFills(tables[1])).toEqual(BANDS.slice(0, 2));
  });
});
