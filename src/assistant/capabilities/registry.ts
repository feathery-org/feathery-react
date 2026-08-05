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
/**
 * Param types use a small fixed language (m5 C3: no arbitrary schema
 * language): `string`, `string[][]`, `number`, `int>0`, `int>=0`, `boolean`,
 * `enum[a,b,...]` - each optionally suffixed `?` when the param may be
 * omitted. Cross-op fields (`anchor`, `expect`, `start`, `end`,
 * `inheritFormatFrom`, `changeSetId`, `group`) are reserved keys with one
 * canonical meaning and are not repeated per entry; `requiresAnchor` declares
 * whether the operation uses that anchor contract.
 *
 * `group` names an edit's accept/reject unit: same-`group` ops resolve
 * together, never dragging other groups along (default: the change-set-wide
 * unit). Persisted in revision `customData`, so it survives reloads.
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
}

export interface SectionComposerTableSpec {
  columnHeaders: string[];
  rows: string[][];
  /** Optional semantic labels for the already-ordered columns. */
  columnRoles?: string[];
}

export type SectionComposerBlock =
  | { role: 'heading'; text: string; level?: number }
  | { role: 'paragraph'; text: string }
  | { role: 'table'; table: SectionComposerTableSpec };

/** Content and semantic roles only; document-local appearance is engine-owned. */
export interface SectionComposerSpec {
  title: string;
  blocks: SectionComposerBlock[];
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
    requiresAnchor: true
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
    // `expect` (the selected text) and, when the delivered selection text was
    // truncated, `expectLength` beside that required prefix - never a counted
    // offset or a length-only guard.
    op: 'replace_selection',
    params: {
      replace: 'string',
      startOffset: 'string?',
      endOffset: 'string?',
      expectLength: 'int>=0?'
    },
    requiresAnchor: true
  },
  {
    // handler: applyReplaceAll (executor special case - runs through the
    // search module across the whole document, ignoring any anchor)
    op: 'replace_all',
    params: { find: 'string', replace: 'string' },
    requiresAnchor: false
  },
  {
    // handler: applyAnchoredOp case 'delete_text'
    op: 'delete_text',
    params: { find: 'string' },
    requiresAnchor: true
  },
  {
    // handler: ANCHORED_OP_HANDLERS.delete_paragraph
    op: 'delete_paragraph',
    params: { force: 'boolean?' },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'insert_text'
    op: 'insert_text',
    params: {
      text: 'string',
      position: 'enum[before,after,start,end]?',
      offset: 'int>=0?'
    },
    requiresAnchor: true
  },
  {
    // handler: applyDocumentEdits section-composer expansion. The engine turns
    // this semantic spec into one atomic group of the guarded primitives below;
    // Robin owns content/role/structure judgment; the engine owns document-
    // local styles, table appearance, perimeter padding and integrity.
    op: 'insert_section',
    params: {
      position: 'enum[before,after]?',
      sectionSpec: 'sectionSpec'
    },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'set_cell_text'
    //
    // A figure written into a column of formatted amounts is re-rendered in
    // that column's own number format before anything else looks at it, so
    // `9660` beside `$36,803.00` lands as `$9,660.00`.
    //
    // Such a figure must also declare where it came from, because the engine
    // did not compute it. Two provenances are sanctioned:
    //   - `literal: true` - the user stated this exact figure in conversation.
    //   - `quotedFrom` + `quotedText` - it was quoted verbatim out of a
    //     document the user attached: the attachment, and the verbatim excerpt
    //     containing the figure. The engine checks the figure actually appears
    //     in the excerpt and records the citation on the result.
    // Anything derived from other cells still goes through set_cell_formula.
    op: 'set_cell_text',
    params: {
      text: 'string',
      literal: 'boolean?',
      quotedFrom: 'string?',
      quotedText: 'string?'
    },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'change_case'
    op: 'change_case',
    params: {
      caseType: 'enum[uppercase,lowercase,capitalize,titlecase,sentencecase]'
    },
    requiresAnchor: true
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
    requiresAnchor: true
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
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'apply_style'
    op: 'apply_style',
    params: { styleName: 'string?' },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'clear_formatting'
    op: 'clear_formatting',
    params: {},
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'indent_step'
    op: 'indent_step',
    params: { direction: 'enum[increase,decrease]?' },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'apply_bullets'
    op: 'apply_bullets',
    params: { bullet: 'string?' },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'apply_numbering'
    op: 'apply_numbering',
    params: { numberFormat: 'string?' },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'clear_list'
    op: 'clear_list',
    params: {},
    requiresAnchor: true
  },
  // --- Tables ----------------------------------------------------------------
  {
    // handler: applyAnchoredOp case 'insert_table'
    //
    // The new grid inherits the nearest sibling table's resolved appearance
    // and per-column header/body text formats by default. Explicit appearance
    // and character/paragraph formatting ops in the same change set run later
    // and override only the properties they name.
    op: 'insert_table',
    params: {
      rows: 'int>0?',
      columns: 'int>0?',
      initialCells: 'string[][]?',
      position: 'enum[before,after]?'
    },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'delete_table'
    op: 'delete_table',
    params: {},
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'insert_row'
    //
    // `preserveBanding` (default ON): SyncFusion clones the reference row's fill
    // into the new row, which breaks a striped table in both directions - the new
    // row repeats its neighbour, and every row below it shifts parity. The
    // executor therefore reads the stripe BEFORE the insert (the only moment it
    // is unambiguous) and re-lays it from the new row down afterwards. Costs no
    // extra change cards, because appearance writes create no revisions. Send
    // `preserveBanding: false` to get SyncFusion's raw behaviour.
    // The inserted cells also inherit the resolved character/paragraph format
    // of the row they displace, cycling through the table body on append.
    op: 'insert_row',
    params: {
      above: 'boolean?',
      count: 'int>0?',
      preserveBanding: 'boolean?'
    },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'delete_row'
    //
    // No banding preserve, unlike insert_row: under track changes SyncFusion
    // marks the row deleted and leaves it IN PLACE until the revision is
    // accepted, so no row below it has changed parity yet. `restripe_table` is
    // the repair after acceptance.
    op: 'delete_row',
    params: {},
    requiresAnchor: true
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
    requiresAnchor: true
  },
  {
    // handler: ANCHORED_OP_HANDLERS.set_column_formula
    //
    // The same formula applied down a whole column, one row at a time. It
    // exists because picking row ranges is what the model gets wrong: live it
    // totalled rows 1..3 of one column and rows 1..4 of the column beside it,
    // in the same table, in the same turn. Here the bounds stop mattering - the
    // default span is every DATA row (row 0 is the explicit header row), rows
    // that cannot produce a value are skipped and named, and (the no-op rule)
    // only the cells whose value actually moves become tracked changes.
    op: 'set_column_formula',
    params: {
      formula: 'string',
      startRow: 'int>=0?',
      endRow: 'int>=0?',
      label: 'string?',
      round: 'enum[half_up,half_even,toward_zero,away_from_zero]?',
      decimals: 'int>=0?'
    },
    requiresAnchor: true
  },
  // --- Table appearance -------------------------------------------------------
  //
  // Like the character/paragraph formatting block above, these are NOT tracked:
  // SyncFusion 34.1.31's RevisionType is `Insertion | Deletion | MoveTo |
  // MoveFrom` and nothing else, and a probe of a real DocumentEditor confirms a
  // cell shading or border write creates ZERO revisions. They are still
  // reversible: the executor snapshots the appearance it is about to overwrite
  // and binds the restore into the change set's revision group, so rejecting the
  // card puts the old appearance back along with the content. A change set that
  // writes ONLY appearance has no card to bind to and says so
  // (`changeSet.formatTracking: 'untracked_immediate'`).
  {
    // handler: ANCHORED_OP_HANDLERS.set_cell_format
    // Anchor: the cell's paragraph anchor, exactly as set_cell_text takes it.
    op: 'set_cell_format',
    params: {
      shading: 'string?',
      verticalAlignment: 'enum[Top,Center,Bottom]?',
      borders:
        'enum[AllBorders,OutsideBorders,LeftBorder,RightBorder,TopBorder,BottomBorder,NoBorder]?',
      borderColor: 'string?',
      borderWidth: 'number?',
      borderStyle:
        'enum[Single,None,Dot,DashSmallGap,DashLargeGap,DashDot,DashDotDot,Double]?'
    },
    requiresAnchor: true
  },
  {
    // handler: ANCHORED_OP_HANDLERS.set_row_format
    // Anchor: ANY cell paragraph anchor in the row.
    op: 'set_row_format',
    params: {
      shading: 'string?',
      verticalAlignment: 'enum[Top,Center,Bottom]?',
      borders:
        'enum[AllBorders,OutsideBorders,LeftBorder,RightBorder,TopBorder,BottomBorder,NoBorder]?',
      borderColor: 'string?',
      borderWidth: 'number?',
      borderStyle:
        'enum[Single,None,Dot,DashSmallGap,DashLargeGap,DashDot,DashDotDot,Double]?',
      isHeader: 'boolean?'
    },
    requiresAnchor: true
  },
  {
    // handler: ANCHORED_OP_HANDLERS.copy_table_format
    //
    // "Copy how the table looks", done engine-side. One set_cell_format per cell
    // across a 12x5 table is 60 model-authored ops that drift; this is one, and
    // it is deterministic. Appearance only - never content, never dimensions.
    //
    // Anchor: the TARGET table (a cell anchor, or the `0;7` table anchor a
    // structure read reports). `sourceTable` names the source the same way.
    op: 'copy_table_format',
    params: { sourceTable: 'string' },
    requiresAnchor: true
  },
  {
    // handler: ANCHORED_OP_HANDLERS.restripe_table
    //
    // Re-lay the table's OWN alternating fill so its parity is consistent again.
    // The pattern is inferred from the rows that exist (period and header count
    // both), never assumed, and a table with no detectable stripe is left
    // untouched rather than given one it never had.
    //
    // `insert_row`/`delete_row` already preserve banding by themselves, so this
    // is the repair tool for a table someone else broke - not a follow-up the
    // model has to remember.
    op: 'restripe_table',
    params: { fromRow: 'int>=0?' },
    requiresAnchor: true
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
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'remove_hyperlink'
    op: 'remove_hyperlink',
    params: {},
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'insert_bookmark'
    op: 'insert_bookmark',
    params: { name: 'string' },
    requiresAnchor: true
  },
  {
    // handler: applyAnchorlessOp case 'delete_bookmark'
    op: 'delete_bookmark',
    params: { name: 'string' },
    requiresAnchor: false
  },
  {
    // handler: applyAnchoredOp case 'insert_comment'
    op: 'insert_comment',
    params: { text: 'string' },
    requiresAnchor: true
  },
  {
    // handler: applyAnchorlessOp case 'delete_all_comments'
    op: 'delete_all_comments',
    params: {},
    requiresAnchor: false
  },
  // --- Structure / page setup -------------------------------------------------
  {
    // handler: applyAnchoredOp case 'insert_page_break'
    op: 'insert_page_break',
    params: {},
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'insert_column_break'
    op: 'insert_column_break',
    params: {},
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'insert_section_break'
    op: 'insert_section_break',
    params: {
      sectionBreakType: 'enum[NewPage,Continuous,EvenPage,OddPage]?'
    },
    requiresAnchor: true
  },
  {
    // handler: applyAnchoredOp case 'insert_page_number'
    op: 'insert_page_number',
    params: { numberFormat: 'string?' },
    requiresAnchor: true
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
    requiresAnchor: false
  },
  {
    // handler: applyAnchorlessOp case 'set_orientation'
    op: 'set_orientation',
    params: { orientation: 'enum[Portrait,Landscape]' },
    requiresAnchor: false
  },
  {
    // handler: applyAnchorlessOp case 'set_page_size'
    op: 'set_page_size',
    params: { width: 'number?', height: 'number?' },
    requiresAnchor: false
  },
  // --- Header / footer / navigation -------------------------------------------
  {
    // handler: applyAnchorlessOp case 'enter_header'
    op: 'enter_header',
    params: {},
    requiresAnchor: false
  },
  {
    // handler: applyAnchorlessOp case 'enter_footer'
    op: 'enter_footer',
    params: {},
    requiresAnchor: false
  },
  {
    // handler: ANCHORLESS_OP_HANDLERS.go_to_body
    // Repaired in S5: the handler had called selection.goToBody, which does
    // not exist in ej2-documenteditor 34.1.31, so the op failed with
    // unsupported_op since it shipped (found by the S2 tracked-revision
    // probe). It now routes through selection.closeHeaderFooter().
    op: 'go_to_body',
    params: {},
    requiresAnchor: false
  },
  // --- Revisions / track changes ----------------------------------------------
  {
    // handler: applyAnchorlessOp case 'set_track_changes'
    op: 'set_track_changes',
    params: { enabled: 'boolean?' },
    requiresAnchor: false
  },
  {
    // handler: applyAnchorlessOp case 'accept_all_revisions'
    op: 'accept_all_revisions',
    params: {},
    requiresAnchor: false
  },
  {
    // handler: applyAnchorlessOp case 'reject_all_revisions'
    op: 'reject_all_revisions',
    params: {},
    requiresAnchor: false
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
  : S extends 'sectionSpec'
  ? SectionComposerSpec
  : S extends 'string[][]'
  ? string[][]
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

/**
 * Standalone client reads that are model-facing tools rather than edit-batch
 * operations. Keep these out of `DOCUMENT_EDITOR_CAPABILITIES`: placing a read
 * there would falsely advertise it as an `applyDocumentEdits` operation.
 */
export const DOCUMENT_EDITOR_READ_CAPABILITIES = [
  {
    tool: 'getSectionPattern',
    params: { near: 'string?' },
    requiresAnchor: false,
    readOnly: true
  }
] as const;

export type DocumentEditorReadCapability =
  typeof DOCUMENT_EDITOR_READ_CAPABILITIES[number];
export type DocumentEditorReadTool = DocumentEditorReadCapability['tool'];
