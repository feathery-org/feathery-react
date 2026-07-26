import 'jest-canvas-mock';
import {
  DocumentEditor,
  Editor,
  EditorHistory,
  ImageResizer,
  Search,
  Selection,
  SfdtExport
} from '@syncfusion/ej2-documenteditor';
import {
  flattenSfdt,
  buildInventoryFromBlocks,
  buildIndexBlocksFromBlocks,
  anchorFromOffset,
  findDocumentOccurrences,
  readSelection,
  applyDocumentEdits,
  FULL_INVENTORY_BLOCK_LIMIT,
  LiveEditor
} from '../syncfusionDocumentOps';

DocumentEditor.Inject(
  Editor,
  Selection,
  SfdtExport,
  EditorHistory,
  ImageResizer,
  Search
);

// SyncFusion uses browser crypto for generated revision ids; Jest's jsdom
// environment does not expose it on window by default.
if (!window.crypto?.getRandomValues) {
  Object.defineProperty(window, 'crypto', {
    value: { getRandomValues: (array: Uint8Array) => require('crypto').randomFillSync(array) }
  });
}

const jsdomGetComputedStyle = window.getComputedStyle.bind(window);
window.getComputedStyle = ((elt: Element) =>
  jsdomGetComputedStyle(elt)) as typeof window.getComputedStyle;

if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({
      x: 0,
      y: 0,
      width: 0,
      height: 0
    } as DOMRect);
}

// ---------------------------------------------------------------------------
// A faithful in-memory SyncFusion editor mock: paragraphs with linear character
// offsets, so replace/delete offset math and the CAS guard are exercised for
// real (not stubbed).
// ---------------------------------------------------------------------------

interface MockBlock {
  inlines: { text: string }[];
  characterFormat?: Record<string, any>;
  paragraphFormat?: Record<string, any>;
}

interface MockStyleDefinition {
  characterFormat?: Record<string, any>;
  paragraphFormat?: Record<string, any>;
}

function para(
  text: string,
  styleName?: string,
  formats: {
    characterFormat?: Record<string, any>;
    paragraphFormat?: Record<string, any>;
  } = {}
): MockBlock {
  return {
    inlines: [{ text }],
    characterFormat: { ...(formats.characterFormat ?? {}) },
    paragraphFormat: {
      ...(styleName ? { styleName } : {}),
      ...(formats.paragraphFormat ?? {})
    }
  };
}

class MockEditor implements LiveEditor {
  enableTrackChanges = false;
  doc: { sections: { blocks: MockBlock[] }[] };
  acceptAll = jest.fn();
  rejectAll = jest.fn();
  private sel = { si: 0, bi: 0, start: 0, end: 0 };
  selection: any;
  editor: any;
  revisions: any;
  editorHistory?: { undo: () => void; redo: () => void };

  constructor(
    blocks: MockBlock[],
    private styleDefinitions: Record<string, MockStyleDefinition> = {}
  ) {
    this.doc = { sections: [{ blocks }] };

    const syncSelection = () => {
      const { si, bi, start, end } = this.sel;
      const block = this.doc.sections[si].blocks[bi];
      block.characterFormat ??= {};
      block.paragraphFormat ??= {};
      this.selection.characterFormat = block.characterFormat;
      this.selection.paragraphFormat = block.paragraphFormat;
      this.selection.text = this.blockText(si, bi).slice(start, end);
      this.selection.startOffset = `${si};${bi};${start}`;
      this.selection.endOffset = `${si};${bi};${end}`;
    };

    this.selection = {
      text: '',
      startOffset: '0;0;0',
      endOffset: '0;0;0',
      characterFormat: {},
      paragraphFormat: {},
      select: (start: string, end: string) => {
        const [si, bi, off] = start.split(';').map(Number);
        const [, , offEnd] = end.split(';').map(Number);
        this.sel = { si, bi, start: off, end: offEnd };
        syncSelection();
      }
    };

    this.editor = {
      insertText: (t: string) => {
        const { si, bi, start, end } = this.sel;
        const text = this.blockText(si, bi);
        const next = text.slice(0, start) + t + text.slice(end);
        this.doc.sections[si].blocks[bi].inlines = [{ text: next }];
        this.sel = { si, bi, start: start + t.length, end: start + t.length };
        syncSelection();
      },
      delete: () => this.editor.insertText(''),
      applyStyle: jest.fn((styleName: string) => {
        const style = this.styleDefinitions[styleName];
        if (style?.characterFormat)
          Object.assign(this.selection.characterFormat, style.characterFormat);
        if (style?.paragraphFormat)
          Object.assign(this.selection.paragraphFormat, style.paragraphFormat);
        this.selection.paragraphFormat.styleName = styleName;
      })
    };

    this.revisions = {
      acceptAll: () => this.acceptAll(),
      rejectAll: () => this.rejectAll()
    };
  }

  serialize() {
    return JSON.stringify(this.doc);
  }

  private blockText(si: number, bi: number) {
    const b = this.doc.sections[si]?.blocks[bi];
    return (b?.inlines ?? []).map((i) => i.text ?? '').join('');
  }
}

function make(
  blocks: MockBlock[],
  styleDefinitions?: Record<string, MockStyleDefinition>
) {
  return new MockEditor(blocks, styleDefinitions);
}

function makeRealDocumentEditor(sfdt: any): DocumentEditor {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);

  const editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableImageResizer: true,
    enableSearch: true,
    enableSfdtExport: true,
    enableEditorHistory: true
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));

  return editor;
}

function destroyRealDocumentEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function realRevisions(editor: DocumentEditor): any[] {
  return Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );
}

function rejectEveryRealRevision(editor: DocumentEditor): void {
  // Snapshot first because each public Revision#reject removes its own card.
  for (const revision of realRevisions(editor)) revision.reject();
}

function selectRealBlock(editor: DocumentEditor, anchor: string, text: string) {
  editor.selection.select(`${anchor};0`, `${anchor};${text.length}`);
  return {
    text: editor.selection.text,
    characterFormat: editor.selection.characterFormat,
    paragraphFormat: editor.selection.paragraphFormat
  };
}

// ---------------------------------------------------------------------------

describe('flattenSfdt + inventory', () => {
  const sfdt = {
    sections: [
      {
        blocks: [
          para('Executive Summary', 'Heading 1'),
          para('This is the intro.'),
          para('Pricing', 'Heading 1'),
          para('Quote: $5,500'),
          para('Quote: $5,500 again'),
          para('Total: $5,500')
        ]
      }
    ]
  };

  it('flattens blocks with hierarchical anchors and heading detection', () => {
    const blocks = flattenSfdt(sfdt);
    expect(blocks).toHaveLength(6);
    expect(blocks[0]).toMatchObject({
      anchor: '0;0',
      kind: 'heading',
      level: 1,
      isHeading: true
    });
    expect(blocks[1]).toMatchObject({ anchor: '0;1', kind: 'paragraph' });
    expect(blocks[3].text).toBe('Quote: $5,500');
  });

  it('outline returns heading sections with blockCount', () => {
    const blocks = flattenSfdt(sfdt);
    const res = buildInventoryFromBlocks(blocks, { scope: 'outline' }) as any;
    expect(res.sections).toHaveLength(2);
    expect(res.sections[0]).toMatchObject({
      anchor: '0;0',
      heading: 'Executive Summary',
      level: 1,
      blockCount: 1
    });
    expect(res.sections[1]).toMatchObject({
      anchor: '0;2',
      heading: 'Pricing',
      blockCount: 3
    });
  });

  it('section scope returns the heading and its blocks only', () => {
    const blocks = flattenSfdt(sfdt);
    const res = buildInventoryFromBlocks(blocks, {
      scope: 'section',
      sectionAnchor: '0;2'
    }) as any;
    expect(res.inventory.map((e: any) => e.anchor)).toEqual([
      '0;2',
      '0;3',
      '0;4',
      '0;5'
    ]);
  });

  it('section scope reports missing / unknown anchors', () => {
    const blocks = flattenSfdt(sfdt);
    expect(
      (buildInventoryFromBlocks(blocks, { scope: 'section' }) as any).error
    ).toBe('missing_section_anchor');
    expect(
      (
        buildInventoryFromBlocks(blocks, {
          scope: 'section',
          sectionAnchor: '9;9'
        }) as any
      ).error
    ).toBe('section_not_found');
  });

  it('full scope guards documents over the block limit', () => {
    const many = Array.from(
      { length: FULL_INVENTORY_BLOCK_LIMIT + 1 },
      (_, i) => para(`p${i}`)
    );
    const blocks = flattenSfdt({ sections: [{ blocks: many }] });
    const res = buildInventoryFromBlocks(blocks, { scope: 'full' }) as any;
    expect(res.error).toBe('document_too_large');
  });

  it('handles OPTIMIZED SFDT keys (sec/b/i/tlp/pf.stn/cf) from the live editor', () => {
    // The live SyncFusion editor serializes optimized SFDT (verified in-browser):
    // sections->sec, blocks->b, inlines->i, text->tlp, paragraph style->pf.stn,
    // characterFormat->cf (bold->b, fontSize->fsz), alignment->pf.ta.
    const optimized = {
      optimizeSfdt: true,
      sec: [
        {
          b: [
            { pf: { stn: 'Heading 1' }, i: [{ cf: {}, tlp: 'Pricing' }] },
            {
              pf: {
                ta: 1,
                lin: 18,
                rin: 6,
                fin: -4,
                bs: 3,
                as: 9,
                ls: 1.15,
                lst: 'Multiple'
              },
              i: [{ cf: { b: true, fsz: 12 }, tlp: 'Quote: $5,500' }]
            }
          ]
        }
      ]
    };
    const blocks = flattenSfdt(optimized);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      anchor: '0;0',
      kind: 'heading',
      level: 1,
      text: 'Pricing'
    });
    expect(blocks[1]).toMatchObject({ anchor: '0;1', text: 'Quote: $5,500' });
    expect(blocks[1].format).toMatchObject({
      alignment: 'Center',
      bold: true,
      fontSize: 12,
      leftIndent: 18,
      rightIndent: 6,
      firstLineIndent: -4,
      beforeSpacing: 3,
      afterSpacing: 9,
      lineSpacing: 1.15,
      lineSpacingType: 'Multiple'
    });
    const outline = buildInventoryFromBlocks(blocks, {
      scope: 'outline'
    }) as any;
    expect(outline.sections[0]).toMatchObject({ heading: 'Pricing', level: 1 });
  });

  it('detects heading from a linked character style ("Heading 1 Char")', () => {
    const blocks = flattenSfdt({
      sec: [
        {
          b: [{ pf: {}, i: [{ cf: { stn: 'Heading 2 Char' }, tlp: 'Terms' }] }]
        }
      ]
    });
    expect(blocks[0]).toMatchObject({
      kind: 'heading',
      level: 2,
      text: 'Terms'
    });
  });

  it('index blocks skip empty paragraphs and keep text', () => {
    const blocks = flattenSfdt({
      sections: [{ blocks: [para('hello'), para('   '), para('world')] }]
    });
    const idx = buildIndexBlocksFromBlocks(blocks);
    expect(idx.map((b) => b.text)).toEqual(['hello', 'world']);
  });

  it('never emits an invalid block from a real doc (image-only paragraph, empty cell)', () => {
    // A real doc SFDT: a normal paragraph, an image-only paragraph (inlines with
    // no text), and a table whose first cell is empty and second holds text.
    const realDoc = {
      sections: [
        {
          blocks: [
            para('Coverage summary'),
            { inlines: [{ imageString: 'data:image/png;base64,AAAA' }] },
            {
              rows: [
                {
                  cells: [
                    { blocks: [{ inlines: [] }] }, // empty cell
                    { blocks: [para('General Liability')] }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
    const blocks = flattenSfdt(realDoc);
    const idx = buildIndexBlocksFromBlocks(blocks);

    // Every emitted block must satisfy the index contract {anchor:min(1), text:string}.
    expect(idx.length).toBeGreaterThan(0);
    for (const b of idx) {
      expect(typeof b.anchor).toBe('string');
      expect(b.anchor.trim().length).toBeGreaterThan(0);
      expect(typeof b.text).toBe('string');
      expect(b.text.trim().length).toBeGreaterThan(0);
    }
    // Only the two text-bearing blocks survive; image + empty cell are dropped.
    expect(idx.map((b) => b.text)).toEqual([
      'Coverage summary',
      'General Liability'
    ]);
  });

  it('drops empty-anchor blocks and coerces non-string text (defensive)', () => {
    // Belt-and-suspenders: even a malformed FlatBlock stream never yields a block
    // that would fail the index endpoint's {anchor:min(1), text:string} schema.
    const malformed = [
      { anchor: '', kind: 'paragraph', text: 'orphan text' },
      { anchor: '   ', kind: 'paragraph', text: 'whitespace anchor' },
      { anchor: '0;0', kind: 'paragraph', text: undefined },
      { anchor: '0;1', kind: 'paragraph', text: 42 },
      { anchor: '0;2', kind: 'paragraph', text: 'keep me' }
    ] as any[];
    const idx = buildIndexBlocksFromBlocks(malformed);
    for (const b of idx) {
      expect(b.anchor.trim().length).toBeGreaterThan(0);
      expect(typeof b.text).toBe('string');
    }
    expect(idx).toEqual([
      { anchor: '0;2', kind: 'paragraph', text: 'keep me' }
    ]);
  });
});

describe('anchorFromOffset + readSelection', () => {
  it('strips the trailing offset', () => {
    expect(anchorFromOffset('0;3;5')).toBe('0;3');
    expect(anchorFromOffset('0;2;0;1;0;4')).toBe('0;2;0;1;0');
  });

  it('reads selection anchor, clamps text to 500 chars, reports collapse', () => {
    const long = 'x'.repeat(900);
    const ed = {
      selection: {
        startOffset: '0;1;3',
        endOffset: '0;1;3',
        text: long
      }
    } as any;
    const sel = readSelection(ed);
    expect(sel).toEqual({
      anchor: '0;1',
      text: 'x'.repeat(500),
      isCollapsed: true
    });
  });
});

describe('applyDocumentEdits', () => {
  it('forces track-changes on for the batch then restores it', () => {
    const ed = make([para('Quote: $5,500')]);
    ed.enableTrackChanges = false;
    const seen: boolean[] = [];
    const origInsert = ed.editor.insertText;
    ed.editor.insertText = (t: string) => {
      seen.push(ed.enableTrackChanges);
      origInsert(t);
    };
    applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' }
      ]
    });
    expect(seen).toEqual([true]); // track-changes was ON during the write
    expect(ed.enableTrackChanges).toBe(false); // restored afterwards
  });

  it('replaces text at an anchor and reports ok', () => {
    const ed = make([para('Quote: $5,500')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' }
      ]
    });
    expect(res.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      anchor: '0;0'
    });
    expect(ed.doc.sections[0].blocks[0].inlines[0].text).toBe('Quote: $6,000');
  });

  it('enumerate-and-apply: 3 anchored quote replacements (acceptance test 1)', () => {
    const ed = make([
      para('Quote: $5,500'),
      para('Quote: $5,500'),
      para('Quote: $5,500'),
      para('Total: $5,500')
    ]);
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' },
        { op: 'replace_text', anchor: '0;1', find: '5,500', replace: '6,000' },
        { op: 'replace_text', anchor: '0;2', find: '5,500', replace: '6,000' }
      ]
    });
    expect(res.results.every((r) => r.ok)).toBe(true);
    expect(ed.doc.sections[0].blocks.map((b) => b.inlines[0].text)).toEqual([
      'Quote: $6,000',
      'Quote: $6,000',
      'Quote: $6,000',
      'Total: $5,500' // suspected-derived total left untouched
    ]);
  });

  it('expect CAS guard: stale text fails with stale_anchor and writes nothing', () => {
    const ed = make([para('Quote: $5,500')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: '5,500',
          replace: '6,000',
          expect: 'Quote: $9,999' // no longer matches the live text
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: 'stale_anchor' });
    expect(ed.doc.sections[0].blocks[0].inlines[0].text).toBe('Quote: $5,500');
  });

  it('reports anchor_not_found and text_not_found', () => {
    const ed = make([para('Quote: $5,500')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '9;9', find: 'x', replace: 'y' },
        { op: 'replace_text', anchor: '0;0', find: 'NOPE', replace: 'y' }
      ]
    });
    expect(res.results[0].error).toBe('anchor_not_found');
    expect(res.results[1].error).toBe('text_not_found');
  });

  it('handles anchorless ops (track changes toggle, accept revisions)', () => {
    const ed = make([para('hello')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'set_track_changes', enabled: true },
        { op: 'accept_all_revisions' }
      ]
    });
    expect(res.results.every((r) => r.ok)).toBe(true);
    expect(ed.acceptAll).toHaveBeenCalled();
  });

  it('rejects assistant global undo/redo before writing or touching unrelated history', () => {
    for (const historyOp of ['undo', 'redo'] as const) {
      const ed = make([
        para('User work that predates the assistant'),
        para('Assistant repair target')
      ]);
      const history = { undo: jest.fn(), redo: jest.fn() };
      ed.editorHistory = history;
      const before = ed.serialize();

      const res = applyDocumentEdits(ed, {
        changeSetId: `unsafe-${historyOp}`,
        edits: [
          { op: historyOp },
          {
            op: 'replace_text',
            anchor: '0;1',
            find: 'repair',
            replace: 'replacement'
          }
        ]
      });

      expect(res.results[0]).toMatchObject({
        ok: false,
        op: historyOp,
        error: 'unsafe_global_history_op'
      });
      expect(res.results[0].details?.[0]).toContain(
        'future scoped changeSet-specific inverse'
      );
      expect(res.results[1]).toMatchObject({
        ok: false,
        error: 'change_set_preflight_failed'
      });
      expect(history.undo).not.toHaveBeenCalled();
      expect(history.redo).not.toHaveBeenCalled();
      expect(ed.serialize()).toBe(before);
    }
  });

  it('deletes text at an anchor', () => {
    const ed = make([para('remove THIS please')]);
    applyDocumentEdits(ed, {
      edits: [{ op: 'delete_text', anchor: '0;0', find: ' THIS' }]
    });
    expect(ed.doc.sections[0].blocks[0].inlines[0].text).toBe('remove please');
  });

  it('supports explicit after insertion and returns a post-edit inventory', () => {
    const ed = make([para('Existing peer')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'insert_text',
          anchor: '0;0',
          position: 'after',
          text: 'Inserted subsection'
        }
      ]
    });

    expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
    expect(ed.doc.sections[0].blocks[0].inlines[0].text).toBe(
      'Existing peer\nInserted subsection'
    );
    expect(res.inventory?.[0]).toMatchObject({
      anchor: '0;0',
      text: 'Existing peer\nInserted subsection'
    });
  });

  it('keeps insert_text structural-only when formatting fields are present', () => {
    const ed = make([
      para('Existing peer', 'Normal', {
        characterFormat: { fontFamily: 'Aptos', fontSize: 10.5 },
        paragraphFormat: { beforeSpacing: 2, afterSpacing: 4 }
      })
    ]);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'insert_text',
          anchor: '0;0',
          position: 'after',
          text: 'Inserted subsection',
          inheritFormatFrom: '0;0',
          styleName: 'Heading 2',
          fontName: 'Courier New',
          fontSize: 20,
          beforeSpacing: 24,
          afterSpacing: 24
        }
      ]
    });

    expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
    expect(ed.editor.applyStyle).not.toHaveBeenCalled();
    expect(ed.doc.sections[0].blocks[0].characterFormat).toMatchObject({
      fontFamily: 'Aptos',
      fontSize: 10.5
    });
    expect(ed.doc.sections[0].blocks[0].paragraphFormat).toMatchObject({
      styleName: 'Normal',
      beforeSpacing: 2,
      afterSpacing: 4
    });
    expect(res.inventory?.[0]).toMatchObject({
      text: 'Existing peer\nInserted subsection',
      format: {
        styleName: 'Normal',
        fontName: 'Aptos',
        fontSize: 10.5,
        beforeSpacing: 2,
        afterSpacing: 4
      }
    });
  });
});

describe('live occurrence search and scoped replacement', () => {
  it('real SDK: includes public header/footer stories rather than silently omitting them', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          headersFooters: {
            header: { blocks: [{ inlines: [{ text: 'Marlow in header' }] }] },
            footer: { blocks: [{ inlines: [{ text: 'Marlow in footer' }] }] }
          },
          blocks: [{ inlines: [{ text: 'Marlow in body' }] }]
        }
      ]
    });

    try {
      const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: 'marlow',
        matchCase: false,
        maxResults: 20
      });
      expect(found).toMatchObject({ ok: true, count: 3 });
      expect(found.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'header', matchText: 'Marlow' }),
          expect.objectContaining({ kind: 'footer', matchText: 'Marlow' }),
          expect.objectContaining({ kind: 'paragraph', matchText: 'Marlow' })
        ])
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: finds and replaces case variants across body and table cells without concatenation', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Marlow on the first page' }] },
            {
              tableFormat: {},
              rows: [
                {
                  rowFormat: {},
                  cells: [
                    {
                      cellFormat: {},
                      blocks: [{ inlines: [{ text: 'Marlow Fenwick' }] }]
                    },
                    {
                      cellFormat: {},
                      blocks: [
                        {
                          inlines: [
                            { text: 'Email: marlow.fenwick@example.com' }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ]
            },
            { inlines: [{ text: 'Marlow in the body' }] }
          ]
        }
      ]
    });

    try {
      const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: 'marlow',
        matchCase: false,
        wholeWord: false,
        maxResults: 20
      });
      expect(found).toMatchObject({
        ok: true,
        source: 'live_syncfusion',
        count: 4,
        truncated: false
      });
      expect(found.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            anchor: '0;0',
            kind: 'paragraph',
            matchText: 'Marlow',
            start: 0,
            end: 6
          }),
          expect.objectContaining({
            anchor: '0;1;0;0;0',
            kind: 'table_cell',
            matchText: 'Marlow',
            start: 0,
            end: 6
          }),
          expect.objectContaining({
            anchor: '0;1;0;1;0',
            kind: 'table_cell',
            matchText: 'marlow'
          }),
          expect.objectContaining({
            anchor: '0;2',
            kind: 'paragraph',
            matchText: 'Marlow'
          })
        ])
      );
      const batched = findDocumentOccurrences(ed as unknown as LiveEditor, {
        queries: [
          { text: 'marlow', matchCase: false, wholeWord: false },
          { text: 'fenwick', matchCase: false, wholeWord: true }
        ],
        maxResults: 20
      });
      expect(batched).toMatchObject({
        ok: true,
        source: 'live_syncfusion',
        truncated: false,
        storyCoverage: {
          body: true,
          tables: true,
          headersFooters: false,
          footnotesEndnotes: true,
          textFrames: true
        },
        searchStoryCoverage: {
          body: true,
          tables: true,
          headersFooters: true,
          footnotesEndnotes: true,
          textFrames: true
        }
      });
      expect(batched.results).toEqual([
        expect.objectContaining({
          query: { text: 'marlow', matchCase: false, wholeWord: false },
          count: 4
        }),
        expect.objectContaining({
          query: { text: 'fenwick', matchCase: false, wholeWord: true },
          count: 2
        })
      ]);

      ed.enableTrackChanges = true;
      const edited = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'replace-live-name-variants',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            expect: 'Marlow on the first page',
            find: 'Marlow',
            replace: 'Torrey'
          },
          {
            op: 'replace_text',
            anchor: '0;1;0;0;0',
            expect: 'Marlow Fenwick',
            find: 'Marlow',
            replace: 'Torrey'
          },
          {
            op: 'replace_text',
            anchor: '0;1;0;1;0',
            expect: 'Email: marlow.fenwick@example.com',
            find: 'marlow',
            replace: 'torrey'
          },
          {
            op: 'replace_text',
            anchor: '0;2',
            expect: 'Marlow in the body',
            find: 'Marlow',
            replace: 'Torrey'
          }
        ]
      });
      expect(edited.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ ok: true, anchor: '0;0' }),
          expect.objectContaining({ ok: true, anchor: '0;1;0;0;0' }),
          expect.objectContaining({ ok: true, anchor: '0;1;0;1;0' }),
          expect.objectContaining({ ok: true, anchor: '0;2' })
        ])
      );
      expect(ed.enableTrackChanges).toBe(true);

      const old = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: 'marlow',
        matchCase: false,
        maxResults: 20
      });
      expect(old).toMatchObject({ ok: true, count: 0 });
      const replacement = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: 'torrey',
        matchCase: false,
        maxResults: 20
      });
      expect(replacement).toMatchObject({ ok: true, count: 4 });

      const inventory = buildInventoryFromBlocks(
        flattenSfdt(JSON.parse(ed.serialize())),
        { scope: 'full' }
      ) as any;
      expect(inventory.inventory.map((entry: any) => entry.text)).toEqual(
        expect.arrayContaining([
          'Torrey on the first page',
          'Torrey Fenwick',
          'Email: torrey.fenwick@example.com',
          'Torrey in the body'
        ])
      );
      expect(JSON.stringify(inventory)).not.toContain('Torrey FenwickTorrey');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: replaces a text-frame occurrence with body and table occurrences through their live search ranges', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Body neighbour before' }] },
            {
              inlines: [
                { text: 'Marlow in body', characterFormat: { bidi: false } }
              ]
            },
            {
              tableFormat: {},
              rows: [
                {
                  rowFormat: {},
                  cells: [
                    {
                      cellFormat: {},
                      blocks: [
                        {
                          inlines: [{ text: 'Email: marlow@example.com' }]
                        }
                      ]
                    },
                    {
                      cellFormat: {},
                      blocks: [{ inlines: [{ text: 'Engineer' }] }]
                    }
                  ]
                }
              ]
            },
            {
              inlines: [
                {
                  shapeId: 'robin-story-frame',
                  name: 'Robin story frame',
                  visible: true,
                  width: 120,
                  height: 40,
                  widthScale: 100,
                  heightScale: 100,
                  verticalPosition: 0,
                  verticalOrigin: 'Page',
                  verticalAlignment: 'None',
                  verticalRelativePercent: 0,
                  horizontalPosition: 0,
                  horizontalOrigin: 'Page',
                  horizontalAlignment: 'None',
                  horizontalRelativePercent: 0,
                  zOrderPosition: 0,
                  allowOverlap: true,
                  textWrappingStyle: 'Square',
                  textWrappingType: 'Both',
                  isBelowText: false,
                  layoutInCell: false,
                  lockAnchor: false,
                  autoShapeType: 'Rectangle',
                  fillFormat: { color: '#FFFFFF', fill: true },
                  lineFormat: {
                    line: true,
                    lineFormatType: 'Solid',
                    color: '#000000',
                    weight: 1,
                    lineStyle: 'Single'
                  },
                  textFrame: {
                    textVerticalAlignment: 'Top',
                    leftMargin: 0,
                    rightMargin: 0,
                    topMargin: 0,
                    bottomMargin: 0,
                    blocks: [
                      {
                        inlines: [
                          {
                            text: 'Marlow in text frame',
                            characterFormat: { bidi: false }
                          }
                        ]
                      }
                    ]
                  }
                }
              ]
            },
            { inlines: [{ text: 'Body neighbour after' }] }
          ]
        }
      ]
    });

    try {
      ed.enableTrackChanges = true;
      const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: 'marlow',
        matchCase: false,
        maxResults: 20
      });
      expect(found).toMatchObject({ ok: true, count: 3 });
      expect(found.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'paragraph', matchText: 'Marlow' }),
          expect.objectContaining({ kind: 'table_cell', matchText: 'marlow' }),
          expect.objectContaining({ kind: 'text_frame', matchText: 'Marlow' })
        ])
      );
      const frame = found.occurrences.find(
        (occurrence) => occurrence.kind === 'text_frame'
      );
      expect(frame?.anchor).toContain(';S;');
      expect(
        flattenSfdt(JSON.parse(ed.serialize())).some((block) =>
          block.anchor.includes(';S;')
        )
      ).toBe(false);
      const serializedBefore = ed.serialize();

      const edited = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'text-frame-live-range',
        edits: found.occurrences.map((occurrence) => ({
          op: 'replace_text',
          anchor: occurrence.anchor,
          start: occurrence.start,
          end: occurrence.end,
          expect: occurrence.blockText,
          find: occurrence.matchText,
          replace:
            occurrence.matchText === occurrence.matchText.toLowerCase()
              ? 'torrey'
              : 'Torrey'
        }))
      });
      expect(edited.changeSet).toMatchObject({ status: 'applied' });
      expect(edited.results.every((result) => result.ok)).toBe(true);
      expect(ed.enableTrackChanges).toBe(true);
      expect(realRevisions(ed)).toHaveLength(6);
      expect(
        realRevisions(ed)
          .map((revision) => revision.revisionType)
          .sort()
      ).toEqual([
        'Deletion',
        'Deletion',
        'Deletion',
        'Insertion',
        'Insertion',
        'Insertion'
      ]);
      expect(
        realRevisions(ed).every(
          (revision) =>
            typeof revision.accept === 'function' &&
            typeof revision.reject === 'function'
        )
      ).toBe(true);

      expect(
        flattenSfdt(JSON.parse(ed.serialize())).map((block) => block.text)
      ).toEqual([
        'Body neighbour before',
        'Torrey in body',
        'Email: torrey@example.com',
        'Engineer',
        '',
        'Body neighbour after'
      ]);

      expect(
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'marlow',
          matchCase: false,
          maxResults: 20
        })
      ).toMatchObject({ ok: true, count: 0 });
      expect(
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'torrey',
          matchCase: false,
          maxResults: 20
        })
      ).toMatchObject({ ok: true, count: 3 });
      // Pending deletions are adjacent to the inserted runs in SyncFusion's
      // raw search stream. Whole-word discovery must instead use current text
      // boundaries, so verification sees the same three replacements.
      expect(
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'marlow',
          matchCase: false,
          wholeWord: true,
          maxResults: 20
        })
      ).toMatchObject({ ok: true, count: 0 });
      expect(
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'torrey',
          matchCase: false,
          wholeWord: true,
          maxResults: 20
        })
      ).toMatchObject({
        ok: true,
        count: 3,
        occurrences: expect.arrayContaining([
          expect.objectContaining({ kind: 'paragraph', matchText: 'Torrey' }),
          expect.objectContaining({ kind: 'table_cell', matchText: 'torrey' }),
          expect.objectContaining({ kind: 'text_frame', matchText: 'Torrey' })
        ])
      });

      // The exact native cards are public and individually rejectable. The
      // bridge groups them, so rejecting every card restores the pre-write SFDT
      // without using global rejectAll or document history.
      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(serializedBefore);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: reports header/footer write coverage without voiding an independent body edit', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          headersFooters: {
            header: { blocks: [{ inlines: [{ text: 'Marlow header' }] }] },
            footer: {
              blocks: [{ inlines: [{ text: 'Email: marlow@footer.test' }] }]
            }
          },
          blocks: [{ inlines: [{ text: 'Marlow body' }] }]
        }
      ]
    });

    try {
      ed.enableTrackChanges = true;
      const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: 'marlow',
        matchCase: false,
        maxResults: 20
      });
      expect(found).toMatchObject({ ok: true, count: 3 });
      expect(found.storyCoverage.headersFooters).toBe(false);
      expect(found.searchStoryCoverage.headersFooters).toBe(true);
      expect(found.occurrences).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'header',
            anchor: expect.stringContaining(';H;')
          }),
          expect.objectContaining({
            kind: 'footer',
            anchor: expect.stringContaining(';F;')
          })
        ])
      );

      const edited = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'header-footer-live-range',
        edits: found.occurrences.map((occurrence) => ({
          op: 'replace_text',
          anchor: occurrence.anchor,
          start: occurrence.start,
          end: occurrence.end,
          expect: occurrence.blockText,
          find: occurrence.matchText,
          replace:
            occurrence.matchText === occurrence.matchText.toLowerCase()
              ? 'torrey'
              : 'Torrey'
        }))
      });
      expect(edited.changeSet).toMatchObject({ status: 'failed' });
      expect(edited.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            anchor: expect.stringContaining(';H;'),
            ok: false,
            error: 'story_write_unverified'
          }),
          expect.objectContaining({
            anchor: expect.stringContaining(';F;'),
            ok: false,
            error: 'story_write_unverified'
          }),
          expect.objectContaining({
            anchor: '0;0',
            ok: false,
            error: 'change_set_failed'
          })
        ])
      );
      expect(ed.enableTrackChanges).toBe(true);
      expect(realRevisions(ed)).toHaveLength(2);
      expect(
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'marlow',
          matchCase: false,
          maxResults: 20
        })
      ).toMatchObject({ ok: true, count: 2 });
      expect(
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'torrey',
          matchCase: false,
          maxResults: 20
        })
      ).toMatchObject({ ok: true, count: 1 });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: stale story range fails preflight by anchor and performs no sibling writes', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [{ inlines: [{ text: 'Marlow body' }] }]
        }
      ]
    });

    try {
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'stale-story-preflight',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            expect: 'Marlow body',
            find: 'Marlow',
            replace: 'Torrey'
          },
          {
            op: 'replace_text',
            anchor: '0;0;S;1;0',
            start: 0,
            end: 6,
            expect: 'Marlow',
            find: 'Marlow',
            replace: 'Torrey'
          }
        ]
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(result.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ok: false,
            error: 'change_set_preflight_failed'
          }),
          expect.objectContaining({
            anchor: '0;0;S;1;0',
            ok: false,
            error: 'stale_anchor'
          })
        ])
      );
      expect(ed.serialize()).toBe(before);
      expect(ed.revisions.length).toBe(0);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a failed post-write read rolls back tracked text and never reports success', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            {
              inlines: [
                { text: 'Marlow body', characterFormat: { bidi: false } }
              ]
            }
          ]
        }
      ]
    });

    try {
      const before = ed.serialize();
      let serializeCalls = 0;
      const faultyReadEditor = new Proxy(ed as unknown as LiveEditor, {
        get(target, property, receiver) {
          if (property === 'serialize') {
            return () => {
              serializeCalls++;
              // The second read is the immediate post-write verification. It
              // intentionally returns the pre-write SFDT while every mutation
              // remains a real DocumentEditor operation.
              if (serializeCalls === 2) return before;
              return target.serialize();
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const result = applyDocumentEdits(faultyReadEditor, {
        changeSetId: 'failed-post-write-read',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            expect: 'Marlow body',
            find: 'Marlow',
            replace: 'Torrey'
          }
        ]
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'text_verification_failed'
      });
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe('styling ops (no silent success)', () => {
  it('real SDK: inherit-only apply_style restores the source direct override after its 20 pt named style', () => {
    const sfdt = {
      sections: [
        {
          blocks: [
            {
              // Like the persisted Robin thread, the inventory/SFDT only names
              // the paragraph style. The visible direct override is supplied by
              // the live SyncFusion selection below and must not be lost when
              // the named style is reapplied at the target.
              paragraphFormat: { styleName: 'noTOCheading2' },
              inlines: [{ text: 'Neighbor heading' }]
            },
            {
              paragraphFormat: { beforeSpacing: 0, afterSpacing: 18 },
              inlines: [{ text: '' }]
            },
            {
              paragraphFormat: { styleName: 'noTOCheading2' },
              inlines: [{ text: 'Inserted heading' }]
            }
          ]
        }
      ],
      styles: [
        {
          type: 'Paragraph',
          name: 'noTOCheading2',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: {
            bold: true,
            fontFamily: 'Aptos Display',
            fontSize: 20,
            fontColor: '#1f4e79'
          },
          paragraphFormat: {
            textAlignment: 'Left',
            leftIndent: 0,
            rightIndent: 6,
            beforeSpacing: 0,
            afterSpacing: 0,
            lineSpacing: 1,
            lineSpacingType: 'Multiple'
          }
        }
      ]
    };
    const ed = makeRealDocumentEditor(sfdt);

    try {
      const beforeInventory = buildInventoryFromBlocks(
        flattenSfdt(JSON.parse(ed.serialize())),
        { scope: 'full' }
      ) as any;
      expect(beforeInventory.inventory[0].format).toEqual({
        styleName: 'noTOCheading2'
      });

      const source = selectRealBlock(ed, '0;0', 'Neighbor heading');
      // Direct/effective source formatting is deliberately applied through the
      // actual SDK after the SFDT-only inventory assertion above.
      source.characterFormat.fontSize = 11;
      source.paragraphFormat.textAlignment = 'Center';
      source.paragraphFormat.leftIndent = 18;
      source.paragraphFormat.rightIndent = 6;
      source.paragraphFormat.firstLineIndent = -4;
      source.paragraphFormat.beforeSpacing = 6;
      source.paragraphFormat.afterSpacing = 12;
      source.paragraphFormat.lineSpacing = 1.08;

      const beforeReference = selectRealBlock(ed, '0;0', 'Neighbor heading');
      expect(beforeReference.characterFormat.fontSize).toBe(11);
      expect(beforeReference.paragraphFormat.afterSpacing).toBe(12);

      const beforeTarget = selectRealBlock(ed, '0;2', 'Inserted heading');
      expect(beforeTarget.characterFormat.fontSize).toBe(20);

      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'apply_style',
            anchor: '0;2',
            inheritFormatFrom: '0;0'
          }
        ]
      });

      expect(res.results[0]).toMatchObject({ ok: true, op: 'apply_style' });

      const afterReference = selectRealBlock(ed, '0;0', 'Neighbor heading');
      const afterTarget = selectRealBlock(ed, '0;2', 'Inserted heading');
      expect(afterTarget.characterFormat.fontSize).toBe(
        afterReference.characterFormat.fontSize
      );
      expect(afterTarget.characterFormat.fontFamily).toBe(
        afterReference.characterFormat.fontFamily
      );
      expect(afterTarget.characterFormat.bold).toBe(
        afterReference.characterFormat.bold
      );
      expect(afterTarget.paragraphFormat.beforeSpacing).toBe(
        afterReference.paragraphFormat.beforeSpacing
      );
      expect(afterTarget.paragraphFormat.afterSpacing).toBe(
        afterReference.paragraphFormat.afterSpacing
      );
      expect(afterTarget.paragraphFormat.leftIndent).toBe(
        afterReference.paragraphFormat.leftIndent
      );
      expect(afterTarget.paragraphFormat.rightIndent).toBe(
        afterReference.paragraphFormat.rightIndent
      );
      expect(afterTarget.paragraphFormat.firstLineIndent).toBe(
        afterReference.paragraphFormat.firstLineIndent
      );
      expect(afterTarget.paragraphFormat.lineSpacing).toBe(
        afterReference.paragraphFormat.lineSpacing
      );

      const serialized = JSON.parse(ed.serialize());
      expect(
        flattenSfdt(serialized).find((b) => b.anchor === '0;1')
      ).toMatchObject({
        text: '',
        format: {
          beforeSpacing: 0,
          afterSpacing: 18
        }
      });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: reports a scoped mismatch when an inherited resolved format cannot be applied', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            {
              paragraphFormat: { styleName: 'noTOCheading2' },
              inlines: [{ text: 'Source' }]
            },
            {
              paragraphFormat: { styleName: 'noTOCheading2' },
              inlines: [{ text: 'Target' }]
            },
            {
              paragraphFormat: { styleName: 'noTOCheading2' },
              inlines: [{ text: 'Other target' }]
            }
          ]
        }
      ],
      styles: [
        {
          type: 'Paragraph',
          name: 'noTOCheading2',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 20 },
          paragraphFormat: { afterSpacing: 0 }
        }
      ]
    });

    try {
      selectRealBlock(ed, '0;0', 'Source').characterFormat.fontSize = 11;
      // This is a narrowly-scoped fault injector over a real DocumentEditor,
      // not a document/editor mock: only the target's fontSize setter refuses
      // the direct override so the production verification path is exercised.
      const selection = new Proxy(ed.selection as any, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (
            prop === 'characterFormat' &&
            String(target.startOffset).startsWith('0;1;')
          ) {
            return new Proxy(value, {
              set(format, key, next, proxy) {
                if (key === 'fontSize') return true;
                return Reflect.set(format, key, next, proxy);
              }
            });
          }
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const editor = Object.create(ed) as LiveEditor;
      Object.defineProperty(editor, 'selection', { value: selection });

      const res = applyDocumentEdits(editor, {
        changeSetId: 'fault-injected-format-change-set',
        edits: [
          { op: 'apply_style', anchor: '0;2', inheritFormatFrom: '0;0' },
          { op: 'apply_style', anchor: '0;1', inheritFormatFrom: '0;0' }
        ]
      });

      // The unaffected location is physically written, but the response never
      // reports a partial logical success; both writes are one rejectable group.
      expect(res.results[0]).toMatchObject({
        ok: false,
        error: 'change_set_failed'
      });
      expect(res.results[1]).toMatchObject({
        ok: false,
        error: 'inherited_format_mismatch'
      });
      expect(res.changeSet).toMatchObject({
        id: 'fault-injected-format-change-set',
        status: 'failed'
      });
      expect(res.results[1].details).toContain(
        'characterFormat.fontSize: expected 11, got 20'
      );
      // Inspect real editor state, not merely the response: the first location
      // was initially formatted then compensated after its sibling failed.
      expect(
        selectRealBlock(ed, '0;2', 'Other target').characterFormat.fontSize
      ).toBe(20);
      expect(
        selectRealBlock(ed, '0;1', 'Target').characterFormat.fontSize
      ).toBe(20);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: change set re-resolves two shifted inserted paragraphs against their own distant neighbors', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            {
              paragraphFormat: { styleName: 'HeadingA' },
              inlines: [{ text: 'Source A' }]
            },
            { inlines: [{ text: 'Existing A' }] },
            { inlines: [{ text: 'Unrelated middle paragraph' }] },
            {
              paragraphFormat: { styleName: 'HeadingB' },
              inlines: [{ text: 'Source B' }]
            },
            { inlines: [{ text: 'Existing B' }] }
          ]
        }
      ],
      styles: [
        {
          type: 'Paragraph',
          name: 'HeadingA',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 20 },
          paragraphFormat: { afterSpacing: 0 }
        },
        {
          type: 'Paragraph',
          name: 'HeadingB',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 20 },
          paragraphFormat: { afterSpacing: 0 }
        }
      ]
    });
    try {
      const sourceA = selectRealBlock(ed, '0;0', 'Source A');
      sourceA.characterFormat.fontSize = 11;
      sourceA.paragraphFormat.beforeSpacing = 4;
      sourceA.paragraphFormat.afterSpacing = 8;
      const sourceB = selectRealBlock(ed, '0;3', 'Source B');
      sourceB.characterFormat.fontSize = 13;
      sourceB.paragraphFormat.beforeSpacing = 10;
      sourceB.paragraphFormat.afterSpacing = 16;
      expect(
        selectRealBlock(ed, '0;3', 'Source B').characterFormat.fontSize
      ).toBe(13);

      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'two-distant-inserts',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;0',
            position: 'after',
            text: 'Inserted A'
          },
          // Source B's original 0;3 anchor shifts after the first insertion.
          {
            op: 'insert_text',
            anchor: '0;3',
            position: 'after',
            text: 'Inserted B'
          },
          {
            op: 'apply_style',
            anchor: '0;1',
            expect: 'Inserted A',
            inheritFormatFrom: '0;0'
          },
          {
            op: 'apply_style',
            anchor: '0;4',
            expect: 'Inserted B',
            inheritFormatFrom: '0;3'
          }
        ]
      });

      expect(res.results.every((result) => result.ok)).toBe(true);
      expect(res.changeSet).toMatchObject({
        id: 'two-distant-inserts',
        status: 'applied'
      });
      expect(
        res.inventory?.map((entry) => [
          entry.anchor,
          entry.text,
          entry.format?.fontSize
        ])
      ).toEqual([
        ['0;0', 'Source A', 11],
        ['0;1', 'Inserted A', 11],
        ['0;2', 'Existing A', undefined],
        ['0;3', 'Unrelated middle paragraph', undefined],
        ['0;4', 'Inserted B', 13],
        ['0;5', 'Source B', 13],
        ['0;6', 'Existing B', undefined]
      ]);
      expect(
        selectRealBlock(ed, '0;1', 'Inserted A').characterFormat.fontSize
      ).toBe(11);
      expect(
        selectRealBlock(ed, '0;1', 'Inserted A').paragraphFormat.afterSpacing
      ).toBe(8);
      expect(
        selectRealBlock(ed, '0;4', 'Inserted B').characterFormat.fontSize
      ).toBe(13);
      expect(
        selectRealBlock(ed, '0;4', 'Inserted B').paragraphFormat.afterSpacing
      ).toBe(16);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('apply_style with inheritFormatFrom copies peer heading formatting and ignores schema defaults', () => {
    const ed = make([
      para('Reference heading', 'Heading 2', {
        characterFormat: {
          bold: true,
          italic: false,
          fontFamily: 'Aptos Display',
          fontSize: 16,
          fontColor: '#1f4e79'
        },
        paragraphFormat: {
          textAlignment: 'Center',
          leftIndent: 24,
          beforeSpacing: 6,
          afterSpacing: 12,
          lineSpacing: 1.15
        }
      }),
      para('Inserted heading from attachment', 'Normal', {
        characterFormat: {
          bold: false,
          italic: true,
          fontFamily: 'Times New Roman',
          fontSize: 11,
          fontColor: '#000000'
        },
        paragraphFormat: {
          textAlignment: 'Left',
          leftIndent: 0,
          beforeSpacing: 0,
          afterSpacing: 0,
          lineSpacing: 1
        }
      })
    ]);

    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'apply_style',
          anchor: '0;1',
          inheritFormatFrom: '0;0',
          styleName: 'Heading 2',
          bold: false,
          italic: false,
          underline: false,
          fontName: '',
          fontSize: 0,
          fontColor: '',
          highlightColor: '',
          alignment: '',
          leftIndent: 0,
          beforeSpacing: 0,
          afterSpacing: 0,
          lineSpacing: 0
        }
      ]
    });

    const inserted = ed.doc.sections[0].blocks[1];
    expect(res.results[0]).toMatchObject({ ok: true, op: 'apply_style' });
    expect(inserted.characterFormat).toMatchObject({
      bold: true,
      italic: false,
      fontFamily: 'Aptos Display',
      fontSize: 16,
      fontColor: '#1f4e79'
    });
    expect(inserted.paragraphFormat).toMatchObject({
      styleName: 'Heading 2',
      textAlignment: 'Center',
      leftIndent: 24,
      beforeSpacing: 6,
      afterSpacing: 12,
      lineSpacing: 1.15
    });
  });

  it('set_para_format with inheritFormatFrom copies peer body formatting without zero/default overwrite', () => {
    const ed = make([
      para('Reference body', 'Normal', {
        characterFormat: {
          bold: false,
          italic: false,
          fontFamily: 'Aptos',
          fontSize: 10.5,
          fontColor: '#333333'
        },
        paragraphFormat: {
          textAlignment: 'Justify',
          leftIndent: 18,
          rightIndent: 9,
          beforeSpacing: 4,
          afterSpacing: 8,
          lineSpacing: 1.08
        }
      }),
      para('Inserted body from attachment', 'Normal', {
        characterFormat: {
          bold: true,
          italic: true,
          fontFamily: 'Courier New',
          fontSize: 14,
          fontColor: '#990000'
        },
        paragraphFormat: {
          textAlignment: 'Left',
          leftIndent: 0,
          rightIndent: 0,
          beforeSpacing: 0,
          afterSpacing: 0,
          lineSpacing: 1
        }
      })
    ]);

    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'set_para_format',
          anchor: '0;1',
          inheritFormatFrom: '0;0',
          styleName: '',
          alignment: '',
          leftIndent: 0,
          rightIndent: 0,
          firstLineIndent: 0,
          beforeSpacing: 0,
          afterSpacing: 0,
          lineSpacing: 0
        }
      ]
    });

    const inserted = ed.doc.sections[0].blocks[1];
    expect(res.results[0]).toMatchObject({ ok: true, op: 'set_para_format' });
    expect(inserted.characterFormat).toMatchObject({
      bold: false,
      italic: false,
      fontFamily: 'Aptos',
      fontSize: 10.5,
      fontColor: '#333333'
    });
    expect(inserted.paragraphFormat).toMatchObject({
      styleName: 'Normal',
      textAlignment: 'Justify',
      leftIndent: 18,
      rightIndent: 9,
      beforeSpacing: 4,
      afterSpacing: 8,
      lineSpacing: 1.08
    });
  });

  it('rejects inheritFormatFrom when the reference anchor is stale', () => {
    const ed = make([para('Inserted body')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'set_para_format',
          anchor: '0;0',
          inheritFormatFrom: '0;9'
        }
      ]
    });

    expect(res.results[0]).toMatchObject({
      ok: false,
      op: 'set_para_format',
      error: 'inherit_anchor_not_found'
    });
  });

  it('set_char_format applies bold + fontColor to the selection', () => {
    const ed = make([para('Hello')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'set_char_format',
          anchor: '0;0',
          bold: true,
          fontColor: '#ff0000'
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, op: 'set_char_format' });
    expect(ed.selection.characterFormat.bold).toBe(true);
    expect(ed.selection.characterFormat.fontColor).toBe('#ff0000');
  });

  it('set_char_format with NO recognized field throws missing_format (not silent ok)', () => {
    const ed = make([para('Hello')]);
    const res = applyDocumentEdits(ed, {
      edits: [{ op: 'set_char_format', anchor: '0;0' }]
    });
    expect(res.results[0]).toMatchObject({
      ok: false,
      op: 'set_char_format',
      error: 'missing_format'
    });
    // Nothing was written to the selection format.
    expect(ed.selection.characterFormat.bold).toBeUndefined();
  });

  it('set_char_format reads fields from a nested op.format fallback', () => {
    const ed = make([para('Hello')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'set_char_format',
          anchor: '0;0',
          format: { italic: true, fontSize: 14 }
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true });
    expect(ed.selection.characterFormat.italic).toBe(true);
    expect(ed.selection.characterFormat.fontSize).toBe(14);
  });

  it('set_para_format applies alignment; empty op throws missing_format', () => {
    const ed = make([para('Hello')]);
    const ok = applyDocumentEdits(ed, {
      edits: [{ op: 'set_para_format', anchor: '0;0', alignment: 'Center' }]
    });
    expect(ok.results[0]).toMatchObject({ ok: true });
    expect(ed.selection.paragraphFormat.textAlignment).toBe('Center');

    const empty = applyDocumentEdits(ed, {
      edits: [{ op: 'set_para_format', anchor: '0;0' }]
    });
    expect(empty.results[0]).toMatchObject({
      ok: false,
      error: 'missing_format'
    });
  });

  it('set_para_format reads fields from a nested op.format fallback', () => {
    const ed = make([para('Hello')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'set_para_format', anchor: '0;0', format: { alignment: 'Right' } }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true });
    expect(ed.selection.paragraphFormat.textAlignment).toBe('Right');
  });

  it('set_para_format can copy styleName from nested format metadata', () => {
    const ed = make([para('Hello')]);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'set_para_format',
          anchor: '0;0',
          format: { styleName: 'Heading 2', alignment: 'Center' }
        }
      ]
    });

    expect(res.results[0]).toMatchObject({ ok: true });
    expect(ed.editor.applyStyle).toHaveBeenCalledWith('Heading 2');
    expect(ed.selection.paragraphFormat.textAlignment).toBe('Center');
  });

  it('apply_style with empty/missing styleName throws missing_style_name', () => {
    const ed = make([para('Hello')]);
    const empty = applyDocumentEdits(ed, {
      edits: [{ op: 'apply_style', anchor: '0;0', styleName: '   ' }]
    });
    expect(empty.results[0]).toMatchObject({
      ok: false,
      op: 'apply_style',
      error: 'missing_style_name'
    });

    const missing = applyDocumentEdits(ed, {
      edits: [{ op: 'apply_style', anchor: '0;0' }]
    });
    expect(missing.results[0]).toMatchObject({ error: 'missing_style_name' });
  });
});

// ---------------------------------------------------------------------------
// Fix 3 - atomic replace revision grouping (content-loss guard).
//
// A track-changes replace produces TWO revisions: a Deletion of the old run and
// an Insertion of the new. This mock models each block as an ordered list of
// runs (normal / inserted / deleted) and exposes the individual Revision objects
// with per-card accept/reject, so we can drive them in the exact order that lost
// content live and prove the grouping fix keeps the block whole.
// ---------------------------------------------------------------------------

type RunState = 'normal' | 'ins' | 'del';
interface Run {
  text: string;
  state: RunState;
}

class RevisionMockEditor implements LiveEditor {
  enableTrackChanges = false;
  // One section; each block is a list of runs.
  blocksRuns: Run[][];
  selection: any;
  editor: any;
  revisions: any;
  private sel = { si: 0, bi: 0, start: 0, end: 0 };

  constructor(texts: string[]) {
    this.blocksRuns = texts.map((t) => [{ text: t, state: 'normal' }]);

    const changes: any[] = [];
    const removeChange = (rev: any) => {
      const i = changes.indexOf(rev);
      if (i >= 0) changes.splice(i, 1);
    };
    this.revisions = {
      changes,
      get: (i: number) => changes[i],
      get length() {
        return changes.length;
      },
      acceptAll: () => [...changes].forEach((r) => r.accept()),
      rejectAll: () => [...changes].forEach((r) => r.reject())
    };

    const removeRun = (runs: Run[], run: Run) => {
      const i = runs.indexOf(run);
      if (i >= 0) runs.splice(i, 1);
    };

    const syncSelection = () => {
      const { si, bi, start, end } = this.sel;
      const text = this.logicalText(si, bi);
      this.selection.text = text.slice(start, end);
      this.selection.startOffset = `${si};${bi};${start}`;
      this.selection.endOffset = `${si};${bi};${end}`;
    };

    this.selection = {
      text: '',
      startOffset: '0;0;0',
      endOffset: '0;0;0',
      characterFormat: {},
      paragraphFormat: {},
      select: (start: string, end: string) => {
        const [si, bi, off] = start.split(';').map(Number);
        const [, , offEnd] = end.split(';').map(Number);
        this.sel = { si, bi, start: off, end: offEnd };
        syncSelection();
      }
    };

    this.editor = {
      insertText: (t: string) => {
        const { si, bi, start, end } = this.sel;
        const text = this.logicalText(si, bi);
        const before = text.slice(0, start);
        const mid = text.slice(start, end);
        const after = text.slice(end);

        if (!this.enableTrackChanges) {
          this.blocksRuns[bi] = [{ text: before + t + after, state: 'normal' }];
          this.sel = {
            si,
            bi,
            start: before.length + t.length,
            end: before.length + t.length
          };
          syncSelection();
          return;
        }

        // Track-changes replace: keep old run as a Deletion, add new as Insertion.
        const next: Run[] = [];
        if (before) next.push({ text: before, state: 'normal' });
        const delRun: Run | null = mid ? { text: mid, state: 'del' } : null;
        if (delRun) next.push(delRun);
        const insRun: Run | null = t ? { text: t, state: 'ins' } : null;
        if (insRun) next.push(insRun);
        if (after) next.push({ text: after, state: 'normal' });
        this.blocksRuns[bi] = next;

        if (delRun) {
          const rev: any = {
            revisionType: 'Deletion',
            accept: () => {
              removeRun(this.blocksRuns[bi], delRun);
              removeChange(rev);
            },
            reject: () => {
              delRun.state = 'normal';
              removeChange(rev);
            }
          };
          changes.push(rev);
        }
        if (insRun) {
          const rev: any = {
            revisionType: 'Insertion',
            accept: () => {
              insRun.state = 'normal';
              removeChange(rev);
            },
            reject: () => {
              removeRun(this.blocksRuns[bi], insRun);
              removeChange(rev);
            }
          };
          changes.push(rev);
        }
        // Collapse the caret after the inserted text.
        this.sel = {
          si,
          bi,
          start: before.length + t.length,
          end: before.length + t.length
        };
        syncSelection();
      },
      delete: () => this.editor.insertText('')
    };
  }

  serialize() {
    return JSON.stringify({
      // Model the current-text projection that a real tracked SFDT exposes:
      // deletion runs retain their revision but are not live visible text.
      revisions: [{ revisionID: 'mock-deletion', revisionType: 'Deletion' }],
      sections: [
        {
          blocks: this.blocksRuns.map((runs) => ({
            inlines: runs.map((run) => ({
              text: run.text,
              ...(run.state === 'del' ? { revisionIds: ['mock-deletion'] } : {})
            }))
          }))
        }
      ]
    });
  }

  // The text a user/anchor sees: all runs concatenated (tracked deletions still
  // show until resolved). At op time each block is a single normal run.
  logicalText(_si: number, bi: number) {
    return this.blocksRuns[bi].map((r) => r.text).join('');
  }

  // The resolved paragraph text: what remains after revisions are accepted/rejected.
  text(bi: number) {
    return this.blocksRuns[bi].map((r) => r.text).join('');
  }
}

describe('replace revision grouping (content-loss guard)', () => {
  it('reproduces content loss: native per-card resolve in the destructive order empties the block', () => {
    // Baseline (no grouping): drive the raw delete+insert revisions the way the
    // live bug did - reject the insertion, then accept the deletion.
    const ed = new RevisionMockEditor(['Quote: $5,500']);
    ed.enableTrackChanges = true;
    ed.selection.select('0;0;0', `0;0;${'Quote: $5,500'.length}`);
    ed.editor.insertText('Quote: $6,000'); // whole-block replace -> del + ins

    const [deletion, insertion] = ed.revisions.changes;
    insertion.reject(); // drop the new text
    deletion.accept(); // drop the old text

    expect(ed.text(0)).toBe(''); // paragraph vanished - the confirmed bug
  });

  it('grouped replace: destructive-order reject keeps the ORIGINAL value, never empty', () => {
    const ed = new RevisionMockEditor(['Quote: $5,500']);
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
    expect(ed.revisions.changes).toHaveLength(2);

    // Per-card in the previously-destructive order: click reject on the insertion
    // card first, then reject on the deletion card.
    const [deletion, insertion] = ed.revisions.changes.slice();
    insertion.reject();
    deletion.reject(); // already resolved by the group - no-op

    expect(ed.text(0)).toBe('Quote: $5,500');
    expect(ed.text(0)).not.toBe('');
  });

  it('grouped replace: destructive-order accept keeps the NEW value, never empty', () => {
    const ed = new RevisionMockEditor(['Quote: $5,500']);
    applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' }
      ]
    });
    const [deletion, insertion] = ed.revisions.changes.slice();
    // Destructive order, accept side: accept the deletion card first, then the
    // insertion card.
    deletion.accept();
    insertion.accept(); // already resolved by the group - no-op

    expect(ed.text(0)).toBe('Quote: $6,000');
    expect(ed.text(0)).not.toBe('');
  });

  it('grouped whole-block replace cannot be emptied by any per-card order', () => {
    // The multi-op / whole-value case that vanished live. Try every accept/reject
    // ordering across the two cards; none may empty the paragraph.
    const orderings: Array<
      ['accept' | 'reject', 'accept' | 'reject', number[]]
    > = [
      ['reject', 'accept', [1, 0]],
      ['accept', 'reject', [0, 1]],
      ['reject', 'reject', [1, 0]],
      ['accept', 'accept', [0, 1]]
    ];
    for (const [first, second, [i, j]] of orderings) {
      const ed = new RevisionMockEditor(['Total premium: $12,000']);
      applyDocumentEdits(ed, {
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: 'Total premium: $12,000',
            replace: 'Total premium: $13,500'
          }
        ]
      });
      const cards = ed.revisions.changes.slice();
      cards[i][first]();
      cards[j][second]();
      const out = ed.text(0);
      expect(out).not.toBe('');
      expect(['Total premium: $12,000', 'Total premium: $13,500']).toContain(
        out
      );
    }
  });

  it('multi-op batch binds all revisions to its one logical change-set decision', () => {
    // A multi-location assistant action is one logical change set. Resolving any
    // card decides every revision produced by that batch, avoiding partial
    // accept/reject outcomes across related locations.
    const ed = new RevisionMockEditor([
      'General Liability: $5,500',
      'Total premium: $5,500'
    ]);
    const res = applyDocumentEdits(ed, {
      changeSetId: 'quotes-q6',
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' },
        { op: 'replace_text', anchor: '0;1', find: '5,500', replace: '6,000' }
      ]
    });
    // 4 revisions total, 2 per logical edit.
    expect(ed.revisions.changes).toHaveLength(4);
    expect(res.changeSet).toMatchObject({
      id: 'quotes-q6',
      status: 'applied',
      revisionGrouping: 'bridge_bound_revision_cards',
      uiGrouping: 'requires_cross_layer_group_card'
    });
    expect(
      ed.revisions.changes.every((r: any) => r.robinChangeSetId === 'quotes-q6')
    ).toBe(true);

    // Rejecting any revision card rejects the entire logical change set.
    const cards = ed.revisions.changes.slice();
    cards[1].reject(); // block 0 insertion
    cards[0].reject(); // already resolved by the group - no-op
    expect(ed.text(0)).toBe('General Liability: $5,500');
    expect(ed.text(1)).toBe('Total premium: $5,500');
    expect(ed.revisions.changes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Optimized-SFDT tables (the shape the LIVE editor actually serializes).
//
// The live SyncFusion editor always serializes optimized SFDT, where a table's
// rows key is `r` (not `rows`/`rw`). Probing the wrong key made every table walk
// as one empty paragraph, so table cells were invisible to inventory + index and
// unreachable by cell-anchored edits. These tests use the optimized-key fixture
// that was missing (unit tests only ever used full-key fixtures), covering all
// three impacts: (1) inventory, (2) index, (3) cell-write.
// ---------------------------------------------------------------------------

// The optimized shape emitted by editor.serialize() for a one-cell table.
function optimizedTableSfdt(cellText: string) {
  return {
    optimizeSfdt: true,
    sec: [
      { b: [{ r: [{ c: [{ b: [{ i: [{ cf: {}, tlp: cellText }] }] }] }] }] }
    ]
  };
}

// A table-aware editor mock: serializes the optimized single-cell table shape and
// supports cell-anchored selection (offset is the LAST `;`-segment) + writes.
class OptimizedTableCellEditor implements LiveEditor {
  enableTrackChanges = false;
  cellText: string;
  selection: any;
  editor: any;
  revisions: any = { acceptAll: jest.fn(), rejectAll: jest.fn() };
  readonly anchor = '0;0;0;0;0';
  private sel = { start: 0, end: 0 };

  constructor(text: string) {
    this.cellText = text;
    const sync = () => {
      this.selection.text = this.cellText.slice(this.sel.start, this.sel.end);
      this.selection.startOffset = `${this.anchor};${this.sel.start}`;
      this.selection.endOffset = `${this.anchor};${this.sel.end}`;
    };
    this.selection = {
      text: '',
      startOffset: `${this.anchor};0`,
      endOffset: `${this.anchor};0`,
      characterFormat: {},
      paragraphFormat: {},
      select: (start: string, end: string) => {
        this.sel = {
          start: Number(start.split(';').pop()),
          end: Number(end.split(';').pop())
        };
        sync();
      }
    };
    this.editor = {
      insertText: (t: string) => {
        const { start, end } = this.sel;
        this.cellText =
          this.cellText.slice(0, start) + t + this.cellText.slice(end);
        const caret = start + t.length;
        this.sel = { start: caret, end: caret };
        sync();
      },
      delete: () => this.editor.insertText('')
    };
  }

  serialize() {
    return JSON.stringify(optimizedTableSfdt(this.cellText));
  }
}

describe('optimized-SFDT tables (row key r)', () => {
  it('flattenSfdt walks an optimized table into a table_cell block', () => {
    const blocks = flattenSfdt(optimizedTableSfdt('Quote: $5,500'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      anchor: '0;0;0;0;0',
      kind: 'table_cell',
      text: 'Quote: $5,500'
    });
  });

  it('(1) inventory surfaces the table-cell content', () => {
    const blocks = flattenSfdt(optimizedTableSfdt('Quote: $5,500'));
    const res = buildInventoryFromBlocks(blocks, { scope: 'full' }) as any;
    expect(res.inventory).toEqual([
      { anchor: '0;0;0;0;0', kind: 'table_cell', text: 'Quote: $5,500' }
    ]);
  });

  it('(2) index keeps the table-cell block (semantic search sees it)', () => {
    const blocks = flattenSfdt(optimizedTableSfdt('Quote: $5,500'));
    const idx = buildIndexBlocksFromBlocks(blocks);
    expect(idx).toEqual([
      { anchor: '0;0;0;0;0', kind: 'table_cell', text: 'Quote: $5,500' }
    ]);
  });

  it('(3) replace_text applies at the cell anchor', () => {
    const ed = new OptimizedTableCellEditor('Quote: $5,500');
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0;0;0;0',
          find: '5,500',
          replace: '6,000'
        }
      ]
    });
    expect(res.results[0]).toMatchObject({
      ok: true,
      op: 'replace_text',
      anchor: '0;0;0;0;0'
    });
    expect(ed.cellText).toBe('Quote: $6,000');
  });

  it('(3) set_cell_text overwrites the cell at its anchor', () => {
    const ed = new OptimizedTableCellEditor('Quote: $5,500');
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'set_cell_text', anchor: '0;0;0;0;0', text: 'Quote: $7,250' }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: true, op: 'set_cell_text' });
    expect(ed.cellText).toBe('Quote: $7,250');
  });

  it('cell edits no longer report anchor_not_found (regression guard)', () => {
    const ed = new OptimizedTableCellEditor('Quote: $5,500');
    const res = applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0;0;0;0', find: '5,500', replace: '6' }
      ]
    });
    expect(res.results[0].error).toBeUndefined();
  });
});
