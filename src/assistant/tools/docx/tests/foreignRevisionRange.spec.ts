/**
 * T3: the foreign-pending-revision guard, narrowed from the block to the range.
 *
 * The guard refuses to overwrite text carrying somebody else's unaccepted
 * tracked change, because SyncFusion does not leave such a revision alone - it
 * re-authors it under the current user, so the other person's edit silently
 * becomes the assistant's and a later accept/reject no longer does what its
 * author intended.
 *
 * That is right. What was wrong is how MUCH it refused: any foreign revision
 * ANYWHERE in the paragraph blocked every write to that paragraph. One pending
 * comment-sized edit made a whole paragraph unwritable, and the refusal named a
 * range the user was not touching - unactionable and unexplainable.
 *
 * So the pair below is the whole point, and the FIRST case matters more than
 * the second: a guard that only ever refuses is indistinguishable from a broken
 * feature, and the over-refusal is what the narrowing had to fix.
 */
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
import { applyDocumentEdits, flattenSfdt, LiveEditor } from '../syncfusionDocumentOps';

DocumentEditor.Inject(Editor, Selection, SfdtExport, EditorHistory, ImageResizer, Search);

if (!window.crypto?.getRandomValues)
  Object.defineProperty(window, 'crypto', {
    value: {
      getRandomValues: (a: Uint8Array) => require('crypto').randomFillSync(a)
    }
  });
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

const OTHER_AUTHOR = 'Ayesha';

const doc = () => ({
  sections: [
    {
      sectionFormat: { pageWidth: 612, pageHeight: 792 },
      blocks: [
        {
          paragraphFormat: {},
          characterFormat: {},
          inlines: [{ characterFormat: {}, text: 'Alpha beta gamma delta.' }]
        }
      ]
    }
  ]
});

let editor: DocumentEditor;

const open = () => {
  const host = document.createElement('div');
  host.style.width = '900px';
  host.style.height = '700px';
  document.body.appendChild(host);
  editor = new DocumentEditor({
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableSfdtExport: true,
    enableEditorHistory: true,
    enableSearch: true,
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(doc()));
  return editor as unknown as LiveEditor;
};

const teardown = () => {
  if (!editor) return;
  const element = editor.element;
  editor.destroy();
  element?.remove();
};

/**
 * Leave a pending tracked change authored by somebody who is NOT the assistant.
 * Tracking is turned off afterwards so the assistant's own change set controls
 * it, exactly as the engine expects.
 */
const leaveForeignEdit = (write: () => void) => {
  editor.currentUser = OTHER_AUTHOR;
  editor.enableTrackChanges = true;
  write();
  editor.enableTrackChanges = false;
};

const foreignRevisionCount = () => {
  const revisions = (editor as any).revisions;
  let n = 0;
  for (let i = 0; i < (revisions?.length ?? 0); i++) {
    const revision = revisions[i] ?? revisions.get?.(i);
    if (revision?.author === OTHER_AUTHOR) n++;
  }
  return n;
};

const liveTextOf = () =>
  (flattenSfdt(JSON.parse(editor.serialize())) as any[])
    .map((b) => String(b.text ?? ''))
    .join('');

const apply = (live: LiveEditor, edits: any[], id: string) =>
  applyDocumentEdits(live, { changeSetId: id, edits }) as any;

describe('foreign pending revisions are judged by RANGE, not by block', () => {
  afterEach(teardown);

  describe('a foreign INSERTION in the same paragraph', () => {
    // Ayesha inserts a word. That run has real width, so it occupies a genuine
    // character range and the overlap test is a real interval comparison.
    const setup = () => {
      const live = open();
      leaveForeignEdit(() => {
        editor.selection.select('0;0;0', '0;0;0');
        editor.editor.insertText('INSERTED ');
      });
      expect(foreignRevisionCount()).toBeGreaterThan(0);
      return live;
    };

    it('OVER-REFUSAL FIXED: editing a DIFFERENT word in that paragraph succeeds', () => {
      const live = setup();
      const before = liveTextOf();
      expect(before).toContain('delta');
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'delta', replace: 'omega', group: 'g' }],
        'far-from-foreign'
      );
      expect(result.results[0].error).not.toBe('pending_revision_in_range');
      expect(result.results[0].ok).toBe(true);
      expect(liveTextOf()).toContain('omega');
    });

    it('STILL REFUSES: editing the foreign run itself is blocked, and writes nothing', () => {
      const live = setup();
      const before = editor.serialize();
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'INSERTED', replace: 'MINE', group: 'g' }],
        'onto-foreign'
      );
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('pending_revision_in_range');
      expect(editor.serialize()).toBe(before);
    });
  });

  describe('a foreign DELETION makes the narrowing unsafe, so it is given up', () => {
    // This group asserts a DELIBERATE LOSS of the narrowing, and the reason is
    // a measured engine defect that has nothing to do with this guard.
    //
    // With a foreign pending deletion in the block, `liveText` - the projection
    // `find` resolves its index in - comes back as the deletion-INCLUDED text
    // TRUNCATED to the length of the deletion-EXCLUDED text. Measured on this
    // exact document: "Alpha beta gamma delta." with "beta " pending-deleted
    // yields liveText "Alpha beta gamma d". That is a hybrid of two projections
    // and matches neither, so every index resolved in it is wrong.
    //
    // Narrowing on those offsets would mean deciding what is safe to overwrite
    // from known-corrupt positions. So the guard detects the condition and
    // falls back to block granularity. It over-refuses, on purpose, and that is
    // the correct trade while the offsets cannot be trusted.
    //
    // These tests exist to PIN that trade. When the liveText projection is
    // fixed, the second one starts failing - and that failure is the signal to
    // restore the narrowing, not to weaken the test.
    const setup = () => {
      const live = open();
      leaveForeignEdit(() => {
        editor.selection.select('0;0;6', '0;0;11');
        editor.editor.delete();
      });
      expect(foreignRevisionCount()).toBeGreaterThan(0);
      return live;
    };

    it('the block carries a foreign deletion, so even a distant write refuses', () => {
      const live = setup();
      const before = editor.serialize();
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'gamma', replace: 'GAMMA', group: 'g' }],
        'deletion-forces-block-granularity'
      );
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('pending_revision_in_range');
      // The refusal wrote nothing - the property that makes over-refusing an
      // acceptable trade rather than a second defect.
      expect(editor.serialize()).toBe(before);
    });

    it('a block with NO foreign deletion still gets the narrowing', () => {
      // The control. Without this, the test above would pass just as well if
      // the guard had reverted to refusing everything everywhere, and the whole
      // narrowing could rot away unnoticed.
      const live = open();
      leaveForeignEdit(() => {
        editor.selection.select('0;0;0', '0;0;0');
        editor.editor.insertText('INSERTED ');
      });
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'delta', replace: 'omega', group: 'g' }],
        'insertion-only-still-narrows'
      );
      expect(result.results[0].ok).toBe(true);
    });
  });

  describe('revisions the character walk cannot address', () => {
    // Review caught this: the narrowing walked runs only, so a foreign revision
    // on the PARAGRAPH MARK or on a table ROW was invisible to it - the filter
    // found nothing in range and the write PROCEEDED, where the block-wide path
    // it replaced would have refused. A narrowing that loses protection is not a
    // narrowing, it is a hole. Neither of these has a character range at all,
    // so the fix is to stop narrowing when one is present.

    it('a foreign PARAGRAPH-MARK revision forces block-wide refusal', () => {
      const live = open();
      // A paragraph-mark revision lives on the block's own characterFormat, not
      // in any run - which is exactly why walking inlines never saw it.
      const doc = JSON.parse(editor.serialize());
      const block = (doc.sections ?? doc.sec)[0].blocks?.[0] ?? (doc.sections ?? doc.sec)[0].b?.[0];
      const id = 'foreign-mark-1';
      (doc.revisions ??= []).push({
        author: OTHER_AUTHOR,
        date: '2020-01-01T00:00:00Z',
        revisionType: 'Deletion',
        revisionId: id
      });
      (block.characterFormat ??= {}).revisionIds = [id];
      editor.open(JSON.stringify(doc));

      const before = editor.serialize();
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'delta', replace: 'omega', group: 'g' }],
        'foreign-paragraph-mark'
      );
      // "delta" carries no revision, so the range filter alone would allow this.
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('pending_revision_in_range');
      expect(editor.serialize()).toBe(before);
    });

    it('a foreign TRACKED FORMATTING revision on a run forces refusal', () => {
      // Third variant of the same hole. SyncFusion records a tracked FORMATTING
      // change on the run's own characterFormat.revisionIds - not on the run's
      // revisionIds - so a walk that read only the latter narrowed straight past
      // somebody else's pending formatting change. Found in review after the
      // paragraph-mark and rowFormat cases; same shape, third location.
      const live = open();
      const doc = JSON.parse(editor.serialize());
      const section = (doc.sections ?? doc.sec)[0];
      const block = (section.blocks ?? section.b)[0];
      const inline = (block.inlines ?? block.i)[0];
      const id = 'foreign-format-1';
      (doc.revisions ??= []).push({
        author: OTHER_AUTHOR,
        date: '2020-01-01T00:00:00Z',
        revisionType: 'Insertion',
        revisionId: id
      });
      (inline.characterFormat ??= {}).revisionIds = [id];
      editor.open(JSON.stringify(doc));

      const before = editor.serialize();
      const result = apply(
        live,
        [{ op: 'replace_text', anchor: '0;0', find: 'delta', replace: 'omega', group: 'g' }],
        'foreign-tracked-formatting'
      );
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('pending_revision_in_range');
      expect(editor.serialize()).toBe(before);
    });

    it('a foreign ROW revision forces block-wide refusal from a cell anchor', () => {
      // Harder than the paragraph mark: rowFormat hangs off the ROW, above the
      // cell's paragraph, so even the block-wide recursion from a cell anchor
      // could not reach it. It has to be unioned in explicitly.
      const host = document.createElement('div');
      host.style.width = '900px';
      host.style.height = '700px';
      document.body.appendChild(host);
      editor = new DocumentEditor({
        isReadOnly: false,
        enableEditor: true,
        enableSelection: true,
        enableSfdtExport: true,
        enableEditorHistory: true,
        enableSearch: true,
        documentEditorSettings: { optimizeSfdt: false }
      });
      editor.appendTo(host);
      const id = 'foreign-row-1';
      editor.open(
        JSON.stringify({
          sections: [
            {
              sectionFormat: { pageWidth: 612, pageHeight: 792 },
              blocks: [
                {
                  rows: [
                    {
                      rowFormat: { revisionIds: [id] },
                      cells: [
                        {
                          cellFormat: { columnSpan: 1, rowSpan: 1 },
                          blocks: [
                            {
                              paragraphFormat: {},
                              characterFormat: {},
                              inlines: [{ characterFormat: {}, text: 'Website build' }]
                            }
                          ]
                        }
                      ]
                    }
                  ]
                }
              ],
              headersFooters: {}
            }
          ],
          revisions: [
            {
              author: OTHER_AUTHOR,
              date: '2020-01-01T00:00:00Z',
              revisionType: 'Deletion',
              revisionId: id
            }
          ]
        })
      );
      const live = editor as unknown as LiveEditor;
      const before = editor.serialize();
      const result = apply(
        live,
        [
          {
            op: 'replace_text',
            anchor: '0;0;0;0;0',
            find: 'Website',
            replace: 'Site',
            group: 'g'
          }
        ],
        'foreign-row-revision'
      );
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('pending_revision_in_range');
      expect(editor.serialize()).toBe(before);
    });
  });

  describe('whole-block ops keep block granularity', () => {
    // Not a regression, and not laziness: change_case rewrites the ENTIRE
    // block, so every revision in it really is in range. Narrowing here would
    // be wrong, and this test exists so nobody "consistently" narrows it later.
    it('change_case still refuses on any foreign revision in the block', () => {
      const live = open();
      leaveForeignEdit(() => {
        editor.selection.select('0;0;0', '0;0;0');
        editor.editor.insertText('INSERTED ');
      });
      const before = editor.serialize();
      const result = apply(
        live,
        [{ op: 'change_case', anchor: '0;0', caseType: 'uppercase', group: 'g' }],
        'whole-block-op'
      );
      expect(result.results[0].ok).toBe(false);
      expect(result.results[0].error).toBe('pending_revision_in_range');
      expect(editor.serialize()).toBe(before);
    });
  });
});
