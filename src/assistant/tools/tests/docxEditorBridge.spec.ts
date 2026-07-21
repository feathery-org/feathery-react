import {
  createDocxEditorBridge,
  FULL_INVENTORY_BLOCK_LIMIT
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

// Stateful editor stub. `present` is the set of strings findAll() will "find".
const makeEditor = (doc: any, present: string[] = []) => {
  const captured: { tracking?: boolean } = {};
  const searchResults = {
    length: 0,
    replaceAll: jest.fn(function (this: any) {
      captured.tracking = editor.enableTrackChanges;
    })
  };
  const editor: any = {
    enableTrackChanges: false,
    serialize: () => JSON.stringify(doc),
    search: {
      findAll: jest.fn((q: string) => {
        searchResults.length = present.includes(q) ? 1 : 0;
      }),
      searchResults
    },
    revisions: { acceptAll: jest.fn() },
    editorHistory: { undo: jest.fn(), redo: jest.fn() }
  };
  return { editor, captured, searchResults };
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
  it('applies a replace_text op as a tracked change and restores tracking', async () => {
    const { editor, captured, searchResults } = makeEditor(SFDT, [
      'Quote: $5,500'
    ]);
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b1',
          find: 'Quote: $5,500',
          replace: 'Quote: $6,000',
          expect: 'Quote: $5,500'
        }
      ]
    });
    expect(res.results).toEqual([
      { anchor: 's0:b1', op: 'replace_text', ok: true }
    ]);
    expect(searchResults.replaceAll).toHaveBeenCalledWith('Quote: $6,000');
    // Ran with track-changes ON, restored to the prior value (false) after.
    expect(captured.tracking).toBe(true);
    expect(editor.enableTrackChanges).toBe(false);
  });

  it('fails a replace_text with a stale expect guard without writing', async () => {
    const { editor, searchResults } = makeEditor(SFDT, []); // expect not present
    const bridge = createDocxEditorBridge(() => editor);
    const res: any = await bridge.applyDocumentEdits!({
      edits: [
        {
          op: 'replace_text',
          anchor: 's0:b1',
          find: 'Quote: $5,500',
          replace: 'X',
          expect: 'Quote: $5,500'
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: 'stale_anchor' });
    expect(searchResults.replaceAll).not.toHaveBeenCalled();
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
