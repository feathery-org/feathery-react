// Dry run for "delete this table": which formulas elsewhere stop evaluating?
//
// Deleting a table takes its input values with it. A formula outside the table
// that reads them keeps its last computed number, fails every following
// reconcile, and blocks saving - while itself being non-deletable (formulas are
// del=keep by design). So before a table is deleted, this answers what the
// deletion orphans, by running the pure engine on the document with and without
// the table and diffing which formulas newly fail. The engine is the authority
// on reference resolution; nothing here re-implements it.

import { applyRules, ApplyRulesResult } from './engine';
import { parseTag } from './tagDsl';
import { SfdtBlock, SfdtDocument } from './sfdtTypes';

export interface OrphanedFormula {
  name: string;
  /** Tags of the surviving occurrences, for unwrapping them to plain text. */
  tags: string[];
}

export interface TableDeleteImpact {
  /** Bound table id when the block is a tagged wrapper, else null. */
  tableId: string | null;
  orphans: OrphanedFormula[];
}

/** The block when it is a table or a block content control wrapping one. */
function tableBlockAt(
  doc: SfdtDocument,
  sectionIndex: number,
  blockIndex: number
): SfdtBlock | null {
  const block = doc.sections?.[sectionIndex]?.blocks?.[blockIndex];
  if (!block) return null;
  if (Array.isArray(block.rows)) return block;
  if (
    block.contentControlProperties &&
    Array.isArray(block.blocks) &&
    block.blocks.some((child) => Array.isArray((child as SfdtBlock).rows))
  )
    return block;
  return null;
}

function boundTableId(block: SfdtBlock): string | null {
  const tag = block.contentControlProperties?.tag;
  if (!tag) return null;
  try {
    const def = parseTag(String(tag));
    return def && def.kind === 'table' ? def.tableId : null;
  } catch {
    return null;
  }
}

/** Names of formulas that failed to evaluate, keyed off diagnostic paths. */
function failedFormulaNames(result: ApplyRulesResult): Set<string> {
  const byPath = new Map<string, string>();
  for (const occurrence of result.index.occurrences) {
    if (occurrence.def.kind === 'formula')
      byPath.set(JSON.stringify(occurrence.path), occurrence.name);
  }
  const failed = new Set<string>();
  for (const diagnostic of result.diagnostics) {
    if (diagnostic.severity !== 'error') continue;
    const name = byPath.get(JSON.stringify(diagnostic.path));
    if (name) failed.add(name);
  }
  return failed;
}

/**
 * Impact of deleting the table at sections[sectionIndex].blocks[blockIndex]
 * (Syncfusion's hierarchical selection index gives exactly those two numbers -
 * the wrapper occupies the block slot). Null when the block is not a table.
 */
export function analyzeTableDeleteImpact(
  doc: SfdtDocument,
  sectionIndex: number,
  blockIndex: number
): TableDeleteImpact | null {
  const block = tableBlockAt(doc, sectionIndex, blockIndex);
  if (!block) return null;

  const before = applyRules(doc, { adoptRows: false });
  const trimmed = JSON.parse(JSON.stringify(doc)) as SfdtDocument;
  trimmed.sections?.[sectionIndex]?.blocks?.splice(blockIndex, 1);
  const after = applyRules(trimmed, { adoptRows: false });

  // Only failures the deletion introduces count; a formula already broken
  // before is not this table's dependent.
  const alreadyFailing = failedFormulaNames(before);
  const orphans: OrphanedFormula[] = [];
  for (const name of failedFormulaNames(after)) {
    if (alreadyFailing.has(name)) continue;
    const tags = new Set<string>();
    for (const occurrence of after.index.occurrences) {
      if (occurrence.def.kind === 'formula' && occurrence.name === name)
        tags.add(occurrence.tag);
    }
    if (tags.size) orphans.push({ name, tags: [...tags] });
  }
  orphans.sort((a, b) => a.name.localeCompare(b.name));
  return { tableId: boundTableId(block), orphans };
}
