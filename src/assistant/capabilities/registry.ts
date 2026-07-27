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
export const DOCUMENT_EDITOR_CAPABILITIES: readonly CapabilityEntry[] = [
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
      'Insert `text` at the anchored block (default at its start; `position`/`offset` refine).',
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
    params: { text: 'string' },
    requiresAnchor: true,
    anchorKind: 'table_cell',
    tracked: true,
    summary: 'Overwrite the anchored table cell content with `text`.',
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
    // handler: applyAnchoredOp case 'insert_column'
    op: 'insert_column',
    params: { left: 'boolean?', count: 'int>0?' },
    requiresAnchor: true,
    anchorKind: 'table_cell',
    tracked: false,
    summary:
      'Insert column(s) next to the anchored cell (default right; `left: true` for left). Applies untracked: SyncFusion records no revision for column insertion.',
    example: { op: 'insert_column', anchor: '0;7;0;1;0', left: false, count: 1 }
  },
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
    // handler: applyAnchorlessOp case 'go_to_body'
    // KNOWN BROKEN (pre-existing, found by the S2 tracked-revision probe):
    // the handler calls selection.goToBody, which does not exist in
    // ej2-documenteditor 34.1.31, so this op always fails with
    // `unsupported_op: selection.goToBody unavailable.` The working route is
    // selection.closeHeaderFooter(). Repairing handlers is S5 work; the entry
    // stays because the op is advertised today and S2 changes no behaviour.
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
];
