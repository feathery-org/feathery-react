import * as fs from 'fs';
import * as path from 'path';

import * as capabilityRegistry from '../registry';
import {
  ANCHORED_OP_HANDLERS,
  ANCHORLESS_OP_HANDLERS
} from '../../tools/docx/syncfusionDocumentOps';

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
  path.join(__dirname, '../../tools/docx/syncfusionDocumentOps.ts'),
  'utf8'
);
const { DOCUMENT_EDITOR_CAPABILITIES } = capabilityRegistry;

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

const PARAM_TYPE_LANGUAGE =
  /^(string|number|boolean|int>0|int>=0|enum\[[^\]]{1,200}\])\??$/;

describe('capability entries expose only the live handler contract', () => {
  it.each(
    DOCUMENT_EDITOR_CAPABILITIES.map((entry) => [entry.op, entry] as const)
  )('%s retains only op, params, and requiresAnchor', (_op, entry) => {
    const liveKeys = new Set(['op', 'params', 'requiresAnchor']);
    const deadKeys = Object.keys(entry).filter((key) => !liveKeys.has(key));
    expect(deadKeys).toEqual([]);
    for (const type of Object.values(entry.params)) {
      expect(type).toMatch(PARAM_TYPE_LANGUAGE);
    }
  });
});

describe('live retrieval surface owns its own contract', () => {
  it('keeps inventory scope types in parity with their implementation branches', () => {
    const union = DISPATCH_SOURCE.match(/export type InventoryScope =([^;]+);/);
    expect(union).toBeTruthy();
    const declaredScopes = [...union![1].matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1]
    );
    const branchedScopes = [
      ...DISPATCH_SOURCE.matchAll(/scope === '([a-z_]+)'/g)
    ].map((match) => match[1]);

    // `full` is the exhaustive fallback after every specialized branch.
    expect(DISPATCH_SOURCE).toContain('const all = cap(blocks)');
    expect([...new Set([...branchedScopes, 'full'])].sort()).toEqual(
      [...declaredScopes].sort()
    );
  });

  it('keeps occurrences on its live exported implementation', () => {
    expect(DISPATCH_SOURCE).toContain(
      'export function findDocumentOccurrences'
    );
  });

  it('registers the standalone section-pattern read without advertising it as an edit op', () => {
    expect(capabilityRegistry.DOCUMENT_EDITOR_READ_CAPABILITIES).toEqual([
      {
        tool: 'getSectionPattern',
        params: { near: 'string?' },
        requiresAnchor: false,
        readOnly: true
      }
    ]);
    expect(
      DOCUMENT_EDITOR_CAPABILITIES.some(
        (entry) => entry.op === ('getSectionPattern' as any)
      )
    ).toBe(false);
  });
});
