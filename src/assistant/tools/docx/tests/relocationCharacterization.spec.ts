/**
 * What the relocation family does TODAY, recorded before anything moves.
 *
 * The slice ahead recomposes five ops - copy_section, move_section,
 * swap_sections, duplicate_table, split_table - onto two range primitives. The
 * method is parity: the recomposition must produce the same document the
 * current path produces. That claim is only checkable against a baseline
 * captured beforehand, from the current code, over documents that are not
 * invented for the occasion.
 *
 * So this file asserts almost nothing about whether today's behaviour is GOOD.
 * It records what it IS, per op per shape, in two projections:
 *
 *   accept  - what the document reads if every revision is accepted: what the
 *             op actually did.
 *   reject  - what it reads if every revision is rejected: what the person gets
 *             back if they turn it down. A relocation must restore exactly.
 *
 * Those two are the whole contract of a tracked rearrangement, and they are
 * mechanism-independent - a recomposed op passes them or it changed behaviour.
 * A diff of serialized SFDT would fail on incidental structure the same edit can
 * legitimately produce two ways; text projections compare what a person sees.
 *
 * The one real assertion here is the family law, which is true today and must
 * stay true: rejecting a relocation restores the pre-op document exactly.
 * Anything else that shifts shows up as a changed golden, which is a review
 * conversation rather than a silent pass.
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
import {
  acceptProjectionStream,
  applyDocumentEdits,
  flattenSfdt,
  LiveEditor,
  rejectProjectionStream
} from '../syncfusionDocumentOps';
import { corpusShapes, readShape } from './corpusShapes';

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

interface Landmarks {
  headings: string[];
  tableAnchors: string[];
  firstBodyPara?: string;
}

/**
 * The anchors an op can be driven at, read from the document rather than
 * assumed. A shape with no table cannot be asked to split one, and saying so is
 * part of the record.
 */
const landmarksOf = (editor: DocumentEditor): Landmarks => {
  const blocks = flattenSfdt(JSON.parse(editor.serialize())) as any[];
  const headings = blocks.filter((b) => b.isHeading).map((b) => b.anchor);
  const tableAnchors = [
    ...new Set(
      blocks
        .filter((b) => b.kind === 'table_cell')
        .map((b) => String(b.anchor).split(';').slice(0, 2).join(';'))
    )
  ];
  const firstBodyPara = blocks.find(
    (b) =>
      b.kind !== 'table_cell' && !b.isHeading && String(b.text ?? '').trim()
  )?.anchor;
  return { headings, tableAnchors, firstBodyPara };
};

/** One driveable case: the op, and the edit built from this shape's landmarks. */
type Case = {
  op: string;
  build: (marks: Landmarks) => Record<string, unknown> | null;
};

const CASES: Case[] = [
  {
    op: 'move_section',
    build: (m) =>
      m.headings.length >= 2
        ? {
            anchor: m.headings[m.headings.length - 1],
            targetAnchor: m.headings[0],
            position: 'before'
          }
        : null
  },
  {
    op: 'copy_section',
    build: (m) =>
      m.headings.length >= 2
        ? {
            anchor: m.headings[m.headings.length - 1],
            targetAnchor: m.headings[0],
            position: 'before'
          }
        : null
  },
  {
    // swap names its partner `otherAnchor`, not `targetAnchor`. Driving it with
    // the wrong param refused on fifteen of seventeen shapes and would have left
    // one of the five ops uncharacterized while looking covered.
    op: 'swap_sections',
    build: (m) =>
      m.headings.length >= 2
        ? { anchor: m.headings[0], otherAnchor: m.headings[1] }
        : null
  },
  {
    op: 'duplicate_table',
    build: (m) => (m.tableAnchors.length ? { anchor: m.tableAnchors[0] } : null)
  },
  {
    op: 'split_table',
    build: (m) =>
      m.tableAnchors.length && m.firstBodyPara
        ? {
            anchor: `${m.tableAnchors[0]};1;0;0`,
            splitAtRow: 1,
            targetAnchor: m.firstBodyPara,
            position: 'after'
          }
        : null
  }
];

describe('relocation family, characterized before the slice moves it', () => {
  let editor: DocumentEditor;
  afterEach(() => {
    if (!editor) return;
    const element = editor.element;
    editor.destroy();
    element?.remove();
  });

  const open = (sfdt: any) => {
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
    editor.open(JSON.stringify(sfdt));
    return editor as unknown as LiveEditor;
  };

  const shapes = corpusShapes();

  it('has a corpus to characterize against', () => {
    // Guards the guard: if the vendored corpus goes missing this whole file
    // would pass by running nothing, which is the failure mode this workstream
    // keeps meeting.
    expect(shapes.length).toBeGreaterThanOrEqual(16);
  });

  describe.each(shapes)('$name', (shape) => {
    it.each(CASES)('$op', ({ op, build }) => {
      const sfdt = readShape(shape);
      const live = open(sfdt);
      const marks = landmarksOf(editor);
      const edit = build(marks);

      if (!edit) {
        // Not driveable on this shape. Recorded rather than skipped silently:
        // a shape losing its landmarks later would otherwise look like coverage.
        expect(edit).toBeNull();
        return;
      }

      const before = JSON.parse(editor.serialize());
      const beforeReject = rejectProjectionStream(before);

      let outcome: string;
      try {
        const result: any = applyDocumentEdits(live, {
          changeSetId: `characterize-${shape.name}-${op}`,
          edits: [{ op, group: 'g', ...edit } as any]
        });
        const first = result.results?.[0];
        outcome = first?.ok ? 'ok' : `refused:${first?.error ?? 'unknown'}`;
      } catch (error: any) {
        outcome = `threw:${String(error?.message ?? error).split(':')[0]}`;
      }

      const after = JSON.parse(editor.serialize());

      // THE FAMILY LAW, and the only judgement this file makes: whatever the op
      // did or refused to do, turning it down gives the person back exactly the
      // document they had. This is what a recomposition must not break.
      expect(rejectProjectionStream(after)).toBe(beforeReject);

      // The rest is the record. Printed rather than snapshotted to a file: the
      // slice compares these two projections across the recomposition, and a
      // golden file would invite someone to regenerate it instead of reading it.
      // eslint-disable-next-line no-console
      console.log(
        `[characterize] ${shape.name} ${op} -> ${outcome} ` +
          `accept=${acceptProjectionStream(after).length}ch ` +
          `reject=${rejectProjectionStream(after).length}ch` +
          (shape.local ? ' (local-only shape)' : '')
      );
    });
  });
});
