import * as fs from 'fs';
import * as path from 'path';
import { IdTable } from '../../../ids';
import { makeFormatTable } from '../../../verbs';
import { makeView } from '../../../view';
import { NfNode, walk } from '../../../tree';
import { FORMAT_REF_KEYS, KIND } from '../adapter/keys';
import { toNormalForm } from '../adapter/toNormalForm';
import { docxTree } from '../tree';
import { ENUMS, FORMAT_SCHEMA, effective, foreignFormats, schemaFor, setOverride } from '../schema';
import { propertyProblems } from '../../../verifier/schema';
import { docxPack } from '../index';

const corpus = path.join(__dirname, 'corpus');
const flagship = fs.readFileSync(path.join(corpus, 'flagship-v4b.sfdt.json'), 'utf8');

describe('property schema', () => {
  it('matches the SDK enums it was taken from', () => {
    const types = fs.readFileSync(require.resolve('@syncfusion/ej2-documenteditor/src/document-editor/base/types.d.ts'), 'utf8');
    for (const [name, values] of Object.entries(ENUMS)) {
      const m = new RegExp(`export declare type ${name} =([\\s\\S]*?);`).exec(types);
      expect(m).not.toBeNull();
      expect([...(m as RegExpExecArray)[1].matchAll(/'([^']+)'/g)].map((x) => x[1])).toEqual(values);
    }
  });

  it('covers every key a format object carries anywhere in the corpus', () => {
    const known = new Set(FORMAT_SCHEMA.map((s) => s.name));
    const missing = new Set<string>();
    for (const file of fs.readdirSync(corpus)) {
      const { nf } = toNormalForm(fs.readFileSync(path.join(corpus, file), 'utf8'));
      for (const entry of Object.values(nf.formats)) for (const key of Object.keys(entry)) if (!known.has(key)) missing.add(key);
    }
    expect([...missing]).toEqual([]);
  });

  it('gives each node kind its groups, with derived values never writable', () => {
    expect(schemaFor(KIND.run)?.map((s) => s.name)).toContain('bold');
    expect(schemaFor(KIND.paragraph)?.map((s) => s.name)).toEqual(expect.arrayContaining(['textAlignment', 'styleName', 'bold']));
    expect(schemaFor(KIND.cell)?.find((s) => s.name === 'cellWidth')?.class).toBe('derived');
    expect(schemaFor(KIND.table)?.find((s) => s.name === 'grid')?.class).toBe('derived');
    expect(schemaFor(KIND.bookmark)).toBeNull();
  });

  it('keeps a row grid width the document carries in a copied format entry, never as a set (Hilb ffb38cdf)', () => {
    expect(FORMAT_SCHEMA.map((s) => s.name)).toContain('gridBeforeWidth');
    expect(propertyProblems(docxPack, KIND.row, { gridBeforeWidth: 12 }, 'n1')[0]?.destroyed).toMatch(/gridBeforeWidth on row n1: carried by the document/);
    expect(propertyProblems(docxPack, KIND.row, { height: 12 }, 'n1')).toEqual([]);
  });

  it('names a format a node points at that holds what its kind cannot, and the kind that holds it (Hilb ffb38cdf)', () => {
    const formats = {
      fCell: { shading: { backgroundColor: '#F2F2F2FF' }, columnSpan: 3, verticalAlignment: 'Top' },
      fRow: { height: 20, gridBeforeWidth: 0, gridBeforeWidthType: 'Point' }
    };
    const row = (style: string) => ({ id: 'n1', kind: KIND.row, style, cells: [] }) as unknown as NfNode;
    expect(foreignFormats(row('fCell'), formats)).toEqual([{ formatId: 'fCell', keys: ['shading', 'columnSpan', 'verticalAlignment'], heldBy: [KIND.cell] }]);
    expect(foreignFormats(row('fRow'), formats)).toEqual([]);
  });

  it('accepts valid values and refuses invented ones (true positive and negative per type)', () => {
    const spec = (kind: string, name: string) => schemaFor(kind)?.find((s) => s.name === name);
    expect(spec(KIND.run, 'fontColor')?.validate('#1F3864')).toBeNull();
    expect(spec(KIND.run, 'fontColor')?.validate('#C00000FF')).toBeNull();
    expect(spec(KIND.run, 'fontColor')?.validate('navy')).toMatch(/colour names are not accepted/);
    expect(spec(KIND.run, 'underline')?.validate('Single')).toBeNull();
    expect(spec(KIND.run, 'underline')?.validate('single')).toMatch(/must be one of/);
    expect(spec(KIND.run, 'fontSize')?.validate(11)).toBeNull();
    expect(spec(KIND.run, 'fontSize')?.validate(0)).not.toBeNull();
    expect(spec(KIND.cell, 'shading')?.validate({ backgroundColor: '#D9E2F3' })).toBeNull();
    expect(spec(KIND.cell, 'shading')?.validate({ backgroundColor: 'light blue' })).not.toBeNull();
    expect(spec(KIND.table, 'borders')?.validate({ top: { lineStyle: 'Single', lineWidth: 0.5, color: '#000000' } })).toBeNull();
    expect(spec(KIND.table, 'borders')?.validate({ middle: {} })).toMatch(/unknown side/);
    expect(spec(KIND.section, 'breakCode')?.validate('NoBreak')).toBeNull();
    expect(spec(KIND.section, 'breakCode')?.validate('Continuous')).toMatch(/NoBreak/);
  });

  it('refuses a list format key other than the list and its level, since the list sets the bullets (Hilb 3aaa560e)', () => {
    const listFormat = schemaFor(KIND.paragraph)?.find((s) => s.name === 'listFormat');
    expect(listFormat?.validate({})).toBeNull();
    expect(listFormat?.validate({ listId: 3, listLevelNumber: 0, nsid: 13194224 })).toBeNull();
    expect(listFormat?.validate({ listType: 'Bullet' })).toMatch(/listType is not a list format key/);
    expect(listFormat?.validate({ listId: 3, listLevelNumber: 9 })).toMatch(/listLevelNumber must be a whole number from 0 to 8/);
  });
});

describe('overrides and effective values', () => {
  const adopted = new IdTable().adopt(toNormalForm(flagship), docxTree, FORMAT_REF_KEYS);
  const nodes: NfNode[] = [];
  walk(adopted.nf.root, docxTree, ({ node }) => {
    nodes.push(node);
  });
  const paragraph = nodes.find((n) => n.kind === KIND.paragraph && (n.inlines as NfNode[] | undefined)?.some((i) => i.kind === KIND.run)) as NfNode;

  it('writes a run override copy-on-write, leaving the shared entry alone', () => {
    const nf = JSON.parse(JSON.stringify(adopted.nf));
    const table = makeFormatTable(nf.formats, new IdTable());
    const run = (nf.root as NfNode);
    const target = [] as NfNode[];
    walk(run, docxTree, ({ node }) => {
      if (node.id === (paragraph.inlines as NfNode[]).find((i) => i.kind === KIND.run)?.id) target.push(node);
    });
    const before = String(target[0].style ?? '');
    const sharedBefore = before ? JSON.stringify(nf.formats[before]) : '';
    setOverride(target[0], 'bold', true, table);
    expect(nf.formats[String(target[0].style)].bold).toBe(true);
    if (before) expect(JSON.stringify(nf.formats[before])).toBe(sharedBefore);
  });

  it('an object-valued property merges into the current value; a null member removes it', () => {
    const nf = JSON.parse(JSON.stringify(adopted.nf));
    const table = makeFormatTable(nf.formats, new IdTable());
    const cells: NfNode[] = [];
    walk(nf.root as NfNode, docxTree, ({ node }) => {
      if (node.kind === KIND.cell && typeof node.style === 'string' && nf.formats[node.style]?.shading && nf.formats[node.style]?.borders) cells.push(node);
    });
    const cell = cells[0];
    const was = JSON.parse(JSON.stringify(nf.formats[String(cell.style)]));
    setOverride(cell, 'shading', { backgroundColor: '#FFF2CC' }, table);
    const now = nf.formats[String(cell.style)];
    expect(now.shading).toEqual({ ...was.shading, backgroundColor: '#FFF2CC' });
    setOverride(cell, 'borders', { top: { lineWidth: 1.5 } }, table);
    expect(nf.formats[String(cell.style)].borders).toEqual({ ...was.borders, top: { ...was.borders.top, lineWidth: 1.5 } });
    setOverride(cell, 'shading', { backgroundColor: null }, table);
    expect(nf.formats[String(cell.style)].shading).not.toHaveProperty('backgroundColor');
    // a scalar still replaces
    setOverride(cell, 'verticalAlignment', 'Bottom', table);
    expect(nf.formats[String(cell.style)].verticalAlignment).toBe('Bottom');
  });

  it('a character property on a paragraph reaches its mark and every run', () => {
    const nf = JSON.parse(JSON.stringify(adopted.nf));
    const table = makeFormatTable(nf.formats, new IdTable());
    let target: NfNode | null = null;
    walk(nf.root, docxTree, ({ node }) => {
      if (node.id === paragraph.id) target = node;
    });
    setOverride(target as unknown as NfNode, 'italic', true, table);
    const p = target as unknown as NfNode;
    expect(nf.formats[String(p.markStyle)].italic).toBe(true);
    for (const run of (p.inlines as NfNode[]).filter((i) => i.kind === KIND.run)) expect(nf.formats[String(run.style)].italic).toBe(true);
  });

  it('reports each value with its source', () => {
    const view = makeView(adopted.nf, { annotate: () => new Map(), tree: docxTree } as never);
    const values = effective(paragraph, view);
    expect(Object.keys(values)).toEqual(expect.arrayContaining(['textAlignment', 'bold']));
    for (const v of Object.values(values)) expect(['override', 'container', 'format', 'default']).toContain(v.source);
  });

  it('reads an inherited value through the style it is based on, then the document default (Hilb 804aaba4)', () => {
    const sfdt = JSON.stringify({
      characterFormat: { fontSize: 11, fontFamily: 'Calibri' },
      paragraphFormat: {},
      styles: [
        { name: 'Normal', type: 'Paragraph', paragraphFormat: {}, characterFormat: {} },
        { name: 'Body', type: 'Paragraph', paragraphFormat: { afterSpacing: 6 }, characterFormat: { fontFamily: 'Arial' }, basedOn: 'Normal' },
        { name: 'Table Text', type: 'Paragraph', paragraphFormat: {}, characterFormat: {}, basedOn: 'Body' }
      ],
      sections: [
        {
          sectionFormat: {},
          blocks: [{ paragraphFormat: { styleName: 'Table Text' }, characterFormat: {}, inlines: [{ characterFormat: { bold: true }, text: 'Coverage' }] }]
        }
      ]
    });
    const nf = new IdTable().adopt(toNormalForm(sfdt), docxTree, FORMAT_REF_KEYS).nf;
    const view = makeView(nf, { annotate: () => new Map(), tree: docxTree } as never);
    let run: NfNode | null = null;
    walk(nf.root, docxTree, ({ node }) => {
      if (node.kind === KIND.run) run = node;
    });
    const values = effective(run as unknown as NfNode, view);
    expect(values.fontFamily).toEqual({ value: 'Arial', source: 'container' });
    expect(values.fontSize).toEqual({ value: 11, source: 'default' });
    expect(values.italic).toEqual({ value: null, source: 'default' });
    const paragraph = effective(view.placement((run as unknown as NfNode).id)?.parent as NfNode, view);
    expect(paragraph.afterSpacing).toEqual({ value: 6, source: 'container' });
    // The editor's own default where the document sets none, as the proof reads it
    expect(paragraph.beforeSpacing).toEqual({ value: 0, source: 'default' });
  });
});
