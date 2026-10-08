/**
 * The proof step (architecture 4.4, 4.3a; contract section 8 `proof`).
 *
 * After a commit the live document is read back and compared, through the pack's own accept and
 * reject projections, with what was intended:
 *
 *   landed      accept(live) equals accept(intended): the change landed as asked, not beside the
 *               target and not partially;
 *   reversible  reject(live) equals reject(what rejecting should restore): by default the document
 *               before the write; a pack that applies some changes untracked says what instead.
 *
 * Equality is strict over content: ids are engine bookkeeping and format references compare by the
 * entry they name. The only differences admitted are the pack's enumerated normalizations, and the
 * ones that were needed are reported by name. A failed proof is rolled back until the editor's
 * bytes equal the bytes before the write.
 */
import { renameFormatRefs } from './ids';
import type { EditorHost, Pack } from './pack';
import {
  NormalForm,
  canonicalJson,
  clone,
  contentOf,
  hash64,
  isPlainObject
} from './tree';

/** A document as the proof compares it: no ids, format references replaced by entry content. */
export function comparable(pack: Pack, nf: NormalForm): unknown {
  const root = clone(nf.root);
  const byContent = new Map(
    Object.entries(nf.formats).map(([id, entry]) => [
      id,
      `format:${hash64(canonicalJson(entry))}`
    ])
  );
  renameFormatRefs(root, pack.formatRefKeys, byContent);
  return contentOf(root, { keepPending: true });
}

/** Up to `limit` paths where two JSON values differ, for refusal detail. */
export function differences(a: unknown, b: unknown, limit = 6): string[] {
  const out: string[] = [];
  const rec = (x: unknown, y: unknown, path: string) => {
    if (out.length >= limit) return;
    if (canonicalJson(x) === canonicalJson(y)) return;
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length)
        out.push(`${path || '/'}: ${x.length} items, expected ${y.length}`);
      for (let i = 0; i < Math.min(x.length, y.length); i += 1)
        rec(x[i], y[i], `${path}/${i}`);
      return;
    }
    if (isPlainObject(x) && isPlainObject(y)) {
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
        rec(x[key], y[key], `${path}/${key}`);
      return;
    }
    out.push(
      `${path || '/'}: ${JSON.stringify(x)?.slice(
        0,
        80
      )} where ${JSON.stringify(y)?.slice(0, 80)} was intended`
    );
  };
  rec(a, b, '');
  return out;
}

interface Comparison {
  equal: boolean;
  normalizations: string[];
  diff: string[];
}

/** Strict equality, then equality with the pack's normalizations; names the ones that mattered. */
function compareWithNormalizations(
  pack: Pack,
  live: NormalForm,
  intended: NormalForm
): Comparison {
  const a = comparable(pack, live);
  const b = comparable(pack, intended);
  if (canonicalJson(a) === canonicalJson(b))
    return { equal: true, normalizations: [], diff: [] };
  let l = live;
  let i = intended;
  const used: string[] = [];
  for (const n of pack.projections.normalizations) {
    const nl = n.apply(l);
    const ni = n.apply(i);
    if (
      canonicalJson(comparable(pack, nl)) !==
        canonicalJson(comparable(pack, l)) ||
      canonicalJson(comparable(pack, ni)) !== canonicalJson(comparable(pack, i))
    )
      used.push(n.name);
    l = nl;
    i = ni;
  }
  const ca = comparable(pack, l);
  const cb = comparable(pack, i);
  const equal = canonicalJson(ca) === canonicalJson(cb);
  return {
    equal,
    normalizations: equal ? used : [],
    diff: equal ? [] : differences(ca, cb)
  };
}

export interface ProofOutcome {
  passed: boolean;
  landed: boolean;
  reversible: boolean;
  normalizations: string[];
  landedDiff: string[];
  reversibleDiff: string[];
}

export function prove(
  pack: Pack,
  {
    before,
    intended,
    live
  }: { before: NormalForm; intended: NormalForm; live: NormalForm }
): ProofOutcome {
  const { accept, reject, expectedRejection } = pack.projections;
  const landed = compareWithNormalizations(
    pack,
    accept(live),
    accept(intended)
  );
  const restores = expectedRejection
    ? expectedRejection(before, intended)
    : before;
  const reversible = compareWithNormalizations(
    pack,
    reject(live),
    reject(restores)
  );
  return {
    passed: landed.equal && reversible.equal,
    landed: landed.equal,
    reversible: reversible.equal,
    normalizations: [
      ...new Set([...landed.normalizations, ...reversible.normalizations])
    ],
    landedDiff: landed.diff,
    reversibleDiff: reversible.diff
  };
}

export interface RollbackOutcome {
  byteEqual: boolean;
  via: 'nothing' | 'editor-undo' | 'snapshot';
  undoSteps: number;
}

/** Native undo steps tried before falling back to reopening the snapshot. */
export const ROLLBACK_UNDO_LIMIT = 8;

/**
 * Put the editor back to the bytes before the write: the editor's own undo while it brings the
 * document closer (a native commit is one grouped step), else the snapshot reopened.
 */
export function rollback(
  host: EditorHost,
  beforeNative: string
): RollbackOutcome {
  if (host.serialize() === beforeNative)
    return { byteEqual: true, via: 'nothing', undoSteps: 0 };
  let steps = 0;
  while (steps < ROLLBACK_UNDO_LIMIT && host.canUndo()) {
    host.undo();
    steps += 1;
    if (host.serialize() === beforeNative)
      return { byteEqual: true, via: 'editor-undo', undoSteps: steps };
  }
  host.open(beforeNative);
  return {
    byteEqual: host.serialize() === beforeNative,
    via: 'snapshot',
    undoSteps: steps
  };
}
