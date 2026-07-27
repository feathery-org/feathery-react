import * as fs from 'fs';
import * as path from 'path';

import {
  DOCUMENT_EDITOR_CAPABILITIES,
  DOCUMENT_EDITOR_READS
} from '../registry';
import {
  ANCHORED_OP_HANDLERS,
  ANCHORLESS_OP_HANDLERS
} from '../../tools/syncfusionDocumentOps';

// ---------------------------------------------------------------------------
// Registry <-> dispatch parity, both directions.
//
// Since S5 this agreement is primarily the COMPILER's: the handler tables in
// syncfusionDocumentOps.ts are mapped types over the registry-derived op-name
// unions, so a registry entry with no handler, a handler with no entry, or a
// handler consuming an undeclared param fails `yarn typecheck` / the build.
// This spec re-asserts the same parity at runtime over the emitted JS - a
// cheap second alarm that also guards against the tables being cast loose in
// a future refactor - and pins the executor's two special cases (replace_all,
// and the undo/redo refusal) that live outside the tables.
// ---------------------------------------------------------------------------

const DISPATCH_SOURCE = fs.readFileSync(
  path.join(__dirname, '../../tools/syncfusionDocumentOps.ts'),
  'utf8'
);

describe('capabilities registry <-> dispatch parity', () => {
  it('op names are unique', () => {
    const ops = DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op);
    expect(new Set(ops).size).toBe(ops.length);
  });

  it('every registry op has a handler, and every handler is registered', () => {
    const registered = DOCUMENT_EDITOR_CAPABILITIES.map((entry) => entry.op);

    // replace_all is dispatched by the executor itself (applyReplaceAll), not
    // by either handler table; assert that special case still exists.
    expect(DISPATCH_SOURCE).toContain("op.op === 'replace_all'");
    expect(DISPATCH_SOURCE).toContain('function applyReplaceAll(');

    const handled = [
      ...Object.keys(ANCHORED_OP_HANDLERS),
      ...Object.keys(ANCHORLESS_OP_HANDLERS),
      'replace_all'
    ];
    expect(new Set(handled).size).toBe(handled.length);

    const lies = registered.filter((op) => !handled.includes(op));
    const unreachable = handled.filter(
      (op) => !registered.includes(op as typeof registered[number])
    );

    expect({
      registeredButNoHandler: lies,
      handledButNotRegistered: unreachable
    }).toEqual({ registeredButNoHandler: [], handledButNotRegistered: [] });
  });

  it("anchored/anchorless table membership matches each entry's requiresAnchor", () => {
    for (const entry of DOCUMENT_EDITOR_CAPABILITIES) {
      if (entry.op === 'replace_all') continue; // executor special case
      const table = entry.requiresAnchor
        ? ANCHORED_OP_HANDLERS
        : ANCHORLESS_OP_HANDLERS;
      expect(Object.keys(table)).toContain(entry.op);
    }
  });

  it('undo/redo are unhandled and refused upstream, not silently dropped', () => {
    // They act on global human/editor history, so they are intentionally not
    // advertised and have no handlers; the executor refuses them before any
    // dispatch. Pin the refusal wiring so removing it cannot go unnoticed.
    expect(Object.keys(ANCHORED_OP_HANDLERS)).not.toContain('undo');
    expect(Object.keys(ANCHORLESS_OP_HANDLERS)).not.toContain('undo');
    expect(Object.keys(ANCHORLESS_OP_HANDLERS)).not.toContain('redo');
    expect(DISPATCH_SOURCE).toContain(
      "const UNSAFE_CHANGE_SET_OPS = new Set(['undo', 'redo'])"
    );
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
    return typeof value === 'string' && enumMatch[1].split(',').includes(value);
  throw new Error(`Unknown param type "${type}"`);
}

// ---------------------------------------------------------------------------
// Read capabilities <-> retrieval surface parity (S3). Reads are dispatched by
// getDocumentInventory's scope switch and findDocumentOccurrences, not the
// edit switches - so their parity check reads the scope union and the search
// export instead of case labels. Same failure classes as ops: a declared read
// with no implementation is a lie, an implemented scope nobody declares is
// invisible capability.
// ---------------------------------------------------------------------------

const PARAM_TYPE_LANGUAGE =
  /^(string|number|boolean|int>0|int>=0|enum\[[^\]]{1,200}\])\??$/;

describe('read capabilities <-> retrieval surface parity', () => {
  it('read names are unique and entries fit the declaration envelope', () => {
    const names = DOCUMENT_EDITOR_READS.map((entry) => entry.read);
    expect(new Set(names).size).toBe(names.length);
    for (const entry of DOCUMENT_EDITOR_READS) {
      expect(entry.summary.trim().length).toBeGreaterThan(0);
      expect(entry.summary.length).toBeLessThanOrEqual(400);
      for (const type of Object.values(entry.params)) {
        expect(type).toMatch(PARAM_TYPE_LANGUAGE);
      }
    }
  });

  it('inventory-scope reads match the InventoryScope union exactly, both directions', () => {
    const union = DISPATCH_SOURCE.match(
      /export type InventoryScope = ([^;]+);/
    );
    expect(union).toBeTruthy();
    const implementedScopes = [...union![1].matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1]
    );
    // Guard against a vacuous match on a moved/renamed type.
    expect(implementedScopes).toContain('outline');

    const declaredScopes = DOCUMENT_EDITOR_READS.filter(
      (entry) => entry.read !== 'occurrences'
    ).map((entry) => entry.read);

    expect([...declaredScopes].sort()).toEqual([...implementedScopes].sort());
  });

  it('the occurrences read has a live implementation', () => {
    expect(DISPATCH_SOURCE).toContain(
      'export function findDocumentOccurrences'
    );
  });
});

describe('capability entries are self-consistent', () => {
  it.each(
    DOCUMENT_EDITOR_CAPABILITIES.map((entry) => [entry.op, entry] as const)
  )(
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
