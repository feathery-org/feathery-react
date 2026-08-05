/**
 * Folds a parsed document back into DocumentData. The document's order wins
 * (a block moved in the doc moves in data); the data's token specs win (the
 * document carries values, never definitions).
 */
import { Block, BlockType, Cell, DocumentData, Inline } from './types';
import { ParsedBlock, ParsedDoc, ParsedInlineRun } from './sfdt/parse';
import { TokenSpec, valueKey } from '../documentTokens/plan';

export type SyncEvent =
  | { type: 'blockChanged'; blockId: string }
  | { type: 'blockDeleted'; blockId: string }
  | { type: 'blockAdopted'; blockId: string }
  | { type: 'tokenEdited'; key: string; text: string };

export type AbsorbResult = {
  data: DocumentData;
  events: SyncEvent[];
  tokenEdits: Map<string, string>;
};

const STYLE_TO_TYPE: Record<string, BlockType> = {
  'Heading 1': 'h1',
  'Heading 2': 'h2',
  'Heading 3': 'h3'
};

/** Every token spec in the data, by value key — specs survive doc edits. */
const specIndex = (data: DocumentData): Map<string, TokenSpec> => {
  const index = new Map<string, TokenSpec>();
  for (const section of data.sections) {
    for (const block of section.blocks) {
      const inlines = block.rows
        ? block.rows.flatMap((r) => r.flatMap((c) => c.content))
        : block.content ?? [];
      for (const inline of inlines) {
        if (inline.kind === 'token')
          index.set(valueKey(inline.spec), inline.spec);
      }
    }
  }
  return index;
};

const inlinesFromRuns = (
  runs: ParsedInlineRun[],
  specs: Map<string, TokenSpec>
): Inline[] =>
  runs.map((run) =>
    run.kind === 'token' && specs.has(run.key)
      ? ({ kind: 'token', spec: specs.get(run.key)! } as Inline)
      : ({ kind: 'text', text: run.text } as Inline)
  );

const collectTokenEdits = (
  runs: ParsedInlineRun[],
  rendered: Map<string, string>,
  tokenEdits: Map<string, string>,
  events: SyncEvent[]
) => {
  for (const run of runs) {
    if (run.kind !== 'token') continue;
    const last = rendered.get(run.key) ?? '';
    if (run.text === last) continue;
    // Same key edited in two places: the last occurrence in traversal order
    // wins. Any earlier occurrence would be overwritten by the next render
    // pass anyway, so only the final value (and one event per key) matters.
    const alreadyEdited = tokenEdits.has(run.key);
    tokenEdits.set(run.key, run.text);
    if (alreadyEdited) {
      const i = events.findIndex(
        (e) => e.type === 'tokenEdited' && e.key === run.key
      );
      if (i !== -1) events[i] = { type: 'tokenEdited', key: run.key, text: run.text };
    } else {
      events.push({ type: 'tokenEdited', key: run.key, text: run.text });
    }
  }
};

const nextAdoptedId = (taken: Set<string>): string => {
  let n = 1;
  while (taken.has(`blk_a${n}`)) n += 1;
  const id = `blk_a${n}`;
  taken.add(id);
  return id;
};

export const absorbDocEdits = (
  prev: DocumentData,
  parsed: ParsedDoc,
  renderedValues: Map<string, string>
): AbsorbResult => {
  const specs = specIndex(prev);
  const prevById = new Map<string, Block>();
  for (const s of prev.sections)
    for (const b of s.blocks) prevById.set(b.id, b);

  const events: SyncEvent[] = [];
  const tokenEdits = new Map<string, string>();
  const taken = new Set(prevById.keys());
  const seen = new Set<string>();

  const rebuildBlock = (pb: ParsedBlock): Block => {
    const existing = pb.id ? prevById.get(pb.id) : undefined;

    if (pb.kind === 'table') {
      for (const row of pb.cells ?? []) {
        for (const cell of row)
          collectTokenEdits(cell, renderedValues, tokenEdits, events);
      }
      // Rows beyond the existing table's row count are ones a user typed
      // directly into the doc — only rows the data already knew about get
      // global token lookup; new rows stay text-only (rule 6). Adopted
      // (id: null) tables have no existing row count, so every row keeps
      // the global lookup.
      const existingRowCount = existing?.rows?.length ?? Infinity;
      const rows: Cell[][] = (pb.cells ?? []).map((row, rowIndex) =>
        row.map((cellRuns) => ({
          content: inlinesFromRuns(
            cellRuns,
            rowIndex < existingRowCount ? specs : new Map()
          )
        }))
      );
      if (existing) {
        seen.add(existing.id);
        const next = { ...existing, rows };
        if (JSON.stringify(next.rows) !== JSON.stringify(existing.rows)) {
          events.push({ type: 'blockChanged', blockId: existing.id });
          return next;
        }
        return existing;
      }
      const id = nextAdoptedId(taken);
      events.push({ type: 'blockAdopted', blockId: id });
      return { id, type: 'table', rows };
    }

    collectTokenEdits(pb.runs ?? [], renderedValues, tokenEdits, events);
    const content = inlinesFromRuns(pb.runs ?? [], specs);
    if (existing) {
      seen.add(existing.id);
      const next = { ...existing, content };
      if (JSON.stringify(next.content) !== JSON.stringify(existing.content)) {
        events.push({ type: 'blockChanged', blockId: existing.id });
        return next;
      }
      return existing;
    }
    const id = nextAdoptedId(taken);
    events.push({ type: 'blockAdopted', blockId: id });
    return {
      id,
      type: STYLE_TO_TYPE[pb.styleName ?? ''] ?? 'paragraph',
      content
    };
  };

  // Document order wins. Extra parsed sections fold into the last data section.
  const sections = prev.sections.map((section, i) => {
    const parsedBlocks =
      i === prev.sections.length - 1
        ? parsed.sections.slice(i).flat()
        : parsed.sections[i] ?? [];
    return { ...section, blocks: parsedBlocks.map(rebuildBlock) };
  });

  for (const id of prevById.keys()) {
    if (!seen.has(id)) events.push({ type: 'blockDeleted', blockId: id });
  }

  // A block whose only change was a token VALUE is not a content change: the
  // rebuilt inline is the same token node, so equality already handled it.
  return { data: { ...prev, sections }, events, tokenEdits };
};
