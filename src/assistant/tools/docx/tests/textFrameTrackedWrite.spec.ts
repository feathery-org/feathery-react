// `replace_text` inside a text frame reported `untracked_write` and rolled back.
//
// Live evidence (captain, 2026-07-27 ~15:00): the advisor-title change landed in
// the client-services table but failed on the cover page, twice:
//
//   {"op":"replace_text","anchor":"0;7;S;1;2","find":"Engineer",
//    "replace":"Sr. Advisor","expect":"Engineer","error":"untracked_write"}
//
// The `S` marks a text frame. The engine wrote, could not prove a tracked
// revision was produced, and rolled the write back.
//
// ROOT CAUSE - the same defect as this morning's `48a5b1f9`, in its last
// remaining hiding place. That commit replaced a revision-TYPE guess ("demand an
// Insertion and a Deletion") with the whole-document reject projection, because
// the guess produces false negatives; its own message names this exact case:
// SyncFusion authors "no revision at all when the text being overwritten is
// itself an unaccepted insertion". But `rejectProjectionStream` never descended
// into text frames, so text-frame writes had no projection to be proven by and
// were left on the discarded guess - and therefore kept the discarded bug.
//
// That is why it needed TWO edits to show up, and why the table edit beside it
// was fine: the first cover-page edit created a normal Deletion+Insertion pair,
// and the second one - overwriting text that was still a pending insertion -
// produced no NEW pair, so the guess called a correct write untracked.
//
// It is NOT a SyncFusion limitation. Probed against the bare public API with no
// repo code in the path, the second tracked replace inside a frame is fully
// reversible: rejecting every revision restores the document byte for byte. The
// evidence is asserted directly below, so the claim cannot rot.
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
  applyDocumentEdits,
  findDocumentOccurrences,
  flattenSfdt,
  rejectProjectionStream,
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
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
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

const realRevisions = (ed: DocumentEditor): any[] => {
  const collection = (ed as any).revisions;
  const out: any[] = [];
  for (let i = 0; i < (collection?.length ?? 0); i++) {
    const revision = collection.changes?.[i] ?? collection[i];
    if (revision) out.push(revision);
  }
  return out;
};

/**
 * A cover-page-shaped document: a body table holding the advisor title (the
 * anchor that always worked) plus a multi-block text frame holding the same
 * title (the anchor that failed).
 */
const coverPageDoc = (frameTitle = 'Engineer') => {
  const cell = (text: string) => ({
    cellFormat: {},
    blocks: [{ inlines: [{ text }] }]
  });
  return {
    sections: [
      {
        blocks: [
          { inlines: [{ text: 'Proposal for Hilb Group' }] },
          {
            inlines: [
              {
                shapeId: 'cover-frame',
                name: 'Cover frame',
                visible: true,
                width: 300,
                height: 120,
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
                  // Three blocks, so the title sits at frame block index 2 -
                  // the live anchor's shape (`...;S;1;2`).
                  blocks: [
                    { inlines: [{ text: 'Hilb Group' }] },
                    { inlines: [{ text: 'Tyler Marlow' }] },
                    { inlines: [{ text: frameTitle }] }
                  ]
                }
              }
            ]
          },
          {
            tableFormat: {},
            rows: [
              { rowFormat: {}, cells: [cell('Advisor'), cell('Engineer')] }
            ]
          },
          { inlines: [{ text: 'End of cover page' }] }
        ]
      }
    ]
  };
};

/** Resolve the frame occurrence of `text` the way the client actually does. */
const frameOccurrence = (ed: DocumentEditor, text: string) => {
  const found = findDocumentOccurrences(ed as unknown as LiveEditor, {
    text,
    matchCase: true,
    maxResults: 20
  });
  const frame = found.occurrences.find(
    (occurrence) => occurrence.kind === 'text_frame'
  );
  expect(frame).toBeDefined();
  return frame!;
};

const replaceInFrame = (
  ed: DocumentEditor,
  changeSetId: string,
  find: string,
  replace: string
) => {
  const frame = frameOccurrence(ed, find);
  expect(frame.anchor).toContain(';S;');
  return applyDocumentEdits(ed as unknown as LiveEditor, {
    changeSetId,
    edits: [
      {
        op: 'replace_text',
        anchor: frame.anchor,
        start: frame.start,
        end: frame.end,
        find,
        replace,
        expect: frame.blockText
      }
    ]
  });
};

const withEditor = (
  run: (ed: DocumentEditor) => void,
  sfdt = coverPageDoc()
) => {
  const ed = makeRealDocumentEditor(sfdt);
  try {
    ed.enableTrackChanges = false;
    run(ed);
  } finally {
    const host = ed.element;
    ed.destroy();
    host?.remove();
  }
};

const editorWithInsertText = (
  ed: DocumentEditor,
  insertText: (realInsert: (text: string) => void, text: string) => void
) =>
  new Proxy(ed as unknown as LiveEditor, {
    get(target, property, receiver) {
      if (property === 'editor') {
        const realEditor: any = Reflect.get(target, property, receiver);
        return new Proxy(realEditor, {
          get(inner, method, innerReceiver) {
            const value = Reflect.get(inner, method, innerReceiver);
            if (method !== 'insertText' || typeof value !== 'function')
              return typeof value === 'function' ? value.bind(inner) : value;
            return (text: string) =>
              insertText((actual) => value.call(inner, actual), text);
          }
        });
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });

describe("the captain's advisor-title change on the cover page", () => {
  it('a FIRST tracked replace inside a text frame lands (this always worked)', () => {
    withEditor((ed) => {
      const result = replaceInFrame(ed, 'title-1', 'Engineer', 'Sr. Advisor');

      expect(result.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
      expect(result.changeSet.status).toBe('applied');
      expect(
        realRevisions(ed)
          .map((revision) => String(revision.revisionType).toLowerCase())
          .sort()
      ).toEqual(['deletion', 'insertion']);
    });
  });

  it('THE LIVE FAILURE: a SECOND replace, over text that is still a pending insertion, now lands too', () => {
    withEditor((ed) => {
      const first = replaceInFrame(ed, 'title-1', 'Engineer', 'Sr. Advisor');
      expect(first.results[0]).toMatchObject({ ok: true });

      // Nothing is accepted in between - exactly the live state, where the
      // captain's earlier tracked edit was still sitting in the Changes pane.
      const second = replaceInFrame(
        ed,
        'title-2',
        'Sr. Advisor',
        'Senior Risk Advisor'
      );

      // Before the fix: untracked_write, "SyncFusion did not create the required
      // tracked revision pair for replace_text", and the write rolled back.
      expect(second.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
      expect(second.changeSet.status).toBe('applied');
    });
  });

  it('the second write is genuinely tracked and reversible - rejecting restores the document byte for byte', () => {
    withEditor((ed) => {
      const before = ed.serialize();

      expect(replaceInFrame(ed, 't1', 'Engineer', 'Sr. Advisor').results[0]).toMatchObject({ ok: true });
      expect(
        replaceInFrame(ed, 't2', 'Sr. Advisor', 'Senior Risk Advisor').results[0]
      ).toMatchObject({ ok: true });

      const revisions = realRevisions(ed);
      expect(revisions.length).toBeGreaterThan(0);
      expect(
        revisions.every((revision) => typeof revision.reject === 'function')
      ).toBe(true);

      for (const revision of [...revisions].reverse()) revision.reject();

      // The property the whole verification exists to guarantee, asserted at its
      // full strength: not "close enough", byte-for-byte.
      expect(ed.serialize()).toBe(before);
      expect(realRevisions(ed)).toHaveLength(0);
    });
  });

  it('the cover-page frame and the table cell both carry the change in one change set', () => {
    withEditor((ed) => {
      const before = ed.serialize();
      const frame = frameOccurrence(ed, 'Engineer');

      // The live turn's shape: the frame anchor and the table-cell anchor
      // together. Live, the table half applied and the frame half rolled back.
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'advisor-title-everywhere',
        edits: [
          {
            op: 'replace_text',
            anchor: frame.anchor,
            start: frame.start,
            end: frame.end,
            find: 'Engineer',
            replace: 'Sr. Advisor',
            expect: frame.blockText
          },
          {
            op: 'replace_text',
            anchor: '0;2;0;1;0',
            find: 'Engineer',
            replace: 'Sr. Advisor',
            expect: 'Engineer'
          }
        ]
      });

      expect(result.changeSet.status).toBe('applied');
      expect(result.results.every((r) => r.ok)).toBe(true);

      // The table cell reads the new title...
      expect(
        flattenSfdt(JSON.parse(ed.serialize())).find(
          (block) => block.anchor === '0;2;0;1;0'
        )?.text
      ).toContain('Sr. Advisor');
      // ...and so does the frame, which is only visible through the live search.
      expect(
        findDocumentOccurrences(ed as unknown as LiveEditor, {
          text: 'Sr. Advisor',
          matchCase: true,
          maxResults: 20
        }).occurrences.some((o) => o.kind === 'text_frame')
      ).toBe(true);

      for (const revision of [...realRevisions(ed)].reverse()) revision.reject();
      expect(ed.serialize()).toBe(before);
    });
  });
});

describe('text-frame post-write verification', () => {
  it.each([
    ['Innovation Learning LLC', 'Innovation Learning'],
    ['Acme Corp Ltd', 'Acme Corp']
  ])('shortens %p to %p and preserves the surrounding text', (find, replace) => {
    withEditor(
      (ed) => {
        const result = replaceInFrame(ed, 'shorten-company', find, replace);

        expect(result.results[0]).toMatchObject({ ok: true });
        expect(result.changeSet.status).toBe('applied');
        while (ed.revisions.length) ed.revisions.get(0).accept();
        expect(
          frameOccurrence(ed, `Before ${replace} after`).matchText
        ).toBe(`Before ${replace} after`);
        expect(
          findDocumentOccurrences(ed as unknown as LiveEditor, {
            text: find,
            matchCase: true,
            maxResults: 20
          }).count
        ).toBe(0);
      },
      coverPageDoc(`Before ${find} after`)
    );
  });

  it('edits the intended occurrence when the replacement already exists in the same block', () => {
    const before = 'Acme Corp elsewhere; rename Acme Corp Ltd here';
    const after = 'Acme Corp elsewhere; rename Acme Corp here';
    withEditor(
      (ed) => {
        const result = replaceInFrame(
          ed,
          'shorten-one-company',
          'Acme Corp Ltd',
          'Acme Corp'
        );

        expect(result.results[0]).toMatchObject({ ok: true });
        expect(result.changeSet.status).toBe('applied');
        while (ed.revisions.length) ed.revisions.get(0).accept();
        expect(frameOccurrence(ed, after).matchText).toBe(after);
        const occurrences = findDocumentOccurrences(
          ed as unknown as LiveEditor,
          {
            text: 'Acme Corp',
            matchCase: true,
            maxResults: 20
          }
        );
        expect(occurrences.count).toBe(2);
        expect(occurrences.occurrences.map((item) => item.start)).toEqual([
          0, 28
        ]);
      },
      coverPageDoc(before)
    );
  });

  it('fails when the selected write does not land', () => {
    withEditor(
      (ed) => {
        const frame = frameOccurrence(ed, 'Innovation Learning LLC');
        const noWriteEditor = editorWithInsertText(ed, () => undefined);
        const result = applyDocumentEdits(noWriteEditor, {
          changeSetId: 'missing-story-write',
          edits: [
            {
              op: 'replace_text',
              anchor: frame.anchor,
              start: frame.start,
              end: frame.end,
              expect: frame.blockText,
              find: frame.matchText,
              replace: 'Innovation Learning'
            }
          ]
        });

        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'text_verification_failed'
        });
        expect(result.changeSet.status).toBe('failed');
        expect(frameOccurrence(ed, 'Innovation Learning LLC')).toBeDefined();
        expect(realRevisions(ed)).toHaveLength(0);
      },
      coverPageDoc('Innovation Learning LLC')
    );
  });

  it('fails when the replacement is inserted beside an undeleted target', () => {
    let revisionTypesAfterInsert: string[] = [];
    withEditor(
      (ed) => {
        const before = ed.serialize();
        const frame = frameOccurrence(ed, 'Innovation Learning LLC');
        const adjacentWriteEditor = editorWithInsertText(
          ed,
          (realInsert, text) => {
            const endOffset = `${frame.anchor};${frame.end}`;
            ed.selection.select(endOffset, endOffset);
            realInsert(text);
            revisionTypesAfterInsert = realRevisions(ed).map((revision) =>
              String(revision.revisionType).toLowerCase()
            );
          }
        );
        const result = applyDocumentEdits(adjacentWriteEditor, {
          changeSetId: 'adjacent-story-write',
          edits: [
            {
              op: 'replace_text',
              anchor: frame.anchor,
              start: frame.start,
              end: frame.end,
              expect: frame.blockText,
              find: frame.matchText,
              replace: 'Innovation Learning'
            }
          ]
        });

        expect(revisionTypesAfterInsert).toEqual(['insertion']);
        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'text_verification_failed'
        });
        expect(result.changeSet.status).toBe('failed');
        expect(ed.serialize()).toBe(before);
        expect(realRevisions(ed)).toHaveLength(0);
      },
      coverPageDoc('Innovation Learning LLC')
    );
  });

  // The mirror image of the case above, and the reason the verification cannot
  // be a revision-type test: this write is at the range START, where a
  // legitimate second replace over a still-pending insertion also writes. Both
  // land on exactly the searched range, both author one rejectable Insertion,
  // and both leave the reject projection unchanged - so the only thing that
  // separates them is what the document reads once the changes are accepted.
  it('fails when the replacement is inserted beside an undeleted target at the range start', () => {
    let revisionTypesAfterInsert: string[] = [];
    withEditor(
      (ed) => {
        const before = ed.serialize();
        const frame = frameOccurrence(ed, 'Innovation Learning LLC');
        const startAdjacentWriteEditor = editorWithInsertText(
          ed,
          (realInsert, text) => {
            const startOffset = `${frame.anchor};${frame.start}`;
            ed.selection.select(startOffset, startOffset);
            realInsert(text);
            revisionTypesAfterInsert = realRevisions(ed).map((revision) =>
              String(revision.revisionType).toLowerCase()
            );
          }
        );
        const result = applyDocumentEdits(startAdjacentWriteEditor, {
          changeSetId: 'start-adjacent-story-write',
          edits: [
            {
              op: 'replace_text',
              anchor: frame.anchor,
              start: frame.start,
              end: frame.end,
              expect: frame.blockText,
              find: frame.matchText,
              replace: 'Innovation Learning'
            }
          ]
        });

        expect(revisionTypesAfterInsert).toEqual(['insertion']);
        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'text_verification_failed'
        });
        // The message names the property that failed, not a match count: the
        // accepted document still reads the target beside the replacement.
        expect(result.results[0].details?.join('\n')).toContain(
          'Innovation LearningInnovation Learning LLC'
        );
        expect(result.changeSet.status).toBe('failed');
        expect(ed.serialize()).toBe(before);
        expect(realRevisions(ed)).toHaveLength(0);
      },
      coverPageDoc('Innovation Learning LLC')
    );
  });

  // The engine tolerates a live editor that does not expose an observable
  // revision collection (`assertTrackedMutation` returns early for it). Post-write
  // verification must tolerate it too, or that degraded shape turns every
  // text-frame write into a hard failure plus a rollback.
  it('applies a frame replace on an editor whose revision collection is not observable', () => {
    withEditor((ed) => {
      const hiddenRevisions = new Proxy(ed as unknown as LiveEditor, {
        get(target, property, receiver) {
          if (property === 'revisions') return { acceptAll: () => undefined };
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }
      });
      const frame = frameOccurrence(ed, 'Engineer');
      const result = applyDocumentEdits(hiddenRevisions, {
        changeSetId: 'unobservable-revisions',
        edits: [
          {
            op: 'replace_text',
            anchor: frame.anchor,
            start: frame.start,
            end: frame.end,
            expect: frame.blockText,
            find: 'Engineer',
            replace: 'Sr. Advisor'
          }
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true, op: 'replace_text' });
      expect(result.changeSet.status).toBe('applied');
      // The write really was tracked - only the engine's view of the collection
      // was hidden.
      expect(
        realRevisions(ed)
          .map((revision) => String(revision.revisionType).toLowerCase())
          .sort()
      ).toEqual(['deletion', 'insertion']);
    });
  });

  // The accepted document is unchanged here, which is the one case where the
  // changed text cannot locate the occurrence that was replaced.
  it('accepts a frame replace whose replacement is the target text itself', () => {
    withEditor(
      (ed) => {
        const result = replaceInFrame(
          ed,
          'identical-frame-write',
          'Engineer',
          'Engineer'
        );

        expect(result.results[0]).toMatchObject({ ok: true });
        expect(result.changeSet.status).toBe('applied');
        expect(frameOccurrence(ed, 'Engineer').matchText).toBe('Engineer');
      },
      // The spelling occurs twice in the document (frame title and table cell),
      // so the unchanged stream has to be decided without a changed span.
      coverPageDoc('Engineer')
    );
  });

  // `delete_text` on a story range used to search for its own (empty)
  // replacement, which against the real SDK never terminates. A deletion writes
  // no text, so the accept projection is what proves it landed.
  it('deletes a frame range as one tracked, reversible deletion', () => {
    withEditor((ed) => {
      const before = ed.serialize();
      const frame = frameOccurrence(ed, 'Engineer');
      const result = applyDocumentEdits(ed as unknown as LiveEditor, {
        changeSetId: 'frame-delete',
        edits: [
          {
            op: 'delete_text',
            anchor: frame.anchor,
            start: frame.start,
            end: frame.end,
            expect: frame.blockText,
            find: 'Engineer'
          }
        ]
      });

      expect(result.results[0]).toMatchObject({ ok: true, op: 'delete_text' });
      expect(result.changeSet.status).toBe('applied');
      expect(
        realRevisions(ed).map((revision) =>
          String(revision.revisionType).toLowerCase()
        )
      ).toEqual(['deletion']);

      for (const revision of [...realRevisions(ed)].reverse()) revision.reject();
      expect(ed.serialize()).toBe(before);
    });
  });

  it('fails when the selected write lands with extra text', () => {
    let inserted = '';
    withEditor(
      (ed) => {
        const before = ed.serialize();
        const frame = frameOccurrence(ed, 'Innovation Learning LLC');
        const wrongWriteEditor = editorWithInsertText(
          ed,
          (realInsert) => {
            inserted = 'WRONG Innovation Learning';
            realInsert(inserted);
          }
        );
        const result = applyDocumentEdits(wrongWriteEditor, {
          changeSetId: 'wrong-story-write',
          edits: [
            {
              op: 'replace_text',
              anchor: frame.anchor,
              start: frame.start,
              end: frame.end,
              expect: frame.blockText,
              find: frame.matchText,
              replace: 'Innovation Learning'
            }
          ]
        });

        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'text_verification_failed'
        });
        expect(result.changeSet.status).toBe('failed');
        expect(inserted).toBe('WRONG Innovation Learning');
        expect(ed.serialize()).toBe(before);
        expect(realRevisions(ed)).toHaveLength(0);
      },
      coverPageDoc('Innovation Learning LLC')
    );
  });

  it('keeps a multi-op change set failed when one write is genuinely wrong', () => {
    withEditor(
      (ed) => {
        const frame = frameOccurrence(ed, 'Innovation Learning LLC');
        const wrongStoryEditor = editorWithInsertText(
          ed,
          (realInsert, text) =>
            realInsert(
              text === 'Innovation Learning'
                ? 'Innovation Learning WRONG'
                : text
            )
        );
        const result = applyDocumentEdits(wrongStoryEditor, {
          changeSetId: 'wrong-story-write-with-sibling',
          edits: [
            {
              op: 'replace_text',
              anchor: frame.anchor,
              start: frame.start,
              end: frame.end,
              expect: frame.blockText,
              find: frame.matchText,
              replace: 'Innovation Learning'
            },
            {
              op: 'replace_text',
              anchor: '0;0',
              expect: 'Proposal for Hilb Group',
              find: 'Hilb Group',
              replace: 'Updated Company'
            }
          ]
        });

        expect(result.changeSet.status).toBe('failed');
        expect(result.results).toEqual([
          expect.objectContaining({
            ok: false,
            error: 'text_verification_failed'
          }),
          expect.objectContaining({ ok: false, error: 'change_set_failed' })
        ]);
      },
      coverPageDoc('Innovation Learning LLC')
    );
  });
});

describe('the reject projection covers text-frame content', () => {
  it('a single tracked frame write is reversible byte-for-byte', () => {
    withEditor((ed) => {
      const before = ed.serialize();
      expect(replaceInFrame(ed, 'p1', 'Engineer', 'Sr. Advisor').results[0]).toMatchObject({ ok: true });

      for (const revision of [...realRevisions(ed)].reverse()) revision.reject();
      expect(ed.serialize()).toBe(before);
    });
  });

  it('THE NON-VACUITY PROPERTY: the projection actually contains frame text and changes when it changes', () => {
    withEditor((ed) => {
      const projectionOf = (editor: DocumentEditor) =>
        rejectProjectionStream(JSON.parse(editor.serialize()));

      // The proof is a comparison of two projections. If the projection cannot
      // see into a text frame, then for ANY frame write the two sides are equal,
      // the comparison passes without examining anything, and an irreversible
      // write into a frame would be reported as a success. So the projection
      // must contain the frame's text...
      const before = projectionOf(ed);
      expect(before).toContain('Engineer');
      expect(before).toContain('Tyler Marlow');

      // ...and must change when that text is replaced, with track changes OFF so
      // no revision masks it as a droppable insertion.
      const frame = frameOccurrence(ed, 'Engineer');
      ed.enableTrackChanges = false;
      ed.selection.select(
        `${frame.anchor};${frame.start}`,
        `${frame.anchor};${frame.end}`
      );
      ed.editor.insertText('Untracked Title');

      const after = projectionOf(ed);
      expect(after).not.toBe(before);
      expect(after).toContain('Untracked Title');
    });
  });

  it('a tracked frame write leaves the projection UNCHANGED - which is what proves it reversible', () => {
    withEditor((ed) => {
      const projectionOf = () =>
        rejectProjectionStream(JSON.parse(ed.serialize()));
      const before = projectionOf();

      expect(
        replaceInFrame(ed, 'proj-tracked', 'Engineer', 'Sr. Advisor').results[0]
      ).toMatchObject({ ok: true });

      // Tracked: the insertion is droppable and the deletion is restorable, so
      // what the document WOULD read if everything were rejected is untouched.
      // This is the positive half of the property the previous test negates.
      expect(projectionOf()).toBe(before);
    });
  });
});
