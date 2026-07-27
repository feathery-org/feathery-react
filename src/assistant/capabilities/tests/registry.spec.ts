import * as fs from 'fs';
import * as path from 'path';

import { DOCUMENT_EDITOR_CAPABILITIES } from '../registry';

// ---------------------------------------------------------------------------
// Registry <-> dispatch parity, both directions.
//
// The registry is the advertised surface; the switch cases in
// syncfusionDocumentOps.ts are the implemented surface. The whole point of S2
// is that these two can never silently diverge again:
//   - a registry entry with no switch case advertises a capability that will
//     hard-fail (a lie to the model);
//   - a switch case with no registry entry implements a capability nobody can
//     reach (dead surface, or an op sneaked in without being declared).
// The dispatch is a switch statement, not data, so the comparison reads the
// source. The slice markers are asserted so a refactor that moves the
// functions fails this test loudly instead of matching nothing.
// ---------------------------------------------------------------------------

const DISPATCH_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../tools/syncfusionDocumentOps.ts'),
  'utf8'
);

function dispatchSlice(): string {
  const start = DISPATCH_SOURCE.indexOf('function applyAnchoredOp(');
  const end = DISPATCH_SOURCE.indexOf('function fmtField(');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return DISPATCH_SOURCE.slice(start, end);
}

// `undo`/`redo` have switch cases but are intentionally not advertised: the
// executor refuses them before dispatch (unsafe_global_history_op, see
// UNSAFE_CHANGE_SET_OPS) because they act on global human/editor history.
const HANDLED_BUT_UNADVERTISED = ['undo', 'redo'];

function switchCaseOps(): string[] {
  const slice = dispatchSlice();
  const cases = [...slice.matchAll(/case '([a-z][a-z0-9_]*)':/g)].map(
    (match) => match[1]
  );
  // The slice must contain both dispatch switches; spot-check one op from
  // each so a partial slice cannot pass vacuously.
  expect(cases).toContain('replace_text'); // applyAnchoredOp
  expect(cases).toContain('enter_header'); // applyAnchorlessOp
  return cases;
}

describe('capabilities registry <-> dispatch parity', () => {
  it('op names are unique', () => {
    const ops = DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op);
    expect(new Set(ops).size).toBe(ops.length);
  });

  it('every registry op has a handler, and every handler is registered', () => {
    const registered = DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op);

    const cases = switchCaseOps();
    for (const op of HANDLED_BUT_UNADVERTISED) expect(cases).toContain(op);

    // replace_all is dispatched by the executor itself (applyReplaceAll), not
    // by either switch; assert that special case still exists in the source.
    expect(DISPATCH_SOURCE).toContain("name === 'replace_all'");
    expect(DISPATCH_SOURCE).toContain('function applyReplaceAll(');

    const handled = [
      ...cases.filter((op) => !HANDLED_BUT_UNADVERTISED.includes(op)),
      'replace_all'
    ];

    const lies = registered.filter((op) => !handled.includes(op));
    const unreachable = handled.filter((op) => !registered.includes(op));

    expect({
      registeredButNoHandler: lies,
      handledButNotRegistered: unreachable
    }).toEqual({ registeredButNoHandler: [], handledButNotRegistered: [] });
  });
});

// ---------------------------------------------------------------------------
// Entry self-consistency: each example must validate against its own declared
// params (m5 C3 - a self-inconsistent example is a broken declaration).
// ---------------------------------------------------------------------------

const RESERVED_EXAMPLE_KEYS = new Set(['op', 'anchor', 'expect']);

function matchesType(value: unknown, type: string): boolean {
  const base = type.endsWith('?') ? type.slice(0, -1) : type;
  if (base === 'string') return typeof value === 'string';
  if (base === 'number') return typeof value === 'number';
  if (base === 'boolean') return typeof value === 'boolean';
  if (base === 'int>0')
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
  if (base === 'int>=0')
    return typeof value === 'number' && Number.isInteger(value) && value >= 0;
  const enumMatch = base.match(/^enum\[(.*)\]$/);
  if (enumMatch)
    return (
      typeof value === 'string' && enumMatch[1].split(',').includes(value)
    );
  throw new Error(`Unknown param type "${type}"`);
}

describe('capability entries are self-consistent', () => {
  it.each(DOCUMENT_EDITOR_CAPABILITIES.map((entry) => [entry.op, entry] as const))(
    '%s: example validates against declared params and anchor contract',
    (op, entry) => {
      expect(entry.example.op).toBe(op);
      expect(entry.summary.trim().length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeLessThanOrEqual(400);

      // Anchor contract.
      if (entry.requiresAnchor) {
        expect(entry.anchorKind).not.toBe('none');
        const anchor = entry.example.anchor;
        expect(typeof anchor).toBe('string');
        const parts = String(anchor).split(';');
        if (entry.anchorKind === 'table_cell') expect(parts).toHaveLength(5);
        else expect(parts.length).toBeLessThanOrEqual(2);
      } else {
        expect(entry.anchorKind).toBe('none');
        expect(entry.example.anchor).toBeUndefined();
      }

      // Every example key is either reserved or declared.
      for (const key of Object.keys(entry.example)) {
        if (RESERVED_EXAMPLE_KEYS.has(key)) continue;
        expect(Object.keys(entry.params)).toContain(key);
      }

      // Every declared param present in the example matches its type, and
      // every required (non-`?`) param is present.
      for (const [param, type] of Object.entries(entry.params)) {
        const value = entry.example[param];
        if (value === undefined) {
          expect(type.endsWith('?')).toBe(true);
        } else {
          expect(matchesType(value, type)).toBe(true);
        }
      }
    }
  );
});
