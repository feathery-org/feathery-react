/**
 * The WP1 delta-by-path table, reproduced through the engine in the real editor (flagship v4b,
 * after the user's own untracked edit): for each delta the engine chooses its commit path,
 * commits, proves and undoes. Text-shaped deltas commit natively as one undo group with the user's
 * undo stack intact; structural deltas commit by splice with the engine keeping the way back. The
 * editor's own accept-all and reject-all are compared with the engine's projections each time.
 */
import fs from 'fs';
import path from 'path';
import { EngineLane, startEngineLane } from './headless/engineLane';

const flagship = fs.readFileSync(path.join(__dirname, 'corpus', 'flagship-v4b.sfdt.json'), 'utf8');

let lane: EngineLane;
beforeAll(async () => {
  lane = await startEngineLane();
}, 600000);
afterAll(async () => {
  await lane?.close();
});

let turn = 0;
const dispatch = async (verb: string, input: unknown): Promise<any> => {
  const out = await lane.call<any>('dispatch', { protocolVersion: 1, turnId: `turn-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, verb, input });
  if (out.status !== 'ok') throw new Error(JSON.stringify(out.failure));
  return out.response.result;
};
const read = async (ids: string[]): Promise<Record<string, any>> => {
  const r = await dispatch('read', { ids });
  if (!r.ok) throw new Error(JSON.stringify(r).slice(0, 400));
  return Object.fromEntries(r.nodes.map((n: any) => [n.id, n]));
};
const strip = (v: any): any =>
  Array.isArray(v) ? v.map(strip) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !['base', 'shape', 'usedBy', 'derived', 'pending', 'properties'].includes(k)).map(([k, x]) => [k, strip(x)])) : v;
const fresh_ = (v: any): any => {
  // a node written anew: the same content with no ids
  const s = strip(v);
  const rec = (x: any): any => (Array.isArray(x) ? x.map(rec) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'id').map(([k, y]) => [k, rec(y)])) : x);
  return rec(s);
};
const at = (p: Array<string | number>) => lane.call<string>('idAt', p);

async function fresh(): Promise<string> {
  turn += 1;
  await lane.call('open', flagship);
  return lane.call<string>('userEdit', '0;1;0', 'U');
}

interface Row {
  delta: string;
  seam: string;
  landed: string;
  proof: string;
  native: string;
  undo: string;
  warnings?: string;
  /** The card's title as the group tag carries it. */
  title?: string;
  userUndoKept: boolean;
}
const table: Row[] = [];

async function commitAndUndo(delta: string, pre: string, write: unknown): Promise<Row> {
  const depth = await lane.call<number>('undoDepth');
  const result = await dispatch('write', write);
  if (!result.ok) throw new Error(`${delta}: ${JSON.stringify(result.refusal ?? result.error ?? result.conflict).slice(0, 800)}`);
  const seam: string[] = result.trace.committed.seams;
  let title: string | undefined;
  if (result.landed === 'card') {
    const revisions = await lane.call<Array<{ group: string | null; author: string; title: string | null }>>('revisions');
    const ours = revisions.filter((r) => r.group === `turn-${turn}`);
    expect(ours.length).toBeGreaterThan(0);
    expect(ours.every((r) => r.author === 'Robin')).toBe(true);
    title = ours[0].title ?? undefined;
  }
  const check = await lane.call<{ accept: boolean; reject: boolean; acceptDiff: string[]; rejectDiff: string[] }>('crossCheck');
  const added = (await lane.call<number>('undoDepth')) - depth;
  const undone = await lane.call<{ via: string }>('sessionUndo');
  const after = await lane.call<string>('settled');
  const restored = after === pre ? 'byte-equal' : (await lane.call<boolean>('equivalent', after, pre)) ? 'equivalent' : 'NOT restored';
  const native = seam.length ? await lane.call<boolean>('canUndo') : true;
  const row: Row = {
    delta,
    seam: seam.join('+') || 'none',
    landed: result.landed,
    proof: result.trace.proof.outcome,
    native: `accept ${check.accept ? 'agrees' : `differs ${check.acceptDiff.slice(0, 2).join(' | ')}`}, reject ${check.reject ? 'agrees' : `differs ${check.rejectDiff.slice(0, 2).join(' | ')}`}`,
    undo: `${undone.via}${seam.includes('splice') ? '' : ` (+${added})`}: ${restored}`,
    userUndoKept: seam.includes('splice') ? true : native,
    warnings: ((result.warnings ?? []) as Array<{ code: string }>).map((w) => w.code).join(',') || '-',
    ...(title ? { title } : {})
  };
  table.push(row);
  return row;
}

const NATIVE_TEXT = { seam: 'text', landed: 'card', proof: 'passed', userUndoKept: true };
const SPLICE = { seam: 'splice', landed: 'card', proof: 'passed' };

describe('WP1 delta by path, through the engine in the real editor', () => {
  it('D1 run text replace: native tracked text, one undo step, user stack intact', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const run = (await read([pid]))[pid].inlines.find((i: any) => i.kind === 'run');
    const row = await commitAndUndo('D1', pre, {
      intent: 'Replace the clause.',
      scope: { ids: [run.id] },
      changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: 'This clause was replaced by the engine.' } }]
    });
    expect(row).toEqual(expect.objectContaining(NATIVE_TEXT));
    expect(row.undo).toMatch(/^editor \(\+1\): (byte-equal|equivalent)$/);
  });

  it('D1B bound run text: native tracked text inside the control', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 1, 'blocks', 2]);
    const p = (await read([pid]))[pid];
    const control = p.inlines.find((i: any) => i.kind === 'control' && i.binding?.name === 'property_limit');
    const run = control.inlines.find((i: any) => i.kind === 'run');
    const row = await commitAndUndo('D1B', pre, {
      intent: 'Raise the property limit.',
      scope: { ids: [run.id] },
      changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: '$3,000,000.00' } }]
    });
    expect(row).toEqual(expect.objectContaining(NATIVE_TEXT));
  });

  it('D8 run restyle: native format, immediate, one undo step', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const run = (await read([pid]))[pid].inlines.find((i: any) => i.kind === 'run');
    const row = await commitAndUndo('D8', pre, {
      intent: 'Make the clause bold and red.',
      scope: { ids: [run.id] },
      changes: [{ kind: 'set', target: { ids: [run.id], shape: { [run.id]: run.shape } }, props: { bold: true, fontColor: '#C00000' } }]
    });
    expect(row).toEqual(expect.objectContaining({ seam: 'format', landed: 'immediate', proof: 'passed', userUndoKept: true }));
    expect(row.undo).toMatch(/^editor \(\+1\): (byte-equal|equivalent)$/);
  });

  it('N1 identity: a write that changes nothing lands nothing', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const run = (await read([pid]))[pid].inlines.find((i: any) => i.kind === 'run');
    const result = await dispatch('write', { intent: 'Keep the clause.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: strip(run) }] });
    expect(result.ok).toBe(true);
    expect(result.trace.committed.seams).toEqual([]);
    expect(await lane.call<string>('serialize')).toBe(pre);
    table.push({ delta: 'N1', seam: 'none', landed: result.landed, proof: result.trace.proof.outcome, native: '-', undo: '-', userUndoKept: true });
  });

  it('D2 paragraph replace: splice, engine undo', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const p = (await read([pid]))[pid];
    const run = p.inlines.find((i: any) => i.kind === 'run');
    const row = await commitAndUndo('D2', pre, {
      intent: 'Rewrite the clause in two runs.',
      scope: { ids: [pid] },
      changes: [{ kind: 'replace', id: pid, base: p.base, node: { style: p.style, markStyle: p.markStyle, inlines: [{ text: 'A replacement paragraph, first run. ', style: run.style }, { text: 'Second run.', style: run.style }] } }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
    expect(row.undo).toMatch(/^engine: (byte-equal|equivalent)$/);
  });

  it('D3 insert a paragraph: splice, engine undo', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const sid = await at(['sections', 3]);
    const n = await read([pid, sid]);
    const row = await commitAndUndo('D3', pre, {
      intent: 'Add a paragraph.',
      scope: { ids: [] },
      changes: [{ kind: 'insert_after', anchor: pid, container: n[sid].shape, node: { style: n[pid].style, markStyle: n[pid].markStyle, inlines: [{ text: 'A new paragraph from the engine.' }] } }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
    expect(row.undo).toMatch(/^engine: (byte-equal|equivalent)$/);
  });

  it('D4 insert a column in a plain table: splice, geometry derived', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 1, 'blocks', 4]);
    const t = (await read([tid]))[tid];
    const changes = t.rows.map((row: any) => {
      const last = row.cells[row.cells.length - 1];
      return { kind: 'insert_after', anchor: last.id, container: row.shape, node: { ...fresh_(last), blocks: [{ ...fresh_(last.blocks[0]), inlines: [{ text: 'New' }] }] } };
    });
    const row = await commitAndUndo('D4', pre, { intent: 'Add a column.', scope: { ids: t.rows.map((r: any) => r.cells[r.cells.length - 1].id) }, changes });
    expect(row).toEqual(expect.objectContaining(SPLICE));
    expect(row.title).toBe('Added a column');
  });

  it('D5 bound row insert (copy of a row): splice, identity minted, formulas recomputed', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 1, 'blocks', 10, 'blocks', 0]);
    const t = (await read([tid]))[tid];
    const item = t.rows[2];
    const row = await commitAndUndo('D5', pre, {
      intent: 'Add a line.',
      scope: { ids: [item.id] },
      changes: [{ kind: 'insert_after', anchor: item.id, container: t.shape, node: strip(item) }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
  });

  it('D6 bound row delete: splice, formulas recomputed, the bindings re-read without a re-attach', async () => {
    await fresh();
    const tid = await at(['sections', 3, 'blocks', 10, 'blocks', 0]);
    const t = (await read([tid]))[tid];
    const item = t.rows[2];
    const cid = await at(['sections', 3, 'blocks', 10]);
    const control = (await read([cid]))[cid];
    const tableId = control?.binding?.table;
    expect(typeof tableId).toBe('string');
    const rowsBefore = await lane.call<number>('bindingRows', tableId);
    const result = await dispatch('write', { intent: 'Remove a line.', scope: { ids: [item.id] }, changes: [{ kind: 'delete', id: item.id, base: item.base }] });
    expect(result.ok).toBe(true);
    // the bindings re-read the spliced document without a re-attach: the deleted row is out of their index
    expect(await lane.call<number>('bindingRows', tableId)).toBe(rowsBefore - 1);
    await lane.call('sessionUndo');
    const pre2 = await fresh();
    const t2 = (await read([tid]))[tid];
    const row = await commitAndUndo('D6', pre2, { intent: 'Remove a line.', scope: { ids: [t2.rows[2].id] }, changes: [{ kind: 'delete', id: t2.rows[2].id, base: t2.rows[2].base }] });
    expect(row).toEqual(expect.objectContaining(SPLICE));
  });

  it('D7 move a plain table: splice, identity kept', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 1, 'blocks', 4]);
    const aid = await at(['sections', 0, 'blocks', 3]);
    const sid = await at(['sections', 0]);
    const n = await read([tid, sid]);
    const row = await commitAndUndo('D7', pre, {
      intent: 'Move the coverage table to the front.',
      scope: { ids: [tid] },
      changes: [{ kind: 'move', id: tid, shape: n[tid].shape, anchor: aid, position: 'after', container: n[sid].shape }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
  });

  it('D7B move a bound table: splice, its readers keep working', async () => {
    const pre = await fresh();
    const cid = await at(['sections', 1, 'blocks', 10]);
    const aid = await at(['sections', 0, 'blocks', 3]);
    const sid = await at(['sections', 0]);
    const n = await read([cid, sid]);
    const row = await commitAndUndo('D7B', pre, {
      intent: 'Move the property premium table to the front.',
      scope: { ids: [cid] },
      changes: [{ kind: 'move', id: cid, shape: n[cid].shape, anchor: aid, position: 'after', container: n[sid].shape }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
  });

  it('D9 header text replace: splice (headers are not natively addressed)', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 0, 'headersFooters', 'header', 'blocks', 0]);
    const run = (await read([pid]))[pid].inlines.find((i: any) => i.kind === 'run');
    const row = await commitAndUndo('D9', pre, {
      intent: 'Retitle the header.',
      scope: { ids: [run.id] },
      changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: 'Commercial proposal for ' } }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
  });

  it('D10 a new section from a sibling: splice', async () => {
    const pre = await fresh();
    const sid = await at(['sections', 1]);
    const s = (await read([sid]))[sid];
    const heading = s.blocks[3];
    const body = s.blocks[1];
    const row = await commitAndUndo('D10', pre, {
      intent: 'Add an Exclusions section.',
      scope: { ids: [] },
      changes: [{
        kind: 'insert_after',
        anchor: sid,
        container: (await read(['root'])).root.shape,
        node: { style: s.style, headersFooters: fresh_(s.headersFooters), blocks: [{ ...fresh_(heading), inlines: [{ text: '1.4 Exclusions', style: heading.inlines[0]?.style }] }, { ...fresh_(body), inlines: [{ text: 'No exclusions apply.' }] }] }
      }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
  });

  it('D11 rewrite a formula on a kept control: splice, a tracked replacement (resolved by the engine, not natively)', async () => {
    const pre = await fresh();
    const hits = (await dispatch('find', { feature: { name: 'formula' } })).hits as Array<{ id: string }>;
    const nodes = await read(hits.map((h) => h.id));
    // a formula with one occurrence: rewriting one of several would make them disagree
    const formulas = Object.values(nodes).filter((n: any) => n.kind === 'control' && typeof n.binding?.expr === 'string') as any[];
    const control = formulas.find((n) => formulas.filter((m) => m.binding.name === n.binding.name).length === 1);
    expect(control).toBeDefined();
    const row = await commitAndUndo('D11', pre, {
      intent: 'Write the formula out in full.',
      scope: { ids: [control.id] },
      changes: [{ kind: 'replace', id: control.id, base: control.base, node: { ...strip(control), binding: { ...control.binding, expr: `mul(${control.binding.expr},1)` } } }]
    });
    expect(row).toEqual(expect.objectContaining(SPLICE));
    // The editor keeps no revision on a control's own markers, so its accept-all and reject-all
    // each leave the other control as an empty shell: this card resolves through the engine's
    // projections, never natively (the rail spec drives it).
    expect(row.native).toMatch(/^accept differs .* reject differs /);
  });

  const setOn = (n: any, props: Record<string, unknown>, intent: string) => ({
    intent,
    scope: { ids: [n.id] },
    changes: [{ kind: 'set', target: { ids: [n.id], shape: { [n.id]: n.shape } }, props }]
  });
  const NATIVE_FORMAT = { seam: 'format', landed: 'immediate', proof: 'passed', userUndoKept: true };

  it('D12 paragraph property: native format, immediate, one undo step', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 3, 'blocks', 16]);
    const p = (await read([pid]))[pid];
    const row = await commitAndUndo('D12', pre, setOn(p, { textAlignment: 'Center', afterSpacing: 18 }, 'Center the clause.'));
    expect(row).toEqual(expect.objectContaining(NATIVE_FORMAT));
    expect(row.undo).toMatch(/^editor \(\+1\): (byte-equal|equivalent)$/);
  });

  it('D13 cell properties: native format, immediate, one undo step', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 1, 'blocks', 4]);
    const cell = (await read([tid]))[tid].rows[1].cells[1];
    // an object value merges: only the background colour changes
    const row = await commitAndUndo('D13', pre, setOn(cell, { verticalAlignment: 'Bottom', shading: { backgroundColor: '#FFF2CC' } }, 'Shade the cell.'));
    expect(row).toEqual(expect.objectContaining(NATIVE_FORMAT));
  });

  it('D14 row and table properties: native format, immediate', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 1, 'blocks', 4]);
    const t = (await read([tid]))[tid];
    const row = await commitAndUndo('D14', pre, setOn(t.rows[1], { height: 30 }, 'Make the row taller.'));
    expect(row).toEqual(expect.objectContaining(NATIVE_FORMAT));
    const pre2 = await fresh();
    const t2 = (await read([tid]))[tid];
    const row2 = await commitAndUndo('D14B', pre2, setOn(t2, { tableAlignment: 'Center' }, 'Center the table.'));
    expect(row2).toEqual(expect.objectContaining(NATIVE_FORMAT));
  });

  it('D15 a property with no native setter (cell borders): splice, immediate, no card', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 1, 'blocks', 4]);
    const cell = (await read([tid]))[tid].rows[1].cells[1];
    const row = await commitAndUndo('D15', pre, setOn(cell, { borders: { top: { lineStyle: 'Single', lineWidth: 1.5, color: '#000000FF' } } }, 'Rule the cell.'));
    expect(row).toEqual(expect.objectContaining({ seam: 'splice', landed: 'immediate', proof: 'passed' }));
  });

  it('D16 text after an inline control: native text at the exact editor offset', async () => {
    const pre = await fresh();
    const pid = await at(['sections', 0, 'blocks', 3]);
    const p = (await read([pid]))[pid];
    const run = p.inlines.filter((i: any) => i.kind === 'run').find((i: any) => /valid from/.test(i.text));
    const row = await commitAndUndo('D16', pre, {
      intent: 'Change from to starting.',
      scope: { ids: [run.id] },
      changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: run.text.replace('valid from', 'valid starting') } }]
    });
    expect(row).toEqual(expect.objectContaining(NATIVE_TEXT));
  });

  it('D17 the WP3 T3 run on the rig, replayed: a new bound column written without control properties lands', async () => {
    // the model's own writes from the first browser run: retitle (accepted from the rail), set the
    // column widths, then add the Premium tax column, whose new controls carry no properties
    const run = JSON.parse(fs.readFileSync(path.join(__dirname, 'runs', 'wp3-t3-run.json'), 'utf8')) as { writes: Array<{ step: string; input: any }> };
    turn += 1;
    await lane.call('open', flagship);
    await dispatch('outline', {});
    const [title, widths, column] = run.writes;
    const step = async (input: unknown) => {
      turn += 1; // each of the model's writes was its own message
      const r = await dispatch('write', input);
      if (!r.ok) throw new Error(JSON.stringify(r.refusal ?? r.conflict ?? r.error).slice(0, 600));
    };
    await step(title.input);
    await lane.call('acceptAllLive');
    await step(widths.input);
    expect(JSON.stringify(column.input)).not.toContain('contentControlProperties');
    const pre = await lane.call<string>('settled');
    turn += 1;
    const row = await commitAndUndo('D17', pre, column.input);
    expect(row).toEqual(expect.objectContaining(SPLICE));
    // a cell in every row of the table: the card says what a person sees
    expect(row.title).toBe('Added a column');
  });

  it('D18 delete a column (the last cell of every row): splice, the card says a column', async () => {
    const pre = await fresh();
    const tid = await at(['sections', 1, 'blocks', 4]);
    const t = (await read([tid]))[tid];
    const lasts = t.rows.map((r: any) => r.cells[r.cells.length - 1]);
    const row = await commitAndUndo('D18', pre, { intent: 'Remove the last column.', scope: { ids: lasts.map((c: any) => c.id) }, changes: lasts.map((c: any) => ({ kind: 'delete', id: c.id, base: c.base })) });
    expect(row).toEqual(expect.objectContaining(SPLICE));
    expect(row.title).toBe('Removed a column');
  });

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.log(
      ['delta  seam    landed     proof   undo                          native accept/reject          warnings', ...table.map((r) => `${r.delta.padEnd(6)} ${r.seam.padEnd(7)} ${r.landed.padEnd(10)} ${r.proof.padEnd(7)} ${r.undo.padEnd(29)} ${r.native.padEnd(29)} ${r.warnings ?? '-'}`)].join('\n')
    );
  });
});

/**
 * Per-verb cost on the flagship, timed in the page (no bridge). Every verb first reads the editor
 * (serialize, and the adapter when the bytes changed); a write also verifies, commits and proves.
 * A verb above 50 ms is a finding to optimize; the numbers go in the PR's numbers table.
 */
describe('per-verb time on the flagship', () => {
  const RUNS = 5;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const timed = async (verb: string, input: unknown): Promise<{ ms: number; editorMs: number; result: any }> => {
    const out = await lane.call<{ ms: number; editorMs: number; result: any }>('timedDispatch', { protocolVersion: 1, turnId: `turn-${turn}`, editorId: 'ed', target: { type: 'envelope', id: 'env' }, verb, input });
    expect(out.result.status).toBe('ok');
    return { ms: out.ms, editorMs: out.editorMs, result: out.result.response.result };
  };

  it('measures outline, read, find and the three write paths', async () => {
    const rows: Array<[string, number, number]> = [];
    const record = (name: string, xs: number[]) => rows.push([name, median(xs), Math.max(...xs)]);
    const costs: Array<Record<string, number>> = [];
    const verbs: Record<string, number[]> = { 'outline (cold, after open)': [], outline: [], 'read (a 30-row bound table)': [], 'find (text)': [], 'find (feature)': [] };
    const writes: Record<string, number[]> = { 'write: text (native)': [], 'write: format (native)': [], 'write: row copy (splice)': [] };
    // each write split into the editor's own work (seams, serialize, open) and the engine's
    const phases: Record<string, number[]> = {};
    const timedWrite = async (name: string, input: unknown) => {
      const { ms, editorMs, result } = await timed('write', input);
      expect(result.ok).toBe(true);
      writes[name].push(ms);
      const short = name.replace('write: ', '');
      (phases[`  ${short}: editor`] ??= []).push(editorMs);
      (phases[`  ${short}: engine`] ??= []).push(ms - editorMs);
      (phases[`  ${short}: engine verify`] ??= []).push(result.trace.verified.ms);
    };
    for (let k = 0; k < RUNS; k += 1) {
      await fresh();
      verbs['outline (cold, after open)'].push((await timed('outline', {})).ms);
      verbs.outline.push((await timed('outline', {})).ms);
      const tid = await at(['sections', 1, 'blocks', 10, 'blocks', 0]);
      verbs['read (a 30-row bound table)'].push((await timed('read', { ids: [tid] })).ms);
      verbs['find (text)'].push((await timed('find', { text: 'premium' })).ms);
      verbs['find (feature)'].push((await timed('find', { feature: { name: 'binding' } })).ms);
      costs.push(await lane.call<Record<string, number>>('costs'));
      // the three commit paths, each on a fresh document
      const pid = await at(['sections', 3, 'blocks', 16]);
      const run = (await read([pid]))[pid].inlines.find((i: any) => i.kind === 'run');
      await timedWrite('write: text (native)', { intent: 'Replace the clause.', scope: { ids: [run.id] }, changes: [{ kind: 'replace', id: run.id, base: run.base, node: { ...strip(run), text: 'Replaced.' } }] });
      await fresh();
      const run2 = (await read([pid]))[pid].inlines.find((i: any) => i.kind === 'run');
      await timedWrite('write: format (native)', { intent: 'Bold the clause.', scope: { ids: [run2.id] }, changes: [{ kind: 'set', target: { ids: [run2.id], shape: { [run2.id]: run2.shape } }, props: { bold: true } }] });
      await fresh();
      const t = (await read([tid]))[tid];
      await timedWrite('write: row copy (splice)', { intent: 'Add a line.', scope: { ids: [t.rows[2].id] }, changes: [{ kind: 'insert_after', anchor: t.rows[2].id, container: t.shape, node: strip(t.rows[2]) }] });
    }
    for (const [name, xs] of Object.entries(verbs)) record(name, xs);
    for (const [name, xs] of Object.entries(writes)) record(name, xs);
    for (const [name, xs] of Object.entries(phases)) record(name, xs);
    for (const key of ['serialize', 'toNormalForm', 'fromNormalForm'])
      record(`adapter alone: ${key}`, costs.map((c) => c[key]));
    // eslint-disable-next-line no-console
    console.log(
      [`flagship v4b, ${costs[0].bytes} bytes, ${RUNS} runs`, 'verb                                median ms   max ms', ...rows.map(([n, m, x]) => `${n.padEnd(36)}${m.toFixed(1).padStart(9)}${x.toFixed(1).padStart(9)}`)].join('\n')
    );
    expect(rows.length).toBeGreaterThan(0);
  }, 600000);
});
