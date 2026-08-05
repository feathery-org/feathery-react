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
  buildIndexBlocks,
  buildIndexBlocksFromBlocks,
  deriveSectionPattern,
  anchorFromOffset,
  findDocumentOccurrences,
  readSelection,
  applyDocumentEdits,
  getDocumentInventory,
  FULL_INVENTORY_BLOCK_LIMIT,
  LiveEditor,
  findReplaceCounterpart,
  listRevisionGroups,
  installRevisionGroupIsolation,
  parseRevisionGroupTag,
  rebindRevisionGroups,
  resolveRevisionIndividually,
  resolveLiveRevisionGroupsAsOneUndo,
  resolveRevisionsAsOneUndo
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
    value: {
      getRandomValues: (array: Uint8Array) =>
        require('crypto').randomFillSync(array)
    }
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
  currentUser = '';
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
      isCollapsed: true,
      // The selection's extent, so a selection spanning blocks is addressable
      // rather than collapsed to its start block. `truncated` + `textLength`
      // are what let a guard exist for a selection too long to send whole.
      startOffset: '0;1;3',
      endOffset: '0;1;3',
      endAnchor: '0;1',
      textLength: 900,
      truncated: true,
      spansBlocks: false
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

  it('suppresses public layout updates for the mutation phases and restores them', () => {
    const ed = make([para('Quote: $5,500')]);
    const layoutTransitions: boolean[] = [];
    let enableLayout = true;
    Object.defineProperty(ed, 'enableLayout', {
      configurable: true,
      get: () => enableLayout,
      set: (value: boolean) => {
        enableLayout = value;
        layoutTransitions.push(value);
      }
    });

    const result = applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' }
      ]
    });

    expect(result.results[0].ok).toBe(true);
    expect(layoutTransitions).toEqual([false, true]);
    expect(ed.enableLayout).toBe(true);
  });

  it('restores the prior author when an assistant batch fails', () => {
    const ed = make([para('Quote: $5,500')]);
    ed.currentUser = 'Existing author';
    ed.editor.insertText = () => {
      throw new Error('deliberate assistant write failure');
    };

    const result = applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '5,500', replace: '6,000' }
      ]
    });

    expect(result.results[0]).toMatchObject({
      ok: false,
      error: 'op_failed'
    });
    expect(ed.currentUser).toBe('Existing author');
  });

  it('restores editor attribution state when preflight serialization fails', () => {
    const ed = make([para('Quote: $5,500')]);
    ed.enableTrackChanges = false;
    ed.currentUser = 'Existing author';
    ed.serialize = () => {
      throw new Error('deliberate preflight serialization failure');
    };

    expect(() =>
      applyDocumentEdits(ed, {
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: '5,500',
            replace: '6,000'
          }
        ]
      })
    ).toThrow('deliberate preflight serialization failure');
    expect({
      currentUser: ed.currentUser,
      enableTrackChanges: ed.enableTrackChanges
    }).toEqual({
      currentUser: 'Existing author',
      enableTrackChanges: false
    });
  });

  it('real SDK: attributes only assistant revisions to Robin', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            para('Manual before'),
            para('Assistant before'),
            para('Manual after')
          ]
        }
      ]
    });
    try {
      ed.enableTrackChanges = true;
      expect(ed.currentUser).toBe('');

      ed.selection.select('0;0;0', '0;0;6');
      ed.editor.insertText('Human');
      const beforeAssistant = realRevisions(ed).length;
      expect(beforeAssistant).toBeGreaterThan(0);
      expect(
        realRevisions(ed).every((revision) => revision.author === 'Guest user')
      ).toBe(true);

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: 'before',
            replace: 'after'
          }
        ]
      });
      expect(result.results[0].ok).toBe(true);
      const afterAssistant = realRevisions(ed).length;
      expect(afterAssistant).toBeGreaterThan(beforeAssistant);
      expect(
        realRevisions(ed)
          .slice(beforeAssistant, afterAssistant)
          .every((revision) => revision.author === 'Robin')
      ).toBe(true);

      ed.selection.select('0;2;0', '0;2;6');
      ed.editor.insertText('Human');
      expect(
        realRevisions(ed)
          .slice(afterAssistant)
          .every((revision) => revision.author === 'Guest user')
      ).toBe(true);
      expect(ed.currentUser).toBe('');
    } finally {
      destroyRealDocumentEditor(ed);
    }
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

  it('expect CAS guard: stale text fails with expect_mismatch and writes nothing', () => {
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
    expect(res.results[0]).toMatchObject({
      ok: false,
      error: 'expect_mismatch'
    });
    expect(ed.doc.sections[0].blocks[0].inlines[0].text).toBe('Quote: $5,500');
  });

  it('relocates a stale anchor when expect identifies exactly one current block', () => {
    const ed = make([para('Concurrent note'), para('Quote: $5,500')]);
    const res = applyDocumentEdits(ed, {
      changeSetId: 'relocate-unique-expect',
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          expect: 'Quote: $5,500',
          find: '5,500',
          replace: '6,000'
        }
      ]
    });

    expect(res.results[0]).toMatchObject({
      ok: true,
      anchor: '0;1',
      relocated: { from: '0;0', to: '0;1' }
    });
    expect(ed.doc.sections[0].blocks[1].inlines[0].text).toBe('Quote: $6,000');
  });

  it('relocates a missing anchor when find identifies exactly one current block', () => {
    const ed = make([para('Only matching phrase')]);
    const res = applyDocumentEdits(ed, {
      changeSetId: 'relocate-unique-find',
      edits: [
        {
          op: 'replace_text',
          anchor: '0;9',
          find: 'matching',
          replace: 'relocated'
        }
      ]
    });

    expect(res.results[0]).toMatchObject({
      ok: true,
      anchor: '0;0',
      relocated: { from: '0;9', to: '0;0' }
    });
    expect(ed.doc.sections[0].blocks[0].inlines[0].text).toBe(
      'Only relocated phrase'
    );
  });

  it('an ambiguous relocation refuses only its group and lets a sibling group land', () => {
    const ed = make([
      para('Repeated target'),
      para('Repeated target'),
      para('Independent target')
    ]);
    const res = applyDocumentEdits(ed, {
      changeSetId: 'relocate-ambiguous-groups',
      edits: [
        {
          op: 'replace_text',
          group: 'ambiguous',
          anchor: '0;9',
          expect: 'Repeated target',
          find: 'Repeated',
          replace: 'Changed'
        },
        {
          op: 'replace_text',
          group: 'ambiguous',
          anchor: '0;0',
          find: 'Repeated',
          replace: 'Changed'
        },
        {
          op: 'replace_text',
          group: 'independent',
          anchor: '0;2',
          expect: 'Independent target',
          find: 'Independent',
          replace: 'Applied'
        }
      ]
    });

    expect(res.results[0]).toMatchObject({
      ok: false,
      error: 'anchor_not_found'
    });
    expect(res.results[0].details).toEqual(
      expect.arrayContaining([expect.stringContaining('matching blocks (2)')])
    );
    expect(res.results[1]).toMatchObject({
      ok: false,
      error: 'change_set_failed'
    });
    expect(res.results[2]).toMatchObject({ ok: true });
    expect(
      ed.doc.sections[0].blocks.map((block) => block.inlines[0].text)
    ).toEqual(['Repeated target', 'Repeated target', 'Applied target']);
  });

  it('refuses an exact relocation match in a different table cell', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            {
              tableFormat: {},
              rows: [
                {
                  rowFormat: {},
                  cells: [
                    {
                      cellFormat: {},
                      blocks: [{ inlines: [{ text: 'Original cell' }] }]
                    },
                    {
                      cellFormat: {},
                      blocks: [{ inlines: [{ text: 'Moved value' }] }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    });
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'no-cross-cell-relocation',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0;0;0;1',
            expect: 'Moved value',
            find: 'Moved',
            replace: 'Changed'
          }
        ]
      });

      expect(res.results[0]).toMatchObject({
        ok: false,
        error: 'anchor_not_found'
      });
      expect(res.results[0].details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('different table/cell container')
        ])
      );
      expect(selectRealBlock(ed, '0;0;0;1;0', 'Moved value').text).toBe(
        'Moved value'
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
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
        error: 'change_set_failed'
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

  // Direct formatting FIELDS on insert_text stay structural-only: ai-services
  // splits them into follow-up formatting ops before they reach the engine.
  // (`inheritFormatFrom` is different: the engine now honours it for the
  // paragraphs an insert creates - covered by the real-SDK S4b tests below.)
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

  it('real SDK: reuses each post-write verification snapshot for assertion and refresh', () => {
    const countSerializations = (editCount: number): number => {
      const originals = ['Alpha target', 'Beta target', 'Gamma target'];
      const replacements = ['Alpha revised', 'Beta revised', 'Gamma revised'];
      const ed = makeRealDocumentEditor({
        sections: [{ blocks: originals.map((text) => para(text)) }]
      });
      try {
        const before = ed.serialize();
        const serialize = jest.spyOn(ed, 'serialize');
        const result = applyDocumentEdits(ed as unknown as LiveEditor, {
          edits: originals.slice(0, editCount).map((text, index) => ({
            op: 'replace_text',
            anchor: `0;${index}`,
            find: text,
            replace: replacements[index],
            expect: text
          }))
        });

        expect(result.results.every((entry) => entry.ok)).toBe(true);
        const calls = serialize.mock.calls.length;
        expect(result.warnings).toEqual(
          expect.arrayContaining([
            expect.stringMatching(
              new RegExp(`^document_serialization: count=${calls}; total_ms=`)
            )
          ])
        );
        serialize.mockRestore();
        rejectEveryRealRevision(ed);
        expect(ed.serialize()).toBe(before);
        return calls;
      } finally {
        destroyRealDocumentEditor(ed);
      }
    };

    // Initial snapshot + one post-write verification/committed snapshot per op
    // + final inventory. Before reuse, the executor paid one additional
    // committed snapshot per op (4 calls for one, 8 for three).
    expect({
      oneOperation: countSerializations(1),
      threeOperations: countSerializations(3)
    }).toEqual({ oneOperation: 3, threeOperations: 5 });
  });

  it('real SDK: keeps a 12-op mixed batch to eight serializations on a large document', () => {
    const table = (tableIndex: number) => ({
      tableFormat: {},
      rows: Array.from({ length: 5 }, (_, row) => ({
        rowFormat: {},
        cells: Array.from({ length: 4 }, (_, column) => ({
          cellFormat: {},
          blocks: [
            { inlines: [{ text: `Table ${tableIndex} R${row} C${column}` }] }
          ]
        }))
      }))
    });
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            ...Array.from({ length: 240 }, (_, index) =>
              para(`Synthetic paragraph ${index}`)
            ),
            ...Array.from({ length: 4 }, (_, index) => table(index))
          ]
        }
      ]
    });

    try {
      const serialize = jest.spyOn(ed, 'serialize');
      const startedAt = performance.now();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        edits: [
          ...Array.from({ length: 6 }, (_, index) => ({
            op: 'replace_text',
            anchor: `0;${index}`,
            find: `Synthetic paragraph ${index}`,
            replace: `Revised synthetic paragraph ${index}`,
            expect: `Synthetic paragraph ${index}`
          })),
          ...Array.from({ length: 6 }, (_, index) => ({
            op: 'set_char_format',
            anchor: `0;${index + 6}`,
            bold: true,
            expect: `Synthetic paragraph ${index + 6}`
          }))
        ]
      });
      const wallMs = performance.now() - startedAt;

      expect(result.results.every((entry) => entry.ok)).toBe(true);
      expect(serialize).toHaveBeenCalledTimes(8);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(
            /^document_serialization: count=8; total_ms=\d+\.\d$/
          )
        ])
      );
      expect(wallMs).toBeGreaterThan(0);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe('live occurrence search and scoped replacement', () => {
  it('real SDK: every background read class is visually silent', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            para('Proposal', 'Heading 1'),
            para('Our firm supports clients throughout the policy lifecycle.'),
            para('Coverage', 'Heading 2'),
            para('Our firm negotiates coverage and advocates during claims.')
          ]
        }
      ]
    });

    try {
      const selected =
        'Our firm supports clients throughout the policy lifecycle.';
      ed.selection.select('0;1;0', `0;1;${selected.length}`);
      const documentHelper = (ed as any).documentHelper;
      const viewer = documentHelper.viewerContainer as HTMLElement;
      viewer.scrollTop = 420;
      viewer.scrollLeft = 23;
      const originalScrollToPosition =
        documentHelper.scrollToPosition.bind(documentHelper);
      let activeRead = '';
      const scrollSuppression: Array<{ read: string; suppressed: boolean }> =
        [];
      jest
        .spyOn(documentHelper, 'scrollToPosition')
        .mockImplementation((...args: any[]) => {
          scrollSuppression.push({
            read: activeRead,
            suppressed: documentHelper.skipScrollToPosition
          });
          return originalScrollToPosition(...args);
        });

      const expectVisuallySilent = (read: string, operation: () => unknown) => {
        const selectionBefore = readSelection(ed as unknown as LiveEditor);
        const scrollTopBefore = viewer.scrollTop;
        const scrollLeftBefore = viewer.scrollLeft;
        activeRead = read;
        operation();
        expect(readSelection(ed as unknown as LiveEditor)).toEqual(
          selectionBefore
        );
        expect(viewer.scrollTop).toBe(scrollTopBefore);
        expect(viewer.scrollLeft).toBe(scrollLeftBefore);
      };

      expectVisuallySilent('serialize', () => ed.serialize());
      expectVisuallySilent('inventory', () =>
        getDocumentInventory(ed as unknown as LiveEditor, {
          scope: 'structure'
        })
      );
      expectVisuallySilent('pattern', () =>
        deriveSectionPattern(ed as unknown as LiveEditor)
      );
      // This is the editor-reading half of full and delta index sync. Hashing,
      // diffing and POSTing operate only on this immutable snapshot afterward.
      expectVisuallySilent('index-sync', () =>
        buildIndexBlocks(ed as unknown as LiveEditor)
      );
      expectVisuallySilent('occurrences', () =>
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'firm',
          matchCase: false,
          maxResults: 20
        })
      );

      expect(scrollSuppression).toEqual(
        scrollSuppression.map(({ read }) => ({ read, suppressed: true }))
      );
      expect(documentHelper.skipScrollToPosition).toBe(false);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

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

  it('real SDK: replaces a rendered TOC field using its serialized public offsets', () => {
    // Word TOC entries serialize their field instructions alongside their
    // rendered text. SyncFusion Search reports offsets in that serialized
    // coordinate space, while Selection exposes only "Our Mission\\t5".
    const ed = makeRealDocumentEditor({
      optimizeSfdt: true,
      sec: [
        {
          b: [
            { pf: {}, i: [{ cf: {}, tlp: 'Before the table of contents' }] },
            { pf: {}, i: [{ cf: {}, tlp: 'Contents' }] },
            {
              pf: { stn: 'TOC 1' },
              i: [
                { cf: {}, ft: 0, hfe: true },
                { cf: {}, tlp: 'HYPERLINK \\l "_Toc216275880"' },
                { cf: {}, ft: 2 },
                { cf: {}, tlp: 'Our Mission' },
                { cf: {}, tlp: '\\t' },
                { cf: {}, ft: 0, hfe: true },
                { cf: {}, tlp: ' PAGEREF _Toc216275880 \\h ' },
                { cf: {}, ft: 2 },
                { cf: {}, tlp: '5' },
                { cf: {}, ft: 1 },
                { cf: {}, ft: 1 }
              ]
            }
          ]
        }
      ]
    });

    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
        text: 'Our Mission',
        matchCase: true,
        maxResults: 10
      });
      expect(found.occurrences).toEqual([
        expect.objectContaining({ anchor: '0;2', start: 30, end: 41 })
      ]);

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'toc-field-replace',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;2',
            expect:
              'HYPERLINK \\l "_Toc216275880"Our Mission\\t PAGEREF _Toc216275880 \\h 5',
            find: 'Our Mission',
            replace: 'Our Purpose',
            start: 30,
            end: 41
          }
        ]
      });

      expect(result).toMatchObject({
        results: [expect.objectContaining({ ok: true, anchor: '0;2' })],
        changeSet: {
          status: 'applied',
          revisionGrouping: 'bridge_bound_revision_cards'
        }
      });
      expect(flattenSfdt(JSON.parse(ed.serialize()))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            anchor: '0;2',
            text: 'HYPERLINK \\l "_Toc216275880"Our Purpose\\t PAGEREF _Toc216275880 \\h 5'
          })
        ])
      );

      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
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
            error: 'change_set_failed'
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
            },
            {
              paragraphFormat: { styleName: 'noTOCheading2' },
              inlines: [{ text: 'Failing sibling' }]
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
          {
            op: 'apply_style',
            group: 'survivor',
            anchor: '0;2',
            inheritFormatFrom: '0;0'
          },
          {
            op: 'apply_style',
            group: 'failing-format-group',
            anchor: '0;3',
            inheritFormatFrom: '0;0'
          },
          {
            op: 'apply_style',
            group: 'failing-format-group',
            anchor: '0;1',
            inheritFormatFrom: '0;0'
          }
        ]
      });

      // A mid-apply failure rolls back both members of its group, while the
      // independently reviewable sibling group stays applied and reports ok.
      expect(res.results[0]).toMatchObject({
        ok: true
      });
      expect(res.results[1]).toMatchObject({
        ok: false,
        error: 'change_set_failed'
      });
      expect(res.results[2]).toMatchObject({
        ok: false,
        error: 'inherited_format_mismatch'
      });
      expect(res.changeSet).toMatchObject({
        id: 'fault-injected-format-change-set',
        status: 'failed'
      });
      expect(res.results[2].details).toContain(
        'characterFormat.fontSize: expected 11, got 20'
      );
      // Inspect real editor state, not merely the response: the survivor stays
      // formatted and both members of the failed group are back at baseline.
      expect(
        selectRealBlock(ed, '0;2', 'Other target').characterFormat.fontSize
      ).toBe(11);
      expect(
        selectRealBlock(ed, '0;3', 'Failing sibling').characterFormat.fontSize
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
          // The original 0;3 anchor follows Source B after the first insertion.
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
        ['0;4', 'Source B', 13],
        ['0;5', 'Inserted B', 13],
        ['0;6', 'Existing B', undefined]
      ]);
      expect(
        selectRealBlock(ed, '0;1', 'Inserted A').characterFormat.fontSize
      ).toBe(11);
      expect(
        selectRealBlock(ed, '0;1', 'Inserted A').paragraphFormat.afterSpacing
      ).toBe(8);
      expect(
        selectRealBlock(ed, '0;5', 'Inserted B').characterFormat.fontSize
      ).toBe(13);
      expect(
        selectRealBlock(ed, '0;5', 'Inserted B').paragraphFormat.afterSpacing
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
  // Mirrors the live editor: SyncFusion stamps `revisionSettings.customData`
  // onto every revision it creates while the value is set (editor.js), which
  // is how the engine tags each op's revisions with their accept group.
  documentEditorSettings = {
    revisionSettings: { customData: null as string | null }
  };
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
            customData: this.documentEditorSettings.revisionSettings.customData,
            getRange: () => [{ text: delRun.text }],
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
            customData: this.documentEditorSettings.revisionSettings.customData,
            getRange: () => [{ text: insRun.text }],
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
      // Model the projections a real tracked SFDT exposes: deletion runs retain
      // their revision but are not live visible text, and insertion runs carry
      // their revision id so the reject projection can drop them.
      revisions: [
        { revisionID: 'mock-deletion', revisionType: 'Deletion' },
        { revisionID: 'mock-insertion', revisionType: 'Insertion' }
      ],
      sections: [
        {
          blocks: this.blocksRuns.map((runs) => ({
            inlines: runs.map((run) => ({
              text: run.text,
              ...(run.state === 'del'
                ? { revisionIds: ['mock-deletion'] }
                : {}),
              ...(run.state === 'ins'
                ? { revisionIds: ['mock-insertion'] }
                : {})
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
// Assistant-defined accept groups (`group` on each op, persisted via
// SyncFusion revision customData).
// ---------------------------------------------------------------------------

describe('assistant-defined accept groups', () => {
  it('ops with distinct `group` values resolve independently', () => {
    const ed = new RevisionMockEditor([
      'General Liability: $5,500',
      'Signed on 2026-01-01'
    ]);
    const res = applyDocumentEdits(ed, {
      changeSetId: 'cs-1',
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: '5,500',
          replace: '6,000',
          group: 'update-premium'
        },
        {
          op: 'replace_text',
          anchor: '0;1',
          find: '2026-01-01',
          replace: '2026-02-01',
          group: 'update-date'
        }
      ]
    });
    expect(res.results.every((r) => r.ok)).toBe(true);
    expect(ed.revisions.changes).toHaveLength(4);
    // Every revision carries its group both as the durable customData tag and
    // as the in-memory expando.
    expect(
      ed.revisions.changes.map(
        (r: any) => parseRevisionGroupTag(r.customData)?.group
      )
    ).toEqual([
      'update-premium',
      'update-premium',
      'update-date',
      'update-date'
    ]);
    expect(ed.revisions.changes.map((r: any) => r.robinGroupId)).toEqual([
      'update-premium',
      'update-premium',
      'update-date',
      'update-date'
    ]);

    // Accepting ONE revision of the premium group resolves that group only:
    // the date edit's revisions stay pending (both its tracked runs are still
    // in the paragraph), then resolve on their own decision.
    ed.revisions.changes[0].accept();
    expect(ed.text(0)).toBe('General Liability: $6,000');
    expect(ed.revisions.changes).toHaveLength(2);
    expect(ed.text(1)).toBe('Signed on 2026-01-012026-02-01');

    ed.revisions.changes[0].reject();
    expect(ed.text(1)).toBe('Signed on 2026-01-01');
    expect(ed.revisions.changes).toHaveLength(0);
  });

  it('changeSet.groups reports each accept unit with its ops and revisions', () => {
    const ed = new RevisionMockEditor(['Premium: $100', 'Tax: $13']);
    const res = applyDocumentEdits(ed, {
      changeSetId: 'cs-2',
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: '$100',
          replace: '$200',
          group: 'premium'
        },
        { op: 'replace_text', anchor: '0;1', find: '$13', replace: '$26' }
      ]
    });
    expect(res.changeSet?.groups).toEqual([
      { id: 'premium', opIndices: [0], revisionCount: 2 },
      // The ungrouped op falls into the change-set-wide unit.
      { id: 'cs-2', opIndices: [1], revisionCount: 2 }
    ]);
  });

  it('refuses a malformed `group` before writing anything', () => {
    const ed = new RevisionMockEditor(['Premium: $100']);
    const res = applyDocumentEdits(ed, {
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: '$100',
          replace: '$200',
          group: '   '
        }
      ]
    });
    expect(res.results[0]).toMatchObject({ ok: false, error: 'invalid_group' });
    expect(ed.text(0)).toBe('Premium: $100');
    expect(ed.revisions.changes).toHaveLength(0);
  });

  it('restores whatever customData the host had set before the change set', () => {
    const ed = new RevisionMockEditor(['Premium: $100']);
    ed.documentEditorSettings.revisionSettings.customData = 'host-tag';
    applyDocumentEdits(ed, {
      edits: [
        { op: 'replace_text', anchor: '0;0', find: '$100', replace: '$200' }
      ]
    });
    expect(ed.documentEditorSettings.revisionSettings.customData).toBe(
      'host-tag'
    );
  });

  it('listRevisionGroups exposes tagged revisions as review-card data', () => {
    const ed = new RevisionMockEditor(['Premium: $100', 'Tax: $13']);
    applyDocumentEdits(ed, {
      changeSetId: 'cs-4',
      edits: [
        {
          op: 'replace_text',
          anchor: '0;0',
          find: '$100',
          replace: '$200',
          group: 'premium'
        },
        {
          op: 'replace_text',
          anchor: '0;1',
          find: '$13',
          replace: '$26',
          group: 'tax'
        }
      ]
    });
    const views = listRevisionGroups(ed);
    expect(views).toHaveLength(2);
    expect(views[0]).toMatchObject({ changeSetId: 'cs-4', group: 'premium' });
    expect(views[0].items.map((i) => [i.revisionType, i.text])).toEqual([
      ['Deletion', '$100'],
      ['Insertion', '$200']
    ]);
    expect(views[1]).toMatchObject({ changeSetId: 'cs-4', group: 'tax' });

    // Resolving a group empties its view; the other group is untouched.
    views[0].items[0].revision.accept?.();
    const after = listRevisionGroups(ed);
    expect(after).toHaveLength(1);
    expect(after[0].group).toBe('tax');
  });

  it('rebindRevisionGroups rebuilds accept units from persisted customData', () => {
    // Simulate a reload: revisions exist with tags but no in-memory bindings.
    const accepted: string[] = [];
    const makeRevision = (id: string, tag: string) => ({
      customData: tag,
      accept: () => accepted.push(`${id}:public-accept`),
      reject: () => accepted.push(`${id}:public-reject`),
      handleAcceptReject: (isAccept: boolean) =>
        accepted.push(`${id}:${isAccept ? 'accept' : 'reject'}`)
    });
    const tagA = JSON.stringify({
      v: 1,
      source: 'robin',
      changeSetId: 'cs-3',
      group: 'a'
    });
    const tagB = JSON.stringify({
      v: 1,
      source: 'robin',
      changeSetId: 'cs-3',
      group: 'b'
    });
    const revisions = [
      makeRevision('a1', tagA),
      makeRevision('a2', tagA),
      makeRevision('b1', tagB),
      { customData: 'not-ours', accept: jest.fn(), reject: jest.fn() }
    ];
    const editor = {
      revisions: { changes: revisions }
    } as unknown as LiveEditor;

    expect(rebindRevisionGroups(editor)).toBe(3);
    // Idempotent: a second pass binds nothing new.
    expect(rebindRevisionGroups(editor)).toBe(0);

    // Accepting one member resolves its whole group through the non-cascading
    // single-revision path, never the public accept and never group b.
    revisions[0].accept?.();
    expect(accepted).toEqual(['a1:accept', 'a2:accept']);

    (revisions[2] as any).reject();
    expect(accepted).toEqual(['a1:accept', 'a2:accept', 'b1:reject']);
    // Foreign customData is left untouched.
    expect((revisions[3] as any).accept).not.toHaveBeenCalled();
  });

  it('resolveRevisionIndividually resolves one member; the group decision skips it', () => {
    const resolved: string[] = [];
    const makeRev = (id: string, tagStr: string) => ({
      customData: tagStr,
      accept: () => resolved.push(`${id}:public-accept`),
      reject: () => resolved.push(`${id}:public-reject`),
      handleAcceptReject: (isAccept: boolean) =>
        resolved.push(`${id}:${isAccept ? 'accept' : 'reject'}`)
    });
    const tagA = JSON.stringify({
      v: 1,
      source: 'robin',
      changeSetId: 'cs-5',
      group: 'a'
    });
    const revisions = [
      makeRev('a1', tagA),
      makeRev('a2', tagA),
      makeRev('a3', tagA)
    ];
    const editor = {
      revisions: { changes: revisions }
    } as unknown as LiveEditor;
    expect(rebindRevisionGroups(editor)).toBe(3);

    // One edit reviewed alone: only that member resolves, through the native
    // single-revision path (never the group-wide public accept/reject).
    resolveRevisionIndividually(revisions[1] as any, false);
    expect(resolved).toEqual(['a2:reject']);
    // Resolving the same member again is a no-op.
    resolveRevisionIndividually(revisions[1] as any, true);
    expect(resolved).toEqual(['a2:reject']);

    // The later group decision resolves only the remaining members.
    (revisions[0] as any).accept();
    expect(resolved).toEqual(['a2:reject', 'a1:accept', 'a3:accept']);
  });

  it('real SDK: adjacent writes from different accept groups stay separate revisions', () => {
    // SyncFusion extends an adjacent same-author/same-type revision instead of
    // creating a new one, which would fold group B's content (and lose its
    // tag) into group A's revision. Isolation gates that merge on the tag.
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [para('Base.')] }]
    });
    try {
      const live = ed as unknown as LiveEditor;
      installRevisionGroupIsolation(live);
      const tag = (group: string) =>
        JSON.stringify({ v: 1, source: 'robin', changeSetId: 'cs-iso', group });
      const settings = (ed as any).documentEditorSettings.revisionSettings;
      ed.enableTrackChanges = true;
      ed.selection.moveToDocumentEnd();

      settings.customData = tag('premium');
      ed.editor.insertText('AAA ');
      // Back-to-back on purpose: no untracked content separates the groups.
      settings.customData = tag('cancellation');
      ed.editor.insertText('BBB');
      settings.customData = null;

      const views = listRevisionGroups(live);
      expect(views.map((v) => [v.group, v.items.length])).toEqual([
        ['premium', 1],
        ['cancellation', 1]
      ]);
      expect(views.map((v) => v.items[0].text)).toEqual(['AAA', 'BBB']);
      // Adjacent but both insertions (and different groups): not a replace.
      expect(
        findReplaceCounterpart(views[0].items[0].revision)
      ).toBeUndefined();
      expect(
        findReplaceCounterpart(views[1].items[0].revision)
      ).toBeUndefined();

      // Untagged (human) writes keep native merge behavior: adjacent
      // insertions still combine into one revision. Count the raw revision
      // list — the public collection is the pane's card view, which lumps
      // adjacent same-author revisions regardless of how they were created.
      const rawRevisions = () => (ed.revisions as any).changes.length;
      const before = rawRevisions();
      ed.selection.moveToDocumentEnd();
      ed.editor.insertText('one ');
      ed.editor.insertText('two');
      expect(rawRevisions()).toBe(before + 1);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a tracked replace folds into ONE review item; one approval settles both halves', () => {
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [para('The premium is $5,500 for 2026.')] }]
    });
    try {
      const live = ed as unknown as LiveEditor;
      const settings = (ed as any).documentEditorSettings.revisionSettings;
      ed.enableTrackChanges = true;
      settings.customData = JSON.stringify({
        v: 1,
        source: 'robin',
        changeSetId: 'cs-rep',
        group: 'update-premium'
      });
      // Overtype the selected "$5,500": SyncFusion records a Deletion (old
      // text) directly followed by an Insertion (new text).
      ed.selection.select('0;0;15', '0;0;21');
      ed.editor.insertText('$6,000');
      settings.customData = null;

      const views = listRevisionGroups(live);
      expect(views).toHaveLength(1);
      expect(views[0].items).toHaveLength(1);
      const item = views[0].items[0];
      expect(item.revisionType).toBe('Replace');
      // Old and new ride separately so review UI can render a −/+ diff.
      expect(item.beforeText).toBe('$5,500');
      expect(item.text).toBe('$6,000');
      expect(item.partner).toBeTruthy();

      // Either half resolves to the other (renderer-side classification),
      // including via the memo written on first lookup.
      expect(findReplaceCounterpart(item.revision)).toBe(item.partner);
      expect(findReplaceCounterpart(item.partner as any)).toBe(item.revision);

      // One approval resolves both underlying revisions as ONE undo unit
      // (this is what the panel does for a replace item).
      resolveRevisionsAsOneUndo(
        live,
        [item.revision, item.partner as any],
        true
      );
      expect((ed.revisions as any).changes.length).toBe(0);
      ed.selection.selectAll();
      expect(ed.selection.text).toContain('$6,000');
      expect(ed.selection.text).not.toContain('$5,500');

      // A single undo restores the WHOLE replace — both revisions pending
      // again and still folded as one Replace item, never a dangling
      // insertion left behind by a half-undone pair.
      ed.editorHistory.undo();
      expect((ed.revisions as any).changes.length).toBe(2);
      const restored = listRevisionGroups(live);
      expect(restored).toHaveLength(1);
      expect(restored[0].items).toHaveLength(1);
      expect(restored[0].items[0].revisionType).toBe('Replace');
      expect(restored[0].items[0].beforeText).toBe('$5,500');
      expect(restored[0].items[0].text).toBe('$6,000');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe("single review surface: suppressing SyncFusion's native revision pane", () => {
  it('showRevisions=false hides the native Changes pane without touching tracked-change marks', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        { blocks: [para('Draft paragraph'), para('Second paragraph')] }
      ]
    });
    try {
      // Track the edit before opening the pane - showRevisions=true makes
      // selection changes navigate the (unrendered, in this jsdom host) pane
      // list, which is not what this test is exercising.
      ed.enableTrackChanges = true;
      ed.selection.select('0;0;0', '0;0;5');
      ed.editor.insertText('Final');
      const revisionCount = ed.revisions.length;
      expect(revisionCount).toBeGreaterThan(0);

      const pane = () =>
        ed.element?.querySelector('.e-de-review-pane') as HTMLElement | null;

      // Property changes on an EJ2 component are pending until `dataBind()`
      // flushes them (its own documented behaviour); force the flush so this
      // test observes the same effect the running app sees, synchronously.

      // What DocumentEditorContainer hardcodes for its inner DocumentEditor.
      ed.showRevisions = true;
      (ed as any).dataBind();
      expect(pane()?.style.display).not.toBe('none');

      ed.showRevisions = false;
      (ed as any).dataBind();
      expect(pane()?.style.display).toBe('none');
      // The pane closed; the tracked-change marks it listed are untouched.
      expect(ed.revisions.length).toBe(revisionCount);
    } finally {
      destroyRealDocumentEditor(ed);
    }
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

// ---------------------------------------------------------------------------
// Table rows: insert a row and fill its cells.
//
// The captain's report was "for a brief second I saw a new row being added but
// it could not add data". Every cell of a freshly inserted row is empty, and
// overwriting an empty cell makes SyncFusion author an Insertion with no
// Deletion; the old revision-type assertion demanded the pair for every
// `set_cell_text`, so the fill was reported `untracked_write` and the
// compensating rollback then rejected the row insertion itself.
// ---------------------------------------------------------------------------

function locationScheduleCell(text: string) {
  return { cellFormat: {}, blocks: [{ inlines: [{ text }] }] };
}

function locationScheduleSfdt() {
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Location Schedule' }] },
          {
            tableFormat: {},
            rows: [
              {
                rowFormat: {},
                cells: [
                  locationScheduleCell('Loc #'),
                  locationScheduleCell('Address'),
                  locationScheduleCell('City')
                ]
              },
              {
                rowFormat: {},
                cells: [
                  locationScheduleCell('0093'),
                  locationScheduleCell('1 King St W'),
                  locationScheduleCell('Toronto')
                ]
              }
            ]
          },
          { inlines: [{ text: 'End' }] }
        ]
      }
    ]
  };
}

const blockTexts = (editor: DocumentEditor) =>
  flattenSfdt(JSON.parse(editor.serialize())).map((block) => block.text);

const revisionTypes = (editor: DocumentEditor) =>
  realRevisions(editor).map((revision) => revision.revisionType);

function premiumSummaryHeadingSfdt() {
  return {
    sections: Array.from({ length: 7 }, (_, sectionIndex) => ({
      blocks:
        sectionIndex === 6
          ? Array.from({ length: 28 }, (_, blockIndex) => {
              if (blockIndex === 16)
                return {
                  paragraphFormat: { styleName: 'Title' },
                  inlines: [{ text: 'Cyber Insurance' }]
                };
              if (blockIndex === 26)
                return {
                  paragraphFormat: { styleName: 'Title' },
                  inlines: [{ text: 'Premium Summary' }]
                };
              return { inlines: [{ text: `Section 6 block ${blockIndex}` }] };
            })
          : [{ inlines: [{ text: `Section ${sectionIndex}` }] }]
    }))
  };
}

function tableInsertionSfdt() {
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Homeowners Insurance' }] },
          { inlines: [{ text: '' }] }
        ]
      }
    ]
  };
}

describe('tracked inserts never author deletions', () => {
  it('real SDK: pure insert_text before the Premium Summary title creates no Deletion revision and reject restores the heading byte-for-byte', () => {
    const ed = makeRealDocumentEditor(premiumSummaryHeadingSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'g01-add-homeowners-section',
        edits: [
          {
            op: 'insert_text',
            anchor: '6;26',
            group: 'g01-add-homeowners-section',
            text: 'Homeowners Insurance\n\nCoverages and Limits\n\nForms & Endorsements\n\n',
            find: '',
            replace: '',
            expectLength: 0
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'insert_text'
      });
      expect(revisionTypes(ed).filter((type) => type === 'Deletion')).toEqual(
        []
      );
      expect(blockTexts(ed)).toContain('Premium Summary');

      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
      expect(blockTexts(ed)).toContain('Premium Summary');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: replace_text still authors the Deletion and Insertion pair', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Premium Summary' }] },
            { inlines: [{ text: 'End' }] }
          ]
        }
      ]
    });
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'rename-heading',
        edits: [
          {
            op: 'replace_text',
            anchor: '0;0',
            find: 'Premium',
            replace: 'Policy'
          }
        ]
      });

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'replace_text'
      });
      expect(revisionTypes(ed).sort()).toEqual(['Deletion', 'Insertion']);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe('insert_table requires same-batch cell writes', () => {
  it('real SDK: insert_table with no cell writes is refused before an empty grid is created', () => {
    const ed = makeRealDocumentEditor(tableInsertionSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'empty-homeowners-coverages-table',
        edits: [{ op: 'insert_table', anchor: '0;1', rows: 15, columns: 3 }]
      });

      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'insert_table',
        anchor: '0;1',
        error: 'empty_insert_table'
      });
      expect(result.results[0].message).toContain('15x3');
      expect(result.results[0].message).toContain('0;1');
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: insert_table accompanied by cell writes applies', () => {
    const ed = makeRealDocumentEditor(tableInsertionSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'filled-homeowners-coverages-table',
        edits: [
          { op: 'insert_table', anchor: '0;1', rows: 2, columns: 3 },
          { op: 'set_cell_text', anchor: '0;1;0;0;0', text: 'Coverage' },
          { op: 'set_cell_text', anchor: '0;1;0;1;0', text: 'Limit' },
          { op: 'set_cell_text', anchor: '0;1;0;2;0', text: 'Deductible' },
          { op: 'set_cell_text', anchor: '0;1;1;0;0', text: 'Dwelling' },
          { op: 'set_cell_text', anchor: '0;1;1;1;0', text: '$500,000' },
          { op: 'set_cell_text', anchor: '0;1;1;2;0', text: '$1,000' }
        ]
      });

      expect(result.results.map((entry) => entry.ok)).toEqual([
        true,
        true,
        true,
        true,
        true,
        true,
        true
      ]);
      expect(result.changeSet).toMatchObject({ status: 'applied' });
      expect(blockTexts(ed)).toEqual(
        expect.arrayContaining([
          'Coverage',
          'Limit',
          'Deductible',
          'Dwelling',
          '$500,000',
          '$1,000'
        ])
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: insert_table can populate its cells atomically', () => {
    const ed = makeRealDocumentEditor(tableInsertionSfdt());
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'filled-table-atomically',
        edits: [
          {
            op: 'insert_table',
            anchor: '0;1',
            rows: 2,
            columns: 2,
            initialCells: [
              ['Label', 'Value'],
              ['Example', '$10']
            ]
          }
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true, op: 'insert_table' });
      expect(result.changeSet).toMatchObject({ status: 'applied' });
      expect(blockTexts(ed)).toEqual(
        expect.arrayContaining(['Label', 'Value', 'Example', '$10'])
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: accepting a multi-table sibling section preserves top-to-bottom order', () => {
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [{ inlines: [{ text: 'Premium Summary' }] }] }]
    });
    try {
      ed.enableTrackChanges = true;
      const group = 'g01-new-section';
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'new-section-before-summary',
        edits: [
          { op: 'insert_text', group, anchor: '0;0', position: 'before', text: 'New Section' },
          { op: 'insert_text', group, anchor: '0;0', position: 'before', text: 'Policy Information' },
          {
            op: 'insert_table',
            group,
            anchor: '0;0',
            position: 'before',
            rows: 2,
            columns: 2,
            initialCells: [
              ['Policy', 'Term'],
              ['P-123', '2026 - 2027']
            ]
          },
          { op: 'insert_text', group, anchor: '0;0', position: 'before', text: 'Coverages' },
          {
            op: 'insert_table',
            group,
            anchor: '0;0',
            position: 'before',
            rows: 4,
            columns: 2,
            initialCells: [
              ['Coverage', 'Limit'],
              ['First', '$100'],
              ['Second', '$200'],
              ['Third', '$300']
            ]
          },
          { op: 'insert_text', group, anchor: '0;0', position: 'before', text: 'Deductibles' },
          {
            op: 'insert_table',
            group,
            anchor: '0;0',
            position: 'before',
            rows: 2,
            columns: 2,
            initialCells: [
              ['Type', 'Amount'],
              ['Base', '$1,000']
            ]
          }
        ]
      });

      expect(result.changeSet).toMatchObject({ status: 'applied' });
      const live = ed as unknown as LiveEditor;
      resolveLiveRevisionGroupsAsOneUndo(live, listRevisionGroups(live), true);
      expect(ed.revisions.length).toBe(0);
      expect(blockTexts(ed)).toEqual([
        'New Section',
        'Policy Information',
        'Policy',
        'Term',
        'P-123',
        '2026 - 2027',
        'Coverages',
        'Coverage',
        'Limit',
        'First',
        '$100',
        'Second',
        '$200',
        'Third',
        '$300',
        'Deductibles',
        'Type',
        'Amount',
        'Base',
        '$1,000',
        'Premium Summary'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: atomic cell text remains verifiable while inheriting a sibling table', () => {
    const sfdt = locationScheduleSfdt();
    sfdt.sections[0].blocks.splice(2, 0, { inlines: [{ text: '' }] });
    const ed = makeRealDocumentEditor(sfdt);
    try {
      ed.enableTrackChanges = true;
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'filled-table-with-inheritance',
        edits: [
          {
            op: 'insert_table',
            anchor: '0;3',
            rows: 2,
            columns: 3,
            initialCells: [
              ['Loc #', 'Address', 'City'],
              ['0094', '2 King St W', 'Toronto']
            ]
          }
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true, op: 'insert_table' });
      expect(result.changeSet).toMatchObject({ status: 'applied' });
      expect(blockTexts(ed)).toEqual(
        expect.arrayContaining([
          'Loc #',
          'Address',
          'City',
          '0094',
          '2 King St W',
          'Toronto'
        ])
      );
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: insert_table position after preserves both neighboring paragraphs and lands at the declared address', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Before' }] },
            { inlines: [{ text: 'After' }] }
          ]
        }
      ]
    });
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'table-after-paragraph',
        edits: [
          {
            op: 'insert_table',
            anchor: '0;0',
            expect: 'Before',
            position: 'after',
            rows: 1,
            columns: 2
          },
          { op: 'set_cell_text', anchor: '0;1;0;0;0', text: 'Field' },
          { op: 'set_cell_text', anchor: '0;1;0;1;0', text: 'Value' }
        ]
      });

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(blockTexts(ed)).toEqual(['Before', 'Field', 'Value', 'After']);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: composes several populated tables at one stable section boundary in one group', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            {
              paragraphFormat: { styleName: 'Title' },
              inlines: [{ text: 'Next Section' }]
            },
            { inlines: [{ text: 'End' }] }
          ]
        }
      ]
    });
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const group = 'g01-new-section';
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'multi-table-section-at-stable-boundary',
        edits: [
          {
            op: 'insert_text',
            group,
            anchor: '0;0',
            expect: 'Next Section',
            position: 'before',
            text: 'New Section'
          },
          {
            op: 'insert_text',
            group,
            anchor: '0;0',
            expect: 'Next Section',
            position: 'before',
            text: 'Policy Information'
          },
          {
            op: 'insert_table',
            group,
            anchor: '0;0',
            expect: 'Next Section',
            rows: 2,
            columns: 2
          },
          { op: 'set_cell_text', group, anchor: '0;2;0;0;0', text: 'Field' },
          { op: 'set_cell_text', group, anchor: '0;2;0;1;0', text: 'Value' },
          { op: 'set_cell_text', group, anchor: '0;2;1;0;0', text: 'Carrier' },
          {
            op: 'set_cell_text',
            group,
            anchor: '0;2;1;1;0',
            text: 'Example Co.'
          },
          {
            op: 'insert_text',
            group,
            anchor: '0;0',
            expect: 'Next Section',
            position: 'before',
            text: 'Deductibles'
          },
          {
            op: 'insert_table',
            group,
            anchor: '0;0',
            expect: 'Next Section',
            rows: 2,
            columns: 2
          },
          { op: 'set_cell_text', group, anchor: '0;4;0;0;0', text: 'Type' },
          { op: 'set_cell_text', group, anchor: '0;4;0;1;0', text: 'Amount' },
          { op: 'set_cell_text', group, anchor: '0;4;1;0;0', text: 'Base' },
          { op: 'set_cell_text', group, anchor: '0;4;1;1;0', text: '$1,000' }
        ]
      });

      expect(result.results.filter((entry) => !entry.ok)).toEqual([]);
      expect(result.changeSet).toMatchObject({
        status: 'applied',
        groups: [expect.objectContaining({ id: group })]
      });
      expect(blockTexts(ed)).toEqual([
        'New Section',
        'Policy Information',
        'Field',
        'Value',
        'Carrier',
        'Example Co.',
        'Deductibles',
        'Type',
        'Amount',
        'Base',
        '$1,000',
        'Next Section',
        'End'
      ]);

      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

describe('table rows: insert a row and fill its cells', () => {
  it('real SDK: fills every cell of a row it just inserted, in one change set, as one rejectable card', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'location-schedule-row',
        edits: [
          { op: 'insert_row', anchor: '0;1;1;0;0' },
          { op: 'set_cell_text', anchor: '0;1;2;0;0', text: '0094' },
          { op: 'set_cell_text', anchor: '0;1;2;1;0', text: '111 Bathurst St' },
          { op: 'set_cell_text', anchor: '0;1;2;2;0', text: 'Toronto' }
        ]
      });

      expect(result.results.map((r) => r.error)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined
      ]);
      expect(result.results.every((r) => r.ok)).toBe(true);
      expect(result.changeSet).toMatchObject({ status: 'applied' });

      // The row is present WITH its values.
      expect(blockTexts(ed)).toEqual([
        'Location Schedule',
        'Loc #',
        'Address',
        'City',
        '0093',
        '1 King St W',
        'Toronto',
        '0094',
        '111 Bathurst St',
        'Toronto',
        'End'
      ]);

      // ...and the whole thing is one rejectable tracked card.
      expect(realRevisions(ed).length).toBeGreaterThan(0);
      expect(
        realRevisions(ed).every(
          (revision) => typeof revision.reject === 'function'
        )
      ).toBe(true);
      rejectEveryRealRevision(ed);
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: fills the cells of an already-inserted row on a later call (two-phase)', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      const inserted = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'row-only',
        edits: [{ op: 'insert_row', anchor: '0;1;1;0;0' }]
      });
      expect(inserted.results[0]).toMatchObject({ ok: true, op: 'insert_row' });

      // The new row's cells are addressable from a fresh inventory read.
      const inventory = getDocumentInventory(ed as unknown as LiveEditor, {
        scope: 'full'
      });
      expect(inventory.inventory?.map((entry) => entry.anchor)).toEqual(
        expect.arrayContaining(['0;1;2;0;0', '0;1;2;1;0', '0;1;2;2;0'])
      );

      const filled = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'row-fill',
        edits: [
          { op: 'set_cell_text', anchor: '0;1;2;0;0', text: '0094' },
          { op: 'set_cell_text', anchor: '0;1;2;1;0', text: '111 Bathurst St' },
          { op: 'set_cell_text', anchor: '0;1;2;2;0', text: 'Toronto' }
        ]
      });
      expect(filled.results.map((r) => r.error)).toEqual([
        undefined,
        undefined,
        undefined
      ]);
      expect(filled.changeSet).toMatchObject({ status: 'applied' });
      expect(blockTexts(ed).slice(7, 10)).toEqual([
        '0094',
        '111 Bathurst St',
        'Toronto'
      ]);

      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a row insert and a row delete each produce a rejectable tracked revision of the right kind', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      expect(
        applyDocumentEdits(ed as unknown as LiveEditor, {
          changeSetId: 'row-insert-tracked',
          edits: [{ op: 'insert_row', anchor: '0;1;1;0;0' }]
        }).results[0]
      ).toMatchObject({ ok: true });
      expect(revisionTypes(ed)).toEqual(['Insertion']);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);

      expect(
        applyDocumentEdits(ed as unknown as LiveEditor, {
          changeSetId: 'row-delete-tracked',
          edits: [{ op: 'delete_row', anchor: '0;1;1;0;0' }]
        }).results[0]
      ).toMatchObject({ ok: true });
      expect(revisionTypes(ed)).toEqual(['Deletion']);
      expect(
        realRevisions(ed).every((r) => typeof r.reject === 'function')
      ).toBe(true);
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: insert_row honours above and count instead of silently dropping them', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      expect(
        applyDocumentEdits(ed as unknown as LiveEditor, {
          changeSetId: 'above-count',
          edits: [
            { op: 'insert_row', anchor: '0;1;1;0;0', above: true, count: 2 }
          ]
        }).results[0]
      ).toMatchObject({ ok: true });
      // Two empty rows sit between the header row and the pre-existing 0093 row.
      expect(blockTexts(ed)).toEqual([
        'Location Schedule',
        'Loc #',
        'Address',
        'City',
        '',
        '',
        '',
        '',
        '',
        '',
        '0093',
        '1 King St W',
        'Toronto',
        'End'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a deferred cell anchor which lands on existing content is refused and the row insert is rolled back', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      // Inserting ABOVE shifts the pre-existing 0093 row down into index 2, so
      // the deferred anchor now points at real content rather than a new cell.
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'deferred-occupied',
        edits: [
          { op: 'insert_row', anchor: '0;1;1;0;0', above: true },
          { op: 'set_cell_text', anchor: '0;1;2;0;0', text: '0094' }
        ]
      });

      expect(result.results[1]).toMatchObject({
        ok: false,
        error: 'deferred_anchor_occupied'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      // Nothing partially applied: the row insert was rejected with the set.
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a deferred cell anchor the structural op never creates fails the whole set', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'deferred-missing',
        edits: [
          { op: 'insert_row', anchor: '0;1;1;0;0' },
          { op: 'set_cell_text', anchor: '0;1;9;0;0', text: 'nope' }
        ]
      });
      expect(result.results[1]).toMatchObject({
        ok: false,
        error: 'anchor_not_found'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.revisions.length).toBe(0);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a row insert which bypasses track changes is refused (structural changes must be rejectable)', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const untrackedEditor = new Proxy(ed as unknown as LiveEditor, {
        get(target, property, receiver) {
          if (property === 'editor') {
            const realEditor: any = Reflect.get(target, property, receiver);
            return new Proxy(realEditor, {
              get(inner, method, innerReceiver) {
                const value = Reflect.get(inner, method, innerReceiver);
                if (method !== 'insertRow' || typeof value !== 'function')
                  return typeof value === 'function'
                    ? value.bind(inner)
                    : value;
                return (...args: any[]) => {
                  (target as any).enableTrackChanges = false;
                  try {
                    return value.apply(inner, args);
                  } finally {
                    (target as any).enableTrackChanges = true;
                  }
                };
              }
            });
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });

      const result = applyDocumentEdits(untrackedEditor, {
        changeSetId: 'untracked-row-insert',
        edits: [{ op: 'insert_row', anchor: '0;1;1;0;0' }]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'untracked_write'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a cell write which bypasses track changes is still refused as an untracked write', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      // Narrowly-scoped fault injector over a real DocumentEditor: the write
      // itself is a genuine SyncFusion operation, performed with track changes
      // silently switched off so it produces no rejectable revision at all.
      const untrackedEditor = new Proxy(ed as unknown as LiveEditor, {
        get(target, property, receiver) {
          if (property === 'editor') {
            const realEditor: any = Reflect.get(target, property, receiver);
            return new Proxy(realEditor, {
              get(inner, method, innerReceiver) {
                const value = Reflect.get(inner, method, innerReceiver);
                if (method !== 'insertText' || typeof value !== 'function')
                  return typeof value === 'function'
                    ? value.bind(inner)
                    : value;
                return (...args: any[]) => {
                  (target as any).enableTrackChanges = false;
                  try {
                    return value.apply(inner, args);
                  } finally {
                    (target as any).enableTrackChanges = true;
                  }
                };
              }
            });
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });

      const result = applyDocumentEdits(untrackedEditor, {
        changeSetId: 'untracked-cell-write',
        edits: [{ op: 'set_cell_text', anchor: '0;1;1;0;0', text: '9999' }]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'untracked_write'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      // The untracked write is not recoverable through revisions, so the guard
      // exists precisely to stop it being reported as a successful edit.
      expect(ed.serialize()).not.toBe(before);
      expect(blockTexts(ed)).toContain('9999');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// The captain asked for "a page saying Thank you in the middle of the page, all
// caps and bold in bigger format". The page landed and the text never did: the
// text half was refused upstream, and batching it with the break was refused
// here too, because preflight demanded that `insert_text`'s anchor already
// exist when the break in the same batch is what creates it.
const closingSfdt = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Closing Summary' }] },
        { inlines: [{ text: 'We appreciate your business.' }] },
        { inlines: [] }
      ],
      sectionFormat: { pageWidth: 612, pageHeight: 792 }
    }
  ]
});

describe('new page: add a page and put formatted text on it', () => {
  it('real SDK: page break plus centred bold enlarged text, in one change set', () => {
    const ed = makeRealDocumentEditor(closingSfdt());
    try {
      ed.enableTrackChanges = true;

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'thank-you-page',
        edits: [
          { op: 'insert_page_break', anchor: '0;2' },
          { op: 'insert_text', anchor: '0;3', text: 'THANK YOU' },
          {
            op: 'set_char_format',
            anchor: '0;3',
            expect: 'THANK YOU',
            bold: true,
            allCaps: true,
            fontSize: 28
          },
          {
            op: 'set_para_format',
            anchor: '0;3',
            expect: 'THANK YOU',
            alignment: 'Center',
            beforeSpacing: 260
          }
        ]
      });

      expect(result.results.map((r) => r.error)).toEqual([
        undefined,
        undefined,
        undefined,
        undefined
      ]);
      expect(result.results.every((r) => r.ok)).toBe(true);
      expect(result.changeSet).toMatchObject({ status: 'applied' });

      // A new final page carrying the text.
      expect(blockTexts(ed)).toEqual([
        'Closing Summary',
        'We appreciate your business.',
        '\f',
        'THANK YOU'
      ]);

      // Centred, bold, bigger - on the inserted paragraph itself.
      ed.selection.select('0;3;0', '0;3;9');
      expect(ed.selection.text).toBe('THANK YOU');
      expect(ed.selection.characterFormat.bold).toBe(true);
      expect(ed.selection.characterFormat.allCaps).toBe(true);
      expect(ed.selection.characterFormat.fontSize).toBe(28);
      expect(ed.selection.paragraphFormat.textAlignment).toBe('Center');

      // ...and the text is a rejectable tracked card.
      expect(revisionTypes(ed)).toContain('Insertion');
      expect(
        realRevisions(ed).every(
          (revision) => typeof revision.reject === 'function'
        )
      ).toBe(true);
      rejectEveryRealRevision(ed);
      expect(blockTexts(ed)).toEqual([
        'Closing Summary',
        'We appreciate your business.',
        ''
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: refuses a deferred paragraph anchor that lands on existing content', () => {
    const ed = makeRealDocumentEditor(closingSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      // `0;1` already reads "We appreciate your business."; the break creates
      // `0;3`, so this deferred anchor is not the paragraph it names.
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'wrong-deferred-anchor',
        edits: [
          { op: 'insert_page_break', anchor: '0;2' },
          { op: 'insert_text', anchor: '0;4', text: 'THANK YOU' }
        ]
      });

      expect(result.results[1]).toMatchObject({ ok: false });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      // Nothing partially applies: the break it created is rolled back too.
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: delete_paragraph refuses visible content unless forced, and treats underscore as visible', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Keep me' }] },
            { inlines: [{ text: '_' }] },
            { inlines: [{ text: '' }] }
          ]
        }
      ]
    });
    try {
      const nonEmpty = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'refuse-non-empty-paragraph',
        edits: [{ op: 'delete_paragraph', anchor: '0;0', expect: 'Keep me' }]
      });
      expect(nonEmpty.results[0]).toMatchObject({
        ok: false,
        op: 'delete_paragraph',
        error: 'paragraph_not_empty'
      });
      expect(blockTexts(ed)).toEqual(['Keep me', '_', '']);

      const underscore = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'refuse-underscore-paragraph',
        edits: [{ op: 'delete_paragraph', anchor: '0;1', expect: '_' }]
      });
      expect(underscore.results[0]).toMatchObject({
        ok: false,
        op: 'delete_paragraph',
        error: 'paragraph_not_empty'
      });
      expect(blockTexts(ed)).toEqual(['Keep me', '_', '']);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: rejecting a paragraph deletion restores the document byte-for-byte', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Before' }] },
            { inlines: [] },
            { inlines: [{ text: 'After' }] }
          ]
        }
      ]
    });
    try {
      const before = ed.serialize();
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'delete-empty-paragraph',
        edits: [{ op: 'delete_paragraph', anchor: '0;1', expect: '' }]
      });

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'delete_paragraph'
      });
      expect(blockTexts(ed)).toEqual(['Before', 'After']);
      expect(revisionTypes(ed)).toContain('Deletion');
      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: anchors after a paragraph deletion resolve for later ops in the same batch', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Intro' }] },
            { inlines: [] },
            { inlines: [{ text: 'Target Heading' }] },
            { inlines: [{ text: 'Tail' }] }
          ]
        }
      ]
    });
    try {
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'delete-then-format-shifted-anchor',
        edits: [
          { op: 'delete_paragraph', anchor: '0;1', expect: '' },
          {
            op: 'set_para_format',
            anchor: '0;2',
            expect: 'Target Heading',
            alignment: 'Center'
          }
        ]
      });

      expect(result.results.every((r) => r.ok)).toBe(true);
      expect(blockTexts(ed)).toEqual(['Intro', 'Target Heading', 'Tail']);
      ed.selection.select('0;2;0', '0;2;14');
      expect(ed.selection.text).toBe('Target Heading');
      expect(ed.selection.paragraphFormat.textAlignment).toBe('Center');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Explicit structural table ops and section breaks. These previously fell to a
// generic zero-argument snake_case->camelCase dispatch; each now has its own
// case, and an op outside the vocabulary is refused immediately with
// retry:'never' instead of being guessed at.
// ---------------------------------------------------------------------------

// The live editor serializes optimized SFDT with abbreviated keys
// (sections -> sec, sectionFormat -> secpr, breakCode -> bc); accept both.
const serializedSections = (editor: DocumentEditor): any[] => {
  const parsed = JSON.parse(editor.serialize());
  return parsed.sections ?? parsed.sec ?? [];
};

const serializedBreakCode = (section: any): string | undefined => {
  const format = section.sectionFormat ?? section.secpr;
  return format?.breakCode ?? format?.bc;
};

describe('explicit table structure and section break ops', () => {
  it('real SDK: delete_table marks the whole anchored table as a tracked deletion; accepting removes it', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'table-delete',
        edits: [{ op: 'delete_table', anchor: '0;1;0;0;0' }]
      });
      expect(result.results[0]).toMatchObject({ ok: true, op: 'delete_table' });
      expect(revisionTypes(ed)).toContain('Deletion');

      ed.revisions.acceptAll();
      expect(blockTexts(ed)).toEqual(['Location Schedule', 'End']);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: delete_row deletes the anchored row; rejecting restores the document byte-for-byte', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'row-delete',
        edits: [{ op: 'delete_row', anchor: '0;1;1;0;0' }]
      });
      expect(result.results[0]).toMatchObject({ ok: true, op: 'delete_row' });
      expect(revisionTypes(ed)).toEqual(['Deletion']);

      rejectEveryRealRevision(ed);
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  // SyncFusion cannot delete a column or merge cells as a tracked change: both
  // sit behind a blocking "wont be marked as change" confirmation dialog, and a
  // human clicking OK would produce an UNTRACKED change that survives
  // reject-all. This engine applies every change set tracked, so the ops are
  // out of the vocabulary and must refuse loudly instead of reporting ok:true
  // while doing nothing.
  it.each(['delete_column', 'merge_cells'])(
    'real SDK: %s is refused as outside the vocabulary, never as a false success',
    (op) => {
      const ed = makeRealDocumentEditor(locationScheduleSfdt());
      try {
        ed.enableTrackChanges = true;
        const before = ed.serialize();

        const result = applyDocumentEdits(ed as unknown as LiveEditor, {
          changeSetId: `${op}-refused`,
          edits: [{ op, anchor: '0;1;0;0;0' }]
        });
        expect(result.results[0]).toMatchObject({
          ok: false,
          op,
          error: 'unsupported_op',
          retry: 'never'
        });
        expect(ed.serialize()).toBe(before);
      } finally {
        destroyRealDocumentEditor(ed);
      }
    }
  );

  it('real SDK: insert_section_break passes sectionBreakType (Continuous) instead of dropping it', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Alpha' }] },
            { inlines: [{ text: 'Beta' }] }
          ]
        }
      ]
    });
    try {
      ed.enableTrackChanges = true;

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'continuous-break',
        edits: [
          {
            op: 'insert_section_break',
            anchor: '0;1',
            sectionBreakType: 'Continuous'
          }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'insert_section_break'
      });

      const sections = serializedSections(ed);
      expect(sections).toHaveLength(2);
      // SyncFusion spells the Word "Continuous" break "NoBreak" at runtime.
      expect(sections.map(serializedBreakCode)).toContain('NoBreak');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: insert_section_break without a type keeps the NewPage default', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            { inlines: [{ text: 'Alpha' }] },
            { inlines: [{ text: 'Beta' }] }
          ]
        }
      ]
    });
    try {
      ed.enableTrackChanges = true;

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'default-break',
        edits: [{ op: 'insert_section_break', anchor: '0;1' }]
      });
      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'insert_section_break'
      });

      const sections = serializedSections(ed);
      expect(sections).toHaveLength(2);
      expect(sections.map(serializedBreakCode)).not.toContain('NoBreak');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: an op outside the vocabulary fails immediately with unsupported_op and retry:never', () => {
    const ed = makeRealDocumentEditor(locationScheduleSfdt());
    try {
      ed.enableTrackChanges = true;
      const before = ed.serialize();

      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'unknown-op',
        edits: [
          { op: 'set_cell_shading', anchor: '0;1;0;0;0', color: '#D3D3D3' }
        ]
      });
      expect(result.results[0]).toMatchObject({
        ok: false,
        op: 'set_cell_shading',
        error: 'unsupported_op',
        retry: 'never'
      });
      expect(result.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// S3: the structure leg. A document's skeleton - headings, tables, section
// boundaries - answers most navigation questions ("where is the Location
// Schedule") at a token cost that is a rounding error next to the content,
// and it must keep working exactly where `full` is refused.
// ---------------------------------------------------------------------------

describe('structure scope (the cheap navigation leg)', () => {
  const structuredDoc = {
    sections: [
      {
        blocks: [
          para('Executive Summary', 'Heading 1'),
          para('This is the intro.'),
          {
            rows: [
              {
                cells: [
                  { blocks: [para('Loc #')] },
                  { blocks: [para('Address'), para('(line 2)')] }
                ]
              },
              {
                cells: [
                  { blocks: [para('1')] },
                  { blocks: [para('111 Bathurst St')] }
                ]
              }
            ]
          },
          para('Pricing', 'Heading 1'),
          para('Quote: $5,500')
        ]
      },
      {
        blocks: [para('Appendix', 'Heading 1'), para('The fine print.')]
      }
    ]
  };

  it('returns headings, tables and section boundaries - and no body text', () => {
    const blocks = flattenSfdt(structuredDoc);
    const res = buildInventoryFromBlocks(blocks, { scope: 'structure' }) as any;
    const structure = res.structure;

    expect(structure.blockCount).toBe(blocks.length);
    expect(structure.headings.map((h: any) => h.heading)).toEqual([
      'Executive Summary',
      'Pricing',
      'Appendix'
    ]);
    // The table is located by its anchor and recognisable from its header row.
    expect(structure.tables).toEqual([
      {
        anchor: '0;2',
        rows: 2,
        columns: 2,
        firstRowCells: ['Loc #', 'Address (line 2)']
      }
    ]);
    expect(structure.sections).toEqual([
      { section: 0, firstAnchor: '0;0', blockCount: 9 },
      { section: 1, firstAnchor: '1;0', blockCount: 2 }
    ]);

    // The skeleton must stay a skeleton: body text and non-header cell values
    // do not ride along.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('Quote: $5,500');
    expect(serialized).not.toContain('111 Bathurst St');
    expect(serialized).not.toContain('This is the intro.');
  });

  it('keeps working past the block limit where full is refused', () => {
    const many = Array.from(
      { length: FULL_INVENTORY_BLOCK_LIMIT + 1 },
      (_, i) => para(`p${i}`, i % 100 === 0 ? 'Heading 1' : undefined)
    );
    const blocks = flattenSfdt({ sections: [{ blocks: many }] });

    expect(
      (buildInventoryFromBlocks(blocks, { scope: 'full' }) as any).error
    ).toBe('document_too_large');

    const res = buildInventoryFromBlocks(blocks, { scope: 'structure' }) as any;
    expect(res.structure.blockCount).toBe(FULL_INVENTORY_BLOCK_LIMIT + 1);
    expect(res.structure.headings).toHaveLength(9);
  });

  it('caps headings and tables with maxEntries', () => {
    const blocks = flattenSfdt(structuredDoc);
    const res = buildInventoryFromBlocks(blocks, {
      scope: 'structure',
      maxEntries: 1
    }) as any;
    expect(res.structure.headings).toHaveLength(1);
    expect(res.structure.tables).toHaveLength(1);
  });

  it('is reachable through the live getDocumentInventory read', () => {
    const editor = make([
      para('Coverage', 'Heading 1'),
      para('General Liability: included.')
    ]);
    const res = getDocumentInventory(editor, { scope: 'structure' }) as any;
    expect(res.structure.headings).toEqual([
      { anchor: '0;0', heading: 'Coverage', level: 1, blockCount: 1 }
    ]);
    expect(res.structure.tables).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S3: refusal with remedy. A refusal that names only the prohibition is an
// invitation to resend the identical call (the 17x retry); every retrieval
// refusal must carry what to do instead, machine-readable.
// ---------------------------------------------------------------------------

describe('retrieval refusals carry their remedy', () => {
  it('document_too_large keeps its hard limit and names structure as the way in', () => {
    const many = Array.from(
      { length: FULL_INVENTORY_BLOCK_LIMIT + 1 },
      (_, i) => para(`p${i}`)
    );
    const blocks = flattenSfdt({ sections: [{ blocks: many }] });
    const res = buildInventoryFromBlocks(blocks, { scope: 'full' }) as any;

    expect(res.error).toBe('document_too_large');
    expect(res.remedy).toEqual({
      action: 'narrow',
      tool: 'getDocumentInventory',
      input: { scope: 'structure' }
    });
    expect(res.retry).toBe('after_remedy');
    // The prose half must also say what to do, not only what failed.
    expect(res.message).toContain('structure');
    expect(res.message).toContain('section');
  });

  it('missing_section_anchor and section_not_found point back to a structure read', () => {
    const blocks = flattenSfdt({
      sections: [{ blocks: [para('Only paragraph')] }]
    });

    const missing = buildInventoryFromBlocks(blocks, {
      scope: 'section'
    }) as any;
    expect(missing.error).toBe('missing_section_anchor');
    expect(missing.remedy).toMatchObject({ tool: 'getDocumentInventory' });
    expect(missing.retry).toBe('modified_input');

    const notFound = buildInventoryFromBlocks(blocks, {
      scope: 'section',
      sectionAnchor: '9;9'
    }) as any;
    expect(notFound.error).toBe('section_not_found');
    expect(notFound.remedy).toEqual({
      action: 're-read',
      tool: 'getDocumentInventory',
      input: { scope: 'structure' }
    });
    expect(notFound.retry).toBe('after_remedy');
  });
});

// ---------------------------------------------------------------------------
// Inheritance by default (S4b): paragraphs an insert creates are formatted to
// match their neighbors by the engine itself, in the same change set - the
// captain's "they are not even concerned about formatting" requirement. Every
// case runs the real DocumentEditor; resolved formats are read off the live
// selection, exactly what the user sees.
// ---------------------------------------------------------------------------

describe('inheritance by default (S4b)', () => {
  const hilbStyles = [
    {
      type: 'Paragraph',
      name: 'headingNoToc',
      basedOn: 'Normal',
      next: 'Normal',
      characterFormat: {
        bold: true,
        fontFamily: 'Arial',
        fontSize: 14,
        fontColor: '#1F4E79'
      },
      paragraphFormat: {
        beforeSpacing: 12,
        afterSpacing: 6,
        lineSpacing: 1,
        lineSpacingType: 'Multiple'
      }
    },
    {
      type: 'Paragraph',
      name: 'Body Text',
      basedOn: 'Normal',
      next: 'Body Text',
      characterFormat: { fontFamily: 'Georgia', fontSize: 10.5 },
      paragraphFormat: {
        afterSpacing: 8,
        lineSpacing: 1.15,
        lineSpacingType: 'Multiple'
      }
    }
  ];

  // Mirror of the captain's live document around "Our Values": a custom
  // heading style with a direct fontSize override, a Body Text paragraph, and
  // the empty separator paragraph where the prompt recipe anchors inserts.
  const hilbSfdt = () => ({
    sections: [
      {
        blocks: [
          {
            paragraphFormat: { styleName: 'headingNoToc' },
            inlines: [
              { text: 'Our Approach', characterFormat: { fontSize: 12 } }
            ]
          },
          {
            paragraphFormat: { styleName: 'Body Text' },
            inlines: [
              {
                text: 'We believe effective insurance strategies start with understanding.'
              }
            ]
          },
          { inlines: [{ text: '' }] },
          {
            paragraphFormat: { styleName: 'Body Text' },
            inlines: [{ text: 'How We Support Clients' }]
          }
        ]
      }
    ],
    styles: hilbStyles
  });

  const scheduleTableSfdt = () => ({
    sections: [
      {
        blocks: [
          {
            paragraphFormat: { styleName: 'headingNoToc' },
            inlines: [{ text: 'Location Schedule' }]
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
                        paragraphFormat: {
                          textAlignment: 'Center',
                          styleName: 'Body Text'
                        },
                        inlines: [
                          {
                            text: 'Loc #',
                            characterFormat: { bold: true, fontSize: 12 }
                          }
                        ]
                      }
                    ]
                  },
                  {
                    cellFormat: {},
                    blocks: [
                      {
                        paragraphFormat: {
                          textAlignment: 'Center',
                          styleName: 'Body Text'
                        },
                        inlines: [
                          {
                            text: 'Address',
                            characterFormat: { bold: true, fontSize: 12 }
                          }
                        ]
                      }
                    ]
                  }
                ]
              },
              {
                rowFormat: {},
                cells: [
                  {
                    cellFormat: {},
                    blocks: [
                      {
                        paragraphFormat: { styleName: 'Body Text' },
                        inlines: [{ text: '0001' }]
                      }
                    ]
                  },
                  {
                    cellFormat: {},
                    blocks: [
                      {
                        paragraphFormat: { styleName: 'Body Text' },
                        inlines: [{ text: '' }]
                      }
                    ]
                  }
                ]
              }
            ]
          },
          {
            paragraphFormat: { styleName: 'Body Text' },
            inlines: [{ text: 'Trailing body paragraph.' }]
          }
        ]
      }
    ],
    styles: hilbStyles
  });

  const sectionBoundarySfdt = (separator: '' | 'blank' | 'double' | 'page') => {
    const section = (name: string) => [
      {
        paragraphFormat: {
          styleName: 'Heading 1',
          beforeSpacing: 12
        },
        inlines: [{ text: name, characterFormat: { bold: true, fontSize: 16 } }]
      },
      {
        paragraphFormat: { styleName: 'Body Text', afterSpacing: 6 },
        inlines: [{ text: `${name} body` }]
      }
    ];
    const between = () =>
      separator === 'blank' || separator === 'double'
        ? Array.from({ length: separator === 'double' ? 2 : 1 }, () => ({
            inlines: [{ text: '' }]
          }))
        : separator === 'page'
        ? [{ inlines: [{ text: '\f' }] }]
        : [];
    return {
      sections: [
        {
          blocks: [
            ...section('North'),
            ...between(),
            ...section('South'),
            ...between(),
            ...section('East')
          ]
        }
      ],
      styles: [
        ...hilbStyles,
        {
          type: 'Paragraph',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Body Text',
          characterFormat: { bold: true, fontSize: 16 },
          paragraphFormat: { outlineLevel: 'Level1', beforeSpacing: 12 }
        }
      ]
    };
  };

  const CELL_PARA_PROPS = [
    'textAlignment',
    'leftIndent',
    'beforeSpacing',
    'afterSpacing',
    'lineSpacing',
    'contextualSpacing',
    'bidi'
  ] as const;

  function readCellParaFormat(
    editor: DocumentEditor,
    anchor: string,
    len: number
  ) {
    editor.selection.select(`${anchor};0`, `${anchor};${len + 1}`);
    const out: Record<string, any> = {};
    for (const prop of CELL_PARA_PROPS)
      out[prop] = (editor.selection.paragraphFormat as any)[prop];
    return out;
  }

  it('real SDK: a plain section insert matches its neighbors per paragraph role, no second change set', () => {
    const ed = makeRealDocumentEditor(hilbSfdt());
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'insert-our-values-default',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;2',
            text: 'Our Values\nOur values guide how we serve clients every day.'
          }
        ]
      });
      expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
      expect(res.changeSet).toMatchObject({ status: 'applied' });

      // The heading paragraph matched the heading reference - including the
      // 12 pt DIRECT override the named style alone would have hidden.
      const heading = selectRealBlock(ed, '0;2', 'Our Values');
      expect(
        (heading.paragraphFormat.styleName as any)?.name ??
          heading.paragraphFormat.styleName
      ).toBe('headingNoToc');
      expect(heading.characterFormat.fontFamily).toBe('Arial');
      expect(heading.characterFormat.fontSize).toBe(12);
      expect(heading.characterFormat.bold).toBe(true);

      // The body paragraph matched the body reference, not the heading.
      const body = selectRealBlock(
        ed,
        '0;3',
        'Our values guide how we serve clients every day.'
      );
      expect(body.characterFormat.fontFamily).toBe('Georgia');
      expect(body.characterFormat.fontSize).toBe(10.5);
      expect(body.characterFormat.bold).toBe(false);
      expect(body.paragraphFormat.afterSpacing).toBe(8);
      expect(body.paragraphFormat.lineSpacing).toBeCloseTo(1.15, 5);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a new section inherits one blank paragraph above and below in its own accept group', () => {
    const ed = makeRealDocumentEditor(sectionBoundarySfdt('blank'));
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'section-boundary-blank',
        edits: [
          {
            op: 'insert_text',
            group: 'new-section',
            anchor: '0;2',
            text: 'Inserted\nInserted body'
          }
        ]
      });

      expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
      expect(blockTexts(ed)).toEqual([
        'North',
        'North body',
        '',
        'Inserted',
        'Inserted body',
        '',
        'South',
        'South body',
        '',
        'East',
        'East body'
      ]);
      expect(
        selectRealBlock(ed, '0;3', 'Inserted').paragraphFormat.beforeSpacing
      ).toBe(12);
      expect(
        selectRealBlock(ed, '0;4', 'Inserted body').paragraphFormat.afterSpacing
      ).toBe(6);
      expect(res.changeSet?.groups).toEqual([
        expect.objectContaining({
          id: 'new-section',
          opIndices: [0],
          revisionCount: expect.any(Number)
        })
      ]);
      const cards = listRevisionGroups(ed as unknown as LiveEditor);
      expect(cards).toHaveLength(1);
      expect(cards[0].group).toBe('new-section');
      cards[0].items[0].revision.accept?.();
      expect(listRevisionGroups(ed as unknown as LiveEditor)).toHaveLength(0);
      expect(blockTexts(ed).slice(2, 7)).toEqual([
        '',
        'Inserted',
        'Inserted body',
        '',
        'South'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a new section inherits direct adjacency without padding', () => {
    const ed = makeRealDocumentEditor(sectionBoundarySfdt(''));
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'section-boundary-none',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;2',
            position: 'before',
            text: 'Inserted\nInserted body'
          }
        ]
      });

      expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
      expect(blockTexts(ed)).toEqual([
        'North',
        'North body',
        'Inserted',
        'Inserted body',
        'South',
        'South body',
        'East',
        'East body'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a new section inherits a double-blank convention without hardcoding one line', () => {
    const ed = makeRealDocumentEditor(sectionBoundarySfdt('double'));
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'section-boundary-double',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;2',
            text: 'Inserted\nInserted body'
          }
        ]
      });

      expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
      expect(blockTexts(ed).slice(0, 10)).toEqual([
        'North',
        'North body',
        '',
        '',
        'Inserted',
        'Inserted body',
        '',
        '',
        'South',
        'South body'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a new section inherits page-break section boundaries', () => {
    const ed = makeRealDocumentEditor(sectionBoundarySfdt('page'));
    try {
      expect(
        deriveSectionPattern(ed as unknown as LiveEditor).pattern.boundary
          ?.separator
      ).toEqual({
        value: ['page_break'],
        confidence: { matches: 2, sampled: 2, level: 'medium' }
      });
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'section-boundary-page',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;3',
            position: 'before',
            text: 'Inserted\nInserted body'
          }
        ]
      });

      expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
      expect(blockTexts(ed)).toEqual([
        'North',
        'North body',
        '\f',
        'Inserted',
        'Inserted body',
        '\f',
        'South',
        'South body',
        '\f',
        'East',
        'East body'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a mid-paragraph insert is left to SyncFusion run inheritance', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            {
              paragraphFormat: { styleName: 'Body Text' },
              inlines: [
                { text: 'The quick ' },
                {
                  text: 'brown',
                  characterFormat: { bold: true, fontColor: '#AA0000' }
                },
                { text: ' fox jumps.' }
              ]
            }
          ]
        }
      ],
      styles: hilbStyles
    });
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'mid-paragraph-insert',
        edits: [{ op: 'insert_text', anchor: '0;0', offset: 15, text: 'ish' }]
      });
      expect(res.results[0]).toMatchObject({ ok: true });
      // The inserted run adopted the run before the caret - the correct
      // behavior the computed default must not disturb.
      ed.selection.select('0;0;15', '0;0;18');
      expect(ed.selection.text).toBe('ish');
      expect(ed.selection.characterFormat.bold).toBe(true);
      expect(ed.selection.characterFormat.fontColor).toBe('#AA0000');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a paragraph split off a heading falls back to the document default, not the heading dress', () => {
    const ed = makeRealDocumentEditor(hilbSfdt());
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'split-off-heading',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;0',
            position: 'after',
            text: 'New Section'
          }
        ]
      });
      expect(res.results[0]).toMatchObject({ ok: true });
      const inserted = selectRealBlock(ed, '0;1', 'New Section');
      expect(
        (inserted.paragraphFormat.styleName as any)?.name ??
          inserted.paragraphFormat.styleName
      ).toBe('Normal');
      expect(inserted.characterFormat.bold).toBe(false);
      // The heading itself is untouched.
      const heading = selectRealBlock(ed, '0;0', 'Our Approach');
      expect(
        (heading.paragraphFormat.styleName as any)?.name ??
          heading.paragraphFormat.styleName
      ).toBe('headingNoToc');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: inheritFormatFrom into a table cell applies and verifies (cell-toggle write path fixed)', () => {
    const ed = makeRealDocumentEditor(scheduleTableSfdt());
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'cell-inherit-header',
        edits: [
          {
            op: 'apply_style',
            anchor: '0;1;1;0;0',
            expect: '0001',
            inheritFormatFrom: '0;1;0;0;0'
          }
        ]
      });
      expect(res.results[0]).toMatchObject({ ok: true, op: 'apply_style' });
      expect(res.changeSet).toMatchObject({ status: 'applied' });
      const cell = selectRealBlock(ed, '0;1;1;0;0', '0001');
      expect(cell.characterFormat.bold).toBe(true);
      expect(cell.characterFormat.fontSize).toBe(12);
      const para = readCellParaFormat(ed, '0;1;1;0;0', 4);
      expect(para.textAlignment).toBe('Center');
      // The two toggle-semantics properties stayed put.
      expect(para.bidi).toBe(false);
      expect(para.contextualSpacing).toBe(false);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a body source formats a cell target cleanly too', () => {
    const ed = makeRealDocumentEditor(scheduleTableSfdt());
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'body-to-cell-inherit',
        edits: [
          {
            op: 'apply_style',
            anchor: '0;1;1;0;0',
            expect: '0001',
            inheritFormatFrom: '0;2'
          }
        ]
      });
      expect(res.results[0]).toMatchObject({ ok: true });
      const cell = selectRealBlock(ed, '0;1;1;0;0', '0001');
      expect(cell.characterFormat.fontFamily).toBe('Georgia');
      expect(readCellParaFormat(ed, '0;1;1;0;0', 4).bidi).toBe(false);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a failed sibling rolls a cell inherit back to its exact prior paragraph format', () => {
    const ed = makeRealDocumentEditor(scheduleTableSfdt());
    try {
      const before = readCellParaFormat(ed, '0;1;1;0;0', 4);
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'cell-inherit-sibling-fails',
        edits: [
          {
            op: 'apply_style',
            anchor: '0;1;1;0;0',
            expect: '0001',
            inheritFormatFrom: '0;1;0;0;0'
          },
          // Fails at apply time (missing_format), AFTER the cell inherit has
          // already written - exactly the shape that used to corrupt
          // textAlignment through the toggle-semantics restore path.
          { op: 'set_char_format', anchor: '0;2' }
        ]
      });
      expect(res.changeSet).toMatchObject({ status: 'failed' });
      expect(res.results[1]).toMatchObject({
        ok: false,
        error: 'missing_format'
      });
      expect(readCellParaFormat(ed, '0;1;1;0;0', 4)).toEqual(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: insert_text honours an explicit inheritFormatFrom for the paragraph it fills', () => {
    const ed = makeRealDocumentEditor(hilbSfdt());
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'insert-with-explicit-inherit',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;2',
            text: 'Our Values',
            // The computed default would pick the BODY reference for a
            // single-paragraph insert; the explicit source must win.
            inheritFormatFrom: '0;0'
          }
        ]
      });
      expect(res.results[0]).toMatchObject({ ok: true, op: 'insert_text' });
      const inserted = selectRealBlock(ed, '0;2', 'Our Values');
      expect(
        (inserted.paragraphFormat.styleName as any)?.name ??
          inserted.paragraphFormat.styleName
      ).toBe('headingNoToc');
      expect(inserted.characterFormat.fontSize).toBe(12);
      expect(inserted.characterFormat.bold).toBe(true);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: inheritFormatFrom on a mid-text insert is refused, not silently ignored', () => {
    const ed = makeRealDocumentEditor(hilbSfdt());
    try {
      const before = ed.serialize();
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'inherit-mid-text-insert',
        edits: [
          {
            op: 'insert_text',
            anchor: '0;1',
            offset: 10,
            text: 'truly ',
            inheritFormatFrom: '0;0'
          }
        ]
      });
      expect(res.results[0]).toMatchObject({
        ok: false,
        error: 'inherit_requires_new_paragraph'
      });
      expect(res.changeSet).toMatchObject({ status: 'failed' });
      expect(ed.serialize()).toBe(before);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: an empty inheritFormatFrom source is refused at preflight with nothing written', () => {
    const ed = makeRealDocumentEditor(hilbSfdt());
    try {
      const before = ed.serialize();
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'inherit-from-empty-separator',
        edits: [
          {
            op: 'apply_style',
            anchor: '0;0',
            expect: 'Our Approach',
            inheritFormatFrom: '0;2'
          }
        ]
      });
      expect(res.results[0]).toMatchObject({
        ok: false,
        error: 'inherit_source_empty'
      });
      expect(ed.serialize()).toBe(before);
      const heading = selectRealBlock(ed, '0;0', 'Our Approach');
      expect(
        (heading.paragraphFormat.styleName as any)?.name ??
          heading.paragraphFormat.styleName
      ).toBe('headingNoToc');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: inserting into an empty document succeeds with document defaults', () => {
    const ed = makeRealDocumentEditor({
      sections: [{ blocks: [{ inlines: [{ text: '' }] }] }]
    });
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'empty-document-insert',
        edits: [
          { op: 'insert_text', anchor: '0;0', text: 'Hello\nWorld follows.' }
        ]
      });
      expect(res.results[0]).toMatchObject({ ok: true });
      expect(res.changeSet).toMatchObject({ status: 'applied' });
      const first = selectRealBlock(ed, '0;0', 'Hello');
      expect(
        (first.paragraphFormat.styleName as any)?.name ??
          first.paragraphFormat.styleName
      ).toBe('Normal');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a cell insert with no in-cell reference is left to SyncFusion cell defaults', () => {
    // A dedicated shape: the empty data cell sits DIRECTLY under the bold
    // 12 pt header cell, so any reference walk that crosses the cell boundary
    // is visible as bold/12 leaking into the data cell.
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
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
                          paragraphFormat: {
                            textAlignment: 'Center',
                            styleName: 'Body Text'
                          },
                          inlines: [
                            {
                              text: 'Loc #',
                              characterFormat: { bold: true, fontSize: 12 }
                            }
                          ]
                        }
                      ]
                    }
                  ]
                },
                {
                  rowFormat: {},
                  cells: [
                    {
                      cellFormat: {},
                      blocks: [
                        {
                          paragraphFormat: { styleName: 'Body Text' },
                          inlines: [{ text: '' }]
                        }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ],
      styles: hilbStyles
    });
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'cell-insert-no-reference',
        edits: [{ op: 'insert_text', anchor: '0;0;1;0;0', text: '0002' }]
      });
      expect(res.results[0]).toMatchObject({ ok: true });
      const cell = selectRealBlock(ed, '0;0;1;0;0', '0002');
      expect(cell.characterFormat.bold).toBe(false);
      expect(cell.characterFormat.fontSize).not.toBe(12);
      expect(readCellParaFormat(ed, '0;0;1;0;0', 4).textAlignment).toBe('Left');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: explicit formatting in the same change set wins over the computed default', () => {
    const ed = makeRealDocumentEditor(hilbSfdt());
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'explicit-beats-inherited',
        edits: [
          { op: 'insert_text', anchor: '0;2', text: 'Closing note' },
          {
            op: 'set_para_format',
            anchor: '0;2',
            expect: 'Closing note',
            alignment: 'Center'
          }
        ]
      });
      expect(res.results.every((result) => result.ok)).toBe(true);
      const inserted = selectRealBlock(ed, '0;2', 'Closing note');
      // Computed default matched the body neighbor (Georgia)...
      expect(inserted.characterFormat.fontFamily).toBe('Georgia');
      // ...and the explicit paragraph op overrode alignment on top of it.
      ed.selection.select('0;2;0', `0;2;13`);
      expect(ed.selection.paragraphFormat.textAlignment).toBe('Center');
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: text on a page added in the same change set inherits the preceding body look', () => {
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            {
              paragraphFormat: { styleName: 'headingNoToc' },
              inlines: [{ text: 'Closing Summary' }]
            },
            {
              paragraphFormat: { styleName: 'Body Text' },
              inlines: [{ text: 'We appreciate your business.' }]
            },
            // The separator the break will split is plain Normal, so the
            // SyncFusion clone alone would give Calibri/Normal - only the
            // computed default can produce the Body Text look asserted below.
            { inlines: [{ text: '' }] }
          ]
        }
      ],
      styles: hilbStyles
    });
    try {
      const res = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'thank-you-computed-default',
        edits: [
          { op: 'insert_page_break', anchor: '0;2' },
          { op: 'insert_text', anchor: '0;3', text: 'THANK YOU' }
        ]
      });
      expect(res.results.every((result) => result.ok)).toBe(true);
      const thanks = selectRealBlock(ed, '0;3', 'THANK YOU');
      expect(thanks.characterFormat.fontFamily).toBe('Georgia');
      expect(thanks.characterFormat.fontSize).toBe(10.5);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});

// ---------------------------------------------------------------------------
// Heading level detection on documents that do not use built-in heading styles.
//
// The fixture is the captain's live proposal document's style pattern, taken
// from its unpacked styles.xml: custom heading styles that declare no outline
// level, are based on a BODY style, whose names rank backwards against their
// sizes ("noTOCheading2" is the largest, "H1" the smallest), plus bold 12pt
// "H1" field labels that must NOT read as headings.
// ---------------------------------------------------------------------------
describe('heading level detection', () => {
  const proposalStyles = [
    // Present but unused, exactly as in the live document - Title is based on
    // it, so it is what an inheritance walk would find.
    {
      type: 'Paragraph',
      name: 'Heading 1',
      basedOn: 'Normal',
      next: 'Normal',
      characterFormat: { fontSize: 16, fontColor: '#2F5496' },
      paragraphFormat: { outlineLevel: 'Level1' }
    },
    {
      type: 'Paragraph',
      name: 'Normal',
      next: 'Normal',
      characterFormat: { fontFamily: 'Aptos', fontSize: 11 }
    },
    {
      type: 'Paragraph',
      name: 'Body Text',
      basedOn: 'Normal',
      next: 'Body Text',
      characterFormat: { fontSize: 12 }
    },
    {
      type: 'Paragraph',
      name: 'Title',
      basedOn: 'Heading 1',
      next: 'Normal',
      characterFormat: { fontSize: 20, fontColor: '#1F4E79' }
    },
    // Sounds second-level, is the biggest heading in the document.
    {
      type: 'Paragraph',
      name: 'noTOCheading2',
      basedOn: 'Body Text',
      next: 'Body Text',
      characterFormat: { bold: true, fontSize: 20, fontColor: '#1F4E79' }
    },
    {
      type: 'Paragraph',
      name: 'headingNoToc',
      basedOn: 'Body Text',
      next: 'Body Text',
      characterFormat: { bold: true, fontSize: 14, fontColor: '#1F4E79' }
    },
    // Sounds top-level, is a 12pt bold field label with no basedOn at all.
    {
      type: 'Paragraph',
      name: 'H1',
      characterFormat: { bold: true, fontSize: 12 }
    },
    {
      type: 'Paragraph',
      name: 'TOC 1',
      basedOn: 'Normal',
      next: 'Normal',
      characterFormat: { fontSize: 10 }
    }
  ];

  const styled = (styleName: string, text: string, fontSize?: number) => ({
    paragraphFormat: { styleName },
    inlines: [
      {
        text,
        ...(fontSize !== undefined ? { characterFormat: { fontSize } } : {})
      }
    ]
  });

  const proposalSfdt = () => ({
    sections: [
      {
        blocks: [
          styled('Title', 'About Hilb Group'),
          styled(
            'Normal',
            'Built on trust, integrity, and collaboration, Hilb Group brings national capability to local relationships.'
          ),
          // The live style table says 20pt, but each actual sibling carries an
          // 11pt direct override. Classification still comes from the style;
          // relative depth must come from the effective rendered typography.
          styled('noTOCheading2', 'Industry Experience', 11),
          styled(
            'Normal',
            'We have placed coverage for human services organisations for over thirty years.'
          ),
          styled('noTOCheading2', 'A Long-Term Perspective', 11),
          styled(
            'Normal',
            'Our renewal strategy is built around a three-year view of your exposures.'
          ),
          styled('headingNoToc', 'Our Approach'),
          styled(
            'Normal',
            'We start with the exposures and work outward to the market.'
          ),
          styled('headingNoToc', 'Coverages & Limits'),
          styled(
            'Normal',
            'The programme below reflects the limits agreed at the last review.'
          ),
          // Field labels: 'H1' in a table cell, as every one of the live
          // document's 71 uses is...
          {
            tableFormat: {},
            rows: [
              {
                rowFormat: {},
                cells: [
                  { cellFormat: {}, blocks: [styled('H1', 'Company Name')] },
                  {
                    cellFormat: {},
                    blocks: [styled('Body Text', 'Acme Mutual Insurance')]
                  }
                ]
              },
              {
                rowFormat: {},
                cells: [
                  { cellFormat: {}, blocks: [styled('H1', 'Rating')] },
                  {
                    cellFormat: {},
                    blocks: [styled('Body Text', 'A (Excellent)')]
                  }
                ]
              }
            ]
          },
          // ...and again in the body, so the exclusion is proven by the rule
          // itself and not only by the cell path that already returns -1.
          styled('H1', 'Financial Size'),
          styled('Body Text', 'XV ($2 billion or greater)')
        ]
      }
    ],
    styles: proposalStyles
  });

  const outlineOf = (editor: DocumentEditor) =>
    (
      buildInventoryFromBlocks(flattenSfdt(JSON.parse(editor.serialize())), {
        scope: 'outline'
      }) as any
    ).sections;

  it('real SDK: a custom heading style based on a body style is a heading', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      const blocks = flattenSfdt(JSON.parse(ed.serialize()));
      const approach = blocks.find((b) => b.text === 'Our Approach');
      expect(approach).toMatchObject({
        kind: 'heading',
        isHeading: true
      });
      expect(outlineOf(ed).map((s: any) => s.heading)).toEqual([
        'About Hilb Group',
        'Industry Experience',
        'A Long-Term Perspective',
        'Our Approach',
        'Coverages & Limits'
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: bold 12pt field labels are not headings, in a cell or in the body', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      const blocks = flattenSfdt(JSON.parse(ed.serialize()));
      for (const label of ['Company Name', 'Rating', 'Financial Size']) {
        const block = blocks.find((b) => b.text === label);
        expect(block?.format?.styleName).toBe('H1');
        expect({
          label,
          isHeading: block?.isHeading,
          level: block?.level
        }).toEqual({ label, isHeading: false, level: -1 });
      }
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: effective sibling typography establishes arbitrary depth', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      const levelOf = (heading: string) =>
        outlineOf(ed).find((s: any) => s.heading === heading).level;
      // Effective sizes are 20pt Title, 14pt headingNoToc, and 11pt
      // noTOCheading2 despite that last style declaring 20pt. Names and style
      // definitions alone both order these the wrong way round.
      expect(levelOf('Our Approach')).toBeGreaterThan(
        levelOf('About Hilb Group')
      );
      expect(levelOf('Industry Experience')).toBeGreaterThan(
        levelOf('Our Approach')
      );
      expect(outlineOf(ed).map((s: any) => [s.heading, s.level])).toEqual([
        ['About Hilb Group', 0],
        ['Industry Experience', 3],
        ['A Long-Term Perspective', 3],
        ['Our Approach', 2],
        ['Coverages & Limits', 2]
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: sibling sections compare equal, so a same-level comparable resolves', () => {
    const ed = makeRealDocumentEditor(proposalSfdt());
    try {
      const sections = outlineOf(ed);
      const comparableFor = (heading: string) => {
        const target = sections.find((s: any) => s.heading === heading);
        return sections.find(
          (s: any) => s.anchor !== target.anchor && s.level === target.level
        )?.heading;
      };
      expect(comparableFor('Coverages & Limits')).toBe('Our Approach');
      expect(comparableFor('A Long-Term Perspective')).toBe(
        'Industry Experience'
      );
      // Levels are a property of the style, not of one paragraph: the sibling
      // pair below carries a direct size override on one member only.
      const withOverride = {
        sections: [
          {
            blocks: [
              styled('headingNoToc', 'Our Approach'),
              styled('Normal', 'We start with the exposures.'),
              {
                paragraphFormat: { styleName: 'headingNoToc' },
                inlines: [
                  {
                    text: 'Coverages & Limits',
                    characterFormat: { fontSize: 12 }
                  }
                ]
              },
              styled('Normal', 'The programme below reflects the limits.')
            ]
          }
        ],
        styles: proposalStyles
      };
      const overridden = makeRealDocumentEditor(withOverride);
      try {
        const levels = outlineOf(overridden).map((s: any) => s.level);
        expect(levels).toHaveLength(2);
        expect(levels[1]).toBe(levels[0]);
      } finally {
        destroyRealDocumentEditor(overridden);
      }
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a well-formed document keeps its declared levels', () => {
    // Heading 3 with no Heading 2 in between: size ranking alone would collapse
    // these to 1 and 2. Declared levels are authoritative and must survive.
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            styled('Heading 1', 'Executive Summary'),
            styled('Normal', 'This programme covers the 2026 policy year.'),
            // An empty heading paragraph - the live document has seven - keeps
            // its declared level: it is declared, not inferred from text.
            styled('Heading 2', ''),
            styled('Heading 3', 'Pricing detail'),
            styled('Normal', 'The indication below is subject to survey.'),
            styled('Heading 1', 'Next Steps'),
            styled('Normal', 'We will bind on receipt of the signed request.')
          ]
        }
      ],
      styles: [
        {
          type: 'Paragraph',
          name: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 11 }
        },
        {
          type: 'Paragraph',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 16 },
          paragraphFormat: { outlineLevel: 'Level1' }
        },
        {
          type: 'Paragraph',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 13 },
          paragraphFormat: { outlineLevel: 'Level2' }
        },
        {
          type: 'Paragraph',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 12 },
          paragraphFormat: { outlineLevel: 'Level3' }
        }
      ]
    });
    try {
      expect(outlineOf(ed).map((s: any) => [s.heading, s.level])).toEqual([
        ['Executive Summary', 1],
        ['', 2],
        ['Pricing detail', 3],
        ['Next Steps', 1]
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a declared outline level outranks the size inference', () => {
    // 'sectionHead' is big enough to be inferred as the top level, and says
    // otherwise. The declaration wins - on the style, and on the paragraph.
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            styled('sectionHead', 'Coverage Summary'),
            styled('Normal', 'The limits below apply to all locations.'),
            {
              paragraphFormat: { styleName: 'Normal', outlineLevel: 'Level4' },
              inlines: [{ text: 'Endorsement note' }]
            },
            styled('Normal', 'Endorsements are listed in the appendix.')
          ]
        }
      ],
      styles: [
        {
          type: 'Paragraph',
          name: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 11 }
        },
        {
          type: 'Paragraph',
          name: 'sectionHead',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { bold: true, fontSize: 18 },
          paragraphFormat: { outlineLevel: 'Level2' }
        }
      ]
    });
    try {
      expect(outlineOf(ed).map((s: any) => [s.heading, s.level])).toEqual([
        ['Coverage Summary', 2],
        ['Endorsement note', 4]
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('real SDK: a stale table of contents does not drag the body-text bar down', () => {
    // The live document's shape, and the reason the body-text size is measured
    // over table cells too: 211 paragraphs of 10pt TOC against prose that lives
    // almost entirely inside layout tables. Measuring the body story alone made
    // 10pt the body size, which promoted 12pt "Body Text" to a heading.
    const tocEntry = (text: string) => styled('TOC 1', text);
    const cell = (text: string, styleName: string) => ({
      cellFormat: {},
      blocks: [styled(styleName, text)]
    });
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            styled('Title', 'About Hilb Group'),
            tocEntry('About Us5'),
            tocEntry('Our Mission5'),
            tocEntry('Our Values5'),
            tocEntry('Your Client Services Team6'),
            tocEntry('Named Insured(s)7'),
            tocEntry('Insured Location Information7'),
            styled('headingNoToc', 'Our Approach'),
            // Body Text in the body story, as the live document has it - short,
            // unterminated, and 12pt, so only the size bar can exclude it.
            styled('Body Text', 'How We Support Clients'),
            {
              tableFormat: {},
              rows: [
                {
                  rowFormat: {},
                  cells: [
                    cell(
                      'Built on trust, integrity, and collaboration, Hilb Group brings national capability to local relationships.',
                      'Normal'
                    ),
                    cell(
                      'We have placed coverage for human services organisations for over thirty years.',
                      'Normal'
                    )
                  ]
                },
                {
                  rowFormat: {},
                  cells: [
                    cell(
                      'Our renewal strategy is built around a three-year view of your exposures.',
                      'Normal'
                    ),
                    cell(
                      'The programme below reflects the limits agreed at the last review.',
                      'Normal'
                    )
                  ]
                }
              ]
            }
          ]
        }
      ],
      styles: proposalStyles
    });
    try {
      // 14pt headingNoToc ranks below 20pt Title; what matters is that 12pt
      // "How We Support Clients" is not in the outline at all.
      expect(outlineOf(ed).map((s: any) => [s.heading, s.level])).toEqual([
        ['About Hilb Group', 0],
        ['Our Approach', 2]
      ]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });

  it('an out-of-range declared outline level is not a heading', () => {
    // OOXML's w:outlineLvl 9 means body text, and the live document's
    // "TOC Heading" style carries it. SFDT's own enum stops at Level9, so an
    // importer that passes the raw index through must not mint a level-10
    // heading. Asserted on the walker directly - the SDK's enum would reject
    // the value before it reached us.
    const blocks = flattenSfdt({
      sections: [
        {
          blocks: [
            para('Table of Contents', 'TOC Heading'),
            para('This programme covers the 2026 policy year.', 'Normal'),
            para('Nothing to see here', 'quietStyle')
          ]
        }
      ],
      styles: [
        {
          type: 'Paragraph',
          name: 'Normal',
          characterFormat: { fontSize: 11 }
        },
        {
          type: 'Paragraph',
          name: 'TOC Heading',
          basedOn: 'Normal',
          characterFormat: { fontSize: 10 },
          paragraphFormat: { outlineLevel: 'Level10' }
        },
        {
          type: 'Paragraph',
          name: 'quietStyle',
          basedOn: 'Normal',
          paragraphFormat: { outlineLevel: 'BodyText' }
        }
      ]
    });
    expect(blocks.map((b) => [b.text, b.kind, b.level])).toEqual([
      ['Table of Contents', 'paragraph', -1],
      ['This programme covers the 2026 policy year.', 'paragraph', -1],
      ['Nothing to see here', 'paragraph', -1]
    ]);
  });

  it('real SDK: a large-type style used for prose is not a heading', () => {
    // Size alone is not enough: a 16pt cover blurb is body text, and promoting
    // it would put a page break in the middle of the cover page.
    const ed = makeRealDocumentEditor({
      sections: [
        {
          blocks: [
            styled(
              'coverBlurb',
              'A proposed insurance programme prepared for Innovation Learning LLC, covering general liability, property and umbrella exposures for the coming policy year.'
            ),
            styled('Normal', 'Prepared by the Hilb Group risk advisory team.'),
            styled('Normal', 'All figures are indications, not quotations.'),
            // Enough body text that 11pt is unambiguously this document's body
            // size, so the blurb clears the size gate and only its shape - long,
            // and ending in a sentence terminator - can exclude it.
            styled(
              'Normal',
              'Coverage is subject to the terms, conditions and exclusions of the policies as issued.'
            ),
            styled(
              'Normal',
              'Premiums shown exclude taxes, fees and surcharges unless stated otherwise.'
            ),
            styled(
              'Normal',
              'Please review the schedule of locations and advise of any additions before binding.'
            )
          ]
        }
      ],
      styles: [
        {
          type: 'Paragraph',
          name: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 11 }
        },
        {
          type: 'Paragraph',
          name: 'coverBlurb',
          basedOn: 'Normal',
          next: 'Normal',
          characterFormat: { fontSize: 16 }
        }
      ]
    });
    try {
      expect(outlineOf(ed)).toEqual([]);
    } finally {
      destroyRealDocumentEditor(ed);
    }
  });
});
