// Spike: Syncfusion accepts a non-standard 'Formatting' revision type on open()
// and attaches it to the run (colour, no underline/strike); pixels unchecked.
// A browser screenshot remains as final visual confirmation, now low-risk.
import {
  destroyRealDocumentEditor,
  docWith,
  makeRealDocumentEditor,
  para
} from '../../bindings/tests/realEditorHarness';

const FORMATTING = 'Formatting'; // deliberately outside the 4 known types

function docWithFormattingRevision() {
  return {
    ...docWith(
      para(
        { text: 'Plain lead-in. ' },
        {
          text: 'Now bold.',
          revisionIds: ['f1'],
          characterFormat: { bold: true }
        }
      )
    ),
    revisions: [
      {
        author: 'user',
        date: new Date().toISOString(),
        revisionType: FORMATTING,
        revisionId: 'f1'
      }
    ]
  };
}

describe('sfdtDiff fmt-revision spike', () => {
  it('opens a non-standard "Formatting" revision without error', () => {
    const editor = makeRealDocumentEditor(docWithFormattingRevision());
    try {
      // Reaching here means open() did not throw on the unknown type.
      expect(editor).toBeTruthy();
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('attaches the Formatting revision to the run so the colour branch fires', () => {
    const editor = makeRealDocumentEditor(docWithFormattingRevision());
    try {
      const changes = (editor as any).revisions?.changes ?? [];
      const mine = changes.find(
        (r: any) => r.revisionID === 'f1' || r.author === 'user'
      );
      // The revision is present...
      expect(mine).toBeTruthy();
      // ...its type survived as our non-standard string (not coerced to a known one)...
      expect(mine.revisionType).toBe(FORMATTING);
      // ...and it is bound to at least one rendered element. checkRevisionType()
      // walks elementBox.getRevision(i); a non-empty range is what makes
      // getRevisionColor() colour the glyph. This is the key precondition.
      expect(Array.isArray(mine.range) ? mine.range.length : 0).toBeGreaterThan(
        0
      );
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });

  it('round-trips the Formatting revision and its run link through serialize()', () => {
    const editor = makeRealDocumentEditor(docWithFormattingRevision());
    try {
      const back = JSON.parse(editor.serialize());
      const rev = (back.revisions ?? []).find(
        (r: any) => r.revisionId === 'f1'
      );
      expect(rev).toBeTruthy();
      expect(rev.revisionType).toBe(FORMATTING);
      const boldRun = back.sections[0].blocks
        .flatMap((b: any) => b.inlines ?? [])
        .find((i: any) => i.text === 'Now bold.');
      expect(boldRun?.revisionIds).toContain('f1');
      expect(boldRun?.characterFormat?.bold).toBe(true);
    } finally {
      destroyRealDocumentEditor(editor);
    }
  });
});
