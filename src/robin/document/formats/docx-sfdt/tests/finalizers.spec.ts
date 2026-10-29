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
import { makeView } from '../../../view';
import { docxPack } from '../index';
import { setControlText } from '../finalizers/formulas';
import { tableIdentityFinalizer } from '../finalizers/structure';
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

  it('reordering item rows of a bound table leaves its subtotal row\'s fill alone', () => {
    const s = state();
    const control = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections).flatMap((x) => arr<NfNode>(x.blocks))).find(
      (b) => (b.binding as { table?: string } | undefined)?.table === 'property_premium'
    ) as NfNode;
    const table = arr<NfNode>(control.blocks)[0];
    const rows = arr<NfNode>(table.rows);
    const subtotal = rows[rows.length - 1];
    const r = prepareWrite(s, {
      intent: 'Swap the first two items.',
      scope: { ids: [rows[1].id] },
      changes: [{ kind: 'move', id: rows[1].id, shape: shapeOf(rows[1], docxTree), anchor: rows[2].id, container: shapeOf(table, docxTree), position: 'after' }]
    } as WriteInput);
    expect(r.outcome).toBe('verified');
    if (r.outcome !== 'verified') return;
    const restriped = new Set(r.facts.filter((f) => f.kind === 'finalizer' && f.name === 'restripe').flatMap((f) => f.ids));
    expect(restriped.size).toBeGreaterThan(0);
    for (const cell of arr<NfNode>(subtotal.cells)) expect(restriped.has(cell.id)).toBe(false);
  });
});

describe('a new table takes the look of the document\'s tables (Codex review D5)', () => {
  // the flagship's banded table at sections[3].blocks[10]: write a new one after it with no fills
  const newTableAfter = (rows: number, keepHeaderFill = false) => {
    const s = state();
    const source = tableAt(s.view.nf.root, 3, 10);
    const control = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[3].blocks)[10];
    const section = arr<NfNode>(s.view.nf.root.sections)[3];
    const width = arr<NfNode>(arr<NfNode>(source.rows)[0].cells).length;
    const headFill = keepHeaderFill ? { 'tmp:h': { shading: { backgroundColor: '#123456' } } } : {};
    const row = (t: string, header = false) => ({
      kind: 'row',
      cells: Array.from({ length: width }, (_, k) => ({ kind: 'cell', ...(header && keepHeaderFill ? { style: 'tmp:h' } : {}), blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: `${t}${k}` }] }] }))
    });
    const r = prepareWrite(s, {
      intent: 'Add a table.',
      scope: { ids: [] },
      formats: headFill,
      changes: [{ kind: 'insert_after', anchor: control.id, container: shapeOf(section, docxTree), node: { kind: 'table', rows: [row('H', true), ...Array.from({ length: rows - 1 }, (_, i) => row(`B${i}`))] } }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    const created = arr<NfNode>(arr<NfNode>(r.intended.root.sections)[3].blocks)[11];
    const fills = arr<NfNode>(created.rows).map((x) => arr<NfNode>(x.cells).map((c) => fill(r.intended.formats, c)));
    const sourceFills = arr<NfNode>(source.rows).map((x) => arr<NfNode>(x.cells).map((c) => fill(s.view.nf.formats, c)));
    return { fills, sourceFills, facts: r.facts };
  };

  it('its header row takes the header fill and its body rows the bands of the table before it', () => {
    const { fills, sourceFills, facts } = newTableAfter(5);
    expect(fills[0]).toEqual(sourceFills[0]);
    expect(new Set(fills.slice(1).map((r) => r[0])).size).toBeGreaterThan(1);
    expect(fills.slice(1).map((r) => r[0])).toEqual(sourceFills.slice(1, 5).map((r) => r[0]));
    expect(facts.some((f) => f.kind === 'finalizer' && f.name === 'restripe')).toBe(true);
  });

  it('a header fill the write gives is kept', () => {
    const { fills } = newTableAfter(5, true);
    expect(fills[0].every((f) => f === '#123456')).toBe(true);
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

describe('table identity finalizer: copies the document already had', () => {
  it("leaves a pending move's two bound copies alone in a later write (b592d997 t7)", () => {
    const s = state();
    const sections = arr<NfNode>(s.view.nf.root.sections);
    const blocks = arr<NfNode>(sections[1].blocks);
    const control = blocks[10];
    blocks.splice(2, 0, { ...JSON.parse(JSON.stringify(control)), id: 'ghost' });
    const before = makeView(s.view.nf, docxPack);
    const after = JSON.parse(JSON.stringify(s.view.nf));
    const r = tableIdentityFinalizer.run(after, { before, formats: s.view.nf.formats, residue: s.residue });
    expect(r.ids).toEqual([]);
    expect(r.facts).toEqual([]);
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

  it('a table with its own point width fits its cells into that width, not the text width (matrix-2 T2)', () => {
    let d = sfdtOf([156, 312]).replace('"tableFormat":{}', '"tableFormat":{"preferredWidth":400,"preferredWidthType":"Point"}');
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const columns = [0, 1].map((k) => arr<NfNode>(table.rows).map((r) => arr<NfNode>(r.cells)[k]));
    const setWidth = (cells: NfNode[], width: number) => ({ kind: 'set', target: { ids: cells.map((c) => c.id), shape: Object.fromEntries(cells.map((c) => [c.id, shapeOf(c, docxTree)])) }, props: { preferredWidth: width, preferredWidthType: 'Point' } });
    // 500 asked: under the 468 of text, over the table's own 400
    const r = prepareWrite(s, { intent: 'Set the widths.', scope: { ids: columns.flat().map((c) => c.id) }, changes: [setWidth(columns[0], 200), setWidth(columns[1], 300)] } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    const widths = arr<NfNode>(arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[0].rows).map((row) => arr<NfNode>(row.cells).map((c) => r.intended.formats[String(c.style)]?.preferredWidth));
    expect(widths).toEqual([[160, 240], [160, 240]]);
    expect(r.facts.find((f) => f.name === 'column-fit')?.summary).toMatch(/200, 300 pt \(500 pt\).*400 pt.*160, 240/);
  });

  // a new table written with no widths: the editor would lay out a zero grid (lane, matrix T10)
  const newTable = (tableFormat?: Record<string, unknown>, cellWidth?: number) => {
    let d = sfdtOf([156, 312]);
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const section = arr<NfNode>(s.view.nf.root.sections)[0];
    const anchor = arr<NfNode>(section.blocks)[0];
    const cell = (t: string, k: number) => ({ kind: 'cell', ...(cellWidth !== undefined && k === 0 ? { style: 'tmp:w' } : {}), blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: t }] }] });
    const row = (p: string) => ({ kind: 'row', cells: [0, 1, 2].map((k) => cell(`${p}${k}`, k)) });
    const r = prepareWrite(s, {
      intent: 'Add a table.',
      scope: { ids: [] },
      formats: { ...(tableFormat ? { 'tmp:t': tableFormat } : {}), ...(cellWidth !== undefined ? { 'tmp:w': { preferredWidth: cellWidth, preferredWidthType: 'Point' } } : {}) },
      changes: [{ kind: 'insert_after', anchor: anchor.id, container: shapeOf(section, docxTree), node: { kind: 'table', ...(tableFormat ? { style: 'tmp:t' } : {}), rows: [row('H'), row('B')] } }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    const table = arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[1];
    const widths = arr<NfNode>(table.rows).map((x) =>
      arr<NfNode>(x.cells).map((c) => {
        const f = r.intended.formats[String(c.style)] ?? {};
        if (f.preferredWidth === undefined) return 'none';
        return `${f.preferredWidth}${f.preferredWidthType === 'Point' ? 'pt' : f.preferredWidthType}`;
      })
    );
    return { widths, fact: r.facts.find((f) => f.name === 'column-fit') };
  };

  it('a new table written with no widths shares the text width equally, and says so (matrix T10)', () => {
    const { widths, fact } = newTable();
    expect(widths).toEqual([['156pt', '156pt', '156pt'], ['156pt', '156pt', '156pt']]);
    expect(fact?.summary).toMatch(/no widths.*3 columns.*468 pt.*156 pt each/);
  });

  it('a new table that sets its own width shares that width: a point width, and a percent of the text', () => {
    expect(newTable({ preferredWidth: 300, preferredWidthType: 'Point' }).widths[0]).toEqual(['100pt', '100pt', '100pt']);
    expect(newTable({ preferredWidth: 50, preferredWidthType: 'Percent' }).widths[1]).toEqual(['78pt', '78pt', '78pt']);
  });

  it('a new table with any width written is left as written', () => {
    const { widths, fact } = newTable(undefined, 200);
    expect(widths[0][0]).toBe('200pt');
    expect(widths[0][1]).toBe('none');
    expect(fact).toBeUndefined();
  });

  // Codex review D6: a table made of moved rows keeps the widths its cells were laid out at
  it('a new table made of moved cells keeps their laid-out widths: no equal shares (review D6)', () => {
    let d = sfdtOf([156, 312]).replace(/"preferredWidth":(\d+),"preferredWidthType":"Point"/g, '"preferredWidthType":"Auto"');
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    const section = arr<NfNode>(s.view.nf.root.sections)[0];
    const table = arr<NfNode>(section.blocks)[0];
    const body = arr<NfNode>(table.rows)[1];
    const r = prepareWrite(s, {
      intent: 'Split the table.',
      scope: { ids: [body.id, table.id] },
      changes: [
        { kind: 'insert_after', anchor: table.id, container: shapeOf(section, docxTree), node: { id: 'tmp:t', kind: 'table', rows: [{ id: 'tmp:head', kind: 'row', cells: [0, 1].map((k) => ({ kind: 'cell', blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: `H${k}` }] }] })) }] } },
        { kind: 'move', id: body.id, shape: shapeOf(body, docxTree), anchor: 'tmp:head', container: 'tmp:t', position: 'after' }
      ]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 900));
    expect(r.facts.find((f) => f.name === 'column-fit' && /no widths/.test(f.summary))).toBeUndefined();
  });

  it('a nested table with its own point width shares that width; one in a point-width cell shares the cell (review 4)', () => {
    const nested = (tableFormat?: Record<string, unknown>) => {
      let d = sfdtOf([156, 312]);
      const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
      const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
      const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
      const cell = arr<NfNode>(arr<NfNode>(table.rows)[1].cells)[1];
      const para = arr<NfNode>(cell.blocks)[0];
      const r = prepareWrite(s, {
        intent: 'Nest a table.',
        scope: { ids: [] },
        formats: tableFormat ? { 'tmp:t': tableFormat } : {},
        changes: [{ kind: 'insert_after', anchor: para.id, container: shapeOf(cell, docxTree), node: { kind: 'table', ...(tableFormat ? { style: 'tmp:t' } : {}), rows: [{ kind: 'row', cells: ['A', 'B'].map((t) => ({ kind: 'cell', blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: t }] }] })) }] } }]
      } as WriteInput);
      if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
      const inner = arr<NfNode>(arr<NfNode>(arr<NfNode>(arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[0].rows)[1].cells)[1].blocks)[1];
      return arr<NfNode>(arr<NfNode>(inner.rows)[0].cells).map((c) => r.intended.formats[String(c.style)]?.preferredWidth);
    };
    expect(nested({ preferredWidth: 200, preferredWidthType: 'Point' })).toEqual([100, 100]);
    // the cell is 312 points wide: its nested table shares that, less the cell's own margins
    expect(nested()).toEqual([150.6, 150.6]);
  });

  // Codex review D7: amounts must not wrap mid-number when a column narrows
  const moneyTable = (widths: number[]) => {
    const cellOf = (text: string, width: number) => ({ cellFormat: { preferredWidth: width, preferredWidthType: 'Point', cellWidth: width, columnSpan: 1, rowSpan: 1 }, blocks: [{ inlines: [{ text }] }] });
    const texts = [['Coverage', 'Carrier', 'Premium'], ['Business Auto', 'Old Guard', '$1,450,554.00'], ['Total Annual Premium', '', '$1,471,389.04']];
    let d = JSON.stringify({ sections: [{ sectionFormat: { pageWidth: 612, pageHeight: 792, leftMargin: 72, rightMargin: 72 }, blocks: [{ tableFormat: {}, grid: widths, columnCount: widths.length, rows: texts.map((row) => ({ rowFormat: {}, cells: row.map((t, i) => cellOf(t, widths[i])) })) }] }] });
    const host = { serialize: () => d, open: (x: string) => { d = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    return new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
  };
  const widthsAfter = (r: any) => arr<NfNode>(arr<NfNode>(arr<NfNode>(r.intended.root.sections)[0].blocks)[0].rows).map((row) => arr<NfNode>(row.cells).map((c) => Number(r.intended.formats[String(c.style)]?.preferredWidth)));

  it('a column added narrows the others, never an amount column below its longest amount (review D7)', () => {
    const s = moneyTable([234, 117, 117]);
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const rows = arr<NfNode>(table.rows);
    const lasts = rows.map((r) => arr<NfNode>(r.cells)[2]);
    const r = prepareWrite(s, { intent: 'Add a column.', scope: { ids: lasts.map((c) => c.id) }, changes: lasts.map((c, i) => ({ kind: 'insert_after', anchor: c.id, container: shapeOf(rows[i], docxTree), node: { kind: 'cell', style: c.style, blocks: [{ kind: 'paragraph', inlines: [{ kind: 'run', text: '' }] }] } })) } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    const widths = widthsAfter(r);
    // "$1,450,554.00" in 11 pt needs about 89 pt with the cell's margins; proportional narrowing
    // alone would give it 87.75
    for (const row of widths) {
      expect(row[2]).toBeGreaterThanOrEqual(89);
      expect(row.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(468.5);
    }
    expect(widths.every((row) => JSON.stringify(row) === JSON.stringify(widths[0]))).toBe(true);
  });

  it('widths written that leave an amount narrower than itself are kept, with a warning naming the column (review D7)', () => {
    const s = moneyTable([156, 156, 156]);
    const table = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[0].blocks)[0];
    const column = (k: number) => arr<NfNode>(table.rows).map((r) => arr<NfNode>(r.cells)[k]);
    const setWidth = (cells: NfNode[], width: number) => ({ kind: 'set', target: { ids: cells.map((c) => c.id), shape: Object.fromEntries(cells.map((c) => [c.id, shapeOf(c, docxTree)])) }, props: { preferredWidth: width, preferredWidthType: 'Point' } });
    const narrow = prepareWrite(s, { intent: 'Widths.', scope: { ids: [0, 1, 2].flatMap((k) => column(k).map((c) => c.id)) }, changes: [setWidth(column(0), 250), setWidth(column(1), 150), setWidth(column(2), 68)] } as WriteInput);
    if (narrow.outcome !== 'verified') throw new Error(JSON.stringify(narrow).slice(0, 600));
    expect(widthsAfter(narrow)[1][2]).toBe(68);
    expect(narrow.warnings.find((w) => w.code === 'column-too-narrow')?.message).toMatch(/\$1,450,554\.00/);
    const wide = prepareWrite(s, { intent: 'Widths.', scope: { ids: column(2).map((c) => c.id) }, changes: [setWidth(column(2), 156)] } as WriteInput);
    if (wide.outcome !== 'verified') throw new Error(JSON.stringify(wide).slice(0, 600));
    expect(wide.warnings.some((w) => w.code === 'column-too-narrow')).toBe(false);
    // the same in percent, as the rig's write was (16 percent of 468 pt is about 75 pt)
    const setPercent = (cells: NfNode[], width: number) => ({ kind: 'set', target: { ids: cells.map((c) => c.id), shape: Object.fromEntries(cells.map((c) => [c.id, shapeOf(c, docxTree)])) }, props: { preferredWidth: width, preferredWidthType: 'Percent' } });
    const percent = prepareWrite(s, { intent: 'Widths.', scope: { ids: [0, 1, 2].flatMap((k) => column(k).map((c) => c.id)) }, changes: [setPercent(column(0), 50), setPercent(column(1), 34), setPercent(column(2), 16)] } as WriteInput);
    if (percent.outcome !== 'verified') throw new Error(JSON.stringify(percent).slice(0, 600));
    expect(percent.warnings.find((w) => w.code === 'column-too-narrow')?.message).toMatch(/\$1,471,389\.04/);
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

  it('a new table built from copied rows (the captain\'s split) takes its source table\'s banding, its header kept', () => {
    // a new property table holding a copy of the header and a copy of the third item: the copies
    // carry new ids, so the source is known from what they copy
    let doc = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4d.sfdt.json'), 'utf8');
    const host = { serialize: () => doc, open: (x: string) => { doc = x; }, canUndo: () => false, undo: () => {}, canRedo: () => false, redo: () => {}, readOnly: () => false };
    const s = new DocumentSession({ pack: docxPack, host, target: { type: 'envelope', id: 'e' } }).state;
    // the coverage schedule: a plain banded table
    const control = arr<NfNode>(arr<NfNode>(s.view.nf.root.sections)[1].blocks)[4];
    const table = control;
    expect(table.kind).toBe('table');
    const rows = arr<NfNode>(table.rows);
    const r = prepareWrite(s, {
      intent: 'A second table.',
      scope: { ids: [] },
      changes: [{ kind: 'insert_after', anchor: control.id, container: shapeOf(arr<NfNode>(s.view.nf.root.sections)[1], docxTree), node: { kind: 'table', style: table.style, rows: [{ id: rows[0].id, kind: 'row' }, { id: rows[2].id, kind: 'row' }] } }]
    } as WriteInput);
    if (r.outcome !== 'verified') throw new Error(JSON.stringify(r).slice(0, 600));
    const blocks = arr<NfNode>(arr<NfNode>(r.intended.root.sections)[1].blocks);
    const made = blocks[5];
    expect(made.kind).toBe('table');
    const fills = arr<NfNode>(made.rows).map((row) => fill(r.intended.formats, arr<NfNode>(row.cells)[0]));
    // the header keeps its look; the first body row is the first band, as in the source
    expect(fills[0]).toBe(fill(s.view.nf.formats, arr<NfNode>(rows[0].cells)[0]));
    expect(fills[1]).toBe(fill(s.view.nf.formats, arr<NfNode>(rows[1].cells)[0]));
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
