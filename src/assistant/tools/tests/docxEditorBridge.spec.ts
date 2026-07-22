import {
  anchorFromOffset,
  anchorToOffsetPath,
  buildDocxIndexBlocks,
  createDocxEditorBridge,
  firstMeaningfulLine,
  FULL_INVENTORY_BLOCK_LIMIT,
  readDocxSelection
} from '../docxEditorBridge';

const SFDT = {
  sections: [
    {
      blocks: [
        {
          paragraphFormat: { styleName: 'Heading 1', textAlignment: 'left' },
          inlines: [{ text: 'Intro', characterFormat: { bold: true } }]
        },
        {
          paragraphFormat: { styleName: 'Normal' },
          inlines: [{ text: 'Quote: $5,500' }]
        },
        {
          paragraphFormat: { styleName: 'Heading 2' },
          inlines: [{ text: 'Details' }]
        },
        {
          paragraphFormat: { styleName: 'Normal' },
          inlines: [{ text: 'More text' }]
        }
      ]
    }
  ]
};

const OFFSET = (anchor: string) => anchorToOffsetPath(anchor);

// Stateful editor stub modeling SyncFusion search well enough to exercise the
// block-scoped replace. findAll(q) derives matches from the doc's blocks (each
// with a hierarchical `start` offset "<blockPath>;<charIdx>"), exposed via
// searchResults.innerList; setting .index selects one; .replace(text) rewrites
// the current match (recorded in replaceCalls). `present` lets the CAS guard's
// findAll(probe) report a hit for text that isn't itself a block (e.g. a ToC
// first line). `captured.tracking` records enableTrackChanges at write time.
// selection.select / editor.insertText are provided but MUST NOT be used by the
// (marker-safe) anchored path - the tests assert they stay uncalled.
const makeEditor = (doc: any, present: string[] = []) => {
  const captured: { tracking?: boolean } = {};
  const replaceCalls: Array<{ start?: string; text: string }> = [];
  let matches: Array<{ start: string }> = [];

  const deriveMatches = (q: string) => {
    const out: Array<{ start: string }> = [];
    for (const b of buildDocxIndexBlocks(editor)) {
      const t = b.text ?? '';
      let idx = t.indexOf(q);
      while (q && idx >= 0) {
        out.push({ start: `${OFFSET(b.anchor)};${idx}` });
        idx = t.indexOf(q, idx + q.length);
      }
    }
    return out;
  };

  const searchResults: any = {
    length: 0,
    index: -1,
    innerList: [] as Array<{ start: string }>,
    replace: jest.fn(function (text: string) {
      captured.tracking = editor.enableTrackChanges;
      replaceCalls.push({ start: matches[searchResults.index]?.start, text });
    }),
    replaceAll: jest.fn(function () {
      captured.tracking = editor.enableTrackChanges;
    })
  };
  const editor: any = {
    enableTrackChanges: false,
    serialize: () => JSON.stringify(doc),
    search: {
      findAll: jest.fn((q: string) => {
        matches = deriveMatches(q);
        searchResults.innerList = matches;
        searchResults.length = matches.length || (present.includes(q) ? 1 : 0);
        searchResults.index = -1;
      }),
      searchResults
    },
    selection: { select: jest.fn(), startOffset: undefined },
    editor: {
      insertText: jest.fn(function () {
        captured.tracking = editor.enableTrackChanges;
      })
    },
    revisions: { acceptAll: jest.fn() },
    editorHistory: { undo: jest.fn(), redo: jest.fn() }
  };
  return { editor, captured, searchResults, replaceCalls };
};

describe('createDocxEditorBridge - getDocumentInventory', () => {
  it('returns a heading outline with anchors, levels, and block counts', async () => {
    const { editor } = makeEditor(SFDT);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.getDocumentInventory!({ scope: 'outline' });
    expect(res.sections).toEqual([
      { anchor: 's0:b0', heading: 'Intro', level: 1, blockCount: 2 },
      { anchor: 's0:b2', heading: 'Details', level: 2, blockCount: 2 }
    ]);
  });

  it('returns a section slice from a heading anchor to the next same/higher heading', async () => {
    const { editor } = makeEditor(SFDT);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.getDocumentInventory!({
      scope: 'section',
      sectionAnchor: 's0:b2'
    });
    expect(res.inventory.map((e: any) => e.text)).toEqual([
      'Details',
      'More text'
    ]);
  });

  it('errors on a missing/stale section anchor', async () => {
    const { editor } = makeEditor(SFDT);
    const bridge = createDocxEditorBridge(() => editor);
    expect(await bridge.getDocumentInventory!({ scope: 'section' })).toMatchObject(
      { ok: false, error: 'missing_anchor' }
    );
    expect(
      await bridge.getDocumentInventory!({ scope: 'section', sectionAnchor: 'nope' })
    ).toMatchObject({ ok: false, error: 'stale_anchor' });
  });

  it('returns the full inventory with per-block format', async () => {
    const { editor } = makeEditor(SFDT);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.getDocumentInventory!({ scope: 'full' });
    expect(res.inventory).toHaveLength(4);
    expect(res.inventory[0]).toMatchObject({
      anchor: 's0:b0',
      kind: 'paragraph',
      text: 'Intro'
    });
    expect(res.inventory[0].format).toMatchObject({
      styleName: 'Heading 1',
      alignment: 'left',
      bold: true
    });
  });

  it('refuses full on a document over the block limit', async () => {
    const big = {
      sections: [
        {
          blocks: Array.from(
            { length: FULL_INVENTORY_BLOCK_LIMIT + 1 },
            (_, i) => ({ inlines: [{ text: `b${i}` }] })
          )
        }
      ]
    };
    const { editor } = makeEditor(big);
    const bridge = createDocxEditorBridge(() => editor);
    expect(await bridge.getDocumentInventory!({ scope: 'full' })).toMatchObject({
      ok: false,
      error: 'too_large'
    });
  });

  it('tolerates optimized (abbreviated-key) SFDT', async () => {
    const optimized = {
      sec: [
        {
          b: [
            { pf: { sty: 'Heading 1' }, i: [{ tlp: 'Title Block' }] },
            { pf: { sty: 'Normal' }, i: [{ tlp: 'body' }] }
          ]
        }
      ]
    };
    const { editor } = makeEditor(optimized);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.getDocumentInventory!({ scope: 'outline' });
    expect(res.sections).toEqual([
      { anchor: 's0:b0', heading: 'Title Block', level: 1, blockCount: 2 }
    ]);
  });

  it('errors when no editor is mounted', async () => {
    const bridge = createDocxEditorBridge(() => undefined);
    expect(await bridge.getDocumentInventory!({ scope: 'outline' })).toMatchObject(
      { ok: false, error: 'no_editor' }
    );
  });
});

describe('createDocxEditorBridge - applyDocumentEdits', () => {
  it('applies an anchored replace via scoped search-replace and restores tracking', async () => {
    const { editor, captured, searchResults, replaceCalls } = makeEditor(SFDT, [
      'Quote: $5,500'
    ]);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b1', // the "Quote: $5,500" block
          find: 'Quote: $5,500',
          replace: 'Quote: $6,000',
          expect: 'Quote: $5,500'
        }
      ]
    });
    expect(res.results).toEqual([
      { anchor: 's0:b1', op: 'replace_text', ok: true }
    ]);
    // Uses SyncFusion's search (marker-safe match sizing) scoped to the block -
    // NOT a manually-computed selection range or a global replaceAll.
    expect(replaceCalls).toEqual([{ start: '0;1;0', text: 'Quote: $6,000' }]);
    expect(searchResults.replaceAll).not.toHaveBeenCalled();
    expect(editor.selection.select).not.toHaveBeenCalled();
    expect(editor.editor.insertText).not.toHaveBeenCalled();
    // Ran with track-changes ON, restored to the prior value (false) after.
    expect(captured.tracking).toBe(true);
    expect(editor.enableTrackChanges).toBe(false);
  });

  it('a mismatched expect does not block the edit when find is still present', async () => {
    // The whole-block `expect` no longer matches verbatim (field code / drift),
    // but the precise `find` target is still there -> the guard must fall back
    // to `find` and let the scoped edit proceed (this is what unblocks ToC /
    // field-result edits) rather than throwing stale_anchor.
    const { editor, replaceCalls } = makeEditor(SFDT, []);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b1',
          find: 'Quote: $5,500', // still present in the block
          replace: 'Quote: $6,000',
          expect: 'Stale Quote: $4,000' // no longer matches verbatim
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
    expect(replaceCalls).toEqual([{ start: '0;1;0', text: 'Quote: $6,000' }]);
  });

  it('reports not_found when the query is absent', async () => {
    const { editor } = makeEditor(SFDT, []);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [{ op: 'replace_text', find: 'ghost', replace: 'x' }]
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('handles set_track_changes, accept_all_revisions and unknown ops', async () => {
    const { editor } = makeEditor(SFDT);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        { op: 'accept_all_revisions' },
        { op: 'frobnicate' }
      ]
    });
    expect(editor.revisions.acceptAll).toHaveBeenCalled();
    expect(res.results[0]).toMatchObject({ ok: true, op: 'accept_all_revisions' });
    expect(res.results[1]).toMatchObject({ ok: false, error: 'unsupported_op' });
    expect(res.warnings).toEqual([]);
  });

  it('errors when no editor is mounted', async () => {
    const bridge = createDocxEditorBridge(() => undefined);
    expect(await bridge.applyDocumentEdits!({ edits: [] })).toMatchObject({
      ok: false,
      error: 'no_editor'
    });
  });
});

describe('anchorFromOffset / readDocxSelection', () => {
  it('strips the trailing offset segment to get the block anchor', () => {
    expect(anchorFromOffset('0;3;5')).toBe('0;3');
    expect(anchorFromOffset('0;2;0;1;0;4')).toBe('0;2;0;1;0');
    expect(anchorFromOffset('0')).toBe('0');
    expect(anchorFromOffset('')).toBe('');
  });

  it('returns null when there is no usable selection', () => {
    expect(readDocxSelection(undefined)).toBeNull();
    expect(readDocxSelection({})).toBeNull();
    expect(readDocxSelection({ selection: {} })).toBeNull();
    expect(readDocxSelection({ selection: { startOffset: 42 } })).toBeNull();
  });

  it('clamps selection text to 500 chars', () => {
    const sel = readDocxSelection({
      selection: {
        startOffset: '0;1;0',
        endOffset: '0;1;600',
        isEmpty: false,
        text: 'x'.repeat(600)
      }
    });
    expect(sel?.anchor).toBe('0;1');
    expect(sel?.text).toHaveLength(500);
    expect(sel?.isCollapsed).toBe(false);
  });
});

// Optimized SFDT (short keys) with a 2x2 table - row key 'r', cells 'c'.
const TABLE_SFDT = {
  sec: [
    {
      b: [
        { i: [{ tlp: 'Above table' }] },
        {
          r: [
            {
              c: [
                { b: [{ i: [{ tlp: 'Cell A1' }] }] },
                { b: [{ i: [{ tlp: 'Cell B1' }] }] }
              ]
            },
            {
              c: [
                { b: [{ i: [{ tlp: 'Cell A2' }] }] },
                { b: [{ i: [{ tlp: 'Cell B2' }] }] }
              ]
            }
          ]
        }
      ]
    }
  ]
};

describe('createDocxEditorBridge - table walk (fix #1: optimized row key)', () => {
  it('enumerates table cells as addressable table_cell blocks', async () => {
    const { editor } = makeEditor(TABLE_SFDT);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.getDocumentInventory!({ scope: 'full' });
    // 1 paragraph above + 4 cells (would be 1 empty "table" block before the fix)
    expect(res.inventory).toHaveLength(5);
    expect(res.inventory[0]).toMatchObject({
      anchor: 's0:b0',
      kind: 'paragraph',
      text: 'Above table'
    });
    const cells = res.inventory.slice(1);
    expect(cells.map((c: any) => c.kind)).toEqual([
      'table_cell',
      'table_cell',
      'table_cell',
      'table_cell'
    ]);
    expect(cells.map((c: any) => c.text)).toEqual([
      'Cell A1',
      'Cell B1',
      'Cell A2',
      'Cell B2'
    ]);
    expect(cells.map((c: any) => c.anchor)).toEqual([
      's0:b1:r0:c0:b0',
      's0:b1:r0:c1:b0',
      's0:b1:r1:c0:b0',
      's0:b1:r1:c1:b0'
    ]);
  });

  it('lets replace_text edit table-cell content (now that cells are visible)', async () => {
    const { editor, searchResults } = makeEditor(TABLE_SFDT, ['Cell B2']);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [{ op: 'replace_text', find: 'Cell B2', replace: 'Edited B2' }]
    });
    expect(res.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
    expect(searchResults.replaceAll).toHaveBeenCalledWith('Edited B2');
  });
});

describe('styling ops never silently succeed (fix #2: verified absent)', () => {
  it('returns an error (not a false ok) for set_char_format', async () => {
    const { editor } = makeEditor(SFDT);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        { op: 'set_char_format' }, // empty
        { op: 'set_char_format', bold: true } // with a field
      ]
    });
    // The bridge does not implement styling setters, so they return
    // unsupported_op - never a silent ok that makes Assist falsely say "Done".
    expect(res.results[0]).toMatchObject({ ok: false });
    expect(res.results[1]).toMatchObject({ ok: false });
    expect(res.results.every((r: any) => r.ok === false)).toBe(true);
  });
});

// Editor whose tracked replace authors a delete+insert revision pair, with a
// per-revision accept/reject we can drive to reproduce the content-loss path.
const makeRevisionEditor = () => {
  const accepted: string[] = [];
  const rejected: string[] = [];
  const mkRev = (id: string) => ({
    id,
    accept() {
      accepted.push((this as any).id);
    },
    reject() {
      rejected.push((this as any).id);
    }
  });
  const changes: any[] = [];
  const searchResults = {
    length: 0,
    replaceAll: jest.fn(() => {
      changes.push(mkRev('deletion'), mkRev('insertion'));
    })
  };
  const editor: any = {
    enableTrackChanges: false,
    serialize: () => JSON.stringify(SFDT),
    search: {
      findAll: jest.fn(() => {
        searchResults.length = 1;
      }),
      searchResults
    },
    revisions: { changes, acceptAll: jest.fn() }
  };
  return { editor, changes, accepted, rejected };
};

describe('atomic revision grouping (fix #3: content-loss guard)', () => {
  it('groups a replace\'s delete+insert so a per-card reject rejects both (no split)', async () => {
    const { editor, changes, accepted, rejected } = makeRevisionEditor();
    const bridge = createDocxEditorBridge(() => editor);
    await bridge.applyDocumentEdits!({
      edits: [{ op: 'replace_text', find: 'x', replace: 'y' }]
    });
    expect(changes).toHaveLength(2);

    // Contradictory per-card order: reject the insertion, then accept the
    // deletion. Before the fix this drops BOTH runs (content loss). Grouped,
    // the first action resolves the whole edit and the second is a no-op.
    changes[1].reject(); // reject insertion
    changes[0].accept(); // accept deletion (should be a no-op now)

    expect(rejected.sort()).toEqual(['deletion', 'insertion']);
    expect(accepted).toEqual([]);
  });

  it('accepting one member accepts the whole group', async () => {
    const { editor, changes, accepted, rejected } = makeRevisionEditor();
    const bridge = createDocxEditorBridge(() => editor);
    await bridge.applyDocumentEdits!({
      edits: [{ op: 'replace_text', find: 'x', replace: 'y' }]
    });
    changes[0].accept();
    changes[1].reject(); // no-op after the group resolved
    expect(accepted.sort()).toEqual(['deletion', 'insertion']);
    expect(rejected).toEqual([]);
  });
});

describe('firstMeaningfulLine', () => {
  it('returns the first non-empty line, dropping a leading tab column', () => {
    expect(firstMeaningfulLine('\t\r\r\rTable of Contents\rAbout Us\t5\r')).toBe(
      'Table of Contents'
    );
    expect(firstMeaningfulLine('About Us\t5')).toBe('About Us');
    expect(firstMeaningfulLine('Single line')).toBe('Single line');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(firstMeaningfulLine('\t\r\r')).toBe('');
    expect(firstMeaningfulLine('')).toBe('');
  });
});

describe('replace_text expect guard (fix #3: paragraph-aware CAS)', () => {
  // The model copies the whole inventory block into `expect`; it spans \r and
  // can never findAll verbatim. The guard must probe the first meaningful line.
  const MULTI_PARA_EXPECT =
    '\t\r\r\rTable of Contents\rAbout Us\t5\rOur Mission\t5\r';

  it('does NOT fail stale_anchor on a multi-paragraph expect when the anchor is live', async () => {
    // 'Table of Contents' (first meaningful line of expect) present for the guard.
    const { editor, replaceCalls } = makeEditor(SFDT, ['Table of Contents']);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b1', // the "Quote: $5,500" block (contains the find)
          find: 'Quote: $5,500',
          replace: 'Quote: $6,000',
          expect: MULTI_PARA_EXPECT
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
    expect(replaceCalls).toEqual([{ start: '0;1;0', text: 'Quote: $6,000' }]);
  });

  it('still fails stale_anchor when neither the expect line nor find is present', async () => {
    // Both the expect first line AND the find target are gone from the doc ->
    // the anchor is genuinely stale.
    const { editor, searchResults } = makeEditor(SFDT, []);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b1',
          find: 'Old Quote $4,000', // absent
          replace: 'X',
          expect: 'Vanished Heading\rsome body text\r' // absent
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: 'stale_anchor' });
    expect(searchResults.replace).not.toHaveBeenCalled();
    expect(searchResults.replaceAll).not.toHaveBeenCalled();
  });
});

describe('buildDocxIndexBlocks (fix #4a: index inventory)', () => {
  it('builds text-carrying blocks (paragraphs + table cells), skipping empties', () => {
    const doc = {
      sec: [
        {
          b: [
            { pf: { sty: 'Heading 1' }, i: [{ tlp: 'Premium Summary' }] },
            { i: [{ tlp: '' }] }, // empty paragraph - skipped
            {
              r: [
                {
                  c: [
                    { b: [{ i: [{ tlp: 'Premium: $2,691' }] }] },
                    { b: [{ i: [{ tlp: '' }] }] } // empty cell - skipped
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
    const editor = { serialize: () => JSON.stringify(doc) };
    const blocks = buildDocxIndexBlocks(editor);
    expect(blocks.map((b) => b.text)).toEqual([
      'Premium Summary',
      'Premium: $2,691'
    ]);
    expect(blocks.map((b) => b.anchor)).toEqual(['s0:b0', 's0:b2:r0:c0:b0']);
    expect(blocks[1].kind).toBe('table_cell');
    expect(blocks[0].format).toMatchObject({ styleName: 'Heading 1' });
  });

  it('returns [] when the document cannot be read', () => {
    expect(buildDocxIndexBlocks({ serialize: () => 42 as any })).toEqual([]);
    expect(buildDocxIndexBlocks(undefined)).toEqual([]);
  });
});

describe('anchorToOffsetPath', () => {
  it('converts flattenBlocks anchors to SyncFusion offset paths', () => {
    expect(anchorToOffsetPath('s0:b0')).toBe('0;0');
    expect(anchorToOffsetPath('s2:b7')).toBe('2;7');
    expect(anchorToOffsetPath('s0:b1:r0:c1:b0')).toBe('0;1;0;1;0');
  });
  it('is tolerant of an already-semicolon-formatted anchor', () => {
    expect(anchorToOffsetPath('0;3')).toBe('0;3');
  });
});

describe('replace_text anchor scoping (precision fix: no global over-apply)', () => {
  // "Our Mission" appears in TWO heading blocks (b0 and b2).
  const DOC = {
    sections: [
      {
        blocks: [
          { paragraphFormat: { styleName: 'Heading 1' }, inlines: [{ text: 'Our Mission' }] },
          { inlines: [{ text: 'Body text about the topic' }] },
          { paragraphFormat: { styleName: 'Heading 1' }, inlines: [{ text: 'Our Mission' }] }
        ]
      }
    ]
  };

  it('anchored replace rewrites ONLY the target block, not every occurrence', async () => {
    const { editor, searchResults, replaceCalls } = makeEditor(DOC);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        { op: 'replace_text', anchor: 's0:b0', find: 'Our Mission', replace: 'Our Purpose' }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, anchor: 's0:b0' });
    // Only the b0 match ('0;0;...') is replaced; the identical b2 occurrence
    // ('0;2;...') is left alone. No global replaceAll, no offset-select.
    expect(replaceCalls).toEqual([{ start: '0;0;0', text: 'Our Purpose' }]);
    expect(searchResults.replaceAll).not.toHaveBeenCalled();
    expect(editor.selection.select).not.toHaveBeenCalled();
    expect(editor.editor.insertText).not.toHaveBeenCalled();
  });

  it('unanchored replace stays global (bulk asks rewrite every occurrence)', async () => {
    const { editor, searchResults } = makeEditor(DOC, ['Our Mission']);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [{ op: 'replace_text', find: 'Our Mission', replace: 'Our Purpose' }]
    });
    expect(res.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
    expect(searchResults.replaceAll).toHaveBeenCalledWith('Our Purpose');
    // No block scoping when no anchor is given.
    expect(searchResults.replace).not.toHaveBeenCalled();
  });

  it('anchored replace errors not_found when the phrase is absent from that block', async () => {
    const { editor, searchResults } = makeEditor(DOC);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        // b1 does not contain "Our Mission"
        { op: 'replace_text', anchor: 's0:b1', find: 'Our Mission', replace: 'Our Purpose' }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: 'not_found' });
    expect(searchResults.replace).not.toHaveBeenCalled();
    expect(searchResults.replaceAll).not.toHaveBeenCalled();
  });

  it('anchored replace errors stale_anchor for an unknown block anchor', async () => {
    const { editor, searchResults } = makeEditor(DOC);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        { op: 'replace_text', anchor: 's9:b9', find: 'Our Mission', replace: 'x' }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: 'stale_anchor' });
    expect(searchResults.replace).not.toHaveBeenCalled();
  });
});

describe('replace_text on a ToC-bookmark-target heading (truncation regression)', () => {
  // The "Our Purposeon" bug: a heading that is a ToC target has zero-width
  // BOOKMARK markers around its text ([bkt,bkt,text,bkt,bkt]) which occupy
  // SyncFusion offsets. A range derived from the flattened text length (11)
  // undershot the true end offset (13) and deleted only "Our Missi". The fix
  // uses search (marker-aware) so the WHOLE match is replaced regardless of
  // markers, and never derives a selection range from text length.
  const bookmarkHeading = () => ({
    sections: [
      {
        blocks: [
          {
            paragraphFormat: { styleName: 'Heading 1' },
            inlines: [
              { bookmarkType: 0, name: '_Toc1' }, // BookmarkStart (zero-width)
              { bookmarkType: 1, name: '_Toc1' }, // BookmarkEnd   (zero-width)
              { text: 'Our Mission' },
              { bookmarkType: 0, name: '_Toc2' },
              { bookmarkType: 1, name: '_Toc2' }
            ]
          }
        ]
      }
    ]
  });

  it('flattens the heading text past the markers and replaces the FULL phrase', async () => {
    const doc = bookmarkHeading();
    // Sanity: markers contribute no characters to the flattened text.
    const [block] = buildDocxIndexBlocks({ serialize: () => JSON.stringify(doc) });
    expect(block.text).toBe('Our Mission');

    const { editor, replaceCalls } = makeEditor(doc);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        { op: 'replace_text', anchor: 's0:b0', find: 'Our Mission', replace: 'Our Purpose' }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, anchor: 's0:b0' });
    // Whole phrase replaced via search - NO offset-length select (which would
    // have truncated to "Our Missi" and left "on").
    expect(replaceCalls).toEqual([{ start: '0;0;0', text: 'Our Purpose' }]);
    expect(editor.selection.select).not.toHaveBeenCalled();
    expect(editor.editor.insertText).not.toHaveBeenCalled();
  });

  it('passes the exact replacement regardless of length (longer or shorter)', async () => {
    for (const replacement of ['Our Purpose And Vision', 'Aim']) {
      const { editor, replaceCalls } = makeEditor(bookmarkHeading());
      const bridge = createDocxEditorBridge(() => editor);
      const res: any = await bridge.applyDocumentEdits!({
        edits: [
          { op: 'replace_text', anchor: 's0:b0', find: 'Our Mission', replace: replacement }
        ]
      });
      expect(res.results[0]).toMatchObject({ ok: true });
      // Search replaces the whole match with the exact replacement - no
      // truncation on a longer replacement, no overrun on a shorter one.
      expect(replaceCalls).toEqual([{ start: '0;0;0', text: replacement }]);
    }
  });

  it('replaces a match at the very end of a block (no trailing fragment)', async () => {
    // "...ends with Our Mission" - phrase sits at the block end, mark after it.
    const doc = {
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'This section ends with Our Mission' },
                { bookmarkType: 0, name: '_b' },
                { bookmarkType: 1, name: '_b' }
              ]
            }
          ]
        }
      ]
    };
    const { editor, replaceCalls } = makeEditor(doc);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        { op: 'replace_text', anchor: 's0:b0', find: 'Our Mission', replace: 'Our Purpose' }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true });
    // Match start is at char offset 23 within the block; the full phrase (not a
    // truncated prefix) is what the search replaces.
    expect(replaceCalls).toEqual([{ start: '0;0;23', text: 'Our Purpose' }]);
  });
});

describe('replace_text on a ToC / HYPERLINK field-result block', () => {
  // A ToC entry is a field: [begin, <field code>, separator, <result text>, end].
  // The visible text is the RESULT ("Our Mission  5"); the field CODE
  // (HYPERLINK/PAGEREF) must never surface in the inventory.
  const withToc = () => ({
    sections: [
      {
        // s0 = the ToC
        blocks: [
          {
            paragraphFormat: { styleName: 'TOC 1' },
            inlines: [
              { fieldType: 0, hasFieldEnd: true },
              { text: ' HYPERLINK \\l "_Toc001" ' }, // field code (must be hidden)
              { fieldType: 2 },
              { text: 'Our Mission' }, // field RESULT (visible)
              { text: '\t' },
              { text: '5' },
              { fieldType: 1 }
            ]
          }
        ]
      },
      {
        // s1 = the body heading the ToC points at
        blocks: [
          { paragraphFormat: { styleName: 'Heading 1' }, inlines: [{ text: 'Our Mission' }] }
        ]
      }
    ]
  });

  it('flattens the field block to its RESULT text only (no field code)', () => {
    const [tocEntry] = buildDocxIndexBlocks({
      serialize: () => JSON.stringify(withToc())
    });
    expect(tocEntry.anchor).toBe('s0:b0');
    expect(tocEntry.text).toBe('Our Mission\t5');
    expect(tocEntry.text).not.toContain('HYPERLINK');
  });

  it('anchored replace updates the ToC entry display text (field result)', async () => {
    const { editor, replaceCalls, searchResults } = makeEditor(withToc());
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b0', // the ToC entry (field) block
          find: 'Our Mission',
          replace: 'Our Purpose',
          expect: 'Our Mission\t5'
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, anchor: 's0:b0' });
    // The ToC entry's visible run is replaced (its match, start '0;0;...') and
    // the identical heading occurrence in s1 is NOT touched by this op.
    expect(replaceCalls).toEqual([{ start: '0;0;0', text: 'Our Purpose' }]);
    expect(searchResults.replaceAll).not.toHaveBeenCalled();
  });

  it('no longer fails stale_anchor on a ToC field block', async () => {
    const { editor } = makeEditor(withToc());
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b0',
          find: 'Our Mission',
          replace: 'Our Purpose',
          expect: 'Our Mission\t5'
        }
      ]
    });
    expect(res.results[0].ok).toBe(true);
    expect(res.results[0].error).toBeUndefined();
  });
});
