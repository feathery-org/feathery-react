/**
 * The adapter's contract: native bytes to normal form and back is byte-exact over the corpus,
 * with and without the engine re-keying ids and formats in between.
 *
 * The committed corpus is synthetic (the flagship proposal and its WP2 variants). Documents that
 * hold client data are never committed: point ROBIN_DOCUMENT_PRIVATE_CORPUS at a folder of
 * `*.sfdt.json` files to run them too.
 */
import * as fs from 'fs';
import * as path from 'path';
import { IdTable } from '../../../ids';
import { walk } from '../../../tree';
import { fromNormalForm } from '../adapter/fromNormalForm';
import { toNormalForm } from '../adapter/toNormalForm';
import { FORMAT_REF_KEYS } from '../adapter/keys';
import { cardAuthor } from '../adapter/revisions';
import { docxTree } from '../tree';

const corpusDir = path.join(__dirname, 'corpus');
const privateDir = process.env.ROBIN_DOCUMENT_PRIVATE_CORPUS;
const files = [
  ...fs.readdirSync(corpusDir).map((f) => path.join(corpusDir, f)),
  ...(privateDir && fs.existsSync(privateDir)
    ? fs.readdirSync(privateDir).filter((f) => f.endsWith('.sfdt.json')).map((f) => path.join(privateDir, f))
    : [])
].filter((f) => f.endsWith('.sfdt.json'));

describe('adapter round trip', () => {
  it('has a corpus', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it.each(files.map((f) => [path.basename(f), f]))('%s is byte-exact', (_name, file) => {
    const native = fs.readFileSync(file, 'utf8');
    const { nf, residue } = toNormalForm(native);
    expect(fromNormalForm(nf, residue)).toBe(native);
    const adopted = new IdTable().adopt({ nf, residue }, docxTree, FORMAT_REF_KEYS);
    expect(fromNormalForm(adopted.nf, adopted.residue as typeof residue)).toBe(native);
  });

  it.each(files.slice(0, 1).map((f) => [path.basename(f), f]))('%s hides engine-owned values from the normal form', (_name, file) => {
    const { nf } = toNormalForm(fs.readFileSync(file, 'utf8'));
    const text = JSON.stringify(nf);
    for (const hidden of ['"grid"', '"columnCount"', '"columnIndex"', '"cellWidth"', '"revisionIds"', '"optimizeSfdt"', '"tag"'])
      expect(text).not.toContain(hidden);
    let kinds = new Set<string>();
    walk(nf.root, docxTree, ({ node }) => {
      kinds = kinds.add(node.kind);
    });
    expect([...kinds].sort()).toEqual(
      expect.arrayContaining(['bookmark', 'cell', 'control', 'document', 'paragraph', 'row', 'run', 'section', 'table'])
    );
  });

  it('carries an edit through, and builds a created paragraph in the editor\'s own key order', () => {
    const native = fs.readFileSync(files[0], 'utf8');
    const { nf, residue } = toNormalForm(native);
    const section = (nf.root.sections as Array<{ blocks: Array<Record<string, unknown>> }>)[0];
    const para = section.blocks.find((b) => b.kind === 'paragraph' && Array.isArray(b.inlines) && (b.inlines as Array<{ kind: string }>).some((i) => i.kind === 'run')) as Record<string, unknown>;
    const run = (para.inlines as Array<Record<string, unknown>>).find((i) => i.kind === 'run') as Record<string, unknown>;
    const before = String(run.text);
    run.text = 'Changed text';
    section.blocks.splice(1, 0, { id: 'new1', kind: 'paragraph', style: para.style, inlines: [{ id: 'new2', kind: 'run', text: 'Added' }] });
    const out = fromNormalForm(nf, residue);
    expect(out).toContain('"text":"Changed text"');
    expect(out).not.toContain(JSON.stringify(before));
    const added = (JSON.parse(out).sections[0].blocks as Array<Record<string, unknown>>)[1];
    expect(Object.keys(added)).toEqual(['paragraphFormat', 'characterFormat', 'inlines']);
    expect(added.inlines).toEqual([{ characterFormat: {}, text: 'Added' }]);
  });
});

describe('pending changes both ways', () => {
  it('mints revisions for pending the engine authored, grouped by change set, and reads them back', () => {
    const native = fs.readFileSync(files[0], 'utf8');
    const { nf, residue } = toNormalForm(native);
    const runs: Array<Record<string, unknown>> = [];
    walk(nf.root, docxTree, ({ node }) => {
      if (node.kind === 'run' && runs.length < 2) runs.push(node);
    });
    runs[0].pending = { kind: 'Deletion', author: 'Robin', group: 'turn-7' };
    runs[1].pending = { kind: 'Insertion', author: 'Robin', group: 'turn-7' };
    const out = fromNormalForm(nf, residue);
    const doc = JSON.parse(out);
    expect(doc.revisions).toEqual([
      expect.objectContaining({ revisionType: 'Deletion', author: cardAuthor('turn-7'), customData: expect.stringContaining('"changeSetId":"turn-7"') }),
      expect.objectContaining({ revisionType: 'Insertion', author: cardAuthor('turn-7') })
    ]);
    // each change set writes under its own author, read back as the shown name
    expect(cardAuthor('turn-7')).not.toBe(cardAuthor('turn-8'));
    const again = toNormalForm(out);
    const back: Array<Record<string, unknown>> = [];
    walk(again.nf.root, docxTree, ({ node }) => {
      if (node.kind === 'run' && back.length < 2) back.push(node);
    });
    expect(back.map((r) => r.pending)).toEqual([
      { kind: 'Deletion', author: 'Robin', group: 'turn-7' },
      { kind: 'Insertion', author: 'Robin', group: 'turn-7' }
    ]);
    expect(fromNormalForm(again.nf, again.residue)).toBe(out);
  });

  it("joins a foreign change without splitting it: the user's revision keeps its id on every anchor", () => {
    const native = JSON.stringify({
      sections: [{ blocks: [{ inlines: [{ text: 'Alpha ', revisionIds: ['u1'] }, { text: 'beta', revisionIds: ['u1'] }] }] }],
      revisions: [{ author: 'User', date: '2026-10-01T00:00:00Z', revisionType: 'Insertion', revisionId: 'u1' }]
    });
    const { nf, residue } = toNormalForm(native);
    const runs: Array<Record<string, unknown>> = [];
    walk(nf.root, docxTree, ({ node }) => {
      if (node.kind === 'run') runs.push(node);
    });
    expect(runs[1].pending).toEqual({ kind: 'Insertion', author: 'User' });
    // Robin deletes the user's inserted word: the anchor now carries both revisions
    runs[1].pending = { kind: 'Insertion', author: 'User', revisions: [{ kind: 'Insertion', author: 'User' }, { kind: 'Deletion', author: 'Robin', group: 'turn-9' }] };
    const doc = JSON.parse(fromNormalForm(nf, residue));
    const users = (doc.revisions as Array<Record<string, unknown>>).filter((r) => r.author === 'User');
    expect(users.map((r) => r.revisionId)).toEqual(['u1']);
    const inlines = doc.sections[0].blocks[0].inlines as Array<{ revisionIds?: string[] }>;
    expect(inlines[0].revisionIds).toEqual(['u1']);
    expect(inlines[1].revisionIds?.[0]).toBe('u1');
    expect(inlines[1].revisionIds).toHaveLength(2);
  });
});

describe('table geometry by width unit', () => {
  const cell = (cf: Record<string, unknown>) => ({ cellFormat: { ...cf, columnSpan: 1, rowSpan: 1 }, blocks: [{ inlines: [{ text: 'x' }] }] });
  const native = JSON.stringify({
    sections: [{ blocks: [{ tableFormat: { preferredWidth: 100, preferredWidthType: 'Percent' }, grid: [100, 300], columnCount: 2, rows: [{ rowFormat: {}, cells: [cell({ preferredWidth: 25, preferredWidthType: 'Percent', cellWidth: 100 }), cell({ preferredWidth: 75, preferredWidthType: 'Percent', cellWidth: 300 })] }] }] }]
  });

  it("derives a percent cell's laid-out width and the grid in points, from the table it had", () => {
    const { nf, residue } = toNormalForm(native);
    const table = (nf.root.sections as any)[0].blocks[0];
    const [a, b] = table.rows[0].cells;
    nf.formats.p20 = { ...nf.formats[a.style], preferredWidth: 20 };
    nf.formats.p80 = { ...nf.formats[b.style], preferredWidth: 80 };
    a.style = 'p20';
    b.style = 'p80';
    const out = JSON.parse(fromNormalForm(nf, residue)).sections[0].blocks[0];
    expect(out.rows[0].cells.map((c: any) => c.cellFormat.cellWidth)).toEqual([80, 320]);
    expect(out.grid).toEqual([80, 320]);
  });
});

describe('content control properties live in the residue', () => {
  // a control as the client's documents hold them: locked, a title that is not the tag, an appearance
  const control = (tag: string, extra: Record<string, unknown> = {}) => ({
    inlines: [{ text: '$1,000' }],
    contentControlProperties: { lockContentControl: true, lockContents: true, tag, color: '#00000000', title: 'Premium', appearance: 'BoundingBox', type: 'Text', ...extra }
  });
  const doc = (inline: Record<string, unknown>) => JSON.stringify({ sections: [{ blocks: [{ inlines: [{ text: 'Total: ' }, inline] }] }] });
  const controlOf = (nf: ReturnType<typeof toNormalForm>['nf']) => {
    let found: Record<string, unknown> | undefined;
    walk(nf.root, docxTree, ({ node }) => {
      if (node.kind === 'control') found = node;
    });
    return found as Record<string, unknown>;
  };

  it('shows a bound control as its binding and its title, nothing native, and round-trips byte-exact', () => {
    const native = doc(control('[[name=Premium|type=currency]]'));
    const { nf, residue } = toNormalForm(native);
    const c = controlOf(nf);
    expect(c.contentControlProperties).toBeUndefined();
    expect(c.binding).toEqual(expect.objectContaining({ name: 'Premium' }));
    expect(c.title).toBe('Premium');
    expect(JSON.stringify(nf)).not.toContain('[[name=');
    expect(fromNormalForm(nf, residue)).toBe(native);
  });

  it('a title the tag decides is not shown; an unbound control shows only its title', () => {
    const derived = toNormalForm(doc(control('[[name=Premium|type=currency]]', { title: '[[name=Premium|type=currency]]' })));
    expect(controlOf(derived.nf).title).toBeUndefined();
    expect(fromNormalForm(derived.nf, derived.residue)).toBe(doc(control('[[name=Premium|type=currency]]', { title: '[[name=Premium|type=currency]]' })));
    const foreign = toNormalForm(doc(control('vendor-field-17')));
    const c = controlOf(foreign.nf);
    expect(c.binding).toBeUndefined();
    expect(c.contentControlProperties).toBeUndefined();
    expect(c.title).toBe('Premium');
    expect(fromNormalForm(foreign.nf, foreign.residue)).toBe(doc(control('vendor-field-17')));
  });

  it('a retitle or a rebinding changes only the title or the tag; every other property is kept', () => {
    const { nf, residue } = toNormalForm(doc(control('[[name=Premium|type=currency]]')));
    const c = controlOf(nf);
    c.title = 'Annual premium';
    (c.binding as Record<string, unknown>).name = 'AnnualPremium';
    const out = JSON.parse(fromNormalForm(nf, residue));
    const props = out.sections[0].blocks[0].inlines[1].contentControlProperties;
    expect(props).toEqual({ lockContentControl: true, lockContents: true, tag: expect.stringContaining('name=AnnualPremium'), color: '#00000000', title: 'Annual premium', appearance: 'BoundingBox', type: 'Text' });
  });
});
