// Sequence alignment primitives. Two layers:
//   1. patience: pair items whose key is unique on both sides (stable anchors),
//      then recurse between anchors;
//   2. lcs: a bounded dynamic-programming longest-common-subsequence for the
//      gaps, which is what handles repeated short lines (table cells, bullets).
// No dependency: the inputs are small (blocks, or words of one paragraph).

export interface Pair {
  a: number;
  b: number;
}

/** Classic O(n*m) LCS on keys. Returns matched index pairs in order. */
export function lcs(a: string[], b: string[], cap = 4_000_000): Pair[] {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  if (n * m > cap) return greedyMatch(a, b);
  // dp[i][j] = LCS length of a[i:], b[j:]
  const dp: Uint32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }
  const out: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ a: i, b: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** Fallback for very large inputs: forward greedy matching on first hit. */
function greedyMatch(a: string[], b: string[]): Pair[] {
  const out: Pair[] = [];
  let j = 0;
  for (let i = 0; i < a.length && j < b.length; i++) {
    let k = j;
    while (k < b.length && b[k] !== a[i]) k++;
    if (k < b.length) {
      out.push({ a: i, b: k });
      j = k + 1;
    }
  }
  return out;
}

/**
 * Patience alignment: anchor on keys unique to both sides (in increasing order
 * on both — the longest increasing subsequence of the unique matches), then LCS
 * the segments between anchors. Blank keys never anchor.
 */
export function patienceAlign(a: string[], b: string[]): Pair[] {
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const k of a) countA.set(k, (countA.get(k) ?? 0) + 1);
  for (const k of b) countB.set(k, (countB.get(k) ?? 0) + 1);
  const posB = new Map<string, number>();
  b.forEach((k, idx) => {
    if (countB.get(k) === 1) posB.set(k, idx);
  });
  const candidates: Pair[] = [];
  a.forEach((k, idx) => {
    if (k && countA.get(k) === 1 && posB.has(k))
      candidates.push({ a: idx, b: posB.get(k) as number });
  });
  const anchors = longestIncreasingByB(candidates);
  const out: Pair[] = [];
  let ai = 0;
  let bi = 0;
  const fill = (aEnd: number, bEnd: number) => {
    if (aEnd > ai && bEnd > bi) {
      for (const p of lcs(a.slice(ai, aEnd), b.slice(bi, bEnd)))
        out.push({ a: ai + p.a, b: bi + p.b });
    }
  };
  for (const anchor of anchors) {
    fill(anchor.a, anchor.b);
    out.push(anchor);
    ai = anchor.a + 1;
    bi = anchor.b + 1;
  }
  fill(a.length, b.length);
  return out;
}

function longestIncreasingByB(pairs: Pair[]): Pair[] {
  // pairs are already increasing in `a`; find the LIS in `b`.
  if (!pairs.length) return [];
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev: number[] = new Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    const v = pairs[i].b;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const out: Pair[] = [];
  let k = tailIdx[tails.length - 1];
  while (k !== -1) {
    out.push(pairs[k]);
    k = prev[k];
  }
  return out.reverse();
}

/** Dice coefficient over character bigrams; 0..1. */
export function similarity(x: string, y: string): number {
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    grams.set(g, (grams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const c = grams.get(g) ?? 0;
    if (c > 0) {
      hits++;
      grams.set(g, c - 1);
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

export interface WordOp {
  type: 'eq' | 'ins' | 'del';
  text: string;
}

// A whole monetary/numeric value is ONE token — optional currency symbol, the
// digits with thousands/decimal separators, and a trailing percent — so a
// changed number diffs as a single unit (strike the old value, write the new)
// instead of fragmenting into the differing digits. The trailing lookahead
// keeps it from swallowing part of an alphanumeric word (e.g. "3rd", "v2").
// Ordered before the alphanumeric run so it wins when it starts on a number.
const NUMBER = String.raw`[$€£¥]?\d(?:[\d.,]*\d)?%?(?![A-Za-z0-9À-￿])`;
const TOKEN = new RegExp(
  `\\s+|${NUMBER}|[A-Za-z0-9À-￿]+|[^\\sA-Za-z0-9À-￿]`,
  'g'
);

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Word-level diff (whitespace tokens kept so offsets stay exact). */
export function wordDiff(oldText: string, newText: string): WordOp[] {
  if (oldText === newText)
    return oldText ? [{ type: 'eq', text: oldText }] : [];
  const a = tokenize(oldText);
  const b = tokenize(newText);
  const pairs = lcs(a, b);
  const ops: WordOp[] = [];
  let i = 0;
  let j = 0;
  const push = (type: WordOp['type'], text: string) => {
    if (!text) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };
  for (const p of pairs) {
    while (i < p.a) push('del', a[i++]);
    while (j < p.b) push('ins', b[j++]);
    push('eq', a[i++]);
    j++;
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('ins', b[j++]);
  return ops;
}
