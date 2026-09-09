// The captain asked for "change the heading color to red" and was told it was
// done. The document did not change at all.
//
// Live evidence (captain, 2026-09-09, flagship-v4 as served - a document with
// ZERO content controls, its title inside a text box, four Word sections): the
// whole serialize diff against the pristine document was ONE text box's
// re-laid-out height and width. Zero revisions. No card. The assistant reported
// success.
//
// ROOT CAUSE, measured below: SyncFusion silently DROPS a `fontColor` it cannot
// parse, and the CSS colour name `red` is one of those - `#FF0000` writes, `red`
// writes nothing. Nothing in the write path could tell those two apart, because
// direct formatting took no evidence at all: `assertTrackedMutation` returns on
// its first branch for any op outside the tracked text/structural sets, and no
// format op is in either, so phase 3 reported `ok: true` for anything that did
// not throw. The law had already been discovered for the INHERITED format path -
// `verifyInheritedFormat`'s own docstring says "no-op success is not sufficient
// evidence that the target now has the source's visible format" - and applied
// only there.
//
// So: ok now means the document reads what was asked for, at the anchor asked
// for, or the op fails with a code the assistant must relay.
//
// WHAT THIS DOCUMENT CANNOT HAVE, asserted rather than assumed (see the
// `no revision` case): SyncFusion authors NO revision for a formatting change -
// it has no Formatting revision type. A format write is therefore real but not
// reviewable, and the change set says so out loud (`revisionGrouping:
// 'no_revisions'`, `revisionCount: 0`) instead of presenting a card a reviewer
// cannot reject.
import 'jest-canvas-mock';
import * as fs from 'fs';
import * as path from 'path';
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
  flattenSfdt,
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
if (!(window.SVGElement.prototype as any).getBBox)
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);

/**
 * The captain's document, as served, opened in jsdom.
 *
 * Headers and footers are dropped and nothing else is: a header-bearing
 * document never finishes `open()` under jsdom (which is why the fixture lives
 * in `browser-only/`, excluded from the corpus sweep), and the failure under
 * test is about a body heading and a text-frame title - neither of which is in
 * a header. Derived here rather than committed as a second copy so the fixture
 * has one source of truth.
 */
const flagshipV4 = () => {
  const sfdt = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        'corpus',
        'browser-only',
        'flagship-v4.browser.sfdt.json'
      ),
      'utf8'
    )
  );
  for (const section of sfdt.sections ?? []) section.headersFooters = {};
  return sfdt;
};

const makeRealDocumentEditor = (sfdt: any): DocumentEditor => {
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
};

const realRevisions = (ed: DocumentEditor): any[] => {
  const collection = (ed as any).revisions;
  const out: any[] = [];
  for (let i = 0; i < (collection?.length ?? 0); i++) {
    const revision = collection.changes?.[i] ?? collection[i];
    if (revision) out.push(revision);
  }
  return out;
};

const serialize = (ed: DocumentEditor): string => (ed as any).serialize();

/** The resolved font colour SyncFusion reports for one block's whole range. */
const resolvedFontColor = (ed: DocumentEditor, anchor: string): string => {
  const block = flattenSfdt(JSON.parse(serialize(ed))).find(
    (candidate: any) => candidate.anchor === anchor
  );
  expect(block).toBeDefined();
  (ed as any).selection.select(`${anchor};0`, `${anchor};${block!.length}`);
  return String((ed as any).selection.characterFormat?.fontColor ?? '');
};

const redOp = (anchor: string, expectText: string, fontColor: string) => ({
  op: 'set_char_format' as const,
  anchor,
  fontColor,
  expect: expectText
});

const setColor = (
  ed: DocumentEditor,
  changeSetId: string,
  anchor: string,
  expectText: string,
  fontColor: string
) =>
  applyDocumentEdits(ed as unknown as LiveEditor, {
    changeSetId,
    edits: [redOp(anchor, expectText, fontColor) as any]
  });

const withFlagship = (run: (ed: DocumentEditor) => void) => {
  const ed = makeRealDocumentEditor(flagshipV4());
  try {
    ed.enableTrackChanges = true;
    run(ed);
  } finally {
    const host = ed.element;
    ed.destroy();
    host?.remove();
  }
};

// The two anchors the captain's request resolves to in this document: the
// Heading 1 that opens Word section 2, and the title, which lives inside a text
// box on the cover page and is therefore a text-frame anchor.
const HEADING = { anchor: '1;0', text: 'Section 1 - Property' };
const TEXT_BOX_TITLE = {
  anchor: '0;0;S;1;0',
  text: 'Commercial Combined Insurance Proposal'
};

describe.each([
  ['a Heading 1 paragraph', HEADING],
  ['the title inside a text box', TEXT_BOX_TITLE]
])('"change the heading color to red" on %s', (_name, target) => {
  it('THE LIVE FAILURE: a colour word reported ok and wrote nothing; now it writes', () => {
    withFlagship((ed) => {
      const before = resolvedFontColor(ed, target.anchor);
      expect(before).not.toMatch(/^#ff0000/i);

      const result = setColor(ed, 'red-1', target.anchor, target.text, 'red');

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'set_char_format',
        anchor: target.anchor
      });
      expect(result.changeSet.status).toBe('applied');
      // ok IMPLIES CHANGED. This is the whole assertion: the document now reads
      // the colour that was asked for, so the assistant's "done" is true.
      expect(resolvedFontColor(ed, target.anchor)).toMatch(/^#ff0000/i);
    });
  });

  it('a hex colour lands the same way, and reads identically to the colour word', () => {
    withFlagship((ed) => {
      expect(
        setColor(ed, 'red-hex', target.anchor, target.text, '#FF0000')
          .results[0]
      ).toMatchObject({ ok: true });
      expect(resolvedFontColor(ed, target.anchor)).toMatch(/^#ff0000/i);
    });
  });

  it('a colour SyncFusion cannot resolve FAILS LOUDLY and writes nothing', () => {
    withFlagship((ed) => {
      const pristine = resolvedFontColor(ed, target.anchor);

      const result = setColor(
        ed,
        'red-bogus',
        target.anchor,
        target.text,
        'reddish'
      );

      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'invalid_color'
      });
      expect(result.changeSet.status).toBe('failed');
      // A refusal must leave the document as it was - the failure mode being
      // fixed is a write that reports one thing and does another, in either
      // direction.
      //
      // Asserted as the RESOLVED COLOUR rather than as serialized bytes on
      // purpose. Merely selecting inside a text box makes SyncFusion re-lay the
      // shape out, so the serialize moves by that shape's `w`/`h` even when no
      // content was touched - measured here, and it is precisely the residual
      // the captain saw ("only a text-box layout height/width"). Those bytes are
      // engine layout, not document content, so a byte comparison here would
      // fail on a correct refusal.
      expect(resolvedFontColor(ed, target.anchor)).toBe(pristine);
      expect(realRevisions(ed)).toHaveLength(0);
    });
  });

  it('a formatting write is real but NOT reviewable, and says so rather than showing an empty card', () => {
    withFlagship((ed) => {
      const result = setColor(ed, 'red-card', target.anchor, target.text, 'red');

      expect(result.results[0]).toMatchObject({ ok: true });
      // SyncFusion has no Formatting revision type, so there is nothing to
      // reject. Asserted, not assumed: if a future SyncFusion starts authoring
      // one, this fails and the honest surface below can be upgraded to a real
      // card.
      expect(realRevisions(ed)).toHaveLength(0);
      expect(result.changeSet.revisionGrouping).toBe('no_revisions');
      expect(result.changeSet.groups).toHaveLength(1);
      expect(result.changeSet.groups[0].revisionCount).toBe(0);
    });
  });
});

it('the verifier catches a dropped field it was never taught about', () => {
  withFlagship((ed) => {
    // `fontSize` is passed through untouched by the colour normalizer, so this
    // exercises the read-back backstop rather than the normalizer: a value
    // SyncFusion refuses must surface as a failure, not a success.
    const result = applyDocumentEdits(ed as unknown as LiveEditor, {
      changeSetId: 'bad-size',
      edits: [
        {
          op: 'set_char_format',
          anchor: HEADING.anchor,
          fontSize: 100000,
          expect: HEADING.text
        } as any
      ]
    });

    const outcome = result.results[0] as any;
    // Either SyncFusion clamps it (then the read-back must refuse) or it takes
    // it (then ok is honest). What must never happen is ok with the old value
    // still in the document, which is the defect under test.
    if (outcome.ok) {
      (ed as any).selection.select(
        `${HEADING.anchor};0`,
        `${HEADING.anchor};${HEADING.text.length}`
      );
      expect(
        Number((ed as any).selection.characterFormat?.fontSize)
      ).toBeCloseTo(100000, 1);
    } else {
      expect(outcome.error).toBe('format_not_applied');
    }
  });
});

it('a highlight colour named the SyncFusion way is not mistaken for a failure', () => {
  withFlagship((ed) => {
    // `highlightColor` is a NAMED enum, not a hex value. Demanding hex on both
    // sides of the read-back comparison called this successful write a failure,
    // which is exactly the kind of false alarm that gets an integrity assertion
    // switched off.
    const result = applyDocumentEdits(ed as unknown as LiveEditor, {
      changeSetId: 'highlight',
      edits: [
        {
          op: 'set_char_format',
          anchor: HEADING.anchor,
          highlightColor: 'Yellow',
          expect: HEADING.text
        } as any
      ]
    });

    expect(result.results[0]).toMatchObject({ ok: true });
  });
});
