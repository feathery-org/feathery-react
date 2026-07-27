// A resolver-backed harness for the formula engine, so the grammar, the exact
// arithmetic, the refusals and the render/rounding contract can each be tested
// as a unit - no DocumentEditor, no SFDT. The real client path uses the same
// two functions behind `makeFormulaResolver`, so these tests exercise the
// production code, just with the document replaced by an array of cell texts.
import {
  evaluateFormula,
  FormulaEvaluationResult,
  FormulaResolver,
  RoundingMode,
  renderFormulaResult
} from '../cellFormula';

/**
 * A single-table document: `texts[row]` is the verbatim text of column 1 of the
 * table at `0;7`, and column 0 holds a label. `null` is a row with no cell at
 * that column (a short/merged row).
 */
export function stubResolver(
  texts: Array<string | null>,
  options: { columns?: number } = {}
): FormulaResolver {
  const columns = options.columns ?? 2;
  return {
    cell: (anchor) => {
      const match = /^0;7;(\d+);(\d+);0$/.exec(anchor);
      if (!match) return null;
      const row = Number(match[1]);
      const column = Number(match[2]);
      if (row >= texts.length || column >= columns) return null;
      if (column === 0) return `Row ${row}`;
      const text = texts[row];
      return text === null ? null : text;
    },
    range: (reference) => {
      if (reference.tableAnchor !== '0;7') return null;
      const cells = texts
        .map((text, row) => ({
          row,
          ...(text === null
            ? {}
            : { anchor: `0;7;${row};${reference.column};0` }),
          text: reference.column === 0 ? `Row ${row}` : text
        }))
        .filter(
          (cell) =>
            cell.row >= reference.startRow && cell.row <= reference.endRow
        );
      return { cells, rowCount: texts.length, columns };
    }
  };
}

export interface FormulaOutcome {
  ok: boolean;
  error?: string;
  message?: string;
  renderedValue?: string;
  counted?: number;
  skipped?: FormulaEvaluationResult extends { skipped: infer S } ? S : unknown;
  formatSource?: string;
  rounded?: boolean;
  roundingMode?: RoundingMode | null;
  decimals?: number;
  tally?: boolean;
}

/**
 * Evaluate `formula` over a stub column and render it into `target`, returning
 * one flat outcome so a test reads as one assertion about behaviour rather than
 * two about plumbing.
 */
export function runFormula(
  texts: Array<string | null>,
  formula: string,
  target: string | null,
  options: {
    round?: RoundingMode | null;
    decimals?: number;
    columns?: number;
  } = {}
): FormulaOutcome {
  const evaluation = evaluateFormula(formula, stubResolver(texts, options));
  if (!evaluation.ok) {
    return {
      ok: false,
      error: evaluation.error,
      message: evaluation.message
    };
  }
  const rendered = renderFormulaResult(evaluation, target, {
    round: options.round ?? null,
    ...(options.decimals != null ? { decimals: options.decimals } : {})
  });
  if (!rendered.ok) {
    return { ok: false, error: rendered.error, message: rendered.message };
  }
  return {
    ok: true,
    renderedValue: rendered.renderedValue,
    counted: evaluation.counted,
    skipped: evaluation.skipped as FormulaOutcome['skipped'],
    formatSource: rendered.formatSource,
    rounded: rendered.rounded,
    roundingMode: rendered.roundingMode,
    decimals: rendered.decimals,
    tally: evaluation.tally
  };
}

/**
 * The named-aggregate shorthand: rows 1..n of column 1, which is the shape the
 * retired `set_cell_computed` used to cover, so every one of its cases keeps
 * being exercised through the general op that replaced it.
 */
export function columnFormula(
  texts: Array<string | null>,
  fn: 'sum' | 'average' | 'min' | 'max' | 'count',
  target: string | null,
  options: { round?: RoundingMode | null; decimals?: number } = {}
): FormulaOutcome {
  // `texts` is indexed from row 1 (row 0 is the header the caller did not
  // supply), matching the old `col()` helper's row numbering.
  const padded: Array<string | null> = ['Header', ...texts];
  return runFormula(
    padded,
    `${fn}([0;7;1..${padded.length - 1};1])`,
    target,
    options
  );
}
