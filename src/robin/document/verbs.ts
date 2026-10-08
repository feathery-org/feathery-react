/**
 * The four verbs on the virtual document (contract sections 3 to 6).
 *
 * `outline`, `read` and `find` read one version of the normal form. `write` is prepared here: its
 * changes are applied in order to a copy of the live document, ids are minted, the pack's
 * finalizers run, and every check runs; the result is the intended document and its facts, a
 * conflict, or a refusal. Nothing here touches the editor: committing and proving a prepared write
 * is the reconciler's and the proof's job.
 */
import {
  Change,
  ConflictResult,
  FIND_DEFAULT_LIMIT,
  Fact,
  FindInput,
  FindResult,
  FinalizerScope,
  OutlineInput,
  OutlineResult,
  ROOT_ID,
  ReadInput,
  ReadResult,
  Refusal,
  RefusalProblem,
  Warning,
  WriteInput,
  addressedIds,
  isFormatId,
  isNodeId,
  makeRefusal,
  stripReadOnlyKeys
} from './envelope';
import { IdTable, mintWritten, renameFormatRefs } from './ids';
import { renderOutline } from './outline';
import type { DocumentView, FormatTable, Pack, Residue } from './pack';
import {
  FormatEntry,
  NfNode,
  NormalForm,
  baseOf,
  canonicalJson,
  clone,
  indexTree,
  isPlainObject,
  listAt,
  walk
} from './tree';
import { CheckRecord, CheckRunner, problem, runInvariants } from './verifier';
import { bulkQuery, checkBases, referrersOf } from './verifier/base';
import {
  formatPropertyProblems,
  newFormatProblems,
  propertyProblems,
  unknownFormatProblems
} from './verifier/schema';
import {
  TreeDiff,
  diffTrees,
  scopeProblems,
  touchedIds
} from './verifier/scope';
import { emitNode, makeView, matchQuery, referencedFormats } from './view';

export interface DocumentState {
  pack: Pack;
  view: DocumentView;
  residue: Residue;
  ids: IdTable;
  outlineHash: string;
}

// ---------------------------------------------------------------------------------------------
// outline, read, find
// ---------------------------------------------------------------------------------------------

export function outlineVerb(
  state: DocumentState,
  input: OutlineInput
): OutlineResult {
  return renderOutline(state.view, state.pack, input.depth);
}

export function readVerb(state: DocumentState, input: ReadInput): ReadResult {
  const { view, pack } = state;
  const nodes: ReadResult['nodes'] = [];
  const missing: string[] = [];
  const requestedFormats = new Set<string>();
  for (const id of [...new Set(input.ids)]) {
    if (isFormatId(id)) {
      if (view.nf.formats[id]) requestedFormats.add(id);
      else missing.push(id);
      continue;
    }
    const node = id === ROOT_ID ? view.nf.root : view.get(id);
    if (!node) {
      missing.push(id);
      continue;
    }
    nodes.push(
      emitNode(view, pack, node, {
        properties: input.properties === true,
        stubChildren: id === ROOT_ID
      })
    );
  }
  const mode = input.formats ?? 'referenced';
  const wanted =
    mode === 'all'
      ? new Set(Object.keys(view.nf.formats))
      : mode === 'referenced'
      ? referencedFormats(pack, nodes)
      : new Set<string>();
  for (const id of requestedFormats) wanted.add(id);
  const formats: ReadResult['formats'] = {};
  for (const id of Object.keys(view.nf.formats))
    if (wanted.has(id))
      formats[id] = {
        base: baseOf(view.nf.formats[id]),
        ...clone(view.nf.formats[id])
      };
  return { ok: true, outlineHash: state.outlineHash, nodes, formats, missing };
}

export function findVerb(state: DocumentState, input: FindInput): FindResult {
  const hits = matchQuery(state.view, state.pack, input);
  const limit = input.limit ?? FIND_DEFAULT_LIMIT;
  return {
    ok: true,
    outlineHash: state.outlineHash,
    hits: hits.slice(0, limit),
    truncated: hits.length > limit,
    total: hits.length
  };
}

// ---------------------------------------------------------------------------------------------
// write: preparation on the virtual document
// ---------------------------------------------------------------------------------------------

export type PreparedWrite =
  | {
      outcome: 'refused';
      refusal: Refusal;
      checks: CheckRecord[];
      warnings: Warning[];
    }
  | {
      outcome: 'conflict';
      conflict: ConflictResult['conflict'];
      checks: CheckRecord[];
      warnings: Warning[];
    }
  | {
      outcome: 'verified';
      intended: NormalForm;
      intendedResidue: Residue;
      mapping: Record<string, string>;
      touched: string[];
      finalizerScope: FinalizerScope[];
      facts: Fact[];
      warnings: Warning[];
      checks: CheckRecord[];
      diff: TreeDiff;
    };

/** The engine's format table over a working document: lookups, and interning by content. */
export function makeFormatTable(
  formats: Record<string, FormatEntry>,
  ids: IdTable
): FormatTable {
  return {
    get: (id) => formats[id],
    intern: (entry) => {
      const content = canonicalJson(entry);
      for (const [id, existing] of Object.entries(formats))
        if (canonicalJson(existing) === content) return id;
      const id = ids.mintFormat();
      formats[id] = clone(entry);
      return id;
    }
  };
}

const snippet = (pack: Pack, node: NfNode | undefined): string => {
  const text = node ? pack.text(node) : null;
  if (!text) return '';
  const t = text.replace(/\s+/g, ' ').trim();
  return ` ("${t.length > 60 ? `${t.slice(0, 60)}...` : t}")`;
};

const describeProps = (props: Record<string, unknown>) =>
  Object.entries(props)
    .map(([k, v]) =>
      v === null ? `${k} cleared` : `${k}=${JSON.stringify(v)}`
    )
    .join(', ');

/** Every engine id a write names, on changes and inside written nodes. */
function namedIds(changes: Change[]): Array<{ id: string; at: string }> {
  const out: Array<{ id: string; at: string }> = [];
  changes.forEach((change, i) => {
    for (const id of addressedIds(change))
      if (isNodeId(id)) out.push({ id, at: `changes[${i}]` });
    if ('node' in change)
      walkWritten(change.node, (n) => {
        if (isNodeId(n.id))
          out.push({ id: n.id as string, at: `changes[${i}].node` });
      });
  });
  return out;
}

function walkWritten(
  value: unknown,
  visit: (node: Record<string, unknown>) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((v) => walkWritten(v, visit));
    return;
  }
  if (!isPlainObject(value)) return;
  visit(value);
  for (const child of Object.values(value)) walkWritten(child, visit);
}

export function prepareWrite(
  state: DocumentState,
  write: WriteInput
): PreparedWrite {
  const { pack, view, ids } = state;
  const runner = new CheckRunner();
  const warnings: Warning[] = [];
  runner.record('envelope', true);

  // Section 6.2: read-only keys on written nodes are stripped with a warning.
  const strippedKeys = new Set<string>();
  const changes: Change[] = write.changes.map((change) => {
    if (!('node' in change)) return clone(change);
    const { node, stripped } = stripReadOnlyKeys(clone(change.node));
    stripped.forEach((k) => strippedKeys.add(k));
    return { ...clone(change), node };
  });
  if (strippedKeys.size)
    warnings.push({
      code: 'stripped-read-only',
      message: `Ignored read-only key(s) on written nodes: ${[
        ...strippedKeys
      ].join(', ')}.`
    });
  const refused = (): PreparedWrite => ({
    outcome: 'refused',
    refusal: makeRefusal(runner.problems),
    checks: runner.checks,
    warnings
  });

  // Every engine id named must exist; a set on a format entry must name one that exists.
  runner.run('unknown-id', () => {
    const unknown = namedIds(changes).filter(({ id }) => !view.get(id));
    if (!unknown.length) return [];
    return [
      problem(
        'unknown-id',
        `Nothing was applied: ${unknown
          .map((u) => `${u.at} names ${u.id}`)
          .join('; ')}, which is not a node of this document.`,
        {
          detail: unknown,
          hint: 'Copy every id from outline, read or find exactly as given; nodes you create carry no id or a tmp: id.'
        }
      )
    ];
  });
  runner.run('unknown-format', () => {
    const missing = changes.flatMap((c, i) =>
      c.kind === 'set' &&
      'formatId' in c.target &&
      !view.nf.formats[c.target.formatId]
        ? [`changes[${i}] names ${c.target.formatId}`]
        : []
    );
    return missing.length
      ? [
          problem(
            'unknown-format',
            `Nothing was applied: ${missing.join(
              '; '
            )}, which is not a format of this document.`,
            { detail: missing }
          )
        ]
      : [];
  });
  if (runner.failed) return refused();

  // Read before write: every carried hash against the live document.
  const conflict = checkBases(
    view,
    pack,
    { ...write, changes },
    state.outlineHash
  );
  runner.record('base-hashes', !conflict);
  if (conflict)
    return { outcome: 'conflict', conflict, checks: runner.checks, warnings };

  // New format entries and the format references of written nodes.
  const newFormats = write.formats ?? {};
  runner.run('format-entry-rejected', () =>
    newFormatProblems(pack, newFormats)
  );
  const knownFormats = new Set([
    ...Object.keys(view.nf.formats),
    ...Object.keys(newFormats)
  ]);
  runner.run('unknown-format', () =>
    unknownFormatProblems(
      pack,
      changes.flatMap((c) => ('node' in c ? [c.node] : [])),
      knownFormats
    )
  );
  if (runner.failed) return refused();

  // Apply the changes, in order, to a copy of the live document.
  const working = clone(view.nf);
  const formatTable = makeFormatTable(working.formats, ids);
  const mapping: Record<string, string> = {};
  const tmpFormats = new Map<string, string>();
  for (const [tmp, entry] of Object.entries(newFormats)) {
    const id = formatTable.intern(entry);
    tmpFormats.set(tmp, id);
    mapping[tmp] = id;
  }
  for (const c of changes)
    if ('node' in c) renameFormatRefs(c.node, pack.formatRefKeys, tmpFormats);

  const written = new WeakSet<object>();
  const applyProblems: RefusalProblem[] = [];
  const bulkHits = new Map<number, string[]>();
  const factsFor: Array<() => Fact> = [];
  let index = indexTree(working.root, pack.tree);
  const reindex = () => {
    index = indexTree(working.root, pack.tree);
  };
  const fail = (invariant: string, what: string, hint?: string) =>
    applyProblems.push(
      problem(invariant, `Nothing was applied: ${what}.`, hint ? { hint } : {})
    );

  /** Give a written node and its nested nodes their kinds, checking each against its place. */
  const prepare = (
    node: Record<string, unknown>,
    parentKind: string,
    key: string,
    at: string
  ): boolean => {
    const kind =
      typeof node.kind === 'string'
        ? node.kind
        : pack.tree.inferKind(node, parentKind, key);
    if (!kind) {
      fail(
        'apply-failed',
        `${at}: cannot tell what kind of node this is from its shape`,
        'Give the node a `kind`, or copy its shape from a node read from the document.'
      );
      return false;
    }
    let ok = true;
    if (isNodeId(node.id)) {
      const original = view.get(node.id as string);
      if (original && original.kind !== kind) {
        fail(
          'id-shape-mismatch',
          `${at}: ${node.id} is a ${original.kind} in the document but is written as a ${kind}`,
          'A node that carries an id is that node, kept or copied; nodes you create carry no id.'
        );
        ok = false;
      }
    }
    if (!pack.tree.accepts(parentKind, key, kind)) {
      fail(
        'apply-failed',
        `${at}: a ${kind} cannot be placed in the ${key} of a ${parentKind}`
      );
      ok = false;
    }
    node.kind = kind;
    for (const listKey of pack.tree.childLists(node as NfNode)) {
      const list = listAt(node, listKey);
      if (!list) continue;
      list.forEach((child, i) => {
        if (!isPlainObject(child)) {
          fail('apply-failed', `${at}.${listKey}[${i}] is not a node`);
          ok = false;
        } else if (!prepare(child, kind, listKey, `${at}.${listKey}[${i}]`))
          ok = false;
      });
    }
    return ok;
  };

  const locate = (id: string, at: string) => {
    const placement = index.get(id);
    if (!placement)
      fail(
        'apply-failed',
        `${at}: ${id} is no longer in the document at this point of the write (an earlier change removed it)`
      );
    return placement;
  };
  const listOf = (parent: NfNode, key: string) =>
    listAt(parent, key) as unknown[];
  const insideOf = (id: string, ancestor: string) => {
    let p = index.get(id)?.parent ?? null;
    while (p) {
      if (p.id === ancestor) return true;
      p = index.get(p.id)?.parent ?? null;
    }
    return false;
  };

  changes.forEach((change, i) => {
    const at = `changes[${i}]`;
    switch (change.kind) {
      case 'replace': {
        const target = locate(change.id, at);
        if (!target) return;
        if (!target.parent || target.key === null) {
          fail('apply-failed', `${at}: the root cannot be replaced`);
          return;
        }
        const node = change.node as Record<string, unknown>;
        if (!prepare(node, target.parent.kind, target.key, `${at}.node`))
          return;
        if (node.id === undefined && node.kind === target.node.kind)
          node.id = target.node.id;
        listOf(target.parent, target.key)[target.index] = node;
        written.add(node);
        reindex();
        factsFor.push(() => ({
          kind: 'replaced',
          ids: [String(node.id)],
          summary: `${node.kind} ${change.id}${
            node.id !== change.id ? ` replaced by ${node.id}` : ' replaced'
          }${snippet(pack, node as NfNode)}`
        }));
        return;
      }
      case 'insert_before':
      case 'insert_after': {
        const anchor = locate(change.anchor, at);
        if (!anchor) return;
        if (!anchor.parent || anchor.key === null) {
          fail(
            'apply-failed',
            `${at}: the anchor ${change.anchor} is not in a list`
          );
          return;
        }
        const node = change.node as Record<string, unknown>;
        if (!prepare(node, anchor.parent.kind, anchor.key, `${at}.node`))
          return;
        const offset = change.kind === 'insert_after' ? 1 : 0;
        listOf(anchor.parent, anchor.key).splice(
          anchor.index + offset,
          0,
          node
        );
        written.add(node);
        reindex();
        const where = change.kind === 'insert_after' ? 'after' : 'before';
        factsFor.push(() => ({
          kind: 'inserted',
          ids: [String(node.id)],
          summary: `1 ${node.kind} inserted ${where} ${change.anchor}${snippet(
            pack,
            node as NfNode
          )}`
        }));
        return;
      }
      case 'delete': {
        const target = locate(change.id, at);
        if (!target) return;
        if (!target.parent || target.key === null) {
          fail('apply-failed', `${at}: the root cannot be deleted`);
          return;
        }
        const removed = target.node;
        listOf(target.parent, target.key).splice(target.index, 1);
        reindex();
        factsFor.push(() => ({
          kind: 'deleted',
          ids: [change.id],
          summary: `${removed.kind} ${change.id} deleted${snippet(
            pack,
            removed
          )}`
        }));
        return;
      }
      case 'move': {
        const target = locate(change.id, at);
        if (!target) return;
        if (!locate(change.anchor, at)) return;
        if (!target.parent || target.key === null) {
          fail('apply-failed', `${at}: the root cannot be moved`);
          return;
        }
        if (change.anchor === change.id || insideOf(change.anchor, change.id)) {
          fail(
            'apply-failed',
            `${at}: ${change.id} cannot move next to ${change.anchor}, which is inside it`
          );
          return;
        }
        const node = target.node;
        listOf(target.parent, target.key).splice(target.index, 1);
        reindex();
        const anchor = index.get(change.anchor);
        if (!anchor?.parent || anchor.key === null) {
          fail(
            'apply-failed',
            `${at}: the anchor ${change.anchor} is not in a list`
          );
          return;
        }
        if (!pack.tree.accepts(anchor.parent.kind, anchor.key, node.kind)) {
          fail(
            'apply-failed',
            `${at}: a ${node.kind} cannot be placed in the ${anchor.key} of a ${anchor.parent.kind}`
          );
          return;
        }
        listOf(anchor.parent, anchor.key).splice(
          anchor.index + (change.position === 'after' ? 1 : 0),
          0,
          node
        );
        reindex();
        factsFor.push(() => ({
          kind: 'moved',
          ids: [change.id],
          summary: `${node.kind} ${change.id} moved ${change.position} ${
            change.anchor
          }${snippet(pack, node)}`
        }));
        return;
      }
      case 'set': {
        const t = change.target;
        const props = change.props;
        if ('formatId' in t) {
          const problems = formatPropertyProblems(pack, props, t.formatId);
          if (problems.length) {
            applyProblems.push(...problems);
            return;
          }
          const entry = working.formats[t.formatId];
          for (const [name, value] of Object.entries(props))
            pack.properties.setOnFormat(entry, name, value);
          factsFor.push(() => ({
            kind: 'set',
            ids: [],
            summary: `${describeProps(props)} set on format ${
              t.formatId
            }, shared by ${t.referrers} node(s)`
          }));
          return;
        }
        let targets: string[];
        if ('find' in t) {
          targets = matchQuery(view, pack, bulkQuery(t.find)).map((h) => h.id);
          bulkHits.set(i, targets);
        } else if ('match' in t) targets = [t.id];
        else targets = t.ids;
        const nodes: NfNode[] = [];
        for (const id of targets) {
          const placement = 'find' in t ? index.get(id) : locate(id, at);
          if (placement) nodes.push(placement.node);
        }
        const kinds = new Map(nodes.map((n) => [n.kind, n.id]));
        const problems = [...kinds].flatMap(([kind, id]) =>
          propertyProblems(pack, kind, props, id)
        );
        if (problems.length) {
          applyProblems.push(...problems);
          return;
        }
        if ('match' in t) {
          const node = nodes[0];
          if (!node) return;
          const text = pack.text(node);
          const found =
            text === null
              ? null
              : text.slice(t.match.span.start, t.match.span.end);
          if (
            found === null ||
            found.toLowerCase() !== t.match.text.toLowerCase()
          ) {
            fail(
              'apply-failed',
              `${at}: ${t.id} ${
                text === null
                  ? 'has no text'
                  : `reads ${JSON.stringify(found)} at [${
                      t.match.span.start
                    }, ${t.match.span.end}), not ${JSON.stringify(
                      t.match.text
                    )}`
              }`,
              'Copy span from a find hit, or count offsets in the node text as read.'
            );
            return;
          }
          if (!pack.properties.setOnSpan) {
            fail(
              'apply-failed',
              `${at}: text spans cannot carry their own properties in this document`,
              'Use the ids target.'
            );
            return;
          }
          const why = pack.properties.setOnSpan(
            node,
            t.match.span,
            t.match.text,
            props,
            formatTable
          );
          if (why) {
            fail('apply-failed', `${at}: ${why}`);
            return;
          }
        } else
          for (const node of nodes)
            for (const [name, value] of Object.entries(props))
              pack.properties.setOverride(node, name, value, formatTable);
        reindex();
        factsFor.push(() => ({
          kind: 'set',
          ids: nodes.map((n) => n.id),
          summary: `${describeProps(props)} set on ${nodes.length} node(s)${
            'match' in t ? ` (span "${t.match.text}")` : ''
          }`
        }));
      }
    }
  });
  runner.run('apply-failed', () =>
    applyProblems.filter((p) => p.invariant === 'apply-failed')
  );
  runner.run('id-shape-mismatch', () =>
    applyProblems.filter((p) => p.invariant === 'id-shape-mismatch')
  );
  runner.run('property-invalid', () =>
    applyProblems.filter((p) => p.invariant === 'property-invalid')
  );
  if (runner.failed) return refused();

  // Ids for everything the write created or copied; residue follows kept and copied nodes.
  const minted = mintWritten(
    working.root,
    pack.tree,
    ids,
    (id) => view.placement(id)?.parent?.id ?? null,
    (node) => written.has(node)
  );
  Object.assign(mapping, minted.mapping);

  // Finalizers, each declaring what it touched.
  const finalizerScope: FinalizerScope[] = [];
  const finalizerFacts: Fact[] = [];
  const finalizerIds = new Set<string>();
  for (const finalizer of pack.finalizers) {
    const result = finalizer.run(working, {
      before: view,
      formats: formatTable
    });
    finalizerScope.push({ name: finalizer.name, ids: [...result.ids] });
    result.ids.forEach((id) => finalizerIds.add(id));
    finalizerFacts.push(...(result.facts ?? []));
  }
  mintWritten(working.root, pack.tree, ids, () => null);

  const intendedResidue: Residue = {};
  walk(working.root, pack.tree, ({ node }) => {
    if (node.id in state.residue)
      intendedResidue[node.id] = state.residue[node.id];
  });
  for (const [copy, original] of Object.entries(minted.copies))
    if (original in state.residue)
      intendedResidue[copy] = clone(state.residue[original]);

  const after = makeView(working, pack);
  const diff = diffTrees(view, after, pack);
  runner.run('scope', () =>
    scopeProblems({
      before: view,
      after,
      pack,
      diff,
      write,
      bulkHits,
      finalizerIds
    })
  );
  runInvariants(runner, pack, {
    before: view,
    after,
    changed: diff.changed,
    removed: diff.removed,
    created: diff.created
  });
  if (runner.failed) return refused();

  const facts = [...factsFor.map((f) => f()), ...finalizerFacts];
  return {
    outcome: 'verified',
    intended: working,
    intendedResidue,
    mapping,
    touched: touchedIds(diff, finalizerIds),
    finalizerScope,
    facts,
    warnings,
    checks: runner.checks,
    diff
  };
}

/** Count of nodes referencing a format, for callers composing scope acknowledgements. */
export function formatReferrers(
  state: DocumentState,
  formatId: string
): number {
  return referrersOf(state.view, state.pack, formatId).length;
}
