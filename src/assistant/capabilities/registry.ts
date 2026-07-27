// The capabilities registry: one entry per advertised document-edit op.
//
// This is the declaration half of the S2 protocol (hilb-refactor-proposal S2):
// the client tells ai-services what its document engine can actually do,
// instead of ai-services hardcoding a list in another repository and hoping the
// two stay in sync - the failure mode that produced 13 advertised-but-broken
// ops. In S2 ai-services only validates this declaration and logs a diff
// against its hardcoded list (the drift alarm); it does not build tools from it
// yet (that is S5, and so is folding each entry's `apply` into the registry).
//
// Every entry references the switch case that implements it in
// `../tools/syncfusionDocumentOps.ts` (`applyAnchoredOp` / `applyAnchorlessOp`,
// plus the executor's `applyReplaceAll` special case). A unit test asserts the
// registry and those switch cases agree in both directions - an entry with no
// handler is a lie to the model, a handler with no entry is a capability
// nobody can reach.
//
// `tracked` is empirical, not aspirational: it records whether the op produces
// SyncFusion revisions under the engine's forced track-changes mode, probed op
// by op through the real `applyDocumentEdits` dispatch on a real
// DocumentEditor (2026-07-26, ej2-documenteditor 34.1.31). SyncFusion has no
// `Formatting` revision type, so formatting ops apply immediately and are not
// individually rejectable; this field is what lets the assistant say so
// honestly instead of promising a reject card that will never exist.

/**
 * Param types use a small fixed language (m5 C3: no arbitrary schema
 * language): `string`, `number`, `int>0`, `int>=0`, `boolean`,
 * `enum[a,b,...]` - each optionally suffixed `?` when the param may be
 * omitted. Cross-op fields (`anchor`, `expect`, `start`, `end`,
 * `inheritFormatFrom`, `changeSetId`) are reserved keys with one canonical
 * meaning and are not repeated per entry; `requiresAnchor`/`anchorKind`
 * declare the anchor contract instead.
 *
 * `expect` is the compare-and-swap guard: the text the op believes is still
 * there, which the model COPIES from a read. `start`/`end` only disambiguate
 * between several occurrences of one `find` spelling in the same block; they
 * are never a validity test on a range the editor has already resolved,
 * because they are values the model would have to COUNT and it cannot count
 * (see pickOffsetDisambiguatedMatch).
 */
export interface CapabilityEntry {
  /** Op name as the model sends it. */
  op: string;
  /** Op-specific params the engine actually consumes, typed as above. */
  params: Record<string, string>;
  /** Whether the engine refuses the op without an `anchor` (missing_anchor). */
  requiresAnchor: boolean;
  /**
   * What the anchor must address: a body block (`section;block`), a table cell
   * (`section;block;row;cell;paragraph`), or nothing (anchorless ops).
   */
  anchorKind: 'block' | 'table_cell' | 'none';
  /**
   * True when the op produces tracked revisions the user can individually
   * accept or reject. Formatting ops are false: SyncFusion has no Formatting
   * revision type, so they apply immediately.
   */
  tracked: boolean;
  /** One-line, model-facing description of what the op does. */
  summary: string;
  /** One worked example payload, valid against `params`. */
  example: Record<string, unknown>;
}

// Entries are ordered exactly like ai-services' DOCUMENT_EDIT_OPS so a
// name-by-name comparison of the two lists reads as a clean diff.
//
// The array is const-asserted so every entry survives as a literal type: the
// typed handler tables in `../tools/syncfusionDocumentOps.ts` derive each
// handler's parameter type from its entry here (S5). `satisfies` would be the
// idiomatic spelling, but the repo pins TypeScript 4.7, so the entry-shape
// check is the explicit assignability statement after the array instead.
export const DOCUMENT_EDITOR_CAPABILITIES = [
  // --- Text -----------------------------------------------------------------
  {
    // handler: applyAnchoredOp case 'replace_text'
    op: 'replace_text',
    params: { find: 'string', replace: 'string' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary:
      'Replace the first occurrence of `find` within the anchored block with `replace`.',
    example: {
      op: 'replace_text',
      anchor: '0;3',
      find: 'Quote: 5,500',
      replace: 'Quote: 6,000'
    }
  },
  {
    // handler: ANCHORED_OP_HANDLERS.replace_selection
    //
    // The op for "the user selected this and told us to rewrite it". Everything
    // else in this vocabulary addresses text by searching for it, which is the
    // wrong primitive for a selection: the user has already pointed at the
    // target precisely, and a search can miss it or hit the wrong instance. It
    // is also the only op that can express a selection spanning paragraphs -
    // `find` cannot, because SyncFusion search does not match across a
    // paragraph mark.
    //
    // `startOffset`/`endOffset` are copied verbatim from `context.selection`;
    // omit them and the op rewrites the whole anchored block. The guard is
    // `expect` (the selected text) or, when the delivered selection text was
    // truncated, `expectLength` beside the prefix - never a counted offset.
    op: 'replace_selection',
    params: {
      replace: 'string',
      startOffset: 'string?',
      endOffset: 'string?',
      expectLength: 'int>=0?'
    },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary:
      "Replace the user's selected range with `replace`, as one tracked revision. Prefer it over replace_text whenever a selection is present. `anchor` is the selection's start block; copy `startOffset`/`endOffset` verbatim from the selection context (they may span runs or paragraphs; omit them to rewrite the whole block). Guard with `expect` (the selected text) or `expectLength`.",
    example: {
      op: 'replace_selection',
      anchor: '2;14',
      startOffset: '2;14;0',
      endOffset: '2;16;23',
      replace: 'One statement instead of three.',
      expectLength: 457
    }
  },
  {
    // handler: applyReplaceAll (executor special case - runs through the
    // search module across the whole document, ignoring any anchor)
    op: 'replace_all',
    params: { find: 'string', replace: 'string' },
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: true,
    summary: 'Replace every occurrence of `find` across the whole document.',
    example: { op: 'replace_all', find: 'Acme Corp', replace: 'Acme Inc' }
  },
  {
    // handler: applyAnchoredOp case 'delete_text'
    op: 'delete_text',
    params: { find: 'string' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Delete the first occurrence of `find` within the anchored block.',
    example: { op: 'delete_text', anchor: '0;3', find: 'DRAFT ' }
  },
  {
    // handler: applyAnchoredOp case 'insert_text'
    op: 'insert_text',
    params: {
      text: 'string',
      position: 'enum[before,after,start,end]?',
      offset: 'int>=0?'
    },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary:
      'Insert `text` at the anchored block (default at its start; `position`/`offset` refine). Paragraphs the insert creates are automatically formatted to match their nearest preceding neighbors (headings match headings, body matches body); `inheritFormatFrom` overrides that computed reference and is refused for inserts inside existing text.',
    example: {
      op: 'insert_text',
      anchor: '0;3',
      text: 'Effective immediately. ',
      position: 'before'
    }
  },
  {
    // handler: applyAnchoredOp case 'set_cell_text'
    op: 'set_cell_text',
    params: { text: 'string', literal: 'boolean?' },
    requiresAnchor: true,
    anchorKind: 'table_cell',
    tracked: true,
    summary:
      'Overwrite the anchored table cell content with `text`. A purely numeric `text` aimed at a numeric slot in a numeric column is REFUSED (`model_authored_number`): a derived value must go through `set_cell_formula` so the ENGINE computes it. `literal: true` is the narrow exception for a figure the user dictated verbatim, and records the write as user-stated rather than computed.',
    example: { op: 'set_cell_text', anchor: '0;7;2;1;0', text: 'Toronto' }
  },
  {
    // handler: applyAnchoredOp case 'change_case'
    op: 'change_case',
    params: {
      caseType: 'enum[uppercase,lowercase,capitalize,titlecase,sentencecase]'
    },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Rewrite the anchored block text in the requested case.',
    example: { op: 'change_case', anchor: '0;3', caseType: 'uppercase' }
  },
  // --- Character / paragraph formatting (not tracked: SyncFusion has no
  // Formatting revision type, so these apply immediately) --------------------
  {
    // handler: applyAnchoredOp case 'set_char_format'
    op: 'set_char_format',
    params: {
      bold: 'boolean?',
      italic: 'boolean?',
      underline: 'boolean?',
      strikethrough: 'boolean?',
      allCaps: 'boolean?',
      fontName: 'string?',
      fontSize: 'number?',
      fontColor: 'string?',
      highlightColor: 'string?',
      baseline: 'enum[Superscript,Subscript]?'
    },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary:
      'Apply character formatting to the whole anchored block (at least one field required).',
    example: {
      op: 'set_char_format',
      anchor: '0;3',
      bold: true,
      fontColor: '#FF0000'
    }
  },
  {
    // handler: applyAnchoredOp case 'set_para_format'
    op: 'set_para_format',
    params: {
      alignment: 'enum[Left,Center,Right,Justify]?',
      leftIndent: 'number?',
      rightIndent: 'number?',
      firstLineIndent: 'number?',
      lineSpacing: 'number?',
      beforeSpacing: 'number?',
      afterSpacing: 'number?',
      styleName: 'string?'
    },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary:
      'Apply paragraph formatting to the anchored block (at least one field required).',
    example: { op: 'set_para_format', anchor: '0;3', alignment: 'Center' }
  },
  {
    // handler: applyAnchoredOp case 'apply_style'
    op: 'apply_style',
    params: { styleName: 'string?' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary:
      'Apply a named style to the anchored paragraph (`styleName`, or inherit via `inheritFormatFrom`).',
    example: { op: 'apply_style', anchor: '0;3', styleName: 'Heading 1' }
  },
  {
    // handler: applyAnchoredOp case 'clear_formatting'
    op: 'clear_formatting',
    params: {},
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary: 'Clear direct formatting on the anchored block.',
    example: { op: 'clear_formatting', anchor: '0;3' }
  },
  {
    // handler: applyAnchoredOp case 'indent_step'
    op: 'indent_step',
    params: { direction: 'enum[increase,decrease]?' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary: 'Step the anchored paragraph indent one level (default increase).',
    example: { op: 'indent_step', anchor: '0;3', direction: 'increase' }
  },
  {
    // handler: applyAnchoredOp case 'apply_bullets'
    op: 'apply_bullets',
    params: { bullet: 'string?' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary: 'Turn the anchored paragraph into a bulleted list item.',
    example: { op: 'apply_bullets', anchor: '0;3' }
  },
  {
    // handler: applyAnchoredOp case 'apply_numbering'
    op: 'apply_numbering',
    params: { numberFormat: 'string?' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary:
      'Turn the anchored paragraph into a numbered list item (default format "%1.").',
    example: { op: 'apply_numbering', anchor: '0;3', numberFormat: '%1.' }
  },
  {
    // handler: applyAnchoredOp case 'clear_list'
    op: 'clear_list',
    params: {},
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary: 'Remove list formatting from the anchored paragraph.',
    example: { op: 'clear_list', anchor: '0;3' }
  },
  // --- Tables ----------------------------------------------------------------
  {
    // handler: applyAnchoredOp case 'insert_table'
    op: 'insert_table',
    params: { rows: 'int>0?', columns: 'int>0?' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Insert a rows x columns table at the anchored block.',
    example: { op: 'insert_table', anchor: '0;5', rows: 3, columns: 4 }
  },
  {
    // handler: applyAnchoredOp case 'delete_table'
    op: 'delete_table',
    params: {},
    requiresAnchor: true,
    anchorKind: 'table_cell',
    tracked: true,
    summary: 'Delete the whole table containing the anchored cell.',
    example: { op: 'delete_table', anchor: '0;7;0;0;0' }
  },
  {
    // handler: applyAnchoredOp case 'insert_row'
    op: 'insert_row',
    params: { above: 'boolean?', count: 'int>0?' },
    requiresAnchor: true,
    anchorKind: 'table_cell',
    tracked: true,
    summary:
      'Insert row(s) next to the anchored row (default below; `above: true` for above).',
    example: { op: 'insert_row', anchor: '0;7;1;0;0', above: false, count: 1 }
  },
  {
    // handler: applyAnchoredOp case 'delete_row'
    op: 'delete_row',
    params: {},
    requiresAnchor: true,
    anchorKind: 'table_cell',
    tracked: true,
    summary: 'Delete the row containing the anchored cell.',
    example: { op: 'delete_row', anchor: '0;7;2;0;0' }
  },
  {
    // handler: applyAnchoredOp case 'set_cell_formula'
    //
    // The general form of set_cell_computed: the model supplies a FORMULA over
    // cell references and the engine supplies every number. A named-operation
    // list could only ever move the wall (the first request past sum/average/
    // min/max/count - "add 13% tax, then re-total" - had no route, so the model
    // wrote "$95,139.18" into a cell as a string).
    op: 'set_cell_formula',
    params: {
      formula: 'string',
      label: 'string?',
      round: 'enum[half_up,half_even,toward_zero,away_from_zero]?',
      decimals: 'int>=0?'
    },
    requiresAnchor: true,
    anchorKind: 'table_cell',
    tracked: true,
    summary:
      'Overwrite the anchored cell with the result of `formula`, which the ENGINE evaluates - never model arithmetic. Grammar: + - * / ( ), literals (1.13, 13%), cell refs [sec;blk;row;cell;para], column ranges [sec;blk;a..b;col], sum/average/min/max/count over a range; no reference = refused. Renders in the cell own format, verified by re-read. Rounding is explicit: set `round` or be refused.',
    example: {
      op: 'set_cell_formula',
      anchor: '0;7;5;4;0',
      formula: '[0;7;5;3;0] * 1.13',
      label: 'the proposed premium plus 13% tax',
      round: 'half_up'
    }
  },
  // `insert_column` was withdrawn in S5: probed on a real DocumentEditor, it
  // reports ok:true and genuinely mutates the table (4 -> 6 cells) while
  // recording ZERO revisions, so the change survives reject-all and can never
  // be reviewed or undone from the Changes pane - the same no-tracked-route
  // SyncFusion class as the withdrawn delete_column/merge_cells, except the
  // mutation applies silently instead of popping the blocking dialog. It now
  // falls to the vocabulary refusal like the rest of the parked table ops.
  // --- Links / bookmarks / comments ------------------------------------------
  {
    // handler: applyAnchoredOp case 'insert_hyperlink'
    op: 'insert_hyperlink',
    params: {
      address: 'string',
      displayText: 'string?',
      screenTip: 'string?'
    },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Insert a hyperlink at the anchored block.',
    example: {
      op: 'insert_hyperlink',
      anchor: '0;3',
      address: 'https://example.com',
      displayText: 'our site'
    }
  },
  {
    // handler: applyAnchoredOp case 'remove_hyperlink'
    op: 'remove_hyperlink',
    params: {},
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Remove the hyperlink at the anchored block, keeping its text.',
    example: { op: 'remove_hyperlink', anchor: '0;3' }
  },
  {
    // handler: applyAnchoredOp case 'insert_bookmark'
    op: 'insert_bookmark',
    params: { name: 'string' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary: 'Bookmark the anchored block under `name`.',
    example: { op: 'insert_bookmark', anchor: '0;3', name: 'quote-total' }
  },
  {
    // handler: applyAnchorlessOp case 'delete_bookmark'
    op: 'delete_bookmark',
    params: { name: 'string' },
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Delete the bookmark named `name`.',
    example: { op: 'delete_bookmark', name: 'quote-total' }
  },
  {
    // handler: applyAnchoredOp case 'insert_comment'
    op: 'insert_comment',
    params: { text: 'string' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: false,
    summary:
      'Attach a review comment to the anchored block (a comment, not a tracked change).',
    example: {
      op: 'insert_comment',
      anchor: '0;3',
      text: 'Verify this figure.'
    }
  },
  {
    // handler: applyAnchorlessOp case 'delete_all_comments'
    op: 'delete_all_comments',
    params: {},
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Delete every comment in the document.',
    example: { op: 'delete_all_comments' }
  },
  // --- Structure / page setup -------------------------------------------------
  {
    // handler: applyAnchoredOp case 'insert_page_break'
    op: 'insert_page_break',
    params: {},
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Insert a page break before the anchored block.',
    example: { op: 'insert_page_break', anchor: '0;4' }
  },
  {
    // handler: applyAnchoredOp case 'insert_column_break'
    op: 'insert_column_break',
    params: {},
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary:
      'Insert a column break before the anchored block (multi-column sections).',
    example: { op: 'insert_column_break', anchor: '0;4' }
  },
  {
    // handler: applyAnchoredOp case 'insert_section_break'
    op: 'insert_section_break',
    params: {
      sectionBreakType: 'enum[NewPage,Continuous,EvenPage,OddPage]?'
    },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Insert a section break at the anchored block (default NewPage).',
    example: {
      op: 'insert_section_break',
      anchor: '0;4',
      sectionBreakType: 'Continuous'
    }
  },
  {
    // handler: applyAnchoredOp case 'insert_page_number'
    op: 'insert_page_number',
    params: { numberFormat: 'string?' },
    requiresAnchor: true,
    anchorKind: 'block',
    tracked: true,
    summary: 'Insert a page-number field at the anchored block.',
    example: { op: 'insert_page_number', anchor: '0;4' }
  },
  {
    // handler: applyAnchorlessOp case 'set_page_margins'
    op: 'set_page_margins',
    params: {
      left: 'number?',
      right: 'number?',
      top: 'number?',
      bottom: 'number?'
    },
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Set the section page margins, in points.',
    example: {
      op: 'set_page_margins',
      left: 72,
      right: 72,
      top: 72,
      bottom: 72
    }
  },
  {
    // handler: applyAnchorlessOp case 'set_orientation'
    op: 'set_orientation',
    params: { orientation: 'enum[Portrait,Landscape]' },
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Set the section page orientation.',
    example: { op: 'set_orientation', orientation: 'Landscape' }
  },
  {
    // handler: applyAnchorlessOp case 'set_page_size'
    op: 'set_page_size',
    params: { width: 'number?', height: 'number?' },
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Set the section page size, in points.',
    example: { op: 'set_page_size', width: 612, height: 792 }
  },
  // --- Header / footer / navigation -------------------------------------------
  {
    // handler: applyAnchorlessOp case 'enter_header'
    op: 'enter_header',
    params: {},
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Move the editing context into the page header.',
    example: { op: 'enter_header' }
  },
  {
    // handler: applyAnchorlessOp case 'enter_footer'
    op: 'enter_footer',
    params: {},
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Move the editing context into the page footer.',
    example: { op: 'enter_footer' }
  },
  {
    // handler: ANCHORLESS_OP_HANDLERS.go_to_body
    // Repaired in S5: the handler had called selection.goToBody, which does
    // not exist in ej2-documenteditor 34.1.31, so the op failed with
    // unsupported_op since it shipped (found by the S2 tracked-revision
    // probe). It now routes through selection.closeHeaderFooter().
    op: 'go_to_body',
    params: {},
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Return the editing context from header/footer to the body.',
    example: { op: 'go_to_body' }
  },
  // --- Revisions / track changes ----------------------------------------------
  {
    // handler: applyAnchorlessOp case 'set_track_changes'
    op: 'set_track_changes',
    params: { enabled: 'boolean?' },
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary:
      'Toggle track changes (the engine re-enables it for every assistant change set).',
    example: { op: 'set_track_changes', enabled: true }
  },
  {
    // handler: applyAnchorlessOp case 'accept_all_revisions'
    op: 'accept_all_revisions',
    params: {},
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Accept every tracked revision in the document.',
    example: { op: 'accept_all_revisions' }
  },
  {
    // handler: applyAnchorlessOp case 'reject_all_revisions'
    op: 'reject_all_revisions',
    params: {},
    requiresAnchor: false,
    anchorKind: 'none',
    tracked: false,
    summary: 'Reject every tracked revision in the document.',
    example: { op: 'reject_all_revisions' }
  }
] as const;

// The 4.7-compatible `satisfies`: every literal entry must still be a valid
// CapabilityEntry, without widening the literal types the handler tables need.
type AssertCapabilityEntries<T extends readonly CapabilityEntry[]> = T;
export type CapabilityEntriesWellFormed = AssertCapabilityEntries<
  typeof DOCUMENT_EDITOR_CAPABILITIES
>;

// ---------------------------------------------------------------------------
// Types derived from the registry (S5): the compiler half of the contract.
//
// Before S5 the registry and the dispatch switches were kept in agreement by a
// test. A test can be deleted, skipped, or pass vacuously; these types cannot.
// Every op handler in `../tools/syncfusionDocumentOps.ts` is typed against its
// entry here, so a handler that consumes a param the entry does not declare -
// or an entry that declares an op no handler implements - fails to compile.
// ---------------------------------------------------------------------------

/** `'a,b,c'` -> `'a' | 'b' | 'c'` (the member list of an `enum[...]` type). */
type EnumMembers<S extends string> = S extends `${infer Head},${infer Rest}`
  ? Head | EnumMembers<Rest>
  : S;

/** One non-optional param-language type to its TypeScript type. */
type ParamBase<S extends string> = S extends 'string'
  ? string
  : S extends 'number' | 'int>0' | 'int>=0'
  ? number
  : S extends 'boolean'
  ? boolean
  : S extends `enum[${infer Members}]`
  ? EnumMembers<Members>
  : never;

/** One param-language type (optionally `?`-suffixed) to its TypeScript type. */
export type ParamValue<S extends string> = S extends `${infer Base}?`
  ? ParamBase<Base>
  : ParamBase<S>;

/**
 * A `params` block to its TypeScript object shape: `?`-suffixed params become
 * optional properties, everything else is required. There is deliberately no
 * index signature - an undeclared param is a compile error, which is the whole
 * point.
 */
export type ParamsShape<P extends Record<string, string>> = {
  [K in keyof P as P[K] extends `${string}?` ? never : K]: ParamValue<
    P[K] & string
  >;
} & {
  [K in keyof P as P[K] extends `${string}?` ? K : never]?: ParamValue<
    P[K] & string
  >;
};

type DocumentCapability = typeof DOCUMENT_EDITOR_CAPABILITIES[number];

/** Every advertised op name, derived from the registry. */
export type AdvertisedDocumentOp = DocumentCapability['op'];

/** The registry entry for one op, as a literal type. */
export type CapabilityOf<Name extends AdvertisedDocumentOp> = Extract<
  DocumentCapability,
  { op: Name }
>;

/** The typed op-specific params of one op, derived from its registry entry. */
export type OpParams<Name extends AdvertisedDocumentOp> = ParamsShape<
  CapabilityOf<Name>['params']
>;

/** Ops dispatched through the anchored handler table (requiresAnchor: true). */
export type AnchoredDocumentOp = Extract<
  DocumentCapability,
  { requiresAnchor: true }
>['op'];

/**
 * Ops dispatched through the anchorless handler table. `replace_all` is
 * anchorless on the wire but is the executor's own special case (it runs
 * through the search module, not either handler table), so it is excluded.
 */
export type AnchorlessDocumentOp = Exclude<
  Extract<DocumentCapability, { requiresAnchor: false }>['op'],
  'replace_all'
>;

// ---------------------------------------------------------------------------
// Read capabilities (S3): the retrieval legs this engine executes client-side.
// ---------------------------------------------------------------------------

/**
 * One read leg of the retrieval ladder. Reads are declared separately from
 * ops: they mutate nothing, need no `tracked`/`anchorKind` contract, and are
 * dispatched by `getDocumentInventory` scope / `findDocumentOccurrences`
 * rather than the edit switches (so the op<->switch-case parity test does not
 * apply to them). Param types use the same mini-language as `CapabilityEntry`.
 */
export interface ReadCapabilityEntry {
  /** Read name; inventory scopes keep their scope name. */
  read: string;
  params: Record<string, string>;
  summary: string;
}

// Ordered cheapest-first: this order IS the retrieval ladder the model should
// walk down, and the too-large refusal names `structure` as its remedy.
export const DOCUMENT_EDITOR_READS: readonly ReadCapabilityEntry[] = [
  {
    // getDocumentInventory scope 'structure' (buildInventoryFromBlocks)
    read: 'structure',
    params: { maxEntries: 'int>0?' },
    summary:
      'The document skeleton: headings, tables (anchor, rows, columns, firstRowCells) and section boundaries, no body text. Cheapest way to answer "where is X" and to find a table. firstRowCells is the text of row 0, NOT a declared header - read `table_facts` before choosing any row range.'
  },
  {
    // getDocumentInventory scope 'outline' (buildInventoryFromBlocks)
    read: 'outline',
    params: { maxEntries: 'int>0?' },
    summary:
      'Table of contents: headings with anchor, level and the block count each governs.'
  },
  {
    // getDocumentInventory scope 'section' (buildInventoryFromBlocks)
    read: 'section',
    params: { sectionAnchor: 'string', maxEntries: 'int>0?' },
    summary:
      'The blocks under one heading (anchor from a structure/outline read), with text and format.'
  },
  {
    // getDocumentInventory scope 'table_facts' (collectTableFacts)
    read: 'table_facts',
    params: { tableAnchor: 'string' },
    summary:
      'One table LAYOUT FACTS, complete and never capped: dimensions, per-row cell counts (short rows), merged cells and spans, per-cell text/blank/bold/style, which cells parse as numbers and which are formatted amounts, per-column numeric/quantity tallies with units and decimals. States NO header row, NO data range, NO subtotal - you interpret those. READ IT BEFORE any set_cell_formula range.'
  },
  {
    // getDocumentInventory scope 'table_column' (buildInventoryFromBlocks /
    // collectTableColumnCells)
    read: 'table_column',
    params: {
      tableAnchor: 'string',
      column: 'int>=0',
      maxEntries: 'int>0?'
    },
    summary:
      'Every cell of one table column as data: row index, cell anchor and verbatim text, complete and in row order. Always reports the true rowCount; a maxEntries-capped read says "returned N of M" instead of truncating silently. The read to use before any per-row or numeric work on a table.'
  },
  {
    // getDocumentInventory scope 'full' (buildInventoryFromBlocks)
    read: 'full',
    params: { maxEntries: 'int>0?' },
    summary:
      'Every block. Hard-limited by limits.fullInventoryBlocks; past it the refusal names structure+section as the remedy.'
  },
  {
    // findDocumentOccurrences (live SyncFusion search)
    read: 'occurrences',
    params: {
      text: 'string',
      matchCase: 'boolean?',
      wholeWord: 'boolean?',
      maxResults: 'int>0?'
    },
    summary:
      'Exact search over the live editor - the only authoritative source for edit anchors. Bounded by limits.liveSearchQueries / limits.liveOccurrencesPerQuery.'
  }
];
