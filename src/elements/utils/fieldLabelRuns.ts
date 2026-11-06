export type LabelRun = {
  insert: string;
  attributes?: Record<string, any>;
};

/**
 * A field label's rich text runs (a Quill Delta), stored next to the plain
 * `servar.name`. The name stays the source of truth everywhere else, so runs
 * are only used while they still spell it out exactly; anything that renames
 * the field without rewriting the runs (properties panel, API, translations)
 * falls back to the plain name.
 */
export function getLabelRuns(servar: any): LabelRun[] | null {
  const runs = servar?.metadata?.name_formatted;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  if (!runs.every((run) => typeof run?.insert === 'string')) return null;
  const text = runs.map((run) => run.insert).join('');
  return text === servar.name ? runs : null;
}

/** Trims surrounding whitespace across runs, dropping runs left empty. */
export function trimLabelRuns(runs: LabelRun[]): LabelRun[] {
  const trimmed = runs.map((run) => ({ ...run }));
  const first = trimmed.findIndex((run) => run.insert.trim());
  if (first === -1) return [];
  let last = trimmed.length - 1;
  while (!trimmed[last].insert.trim()) last--;
  trimmed[first].insert = trimmed[first].insert.trimStart();
  trimmed[last].insert = trimmed[last].insert.trimEnd();
  return trimmed.slice(first, last + 1).filter((run) => run.insert);
}

/**
 * Rebuilds runs from an edited label's DOM. Each run renders as a span with
 * `data-index`, so typed text keeps the attributes of the run it landed in.
 * Nodes the browser creates without one (bare text, split spans) continue the
 * run before them, or the first run at the start.
 */
export function runsFromNodes(
  nodes: NodeListOf<ChildNode> | ChildNode[],
  oldRuns: LabelRun[]
): LabelRun[] {
  const runs: LabelRun[] = [];
  let index = 0;
  Array.from(nodes).forEach((node) => {
    const insert = node.textContent ?? '';
    if (!insert) return;
    const ownIndex = (node as HTMLElement).dataset?.index;
    if (ownIndex !== undefined) index = Number(ownIndex);
    const attributes = oldRuns[index]?.attributes;
    const prev = runs[runs.length - 1];
    // Merge neighbours with identical formatting to keep the delta compact
    if (prev && sameAttributes(prev.attributes, attributes))
      prev.insert += insert;
    else runs.push(attributes ? { insert, attributes } : { insert });
  });
  return runs;
}

/** True when no run carries formatting, so the plain name says it all. */
export function isPlainRuns(runs: LabelRun[]): boolean {
  return runs.every(
    (run) => !run.attributes || Object.keys(run.attributes).length === 0
  );
}

function sameAttributes(a: LabelRun['attributes'], b: LabelRun['attributes']) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}
