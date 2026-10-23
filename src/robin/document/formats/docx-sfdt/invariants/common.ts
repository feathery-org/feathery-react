/** Shared helpers for the pack's invariants. */
import type { RefusalProblem } from '../../../envelope';
import type { DocumentView } from '../../../pack';
import type { NfNode } from '../../../tree';
import { KIND } from '../adapter/keys';

export function refusal(
  invariant: string,
  destroyed: string,
  detail: unknown,
  read: string[],
  hint?: string
): RefusalProblem {
  return {
    invariant,
    destroyed: `Nothing was applied: ${destroyed}`,
    detail,
    retry: 'modified_input',
    read,
    ...(hint ? { hint } : {})
  };
}

/** Text of a node: its runs' text, in order, at any depth. */
export function textOf(node: NfNode | undefined): string {
  if (!node) return '';
  let out = '';
  const rec = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(rec);
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (o.kind === KIND.run && typeof o.text === 'string') out += o.text;
    for (const [k, v] of Object.entries(o))
      if (k !== 'pending' && k !== 'binding') rec(v);
  };
  rec(node);
  return out;
}

export const describe = (n: NfNode | undefined, id: string): string => {
  const t = textOf(n).replace(/\s+/g, ' ').trim();
  return `${n?.kind ?? 'node'} ${id}${
    t ? ` ("${t.length > 40 ? `${t.slice(0, 40)}...` : t}")` : ''
  }`;
};

/** Nodes of a kind in document order. */
export const nodesOfKind = (view: DocumentView, kind: string): NfNode[] =>
  view.nodes().filter((n) => n.kind === kind);
