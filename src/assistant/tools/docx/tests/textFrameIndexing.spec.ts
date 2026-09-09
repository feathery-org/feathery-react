// The flagship proposal's title "Commercial Combined Insurance Proposal" sits
// inside a Word text box, and asking the assistant to change it failed while
// the identical request on body text worked.
//
// The write path was never the problem: `textFrameTrackedWrite.spec.ts` already
// proves a tracked replace inside a frame lands, groups, and rejects byte for
// byte. What failed is the step before it. `flattenSfdt` walked sections,
// blocks and table cells but never descended into `inline.textFrame.blocks`, so
// the frame's paragraphs existed in no projection built on it:
//
//   - getDocumentInventory - the read the tool schema REQUIRES the model to
//     confirm an anchor with before editing at it,
//   - buildIndexBlocks - the semantic index searchGeneratedDocument ranks,
//   - the anchor->block map findOneDocumentOccurrences attaches context from.
//
// So the title was unreadable and unaddressable: the model that asked for the
// document could not see the text it had been told to change, and had no anchor
// to aim an edit at. The one path that did see it, live search, is not the path
// the schema tells the model to verify with.
//
// THE LAW: every content story is walked and addressed the same way. Body
// blocks, table cells and text frames all reach the index, and the frame block
// carries the SAME public anchor the write path already accepts
// (`host;S;shapeOrdinal;frameBlock`), so no op needs a text-box special case.
//
// This spec is that law's pinning pair: the identical edit, at an anchor taken
// from the index and never from live search, must succeed on the title inside a
// text frame and on the same title as a body paragraph.
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
  buildIndexBlocks,
  flattenSfdt,
  getDocumentInventory,
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

if (!(window.SVGElement.prototype as any).getBBox) {
  (window.SVGElement.prototype as any).getBBox = () =>
    ({ x: 0, y: 0, width: 0, height: 0 } as DOMRect);
}

const TITLE = 'Commercial Combined Insurance Proposal';
const NEW_TITLE = 'Commercial Combined Insurance Quote';

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

const withEditor = (sfdt: any, run: (ed: DocumentEditor) => void) => {
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

/** A shape carrying `textFrame.blocks`: how SyncFusion serializes a text box. */
const textBox = (blocks: any[]) => ({
  shapeId: 'cover-title-frame',
  name: 'Cover title frame',
  visible: true,
  width: 420,
  height: 90,
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
    blocks
  }
});

/** The flagship cover page: the title lives inside the text box. */
const frameTitleDoc = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Prepared for Hilb Group' }] },
        {
          inlines: [
            textBox([
              { inlines: [{ text: 'Hilb Group' }] },
              { inlines: [{ text: TITLE }] }
            ])
          ]
        },
        { inlines: [{ text: 'Prepared by Tyler Marlow' }] }
      ]
    }
  ]
});

/** The control: the same title as an ordinary body paragraph. */
const bodyTitleDoc = () => ({
  sections: [
    {
      blocks: [
        { inlines: [{ text: 'Prepared for Hilb Group' }] },
        { inlines: [{ text: TITLE }] },
        { inlines: [{ text: 'Prepared by Tyler Marlow' }] }
      ]
    }
  ]
});

const inventoryEntries = (ed: DocumentEditor) => {
  const result = getDocumentInventory(ed as unknown as LiveEditor, {
    scope: 'full'
  }) as { inventory?: { anchor: string; kind: string; text: string }[] };
  return result.inventory ?? [];
};

/**
 * The anchor the assistant is told to edit at: found in the inventory the tool
 * schema makes it confirm with, never in live search.
 */
const indexedAnchorOf = (ed: DocumentEditor, text: string): string => {
  const entry = inventoryEntries(ed).find((e) => e.text.includes(text));
  expect(entry).toBeDefined();
  return entry!.anchor;
};

const replaceAtIndexedAnchor = (ed: DocumentEditor, changeSetId: string) => {
  const anchor = indexedAnchorOf(ed, TITLE);
  return applyDocumentEdits(ed as unknown as LiveEditor, {
    changeSetId,
    edits: [
      {
        op: 'replace_text',
        anchor,
        find: TITLE,
        replace: NEW_TITLE,
        expect: TITLE
      }
    ]
  });
};

describe('a title inside a text box is indexed like any other story', () => {
  it('flattenSfdt reaches text-frame paragraphs and gives them the public frame anchor', () => {
    const blocks = flattenSfdt(frameTitleDoc());
    const title = blocks.find((block) => block.text === TITLE);
    expect(title).toBeDefined();
    // `host;S;shapeOrdinal;frameBlock` - the anchor space the write path
    // already resolves (see resolveLiveStoryTarget / currentTextFrameText).
    expect(title!.anchor).toBe('0;1;S;1;1');
    expect(title!.kind).toBe('text_frame');
    expect(title!.length).toBe(TITLE.length);
    // The frame's other paragraph is walked too, in frame order.
    expect(blocks.find((block) => block.text === 'Hilb Group')?.anchor).toBe(
      '0;1;S;1;0'
    );
    // Body paragraphs keep the anchors they always had.
    expect(
      blocks.find((block) => block.text === 'Prepared by Tyler Marlow')?.anchor
    ).toBe('0;2');
  });

  it('the model can read the title: it is in the inventory and the semantic index', () => {
    withEditor(frameTitleDoc(), (ed) => {
      expect(
        inventoryEntries(ed).some((entry) => entry.text.includes(TITLE))
      ).toBe(true);
      expect(
        buildIndexBlocks(ed as unknown as LiveEditor).some((block) =>
          block.text.includes(TITLE)
        )
      ).toBe(true);
    });
  });
});

describe('THE PINNING PAIR: the same edit at the same indexed anchor', () => {
  it('changes the title inside a text box', () => {
    withEditor(frameTitleDoc(), (ed) => {
      const result = replaceAtIndexedAnchor(ed, 'frame-title');
      expect(result.results.map((r) => r.error ?? 'ok')).toEqual(['ok']);
      expect(result.changeSet.status).toBe('applied');
      expect(
        flattenSfdt(JSON.parse(ed.serialize())).find(
          (block) => block.anchor === '0;1;S;1;1'
        )?.text
      ).toBe(NEW_TITLE);
    });
  });

  it('changes the same title as a body paragraph', () => {
    withEditor(bodyTitleDoc(), (ed) => {
      const result = replaceAtIndexedAnchor(ed, 'body-title');
      expect(result.results.map((r) => r.error ?? 'ok')).toEqual(['ok']);
      expect(result.changeSet.status).toBe('applied');
      expect(
        flattenSfdt(JSON.parse(ed.serialize())).find(
          (block) => block.anchor === '0;1'
        )?.text
      ).toBe(NEW_TITLE);
    });
  });

  it('the tracked edit inside the text box is one reversible change set', () => {
    withEditor(frameTitleDoc(), (ed) => {
      const before = ed.serialize();
      ed.enableTrackChanges = true;
      expect(replaceAtIndexedAnchor(ed, 'frame-tracked').changeSet.status).toBe(
        'applied'
      );
      const collection: any = (ed as any).revisions;
      const revisions: any[] = [];
      for (let i = 0; i < (collection?.length ?? 0); i++) {
        const revision = collection.changes?.[i] ?? collection[i];
        if (revision) revisions.push(revision);
      }
      expect(revisions.length).toBeGreaterThan(0);
      for (const revision of [...revisions].reverse()) revision.reject();
      expect(ed.serialize()).toBe(before);
    });
  });
});
