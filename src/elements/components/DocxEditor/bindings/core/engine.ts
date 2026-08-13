// Pure rules engine: SFDT in, SFDT out.
//
//   applyRules(sfdt, { prevValues }) -> { sfdt, index, values, changed, ... }
//
// The engine reads and writes the document only through the adapter. It
// performs, in order: row adoption, input parsing, change detection against the
// previous snapshot's values, field fan-out (every occurrence of an edited
// document field gets the new value), formula dependency ordering, deterministic
// decimal evaluation, and diagnostics. It never evaluates user-provided code -
// the formula vocabulary is the allowlisted AST from formula.ts.

import {
  adoptUnboundRows,
  BindingIndex,
  getAt,
  NativeStructuralMutation,
  Occurrence,
  scanBindings,
  setCalculatedValue,
  setOccurrenceText
} from './sfdtAdapter';
import { Ast, FormulaError, isFormulaError, parseExpression } from './formula';
import {
  isNumericType,
  isValueError,
  parseDisplay,
  renderDisplay
} from './valueTypes';
import * as D from './decimal';
import {
  Diagnostic,
  DiagnosticSeverity,
  SfdtDocument,
  SfdtPath,
  SfdtRow
} from './sfdtTypes';

/**
 * Every display-text write the engine performs is classified, because the
 * editor has to treat them differently in undo history:
 *
 *   'field'   - normalization of the occurrence the USER edited. The adapter
 *               must RECORD it in editor history, or the user's own typing
 *               entry for that cell is corrupted (Word-autocorrect semantics).
 *   'sync'    - fan-out to OTHER occurrences of the same value. Must stay
 *               invisible: recording it makes undo peel engine output instead
 *               of the user's edit, and the next reconcile re-applies it - an
 *               unwinnable undo/Enter loop.
 *   'formula' - engine-owned cells; always invisible.
 */
export type WriteKind = 'field' | 'sync' | 'formula';

export interface EngineWrite {
  tag: string;
  text: string;
  kind: WriteKind;
}

export type ChangeRecord =
  | { type: 'field'; name: string; value: string }
  | { type: 'formula'; name: string; rowId: string | null; value: string }
  | { type: 'row-adopted'; tableId: string; rowId: string };

export type ReconcileMode = 'commit' | 'self-heal';

/**
 * A bound row kept per table so adoption survives the user deleting every one of
 * them. Without it, the last delete removes the only copy of the row shape and
 * every row inserted afterwards stays plain text - permanently, and silently.
 */
export type RowTemplates = Map<string, SfdtRow>;

export interface ApplyRulesOptions {
  prevValues?: Map<string, string> | null;
  mode?: ReconcileMode;
  /** Templates from earlier reconciles; used only when no bound row survives. */
  rowTemplates?: RowTemplates | null;
}

export interface ApplyRulesResult {
  sfdt: SfdtDocument;
  index: BindingIndex;
  values: Map<string, string>;
  changed: ChangeRecord[];
  diagnostics: Diagnostic[];
  writes: EngineWrite[];
  structuralMutations: NativeStructuralMutation[];
  /** True when the transaction changed more than content-control text. */
  structural: boolean;
  /** Carry these into the next reconcile. */
  rowTemplates: RowTemplates;
}

function diag(
  list: Diagnostic[],
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  path: SfdtPath | null = null
): void {
  list.push({ severity, code, message, path: path ?? [] });
}

export function hasBlockingErrors(diagnostics: Diagnostic[]): boolean {
  return diagnostics.some((entry) => entry.severity === 'error');
}

/**
 * Canonical value for every occurrence in an index; parse failures land in
 * `errors` as occurrence keys.
 */
function readValues(
  index: BindingIndex,
  diagnostics: Diagnostic[]
): { values: Map<string, string>; errors: Set<string> } {
  const values = new Map<string, string>();
  const errors = new Set<string>();
  for (const occurrence of index.occurrences) {
    try {
      values.set(
        occurrence.key,
        parseDisplay(occurrence.def.fieldType, occurrence.text)
      );
    } catch (thrown) {
      if (!isValueError(thrown)) throw thrown;
      errors.add(occurrence.key);
      if (occurrence.def.kind === 'field') {
        diag(
          diagnostics,
          'error',
          'invalid-input',
          `"${occurrence.name}"${
            occurrence.rowId ? ` (row ${occurrence.rowId})` : ''
          }: ${thrown.message}`,
          occurrence.path
        );
      }
    }
  }
  return { values, errors };
}

/** Formula node id: doc-level formulas by name, row formulas by row scope. */
function nodeId(occurrence: Occurrence): string {
  return occurrence.tableId
    ? `${occurrence.tableId}/${occurrence.rowId}:${occurrence.name}`
    : `doc:${occurrence.name}`;
}

interface FormulaNode {
  occ: Occurrence;
  ast: Ast;
  deps: Set<string>;
}

type RefTarget =
  | { kind: 'field'; name: string }
  | { kind: 'formula'; id: string }
  | { kind: 'occurrence'; key: string }
  | {
      kind: 'aggregate';
      items: Array<
        { kind: 'formula'; id: string } | { kind: 'occurrence'; key: string }
      >;
      tableId: string;
      col: string;
    };

/**
 * mode 'commit' (default): full behaviour - field fan-out, display
 * normalization, formula recalculation.
 *
 * mode 'self-heal': for undo/redo-originated reconciles. Value changes still
 * PROPAGATE to sibling occurrences (all suppressed, so redo survives) and
 * formulas recompute, but cells are never rewritten cosmetically - the text
 * history restored stays exactly as restored.
 */
export function applyRules(
  sfdt: SfdtDocument,
  {
    prevValues = null,
    mode = 'commit',
    rowTemplates = null
  }: ApplyRulesOptions = {}
): ApplyRulesResult {
  const diagnostics: Diagnostic[] = [];
  const changed: ChangeRecord[] = [];
  const writes = new Map<string, { text: string; kind: WriteKind }>();
  let structural = false;
  let next = sfdt;
  let index = scanBindings(next);
  const structuralMutations: NativeStructuralMutation[] = [];

  /* ---- 0. adopt rows the user inserted with native editor tools ----
     A data row without any bindings gets its column bindings and formulas
     inferred from the last bound row above it; typed cell text becomes the
     field values. Rows that do not match the template shape are left alone
     with a warning instead of guessing. */
  const nextTemplates: RowTemplates = new Map(rowTemplates || []);
  for (const tableId of [...index.tables.keys()]) {
    const result = adoptUnboundRows(
      next,
      tableId,
      index,
      undefined,
      nextTemplates.get(tableId)
    );
    for (const skipped of result.skipped) {
      diag(
        diagnostics,
        'warning',
        'row-not-adopted',
        `table ${tableId}: unbound row at index ${skipped.rowIndex} not adopted (${skipped.reason})`
      );
    }
    if (result.adopted.length) {
      next = result.sfdt;
      structural = true;
      structuralMutations.push(...result.mutations);
      for (const rowId of result.adopted) {
        changed.push({ type: 'row-adopted', tableId, rowId });
        diag(
          diagnostics,
          'info',
          'row-adopted',
          `table ${tableId}: new row bound as ${rowId}; columns and formulas inferred from the row above`
        );
      }
    }
  }
  if (next !== sfdt) index = scanBindings(next);
  diagnostics.push(...index.diagnostics);

  const { values, errors } = readValues(index, diagnostics);

  /* ---- 1. document-field change detection and fan-out ---- */
  for (const [name, occurrences] of index.fields) {
    const parsed = occurrences.filter(
      (occurrence) => !errors.has(occurrence.key)
    );
    if (!parsed.length) continue;
    let txValue: string | undefined;
    if (prevValues) {
      const changedOccurrences = parsed.filter(
        (occurrence) =>
          prevValues.has(occurrence.key) &&
          prevValues.get(occurrence.key) !== values.get(occurrence.key)
      );
      const distinct = [
        ...new Set(
          changedOccurrences.map((occurrence) => values.get(occurrence.key))
        )
      ];
      if (distinct.length === 0) {
        // Nothing edited; still repair any drift between occurrences below.
        txValue = values.get(parsed[0].key);
      } else if (distinct.length === 1) {
        txValue = distinct[0];
        changed.push({ type: 'field', name, value: txValue as string });
      } else {
        diag(
          diagnostics,
          'error',
          'ambiguous-edit',
          `"${name}" was changed to ${distinct.length} different values in one snapshot; resolve manually`,
          parsed[0].path
        );
        continue;
      }
    } else {
      const distinct = [
        ...new Set(parsed.map((occurrence) => values.get(occurrence.key)))
      ];
      if (distinct.length > 1) {
        diag(
          diagnostics,
          'error',
          'ambiguous-edit',
          `occurrences of "${name}" disagree (${distinct.length} values) and there is no previous snapshot to arbitrate`,
          parsed[0].path
        );
        continue;
      }
      txValue = distinct[0];
    }
    if (txValue === undefined) continue;

    // Occurrences share one tag, so a recorded 'field' write and an invisible
    // 'sync' write can land on the same map key - recording wins. An extra undo
    // step is annoying; a suppressed write over the edited cell corrupts its
    // history entry.
    const setWrite = (tag: string, text: string, kind: WriteKind) => {
      const previous = writes.get(tag);
      writes.set(tag, {
        text,
        kind:
          (previous && previous.kind === 'field') || kind === 'field'
            ? 'field'
            : kind
      });
    };
    for (const occurrence of parsed) {
      const rendered = renderDisplay(occurrence.def.fieldType, txValue);
      if (values.get(occurrence.key) !== txValue) {
        next = setOccurrenceText(next, occurrence, rendered);
        setWrite(occurrence.tag, rendered, 'sync');
      } else if (mode === 'commit' && occurrence.text !== rendered) {
        next = setOccurrenceText(next, occurrence, rendered);
        setWrite(occurrence.tag, rendered, 'field');
      }
      values.set(occurrence.key, txValue);
    }
  }

  /* ---- 1b. normalize row-scoped field displays ----
     Document fields were rewritten in rendered form by the fan-out above. Table
     cells get the same treatment: whatever the user typed ("150", "150.005",
     "1,200") is re-rendered from the canonical value ("$150.00", "$150.01",
     "$1,200.00") so symbols, grouping and scale always come back. Invalid input
     is left visible for the diagnostic. */
  if (mode === 'commit') {
    for (const occurrence of index.occurrences) {
      if (occurrence.def.kind !== 'field' || !occurrence.tableId) continue;
      if (!values.has(occurrence.key)) continue;
      const rendered = renderDisplay(
        occurrence.def.fieldType,
        values.get(occurrence.key) as string
      );
      if (occurrence.text !== rendered) {
        next = setOccurrenceText(next, occurrence, rendered);
        writes.set(occurrence.tag, { text: rendered, kind: 'field' });
      }
    }
  }

  /* ---- 2. formula graph ----
     Nodes: one per formula instance. Row formulas with equal names in different
     rows are distinct nodes. */
  const formulaOccurrences = index.occurrences.filter(
    (occurrence) => occurrence.def.kind === 'formula'
  );
  const nodes = new Map<string, FormulaNode>();

  for (const occurrence of formulaOccurrences) {
    if (!isNumericType(occurrence.def.fieldType)) {
      diag(
        diagnostics,
        'error',
        'non-numeric-formula',
        `formula "${occurrence.name}" must have a numeric type`,
        occurrence.path
      );
      continue;
    }
    let ast: Ast;
    try {
      ast = parseExpression(
        occurrence.def.kind === 'formula' ? occurrence.def.expression : ''
      );
    } catch (thrown) {
      if (!isFormulaError(thrown)) throw thrown;
      diag(
        diagnostics,
        'error',
        'malformed-expression',
        `"${occurrence.name}": ${thrown.message}`,
        occurrence.path
      );
      continue;
    }
    const id = nodeId(occurrence);
    // A repeated doc-level formula is one node with many occurrences.
    if (nodes.has(id)) continue;
    nodes.set(id, { occ: occurrence, ast, deps: new Set() });
  }

  /**
   * Resolve a reference. Precedence: (1) the formula's own row, so bare column
   * names always mean "current row"; (2) document fields/formulas by full -
   * possibly dotted - name, so "project.name" stays a field ref; (3)
   * table.column aggregation across data rows.
   */
  function refTargets(ref: string, occurrence: Occurrence): RefTarget | null {
    if (occurrence.tableId) {
      const table = index.tables.get(occurrence.tableId);
      const row = table?.rows.find((entry) => entry.rowId === occurrence.rowId);
      const cell = row && row.bindings.get(ref);
      if (cell) {
        return cell.def.kind === 'formula'
          ? { kind: 'formula', id: nodeId(cell) }
          : { kind: 'occurrence', key: cell.key };
      }
    }
    if (index.fields.has(ref)) return { kind: 'field', name: ref };
    if (index.formulas.has(ref)) return { kind: 'formula', id: `doc:${ref}` };
    const dot = ref.lastIndexOf('.');
    if (dot !== -1) {
      const tableId = ref.slice(0, dot);
      const col = ref.slice(dot + 1);
      const table = index.tables.get(tableId);
      if (table) {
        const items: Array<
          { kind: 'formula'; id: string } | { kind: 'occurrence'; key: string }
        > = [];
        for (const row of table.rows) {
          const cell = row.bindings.get(col);
          if (!cell) continue; // Rows missing the column contribute nothing.
          items.push(
            cell.def.kind === 'formula'
              ? { kind: 'formula', id: nodeId(cell) }
              : { kind: 'occurrence', key: cell.key }
          );
        }
        return { kind: 'aggregate', items, tableId, col };
      }
    }
    return null;
  }

  // Dependency edges.
  function collectDeps(ast: Ast, node: FormulaNode): void {
    if ('ref' in ast) {
      const target = refTargets(ast.ref, node.occ);
      if (target && target.kind === 'formula') node.deps.add(target.id);
      if (target && target.kind === 'aggregate') {
        for (const item of target.items) {
          if (item.kind === 'formula') node.deps.add(item.id);
        }
      }
      return;
    }
    if ('args' in ast) for (const arg of ast.args) collectDeps(arg, node);
  }
  for (const node of nodes.values()) collectDeps(node.ast, node);

  /* ---- 3. topological order with cycle reporting ---- */
  const order: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const broken = new Set<string>();
  function visit(id: string, stack: string[]): void {
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') {
      const cycle = stack.slice(stack.indexOf(id)).concat(id);
      diag(
        diagnostics,
        'error',
        'dependency-cycle',
        `formula cycle: ${cycle.join(' -> ')}`
      );
      // Every node in the cycle is broken, not just the one that closed it.
      for (const entry of cycle) broken.add(entry);
      return;
    }
    state.set(id, 'visiting');
    const node = nodes.get(id);
    if (node) for (const dep of node.deps) visit(dep, [...stack, id]);
    state.set(id, 'done');
    order.push(id);
  }
  for (const id of nodes.keys()) visit(id, []);

  /* ---- 4. evaluate in order ---- */
  const results = new Map<string, string>();
  function evalAst(ast: Ast, node: FormulaNode): string | string[] {
    if ('lit' in ast) return ast.lit;
    if ('ref' in ast) {
      const target = refTargets(ast.ref, node.occ);
      if (!target) throw new FormulaError(`unresolved reference "${ast.ref}"`);
      if (target.kind === 'field') {
        const occurrences = (
          index.fields.get(target.name) as Occurrence[]
        ).filter((occurrence) => values.has(occurrence.key));
        if (!occurrences.length)
          throw new FormulaError(`"${ast.ref}" has no valid value`);
        if (!isNumericType(occurrences[0].def.fieldType))
          throw new FormulaError(`"${ast.ref}" is not numeric`);
        return values.get(occurrences[0].key) as string;
      }
      if (target.kind === 'formula') {
        if (!results.has(target.id))
          throw new FormulaError(`"${ast.ref}" did not evaluate`);
        return results.get(target.id) as string;
      }
      if (target.kind === 'occurrence') {
        if (!values.has(target.key))
          throw new FormulaError(`"${ast.ref}" has an invalid value`);
        return values.get(target.key) as string;
      }
      return target.items.map((item) => {
        if (item.kind === 'formula') {
          if (!results.has(item.id))
            throw new FormulaError(
              `"${ast.ref}" includes a formula that did not evaluate`
            );
          return results.get(item.id) as string;
        }
        if (!values.has(item.key))
          throw new FormulaError(`"${ast.ref}" includes an invalid value`);
        return values.get(item.key) as string;
      });
    }
    const args = ast.args.map((arg) => evalAst(arg, node));
    const flat: string[] = [];
    for (const arg of args) {
      if (Array.isArray(arg)) {
        if (ast.op !== 'sum')
          throw new FormulaError(
            `${ast.op} cannot take a whole-column argument`
          );
        flat.push(...arg);
      } else flat.push(arg);
    }
    switch (ast.op) {
      case 'multiply':
        return flat.reduce((accumulated, value) => D.mul(accumulated, value));
      case 'subtract':
        return D.sub(flat[0], flat[1]);
      case 'sum':
        return D.sum(flat);
      default:
        throw new FormulaError(`unknown op ${ast.op}`);
    }
  }

  for (const id of order) {
    const node = nodes.get(id);
    if (!node || broken.has(id)) continue;
    try {
      const raw = evalAst(node.ast, node);
      if (Array.isArray(raw))
        throw new FormulaError('formula produced a column, not a value');
      const fieldType = node.occ.def.fieldType as { scale?: number };
      // Round to the type's scale BEFORE storing, so a dependent formula sums
      // already-rounded values rather than compounding fractions.
      results.set(id, D.roundTo(raw, fieldType.scale ?? 0));
    } catch (thrown) {
      if (!isFormulaError(thrown)) throw thrown;
      diag(
        diagnostics,
        'error',
        'evaluation-failed',
        `"${node.occ.name}": ${thrown.message}`,
        node.occ.path
      );
    }
  }

  /* ---- 5. write results to every formula occurrence ---- */
  for (const occurrence of formulaOccurrences) {
    const id = nodeId(occurrence);
    if (!results.has(id)) continue;
    const out = results.get(id) as string;
    // setCalculatedValue is identity-preserving when the rendered text already
    // matches, so `updated !== next` doubles as change detection. This also
    // silently reverts any user edit typed over a locked formula: the engine's
    // computed value always wins.
    const updated = setCalculatedValue(next, occurrence, out);
    if (updated !== next) {
      next = updated;
      values.set(occurrence.key, D.normalize(out));
      writes.set(occurrence.tag, {
        text: renderDisplay(occurrence.def.fieldType, out),
        kind: 'formula'
      });
      changed.push({
        type: 'formula',
        name: occurrence.name,
        rowId: occurrence.rowId,
        value: out
      });
    }
  }

  /* ---- 6. final index/values reflect the returned document ---- */
  const writeList: EngineWrite[] = [...writes].map(([tag, write]) => ({
    tag,
    text: write.text,
    kind: write.kind
  }));
  /**
   * Remember each table's last bound row, so a later reconcile can still adopt
   * once the user has deleted every bound row. Only refreshed while one exists -
   * an emptied table keeps whatever was captured last.
   */
  const rememberTemplates = (from: BindingIndex): RowTemplates => {
    for (const [tableId, table] of from.tables) {
      const last = table.rows[table.rows.length - 1];
      if (!last || !last.path) continue;
      const row = getAt(next, last.path) as SfdtRow | undefined;
      if (row) nextTemplates.set(tableId, JSON.parse(JSON.stringify(row)));
    }
    return nextTemplates;
  };

  if (next !== sfdt) {
    index = scanBindings(next);
    const reread = readValues(index, []);
    return {
      sfdt: next,
      index,
      values: reread.values,
      changed,
      diagnostics,
      writes: writeList,
      structuralMutations,
      structural,
      rowTemplates: rememberTemplates(index)
    };
  }
  return {
    sfdt: next,
    index,
    values,
    changed,
    diagnostics,
    writes: writeList,
    structuralMutations,
    structural,
    rowTemplates: rememberTemplates(index)
  };
}
