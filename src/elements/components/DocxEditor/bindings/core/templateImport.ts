// Template import: turns [[...]] TEXT tokens into real content controls.
//
// A template author writes bindings as plain text in Word (or anywhere):
//
//   Project: [[name=project.name|default=Website relaunch]]
//   [[table=costs]]                 <- alone in a paragraph: the NEXT table
//                                      becomes configured; marker removed
//   [[name=quantity|type=integer|default=12|row=auto]]
//                                   <- row=auto: the importer stamps one
//                                      fresh row id per table row
//
// convertTemplateTokens(sfdt) returns a NEW document in which every valid token
// is replaced by an inline content control (fields editable, formulas locked with
// a pending "…" the engine computes on first reconcile), token paragraphs marking
// tables become block-level wrappers, and row=auto is resolved to immutable
// per-row identities. Invalid tokens are left visible with a diagnostic.
//
// It is idempotent: a paragraph that already holds content controls is skipped,
// so running it again on a converted document is a no-op.

import {
  BoundDefinition,
  Definition,
  formatTag,
  isTagError,
  parseTag,
  TableDefinition
} from './tagDsl';
import {
  defaultValue,
  isValueError,
  parseDisplay,
  renderDisplay
} from './valueTypes';
import { freshRowId } from './sfdtAdapter';
import {
  ContentControlProperties,
  Diagnostic,
  DiagnosticSeverity,
  SfdtBlock,
  SfdtDocument,
  SfdtInline
} from './sfdtTypes';

const TOKEN_RE = /\[\[[^[\]]*\]\]/g;

export interface TemplateImportResult {
  sfdt: SfdtDocument;
  converted: number;
  diagnostics: Diagnostic[];
}

function diag(
  list: Diagnostic[],
  severity: DiagnosticSeverity,
  code: string,
  message: string
): void {
  list.push({ severity, code, message, path: [] });
}

function ccProps(def: Definition, locked: boolean): ContentControlProperties {
  return {
    lockContentControl: true,
    lockContents: !!locked,
    tag: formatTag(def),
    title:
      (def.kind !== 'table' && def.options && def.options.label) ||
      (def.kind === 'table' ? def.tableId : def.name),
    type: 'Text',
    hasPlaceHolderText: false,
    multiline: false,
    isTemporary: false,
    // Mandatory - the border renderer measures this as soon as the caret enters
    // the control, and the SFDT reader leaves it undefined when absent.
    color: '#00000000',
    appearance: 'BoundingBox'
  };
}

/** Table markers never reach here - they become block wrappers, not inlines. */
function tokenToCc(
  def: BoundDefinition,
  diagnostics: Diagnostic[]
): SfdtInline {
  if (def.kind === 'formula') {
    return {
      contentControlProperties: ccProps(def, true),
      // Pending: the engine computes the real value on first reconcile.
      inlines: [{ text: '…' }]
    };
  }
  // `value` is what this occurrence shows; `default` only seeds new rows, so it
  // is the fallback here rather than the source.
  const explicit = def.options ? def.options.value : undefined;
  const key = explicit !== undefined ? 'value' : 'default';
  let text = '';
  try {
    text = renderDisplay(
      def.fieldType,
      explicit !== undefined
        ? parseDisplay(def.fieldType, explicit)
        : defaultValue(def)
    );
  } catch (thrown) {
    if (!isValueError(thrown)) throw thrown;
    diag(
      diagnostics,
      'error',
      `bad-${key}`,
      `"${def.name}": ${key} does not parse as ${def.fieldType.kind}`
    );
    // Keep the unparseable text visible rather than silently blanking the cell.
    const raw = explicit !== undefined ? explicit : def.options?.default;
    text = raw !== undefined ? raw : '';
  }
  return { contentControlProperties: ccProps(def, false), inlines: [{ text }] };
}

interface RunSegment {
  inl: SfdtInline;
  start: number;
  end: number;
}

/**
 * Replace tokens in one paragraph. Returns 'marker' when the paragraph was
 * nothing but a table marker (the caller drops it), true when tokens were
 * converted, false when nothing changed.
 *
 * Works over character offsets across ALL runs, because Word routinely splits a
 * token across runs after a resave (spellcheck marks, formatting boundaries) -
 * matching run-by-run would miss those.
 */
function replaceTokensInParagraph(
  para: SfdtBlock,
  diagnostics: Diagnostic[],
  onTable: (def: TableDefinition) => void
): boolean | 'marker' {
  const inlines = para.inlines || [];
  if (!inlines.length) return false;
  // Already converted: idempotent re-runs must not double-wrap.
  if (inlines.some((inline) => inline.contentControlProperties)) return false;
  const joined = inlines
    .map((inline) => (typeof inline.text === 'string' ? inline.text : ''))
    .join('');
  TOKEN_RE.lastIndex = 0;
  if (!TOKEN_RE.test(joined)) return false;

  // A paragraph that is exactly one table marker.
  const trimmed = joined.trim();
  if (/^\[\[[^[\]]*\]\]$/.test(trimmed)) {
    let def: Definition | null = null;
    try {
      def = parseTag(trimmed);
    } catch (thrown) {
      if (!isTagError(thrown)) throw thrown;
      diag(diagnostics, 'error', 'malformed-token', thrown.message);
      return false;
    }
    if (def && def.kind === 'table') {
      onTable(def);
      return 'marker';
    }
  }

  // Character-offset segments over the runs.
  const segments: RunSegment[] = [];
  let offset = 0;
  for (const inline of inlines) {
    const text = typeof inline.text === 'string' ? inline.text : '';
    segments.push({ inl: inline, start: offset, end: offset + text.length });
    offset += text.length;
  }
  const pieces: SfdtInline[] = [];
  let cursor = 0;
  let changedAny = false;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  const pushPlain = (from: number, to: number) => {
    for (const segment of segments) {
      const start = Math.max(segment.start, from);
      const end = Math.min(segment.end, to);
      if (start >= end) continue;
      const run: SfdtInline = {
        text: (segment.inl.text || '').slice(
          start - segment.start,
          end - segment.start
        )
      };
      if (segment.inl.characterFormat)
        run.characterFormat = segment.inl.characterFormat;
      pieces.push(run);
    }
  };
  while ((match = TOKEN_RE.exec(joined)) !== null) {
    let def: Definition | null = null;
    try {
      def = parseTag(match[0]);
    } catch (thrown) {
      if (!isTagError(thrown)) throw thrown;
      diag(diagnostics, 'error', 'malformed-token', thrown.message);
      continue; // Leave the bad token visible; handled as plain text below.
    }
    if (!def) continue; // Foreign [[...]] text stays as-is.
    if (def.kind === 'table') {
      diag(
        diagnostics,
        'error',
        'misplaced-table-token',
        `[[table=${def.tableId}]] must be alone in a paragraph directly before its table`
      );
      continue;
    }
    pushPlain(cursor, match.index);
    const control = tokenToCc(def, diagnostics);
    const host = segments.find(
      (segment) =>
        segment.start <= (match as RegExpExecArray).index &&
        (match as RegExpExecArray).index < segment.end
    );
    if (host && host.inl.characterFormat && control.inlines)
      control.inlines[0].characterFormat = host.inl.characterFormat;
    pieces.push(control);
    cursor = match.index + match[0].length;
    changedAny = true;
  }
  if (!changedAny) return false;
  pushPlain(cursor, joined.length);
  para.inlines = pieces;
  return true;
}

/** One fresh row id per physical table row, shared by every row=auto binding. */
function stampRowIds(tableBlock: SfdtBlock): void {
  for (const row of tableBlock.rows || []) {
    const autos: Array<{ inl: SfdtInline; def: Definition }> = [];
    for (const cell of row.cells || []) {
      for (const block of cell.blocks || []) {
        for (const inline of block.inlines || []) {
          if (!inline.contentControlProperties) continue;
          let def: Definition | null = null;
          try {
            def = parseTag(String(inline.contentControlProperties.tag || ''));
          } catch {
            continue;
          }
          if (
            def &&
            (def.kind === 'field' || def.kind === 'formula') &&
            def.options.row === 'auto'
          ) {
            autos.push({ inl: inline, def });
          }
        }
      }
    }
    if (!autos.length) continue;
    const rowId = freshRowId();
    for (const { inl, def } of autos) {
      if (def.kind === 'table') continue;
      def.options.row = rowId;
      inl.contentControlProperties = {
        ...inl.contentControlProperties,
        tag: formatTag(def)
      };
    }
  }
}

export function convertTemplateTokens(
  sfdt: SfdtDocument
): TemplateImportResult {
  const doc: SfdtDocument = JSON.parse(JSON.stringify(sfdt));
  const diagnostics: Diagnostic[] = [];
  let converted = 0;

  // Taking the marker as a parameter rather than reading the closed-over
  // variable keeps TypeScript from narrowing it to `never`: the only assignment
  // it cannot see is the one inside the onTable callback below.
  const reportDangling = (marker: TableDefinition | null): void => {
    if (!marker) return;
    diag(
      diagnostics,
      'error',
      'dangling-table-marker',
      `[[table=${marker.tableId}]] is not directly followed by a table`
    );
  };

  for (const section of doc.sections || []) {
    const blocks = section.blocks || [];
    const out: SfdtBlock[] = [];
    let pendingTable: TableDefinition | null = null;
    for (const block of blocks) {
      if (Array.isArray(block.rows)) {
        // Convert tokens inside cells first, then stamp row identities.
        for (const row of block.rows) {
          for (const cell of row.cells || []) {
            for (const cellBlock of cell.blocks || []) {
              if (
                cellBlock.inlines &&
                replaceTokensInParagraph(cellBlock, diagnostics, () => {}) ===
                  true
              )
                converted += 1;
            }
          }
        }
        stampRowIds(block);
        if (pendingTable) {
          out.push({
            contentControlProperties: {
              ...ccProps(pendingTable, false),
              type: 'RichText'
            },
            blocks: [block]
          });
          converted += 1;
          pendingTable = null;
        } else {
          out.push(block);
        }
        continue;
      }
      if (pendingTable) {
        reportDangling(pendingTable);
        pendingTable = null;
      }
      if (block.inlines) {
        const result = replaceTokensInParagraph(block, diagnostics, (def) => {
          pendingTable = def;
        });
        if (result === 'marker') continue; // Drop the marker paragraph.
        if (result === true) converted += 1;
      }
      out.push(block);
    }
    // A marker still pending at the end of a section had no table after it.
    reportDangling(pendingTable);
    section.blocks = out;
  }

  return { sfdt: doc, converted, diagnostics };
}
