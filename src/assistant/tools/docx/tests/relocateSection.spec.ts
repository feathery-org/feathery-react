// Reordering, as a structure change rather than a rewrite.
//
// Live evidence for why these two ops exist (captain, verified in the session
// logs, not re-derived):
//
//   - "move the Your Client Services Team section above About Hilb Group". With
//     no relocation op, the model expressed the move as insert_section plus
//     cleanup: it RETYPED every paragraph and every table cell, and when one op
//     of the cleanup group failed, the group's own atomic rollback took the
//     delete_table with it and left a duplicate section in the document.
//
//   - "swap National Capabilities, Local Service and Industry Experience". The
//     model improvised a three-way text shuffle through placeholder tokens -
//     `__TMP_SWAP_HEADING_1__`, `__TMP_SWAP_PARA_1__` - and failed on an
//     `expect` truncated by one character against a 35-character heading.
//
// Both failures are the same class: a structural intent expressed as a sequence
// of content writes, each of which is a fresh chance to mis-transcribe or
// mis-count. `move_section` and `swap_sections` carry no content field, so the
// class is unreachable through them.
//
// What every case here asserts, because "ok: true" from SyncFusion only means
// "did not throw": accepting produces the intended ORDER, the moved table's
// appearance facts read IDENTICALLY on both sides, rejecting restores the
// serialized document STRING-EQUAL on the same editor instance, and the whole
// relocation is ONE entry in changeSet.groups - one rail card, one accept, one
// reject, one undo.
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
  flattenSfdt,
  getDocumentInventory,
  EditOp,
  LiveEditor
} from '../syncfusionDocumentOps';
import { collectTableAppearance, inferHeaderRows } from '../tableAppearance';
import {
  listRevisionGroups,
  resolveLiveRevisionGroupsAsOneUndo
} from '../../../../utils/documentEditorPrimitives';

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

// `layoutType: 'Continuous'` is a JSDOM accommodation, not a product setting,
// and it belongs only on fixtures that carry a header or footer story.
//
// jest-canvas-mock cannot measure text, so a NON-EMPTY header widget gets a NaN
// height. That NaN reaches `Math.max(headerDistance + page.headerWidget.height,
// top)` in the SDK's `updateClientArea` (viewer.js:5770 - the footer arm at :5785
// is the same), so `viewer.clientArea` goes NaN. Every fit test downstream
// compares against NaN and every such comparison is false, so
// `Layout.shiftWidgetsForPara` (layout.js:12812) can neither judge a paragraph to
// fit nor take its escape hatch: it splits the SAME paragraph onto a fresh page
// forever, about 11 pages a second, and the whole worker wedges - synchronously,
// so jest's testTimeout cannot fire. It reproduces on `replace_text` with no
// relocation in the picture, so it is not about these ops.
//
// In Chrome the header widget measures 16.83 and `clientArea` is finite, so the
// runaway does not exist there: the same move over a 7-page header-bearing
// document accepts in 116ms and rejects byte-exact in 169ms. Continuous layout
// does not paginate, so the NaN never reaches a fit test. Header-free fixtures
// keep the default `Pages` layout on purpose - the pagination-sensitive
// assertions elsewhere in this file must keep testing what they test.
function makeEditor(
  sfdt: any,
  options: { layoutType?: 'Pages' | 'Continuous' } = {}
): DocumentEditor {
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
    enableEditorHistory: true,
    ...(options.layoutType ? { layoutType: options.layoutType } : {})
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroyEditor(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

function expectDocumentContentUnchangedAndTrackingOff(
  editor: DocumentEditor,
  before: string
): void {
  expect(editor.enableTrackChanges).toBe(false);
  const beforeSfdt = JSON.parse(before);
  const afterSfdt = JSON.parse(editor.serialize());
  delete beforeSfdt.trackChanges;
  delete beforeSfdt.tc;
  delete afterSfdt.trackChanges;
  delete afterSfdt.tc;
  expect(afterSfdt).toEqual(beforeSfdt);
}

// An empty paragraph carries NO inline, which is what a real document holds. A
// degenerate `{ text: '' }` inline survives `open()` but SFDT normalizes it away
// on the next write, so a fixture built that way fails a byte-for-byte reject
// comparison over a difference that is not content.
const para = (text: string, styleName?: string) => ({
  inlines: text ? [{ text }] : [],
  ...(styleName ? { paragraphFormat: { styleName } } : {})
});

const cell = (text: string) => ({
  cellFormat: {},
  blocks: [{ inlines: [{ text }] }]
});

// A real DocumentEditor keeps a paragraph's style only when the document
// DECLARES it, so heading levels - and therefore every section boundary - need
// this table. Without it `open()` normalizes the fixture to Normal and every
// assertion about a section would pass vacuously over one flat run of text.
const headingStyles = () => [
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
    characterFormat: { bold: true, fontSize: 16 },
    paragraphFormat: { outlineLevel: 'Level1', beforeSpacing: 12 }
  },
  {
    type: 'Paragraph',
    name: 'Heading 2',
    basedOn: 'Normal',
    next: 'Normal',
    characterFormat: { bold: true, fontSize: 13 },
    paragraphFormat: { outlineLevel: 'Level2', beforeSpacing: 8 }
  }
];

/** Every body-paragraph text in document order (table cells excluded). */
const bodyTexts = (editor: DocumentEditor): string[] =>
  flattenSfdt(JSON.parse(editor.serialize()))
    .filter((block) => block.kind !== 'table_cell')
    .map((block) => block.text);

/** Every heading in document order - the order a relocation is judged by. */
const headings = (editor: DocumentEditor): string[] =>
  flattenSfdt(JSON.parse(editor.serialize()))
    .filter((block) => block.isHeading)
    .map((block) => block.text);

/** The table's own facts, read off the SFDT and never off widget state. */
const tableFacts = (editor: DocumentEditor) => {
  const sfdt = JSON.parse(editor.serialize());
  const blocks: any[] = sfdt.sections?.[0]?.blocks ?? sfdt.sec?.[0]?.b ?? [];
  for (let index = 0; index < blocks.length; index++) {
    const appearance = collectTableAppearance(blocks[index]);
    if (!appearance) continue;
    return {
      layout: appearance.layout ?? null,
      styleName: appearance.styleName ?? null,
      headerRows: inferHeaderRows(appearance),
      rowCount: appearance.rows.length,
      rows: appearance.rows.map((row) => ({
        isHeader: row.isHeader,
        shading: row.appearance?.shading ?? null,
        cells: row.cells.map((entry) => entry?.appearance?.shading ?? null)
      }))
    };
  }
  return null;
};

const apply = (editor: DocumentEditor, edits: EditOp[], changeSetId: string) =>
  applyDocumentEdits(editor as unknown as LiveEditor, { edits, changeSetId });

// The captain's own document shape: three level-1 sections, the middle one
// carrying a 3-row table with a #4472C4 shaded header row and allowAutoFit.
const proposalFixture = () => ({
  sections: [
    {
      blocks: [
        para('About Hilb Group', 'Heading 1'), // 0;0
        para('Hilb Group is a national broker.'), // 0;1
        para('Your Client Services Team', 'Heading 1'), // 0;2
        para('Your dedicated team is listed below.'), // 0;3
        {
          // 0;4
          tableFormat: { allowAutoFit: true },
          rows: [
            {
              rowFormat: { isHeader: true },
              cells: [
                { ...cell('Team Member'), cellFormat: { shading: {
                  backgroundColor: '#4472C4'
                } } },
                { ...cell('Role'), cellFormat: { shading: {
                  backgroundColor: '#4472C4'
                } } },
                { ...cell('Contact Info'), cellFormat: { shading: {
                  backgroundColor: '#4472C4'
                } } }
              ]
            },
            {
              rowFormat: {},
              cells: [
                cell('Faizal Somani'),
                cell('Risk Advisor'),
                cell('Direct:')
              ]
            },
            {
              rowFormat: {},
              cells: [cell('Ann Lee'), cell('Account Manager'), cell('Direct:')]
            }
          ]
        },
        para('Next Steps', 'Heading 1'), // 0;5
        para('Confirm the coverage by Friday.') // 0;6
      ]
    }
  ],
  styles: headingStyles()
});

// A parent section with two subsections, plus a sibling parent. The shape the
// captain's swap request pointed at, and the shape the scope 'section' read got
// wrong before `sectionUnitEnd` owned the boundary rule.
const nestedFixture = () => ({
  sections: [
    {
      blocks: [
        para('How We Support Clients', 'Heading 1'), // 0;0
        para('Our service model has two halves.'), // 0;1
        para('National Capabilities, Local Service', 'Heading 2'), // 0;2
        para('National scale with a local team.'), // 0;3
        para('Industry Experience', 'Heading 2'), // 0;4
        para('Deep experience in your industry.'), // 0;5
        para('Next Steps', 'Heading 1'), // 0;6
        para('Confirm the coverage by Friday.') // 0;7
      ]
    }
  ],
  styles: headingStyles()
});

describe('move_section: a relocation writes no content', () => {
  it('moves a section with its table above another, one card, clean both ways', () => {
    const editor = makeEditor(proposalFixture());
    try {
      const before = editor.serialize();
      const factsBefore = tableFacts(editor);
      // The facts the move must carry: a flagged header row, its shared fill,
      // three rows, and autofit. Asserted here so the comparison after the move
      // cannot pass vacuously against an appearance that was never read.
      expect(factsBefore?.headerRows).toBe(1);
      expect(factsBefore?.rows[0]).toMatchObject({
        isHeader: true,
        shading: '#4472C4'
      });
      expect(factsBefore?.rowCount).toBe(3);
      expect(factsBefore?.layout?.allowAutoFit).toBe(true);

      const result = apply(
        editor,
        [
          {
            op: 'move_section',
            anchor: '0;2',
            expect: 'Your Client Services Team',
            targetAnchor: '0;0',
            position: 'before'
          }
        ],
        'move-client-services'
      );

      expect(result.results[0]).toMatchObject({ ok: true, op: 'move_section' });
      expect(result.changeSet?.status).toBe('applied');
      // One op, one group: the rail shows a single card for the whole move even
      // though SyncFusion authored dozens of revisions for it.
      expect(result.changeSet?.groups).toHaveLength(1);

      const pending = editor.serialize();
      expect(pending).not.toBe(before);

      // Reject first, on THIS editor instance - reopening the pending SFDT
      // normalizes styles and would give a false negative.
      editor.revisions.rejectAll();
      expect(editor.serialize()).toBe(before);
      expect(headings(editor)).toEqual([
        'About Hilb Group',
        'Your Client Services Team',
        'Next Steps'
      ]);
      expect(tableFacts(editor)).toEqual(factsBefore);
    } finally {
      destroyEditor(editor);
    }
  });

  it('accepting completes the move and the table survives it exactly', () => {
    const editor = makeEditor(proposalFixture());
    try {
      const factsBefore = tableFacts(editor);
      const result = apply(
        editor,
        [
          {
            op: 'move_section',
            anchor: '0;2',
            targetAnchor: '0;0',
            position: 'before'
          }
        ],
        'move-client-services-accept'
      );
      expect(result.results[0].ok).toBe(true);

      editor.revisions.acceptAll();
      expect(headings(editor)).toEqual([
        'Your Client Services Team',
        'About Hilb Group',
        'Next Steps'
      ]);
      expect(bodyTexts(editor)).toContain('Your dedicated team is listed below.');
      // Exactly one copy of what moved: the failure this op replaces left two.
      expect(
        bodyTexts(editor).filter(
          (text) => text === 'Your dedicated team is listed below.'
        )
      ).toHaveLength(1);
      expect(tableFacts(editor)).toEqual(factsBefore);
    } finally {
      destroyEditor(editor);
    }
  });

  it('position "after" lands past everything the target section covers', () => {
    const editor = makeEditor(nestedFixture());
    try {
      const result = apply(
        editor,
        [
          {
            op: 'move_section',
            anchor: '0;6',
            expect: 'Next Steps',
            targetAnchor: '0;2',
            position: 'after'
          }
        ],
        'move-next-steps-after-subsection'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      // After the SUBSECTION unit (its heading and its body), not after its
      // heading paragraph - and its sibling subsection is untouched.
      expect(headings(editor)).toEqual([
        'How We Support Clients',
        'National Capabilities, Local Service',
        'Next Steps',
        'Industry Experience'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });

  it('moving a parent carries its subsections; moving one leaves the rest', () => {
    const parentEditor = makeEditor(nestedFixture());
    try {
      const result = apply(
        parentEditor,
        [{ op: 'move_section', anchor: '0;0', targetAnchor: '0;6' }],
        'move-parent'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      parentEditor.revisions.acceptAll();
      expect(headings(parentEditor)).toEqual([
        'How We Support Clients',
        'National Capabilities, Local Service',
        'Industry Experience',
        'Next Steps'
      ]);
      expect(bodyTexts(parentEditor)[0]).toBe('How We Support Clients');
    } finally {
      destroyEditor(parentEditor);
    }

    const childEditor = makeEditor(nestedFixture());
    try {
      const result = apply(
        childEditor,
        [{ op: 'move_section', anchor: '0;4', targetAnchor: '0;6' }],
        'move-subsection'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      childEditor.revisions.acceptAll();
      expect(headings(childEditor)).toEqual([
        'How We Support Clients',
        'National Capabilities, Local Service',
        'Industry Experience',
        'Next Steps'
      ]);
      expect(bodyTexts(childEditor)).toEqual([
        'How We Support Clients',
        'Our service model has two halves.',
        'National Capabilities, Local Service',
        'National scale with a local team.',
        'Industry Experience',
        'Deep experience in your industry.',
        'Next Steps',
        'Confirm the coverage by Friday.'
      ]);
    } finally {
      destroyEditor(childEditor);
    }
  });

  it('moves adjacent sections, and reject is byte-identical', () => {
    const editor = makeEditor({
      sections: [
        {
          blocks: [
            para('Alpha', 'Heading 1'),
            para('a body'),
            para('Beta', 'Heading 1'),
            para('b body'),
            para('Gamma', 'Heading 1'),
            para('g body')
          ]
        }
      ],
      styles: headingStyles()
    });
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [{ op: 'move_section', anchor: '0;2', targetAnchor: '0;0' }],
        'move-adjacent'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.rejectAll();
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('moves the last section of a document that ends in a paragraph', () => {
    const editor = makeEditor({
      sections: [
        {
          blocks: [
            para('Alpha', 'Heading 1'),
            para('a body'),
            para('Beta', 'Heading 1'),
            para('b body'),
            para('Gamma', 'Heading 1'),
            para('g body')
          ]
        }
      ],
      styles: headingStyles()
    });
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [{ op: 'move_section', anchor: '0;4', targetAnchor: '0;0' }],
        'move-document-tail'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      // The end anchor has to be `last.length + 1` so the section's own
      // paragraph mark travels with it. At `last.length` the moved tail fuses
      // with whatever it lands beside ("g bodyAlpha") and a stray empty
      // paragraph is stranded behind - both silent.
      expect(bodyTexts(editor).slice(0, 4)).toEqual([
        'Gamma',
        'g body',
        'Alpha',
        'a body'
      ]);
      expect(bodyTexts(editor)).not.toContain('g bodyAlpha');

      const rejectEditor = makeEditor({
        sections: [
          {
            blocks: [
              para('Alpha', 'Heading 1'),
              para('a body'),
              para('Beta', 'Heading 1'),
              para('b body'),
              para('Gamma', 'Heading 1'),
              para('g body')
            ]
          }
        ],
        styles: headingStyles()
      });
      try {
        expect(rejectEditor.serialize()).toBe(before);
        apply(
          rejectEditor,
          [{ op: 'move_section', anchor: '0;4', targetAnchor: '0;0' }],
          'move-document-tail-reject'
        );
        rejectEditor.revisions.rejectAll();
        expect(rejectEditor.serialize()).toBe(before);
      } finally {
        destroyEditor(rejectEditor);
      }
    } finally {
      destroyEditor(editor);
    }
  });

  // The other end of the same range arithmetic, and the one nothing covered:
  // moving a section TO the end of the document. "After the last block" is the
  // one destination the document has no caret for - a block anchor addresses a
  // paragraph's TEXT, so the furthest caret that exists is before the final
  // paragraph mark, not after it - and pasting there merged the payload's first
  // block into the document's last paragraph. Every paragraph tail shape fused,
  // silently, over `ok: true`.
  //
  // Parameterised over the tail SHAPES rather than one document, because the
  // fusion is a property of what the target unit ends with: whether its last
  // block carries text, whether the target has a subsection under it, and
  // whether the document ends with a table at all.
  describe('a move whose destination is the end of the document', () => {
    const tailShapes: Array<[string, () => any, string[]]> = [
      [
        'the target ends with a body paragraph',
        () => ({
          sections: [
            {
              blocks: [
                para('Alpha', 'Heading 1'),
                para('a body'),
                para('Beta', 'Heading 1'),
                para('b body'),
                para('Gamma', 'Heading 1'),
                para('g body')
              ]
            }
          ],
          styles: headingStyles()
        }),
        ['Beta', 'b body', 'Gamma', 'g body', 'Alpha', 'a body']
      ],
      [
        'the target is a heading with no body under it',
        () => ({
          sections: [
            {
              blocks: [
                para('Alpha', 'Heading 1'),
                para('a body'),
                para('Beta', 'Heading 1'),
                para('b body'),
                para('Gamma', 'Heading 1')
              ]
            }
          ],
          styles: headingStyles()
        }),
        ['Beta', 'b body', 'Gamma', 'Alpha', 'a body']
      ],
      [
        'the target unit ends with a subsection',
        () => ({
          sections: [
            {
              blocks: [
                para('Alpha', 'Heading 1'),
                para('a body'),
                para('Beta', 'Heading 1'),
                para('b body'),
                para('Gamma', 'Heading 1'),
                para('g body'),
                para('Gamma Sub', 'Heading 2'),
                para('gs body')
              ]
            }
          ],
          styles: headingStyles()
        }),
        [
          'Beta',
          'b body',
          'Gamma',
          'g body',
          'Gamma Sub',
          'gs body',
          'Alpha',
          'a body'
        ]
      ]
    ];

    it.each(tailShapes)(
      'accepting puts it at the end intact when %s',
      (_label, fixture, expected) => {
        const editor = makeEditor(fixture());
        try {
          expect(
            apply(
              editor,
              [
                {
                  op: 'move_section',
                  anchor: '0;0',
                  targetAnchor: '0;4',
                  position: 'after'
                }
              ],
              'tail-target-accept'
            ).results[0]
          ).toMatchObject({ ok: true });
          editor.revisions.acceptAll();
          expect(bodyTexts(editor).slice(0, expected.length)).toEqual(expected);
          // Nothing absorbed the moved heading. The fusion signature was the
          // target's last paragraph reading its own text with the moved
          // section's heading welded onto it, wearing the heading's style.
          for (const text of bodyTexts(editor))
            expect(text === 'Alpha' || !text.includes('Alpha')).toBe(true);
        } finally {
          destroyEditor(editor);
        }
      }
    );

    // The landing paragraph is created as a TRACKED insertion inside the same
    // card, which is what keeps both reject routes byte-exact rather than
    // leaving a paragraph mark nobody can take back.
    it.each(tailShapes)(
      'both reject routes restore it byte for byte when %s',
      (_label, fixture) => {
        for (const rail of [false, true]) {
          const editor = makeEditor(fixture());
          try {
            const before = editor.serialize();
            apply(
              editor,
              [
                {
                  op: 'move_section',
                  anchor: '0;0',
                  targetAnchor: '0;4',
                  position: 'after'
                }
              ],
              `tail-target-reject-${rail}`
            );
            if (rail)
              resolveLiveRevisionGroupsAsOneUndo(
                editor as unknown as LiveEditor,
                listRevisionGroups(editor as unknown as LiveEditor),
                false
              );
            else editor.revisions.rejectAll();
            expect(editor.serialize()).toBe(before);
          } finally {
            destroyEditor(editor);
          }
        }
      }
    );

    // The fourth tail shape, and the one that is REFUSED rather than handled:
    // a document ending with a table has no body block after it to land at, and
    // creating one there would be authoring content the move never asked for.
    it('refuses when the document ends with a table', () => {
      const editor = makeEditor({
        sections: [
          {
            blocks: [
              para('Alpha', 'Heading 1'),
              para('a body'),
              para('Gamma', 'Heading 1'),
              {
                rows: [
                  {
                    rowFormat: { isHeader: true },
                    cells: [cell('Line'), cell('Carrier')]
                  },
                  { rowFormat: {}, cells: [cell('Auto'), cell('Acme')] }
                ]
              }
            ]
          }
        ],
        styles: headingStyles()
      });
      try {
        const before = editor.serialize();
        const result = apply(
          editor,
          [
            {
              op: 'move_section',
              anchor: '0;0',
              targetAnchor: '0;2',
              position: 'after'
            }
          ],
          'tail-target-table'
        );
        expect(result.results[0]).toMatchObject({
          ok: false,
          error: 'relocation_target_in_table'
        });
        expect(editor.serialize()).toBe(before);
      } finally {
        destroyEditor(editor);
      }
    });
  });
});

// The captain's live document, reduced to the shape that actually broke.
//
// "Your Client Services Team" is a Word SECTION of its own, so the section unit
// starting at its heading runs to the first block of the NEXT Word section, and
// its tail is a run of empty paragraphs ("Email: " then blanks). Two defects met
// here, and the live move failed with relocation_source_lost:
//
//   - the post-paste source position was computed from PER-SECTION block counts,
//     but the payload carries a section break, so pasting it SPLIT the
//     destination section and the destination's own count went DOWN. A negative
//     delta put the computed anchor back inside the copy that had just been
//     pasted - the engine was one comparison away from deleting the copy and
//     keeping the original in place.
//   - the identity comparison demanded the trailing empty paragraphs match
//     exactly, and a paste normalizes one away.
//
// Both are fixed by measuring in the whole-document block sequence and asserting
// the resolved source is not inside the pasted run.
//
// The MOVED section is deliberately the odd one out - landscape, and its own
// margins. With every section declaring the same geometry the page-setup
// assertion below could not fail: it would read 612 whether page setup had been
// carried, dropped or ignored. The moved section is the only one whose geometry
// a relocation could plausibly drag along, so it has to be the one that differs.
const PORTRAIT = { pageWidth: 612, pageHeight: 792, leftMargin: 72 };
const LANDSCAPE = { pageWidth: 792, pageHeight: 612, leftMargin: 36 };
const wordSectionFixture = () => ({
  sections: [
    {
      sectionFormat: { ...PORTRAIT },
      blocks: [
        para('About Hilb Group', 'Heading 1'), // 0;0
        para('Hilb Group is a national broker.'), // 0;1
        para('Our Approach', 'Heading 1'), // 0;2
        para('We start with your risk.') // 0;3
      ]
    },
    {
      sectionFormat: { ...LANDSCAPE },
      blocks: [
        para('Your Client Services Team', 'Heading 1'), // 1;0
        para('Your dedicated team is listed below.'), // 1;1
        para('Email: '), // 1;2
        para(''), // 1;3
        para(''), // 1;4
        para('') // 1;5
      ]
    },
    {
      sectionFormat: { ...PORTRAIT },
      blocks: [
        para('Location Schedule', 'Heading 1'), // 2;0
        para('Schedule body.') // 2;1
      ]
    }
  ],
  styles: headingStyles()
});

/**
 * The page geometry of the Word section holding `text`, or undefined when no
 * section holds it.
 *
 * Sections are identified by content they KEEP rather than by index, because a
 * relocation is free to renumber them - which is the whole point of asking
 * whether a survivor kept its own geometry.
 */
const sectionGeometryHolding = (editor: DocumentEditor, text: string) => {
  const sfdt = JSON.parse(editor.serialize());
  for (const section of (sfdt.sec ?? sfdt.sections) as any[]) {
    const holds = ((section.b ?? section.blocks) as any[]).some((block) =>
      ((block?.i ?? block?.inlines ?? []) as any[])
        .map((run) => run?.tlp ?? run?.text ?? '')
        .join('')
        .includes(text)
    );
    if (!holds) continue;
    const format = section.secpr ?? section.sectionFormat;
    return {
      pw: format.pw ?? format.pageWidth,
      ph: format.ph ?? format.pageHeight,
      lm: format.lm ?? format.leftMargin
    };
  }
  return undefined;
};

describe("the captain's move: a section that is its own Word section", () => {
  it('moves above an earlier section, one card, clean reject', () => {
    const editor = makeEditor(wordSectionFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'move_section',
            anchor: '1;0',
            expect: 'Your Client Services Team',
            targetAnchor: '0;0',
            position: 'before'
          }
        ],
        'captain-move'
      );
      expect(result.results[0]).toMatchObject({ ok: true, op: 'move_section' });
      expect(result.changeSet?.groups).toHaveLength(1);
      // The engine describes a relocation as a relocation. Reporting "writes no
      // table-cell values" beside a card that moved a whole section reads as
      // "nothing happened".
      expect(result.changeSet?.announcement).toContain('moves the section');
      expect(result.changeSet?.announcement).not.toContain(
        'no table-cell values'
      );

      editor.revisions.rejectAll();
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('accepting puts it in front, once, with the section break intact', () => {
    const editor = makeEditor(wordSectionFixture());
    try {
      const result = apply(
        editor,
        [
          {
            op: 'move_section',
            anchor: '1;0',
            targetAnchor: '0;0',
            position: 'before'
          }
        ],
        'captain-move-accept'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(headings(editor)).toEqual([
        'Your Client Services Team',
        'About Hilb Group',
        'Our Approach',
        'Location Schedule'
      ]);
      // Relocated, not retyped, and the original is gone rather than duplicated.
      expect(
        bodyTexts(editor).filter(
          (text) => text === 'Your dedicated team is listed below.'
        )
      ).toHaveLength(1);
      // The section that held the moved content held ONLY it, so accepting
      // collapses it rather than stranding a blank page - and no surviving Word
      // section is left empty. The section BREAK was never inside the range
      // (that would be an untracked delete with no card to reject); this is
      // SyncFusion retiring a section that no longer has content, on accept.
      const sfdt = JSON.parse(editor.serialize());
      const sections: any[] = sfdt.sec ?? sfdt.sections;
      expect(
        sections.map((section) => (section.b ?? section.blocks).length)
      ).not.toContain(0);
    } finally {
      destroyEditor(editor);
    }
  });

  // Page setup is intact on what remains - a relocation carries content, not
  // page geometry. Asserted as each SURVIVOR keeping ITS OWN geometry, read off
  // the same document before the move, rather than against a literal: the
  // fixture's three sections no longer share one page size, so a move that
  // dragged geometry along, or flattened every section to the moved one's, now
  // has somewhere to show.
  it('every surviving Word section keeps its own page geometry', () => {
    const editor = makeEditor(wordSectionFixture());
    try {
      // The two sections that survive are identified by body text the move does
      // not touch; the moved section is identified by text that goes with it.
      const stays = ['We start with your risk.', 'Schedule body.'];
      const before = stays.map((text) => sectionGeometryHolding(editor, text));
      const movedBefore = sectionGeometryHolding(
        editor,
        'Your dedicated team is listed below.'
      );

      // The fixture really does distinguish them, or nothing below can fail.
      expect(before).toEqual([
        { pw: 612, ph: 792, lm: 72 },
        { pw: 612, ph: 792, lm: 72 }
      ]);
      expect(movedBefore).toEqual({ pw: 792, ph: 612, lm: 36 });

      expect(
        apply(
          editor,
          [
            {
              op: 'move_section',
              anchor: '1;0',
              targetAnchor: '0;0',
              position: 'before'
            }
          ],
          'captain-move-geometry'
        ).results[0]
      ).toMatchObject({ ok: true });
      editor.revisions.acceptAll();

      expect(stays.map((text) => sectionGeometryHolding(editor, text))).toEqual(
        before
      );
      // And the moved content is now governed by the geometry of the section it
      // landed in, which is the documented behaviour: the section it used to
      // have was its own and held only it, so accepting collapses that section
      // rather than stranding a blank page. Read here rather than assumed, so
      // the promise in the PR description is a measured one.
      expect(
        sectionGeometryHolding(editor, 'Your dedicated team is listed below.')
      ).toEqual(before[0]);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('swap_sections: one primitive, twice, bottom-up', () => {
  it('swaps two subsections as one card, correct accept, clean reject', () => {
    const editor = makeEditor(nestedFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'swap_sections',
            anchor: '0;2',
            expect: 'National Capabilities, Local Service',
            otherAnchor: '0;4'
          }
        ],
        'swap-subsections'
      );

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'swap_sections'
      });
      // Two relocations, one op, therefore one group: a failure in the second
      // rolls the first back, so a half-swap cannot survive.
      expect(result.changeSet?.groups).toHaveLength(1);

      editor.revisions.rejectAll();
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('accepting the swap exchanges both units, bodies included', () => {
    const editor = makeEditor(nestedFixture());
    try {
      const result = apply(
        editor,
        [{ op: 'swap_sections', anchor: '0;2', otherAnchor: '0;4' }],
        'swap-subsections-accept'
      );
      expect(result.results[0].ok).toBe(true);
      editor.revisions.acceptAll();
      expect(bodyTexts(editor).slice(0, 6)).toEqual([
        'How We Support Clients',
        'Our service model has two halves.',
        'Industry Experience',
        'Deep experience in your industry.',
        'National Capabilities, Local Service',
        'National scale with a local team.'
      ]);
      // No placeholder token can reach the document through an op with no
      // content field - the failure mode this op replaces.
      expect(bodyTexts(editor).join('\n')).not.toContain('__TMP');
    } finally {
      destroyEditor(editor);
    }
  });

  // The case the shift arithmetic can actually get wrong: the two ranges are
  // DIFFERENT sizes, so the second relocation's source has moved by a count that
  // is not its own. Every other swap here happens to exchange equal-sized units,
  // which would hide an off-by-N.
  it('swaps ranges of unequal size, table and all', () => {
    const editor = makeEditor(proposalFixture());
    try {
      const before = editor.serialize();
      const factsBefore = tableFacts(editor);
      // 0;0 About Hilb Group is 2 blocks; 0;2 Your Client Services Team is 3
      // (heading, body, table).
      const result = apply(
        editor,
        [{ op: 'swap_sections', anchor: '0;0', otherAnchor: '0;2' }],
        'swap-unequal'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(result.changeSet?.groups).toHaveLength(1);

      editor.revisions.rejectAll();
      expect(editor.serialize()).toBe(before);

      const acceptEditor = makeEditor(proposalFixture());
      try {
        expect(
          apply(
            acceptEditor,
            [{ op: 'swap_sections', anchor: '0;0', otherAnchor: '0;2' }],
            'swap-unequal-accept'
          ).results[0].ok
        ).toBe(true);
        acceptEditor.revisions.acceptAll();
        expect(headings(acceptEditor)).toEqual([
          'Your Client Services Team',
          'About Hilb Group',
          'Next Steps'
        ]);
        // No trailing empty paragraph: neither range runs to the end of the
        // document, so neither used the `length + 1` end anchor.
        expect(bodyTexts(acceptEditor)).toEqual([
          'Your Client Services Team',
          'Your dedicated team is listed below.',
          'About Hilb Group',
          'Hilb Group is a national broker.',
          'Next Steps',
          'Confirm the coverage by Friday.'
        ]);
        expect(tableFacts(acceptEditor)).toEqual(factsBefore);
      } finally {
        destroyEditor(acceptEditor);
      }
    } finally {
      destroyEditor(editor);
    }
  });

  // The op is symmetric by construction - the handler orders the two ranges
  // itself rather than trusting the caller to send the earlier one first, which
  // is what the bottom-up invariant needs and what the model cannot know.
  it.each([
    ['anchor first', '0;0', '0;5'],
    ['otherAnchor first', '0;5', '0;0']
  ])('swaps non-adjacent sections, %s', (_order, anchor, otherAnchor) => {
    const editor = makeEditor(proposalFixture());
    try {
      const result = apply(
        editor,
        [{ op: 'swap_sections', anchor, otherAnchor }],
        `swap-order-${anchor}`
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(headings(editor)).toEqual([
        'Next Steps',
        'Your Client Services Team',
        'About Hilb Group'
      ]);
      // The table travelled with the section that owns it, exactly once.
      expect(tableFacts(editor)?.rowCount).toBe(3);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('copy_section: the same primitive without its delete', () => {
  it('duplicates a section with its table; accept keeps both, reject removes only the new one', () => {
    const editor = makeEditor(proposalFixture());
    try {
      const before = editor.serialize();
      const factsBefore = tableFacts(editor);
      const result = apply(
        editor,
        [
          {
            op: 'copy_section',
            anchor: '0;2',
            expect: 'Your Client Services Team',
            targetAnchor: '0;5',
            position: 'before'
          }
        ],
        'copy-client-services'
      );
      expect(result.results[0]).toMatchObject({ ok: true, op: 'copy_section' });
      expect(result.changeSet?.groups).toHaveLength(1);
      expect(result.changeSet?.announcement).toContain('copies the section');
      expect(result.changeSet?.announcement).toContain(
        'leaving the original in place'
      );

      // A copy authors Insertions ONLY - there is nothing to delete - so
      // rejecting removes just the new copy and the document is byte-identical.
      editor.revisions.rejectAll();
      expect(editor.serialize()).toBe(before);
      expect(headings(editor)).toEqual([
        'About Hilb Group',
        'Your Client Services Team',
        'Next Steps'
      ]);
      expect(tableFacts(editor)).toEqual(factsBefore);
    } finally {
      destroyEditor(editor);
    }
  });

  it('accepting keeps both copies, the duplicate carrying the same table', () => {
    const editor = makeEditor(proposalFixture());
    try {
      const factsBefore = tableFacts(editor);
      const result = apply(
        editor,
        [
          {
            op: 'copy_section',
            anchor: '0;2',
            targetAnchor: '0;5',
            position: 'before'
          }
        ],
        'copy-client-services-accept'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(headings(editor)).toEqual([
        'About Hilb Group',
        'Your Client Services Team',
        'Your Client Services Team',
        'Next Steps'
      ]);
      // TWO copies of the body now, which is the whole point of a copy - and the
      // duplicated table keeps the shaded header row and autofit.
      expect(
        bodyTexts(editor).filter(
          (text) => text === 'Your dedicated team is listed below.'
        )
      ).toHaveLength(2);
      expect(tableFacts(editor)).toEqual(factsBefore);
    } finally {
      destroyEditor(editor);
    }
  });

  it("copies a section holding another author's pending edit, and leaves it alone", () => {
    const editor = makeEditor(nestedFixture());
    try {
      // The refusal a MOVE gets here does not apply: a copy takes nothing away,
      // so the reviewer's pending change is never at risk.
      editor.enableTrackChanges = true;
      editor.currentUser = 'Dana Reviewer';
      editor.selection.select('0;3;0', '0;3;8');
      editor.editor.insertText('Regionally, ');
      const pendingRevisions = editor.revisions.length;
      expect(pendingRevisions).toBeGreaterThan(0);

      const result = apply(
        editor,
        [{ op: 'copy_section', anchor: '0;2', targetAnchor: '0;6' }],
        'copy-over-foreign-revision'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      // Their revision is still pending, untouched, alongside the copy's own.
      expect(editor.revisions.length).toBeGreaterThan(pendingRevisions);
    } finally {
      destroyEditor(editor);
    }
  });

  it('copies the last section of a document that ends in a table', () => {
    // The move refusal exists because `acceptAll` throws inside SyncFusion's own
    // delete of the tracked tail table. A copy deletes nothing, so the crash
    // cannot arise - asserted rather than assumed, because refusing a copy here
    // would be a refusal with no cause.
    const editor = makeEditor({
      sections: [
        {
          blocks: [
            para('Alpha', 'Heading 1'),
            para('a body'),
            para('Beta', 'Heading 1'),
            para('b body'),
            {
              tableFormat: {},
              rows: [
                { rowFormat: {}, cells: [cell('one'), cell('two')] },
                { rowFormat: {}, cells: [cell('three'), cell('four')] }
              ]
            }
          ]
        }
      ],
      styles: headingStyles()
    });
    try {
      const result = apply(
        editor,
        [{ op: 'copy_section', anchor: '0;2', targetAnchor: '0;0' }],
        'copy-document-tail-table'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      expect(() => editor.revisions.acceptAll()).not.toThrow();
      expect(headings(editor)).toEqual(['Beta', 'Alpha', 'Beta']);
    } finally {
      destroyEditor(editor);
    }
  });

  it.each([
    [
      'a target inside the range being copied',
      { op: 'copy_section', anchor: '0;0', targetAnchor: '0;4' } as EditOp,
      'relocation_target_inside_source'
    ],
    [
      'a target inside a table cell',
      {
        op: 'copy_section',
        anchor: '0;0',
        targetAnchor: '0;4;1;0;0'
      } as EditOp,
      'relocation_anchor_in_table'
    ]
  ])('refuses %s', (_name, edit, error) => {
    const editor = makeEditor(
      error === 'relocation_anchor_in_table' ? proposalFixture() : nestedFixture()
    );
    try {
      const before = editor.serialize();
      const result = apply(editor, [edit], 'copy-refusal');
      expect(result.results[0]).toMatchObject({ ok: false, error });
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('relocation refusals: each names what to do instead', () => {
  const refusalCases: Array<{
    name: string;
    fixture: () => any;
    edit: EditOp;
    error: string;
    says: string[];
  }> = [
    {
      name: 'the last section of a document that ends in a table',
      fixture: () => ({
        sections: [
          {
            blocks: [
              para('Alpha', 'Heading 1'),
              para('a body'),
              para('Beta', 'Heading 1'),
              para('b body'),
              {
                tableFormat: {},
                rows: [
                  { rowFormat: {}, cells: [cell('one'), cell('two')] },
                  { rowFormat: {}, cells: [cell('three'), cell('four')] }
                ]
              }
            ]
          }
        ],
        styles: headingStyles()
      }),
      edit: { op: 'move_section', anchor: '0;2', targetAnchor: '0;0' },
      error: 'relocation_document_tail_table',
      says: ['acceptAll', 'move_section']
    },
    {
      name: 'a target inside the range being moved',
      fixture: nestedFixture,
      edit: { op: 'move_section', anchor: '0;0', targetAnchor: '0;4' },
      error: 'relocation_target_inside_source',
      says: ['inside the range', 'targetAnchor']
    },
    {
      name: 'a target inside a table cell',
      fixture: proposalFixture,
      edit: {
        op: 'move_section',
        anchor: '0;0',
        targetAnchor: '0;4;1;0;0'
      },
      error: 'relocation_anchor_in_table',
      says: ['table cell']
    },
    {
      name: 'a swap of a section with its own subsection',
      fixture: nestedFixture,
      edit: { op: 'swap_sections', anchor: '0;0', otherAnchor: '0;2' },
      error: 'swap_sections_overlap',
      says: ['inside the other', 'move_section']
    },
    {
      name: 'an anchor no block answers to any more',
      fixture: nestedFixture,
      edit: { op: 'move_section', anchor: '0;2', targetAnchor: '0;99' },
      error: 'relocation_anchor_not_found',
      says: ['structure']
    }
  ];

  it.each(refusalCases.map((entry) => [entry.name, entry] as const))(
    'refuses %s and writes nothing',
    (_name, entry) => {
      const editor = makeEditor(entry.fixture());
      try {
        const before = editor.serialize();
        const result = apply(editor, [entry.edit], 'refusal');
        expect(result.results[0]).toMatchObject({
          ok: false,
          error: entry.error
        });
        const spoken = `${result.results[0].message ?? ''} ${(
          result.results[0].details ?? []
        ).join(' ')}`;
        for (const phrase of entry.says) expect(spoken).toContain(phrase);
        // Nothing written means nothing written: no revision, no change.
        expect(editor.serialize()).toBe(before);
        expect(editor.revisions.length).toBe(0);
      } finally {
        destroyEditor(editor);
      }
    }
  );

  it("refuses to move a range holding another author's pending change", () => {
    const editor = makeEditor(nestedFixture());
    try {
      // A human reviewer edits inside the section, tracked and unresolved.
      editor.enableTrackChanges = true;
      editor.currentUser = 'Dana Reviewer';
      editor.selection.select('0;3;0', '0;3;8');
      editor.editor.insertText('Regionally, ');
      const before = editor.serialize();
      const pendingRevisions = editor.revisions.length;
      expect(pendingRevisions).toBeGreaterThan(0);

      const result = apply(
        editor,
        [{ op: 'move_section', anchor: '0;2', targetAnchor: '0;6' }],
        'move-over-foreign-revision'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'relocation_source_has_pending_review'
      });
      expect(result.results[0].message).toContain('Dana Reviewer');
      // Their change is still there, and untouched.
      expectDocumentContentUnchangedAndTrackingOff(editor, before);
      expect(editor.revisions.length).toBe(pendingRevisions);
    } finally {
      destroyEditor(editor);
    }
  });

  it("folds Robin's own pending edit in, and reject restores the truth", () => {
    const editor = makeEditor(nestedFixture());
    try {
      const original = editor.serialize();
      const first = apply(
        editor,
        [
          {
            op: 'replace_text',
            anchor: '0;3',
            find: 'National scale',
            replace: 'Nationwide scale'
          }
        ],
        'robin-earlier-edit'
      );
      expect(first.results[0].ok).toBe(true);

      const moved = apply(
        editor,
        [{ op: 'move_section', anchor: '0;2', targetAnchor: '0;6' }],
        'robin-move-over-own-edit'
      );
      expect(moved.results[0]).toMatchObject({ ok: true });

      // Rejecting everything walks all the way back to the true original text,
      // in the original order: the move CONSUMED the earlier pending insertion
      // (SyncFusion authors no Deletion for text that is itself an unaccepted
      // insertion) rather than leaving anything untracked behind.
      //
      // Asserted on the content rather than on the serialized bytes: a plain
      // tracked replace_text plus rejectAll is already not byte-identical in
      // this SDK version - it materializes a default `boldBidi` onto the inline
      // it touched - which is true with no relocation in the picture at all.
      // The byte-for-byte bar is asserted where it belongs, on relocations of
      // untouched content, above.
      editor.revisions.rejectAll();
      expect(editor.revisions.length).toBe(0);
      expect(bodyTexts(editor)).toEqual(
        flattenSfdt(JSON.parse(original))
          .filter((block) => block.kind !== 'table_cell')
          .map((block) => block.text)
      );
    } finally {
      destroyEditor(editor);
    }
  });
});

// The rail card's own Accept/Reject buttons do NOT call revisions.rejectAll():
// they call resolveLiveRevisionGroupsAsOneUndo over the card's group, which is a
// different path with a different failure mode (it is what Anthony's 3729780254
// was about). Live, the browser tab died the first time that button was clicked
// on a relocation, and the retry then completed cleanly - so the death was the
// machine, not the code. This settles it deterministically instead: the path the
// button uses, over a relocation change set, restoring byte for byte.
//
// Cross-level relocations are included on purpose. They used to leave the
// destination paragraph wearing the moved section's style after a reject, which
// turned out not to be a relocation defect at all: it reproduced on
// `insert_section` alone and that op is already shipped. The fix is the
// paragraph-style inverse on the revision group itself, beside the appearance
// inverse - one owner, every op - and it is asserted over both outcomes in
// `acceptGroupsWithTableFormat.spec.ts`, where that property lives.
describe('the rail card resolves a relocation as one unit', () => {
  const railGroups = (editor: DocumentEditor) =>
    listRevisionGroups(editor as unknown as LiveEditor);

  it.each([
    ['a move', { op: 'move_section', anchor: '0;6', targetAnchor: '0;0' }],
    ['a swap', { op: 'swap_sections', anchor: '0;2', otherAnchor: '0;4' }],
    ['a copy', { op: 'copy_section', anchor: '0;6', targetAnchor: '0;0' }],
    // Cross-level, the shape that exposed the shared paragraph-style defect:
    // a subsection moved above a top-level section, so the two sides of the
    // paste carry different styles.
    ['a cross-level move', { op: 'move_section', anchor: '0;2', targetAnchor: '0;0' }],
    ['a cross-level copy', { op: 'copy_section', anchor: '0;2', targetAnchor: '0;0' }]
  ] as Array<[string, EditOp]>)(
    'rejecting the card restores the document exactly after %s',
    (_name, edit) => {
      const editor = makeEditor(nestedFixture());
      try {
        const before = editor.serialize();
        const result = apply(editor, [edit], 'rail-group-reject');
        expect(result.results[0]).toMatchObject({ ok: true });

        // Exactly one card, which is what the group tag buys.
        const groups = railGroups(editor);
        expect(groups).toHaveLength(1);

        const rejected = resolveLiveRevisionGroupsAsOneUndo(
          editor as unknown as LiveEditor,
          groups,
          false
        );
        expect(rejected.length).toBeGreaterThan(0);
        expect(editor.revisions.length).toBe(0);
        expect(railGroups(editor)).toHaveLength(0);
        expect(editor.serialize()).toBe(before);
      } finally {
        destroyEditor(editor);
      }
    }
  );

  it('accepting the card completes a move and empties the rail', () => {
    const editor = makeEditor(nestedFixture());
    try {
      const result = apply(
        editor,
        [{ op: 'move_section', anchor: '0;4', targetAnchor: '0;2' }],
        'rail-group-accept'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      const groups = railGroups(editor);
      expect(groups).toHaveLength(1);

      resolveLiveRevisionGroupsAsOneUndo(
        editor as unknown as LiveEditor,
        groups,
        true
      );
      expect(editor.revisions.length).toBe(0);
      expect(railGroups(editor)).toHaveLength(0);
      expect(headings(editor)).toEqual([
        'How We Support Clients',
        'Industry Experience',
        'National Capabilities, Local Service',
        'Next Steps'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });
});

// Every real proposal carries a header, and no fixture above has one - so every
// relocation case in this file was being judged on a document shape the product
// never sees. This covers that shape on both resolutions and both paths.
//
// It is also the case Anthony hit: under the default `Pages` layout these four
// do not fail, they HANG, which is why nothing caught them. The cause is a JSDOM
// text-measurement artefact and it is written out in full beside `makeEditor`.
describe('a relocation on a document that carries a header', () => {
  const headerFixture = () => {
    const fixture: any = nestedFixture();
    fixture.sections[0].headersFooters = {
      header: { blocks: [{ inlines: [{ text: 'Hilb Group Proposal' }] }] }
    };
    return fixture;
  };
  const MOVED = ['Next Steps', 'How We Support Clients'];
  const headerEditor = () =>
    makeEditor(headerFixture(), { layoutType: 'Continuous' });

  // Without this the whole describe could pass over a document whose header
  // `open()` dropped, which is precisely the vacuous-fixture failure Anthony
  // named on the Word-section case. The runaway needs a header story with a
  // non-empty INLINE - an empty one short-circuits before the NaN arithmetic -
  // so what is asserted is the inline text, not the presence of the story.
  it('the fixture really carries a non-empty header story', () => {
    const editor = headerEditor();
    try {
      const section = JSON.parse(editor.serialize()).sec?.[0];
      const header = section?.hf?.h ?? section?.headersFooters?.header;
      const text = (header?.b ?? header?.blocks ?? [])
        .flatMap((block: any) => block.i ?? block.inlines ?? [])
        .map((inline: any) => inline.tlp ?? inline.text);
      expect(text).toEqual(['Hilb Group Proposal']);
    } finally {
      destroyEditor(editor);
    }
  });

  it('acceptAll completes the move', () => {
    const editor = headerEditor();
    try {
      const result = apply(
        editor,
        [{ op: 'move_section', anchor: '0;6', targetAnchor: '0;0' }],
        'header-accept'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(headings(editor).slice(0, 2)).toEqual(MOVED);
    } finally {
      destroyEditor(editor);
    }
  });

  it('rejectAll restores the document byte for byte', () => {
    const editor = headerEditor();
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [{ op: 'move_section', anchor: '0;6', targetAnchor: '0;0' }],
        'header-reject'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.rejectAll();
      expect(editor.serialize()).toBe(before);
    } finally {
      destroyEditor(editor);
    }
  });

  it('the rail card restores it byte for byte, and accepts as one unit', () => {
    const rejectEditor = headerEditor();
    try {
      const before = rejectEditor.serialize();
      apply(
        rejectEditor,
        [{ op: 'move_section', anchor: '0;6', targetAnchor: '0;0' }],
        'header-rail-reject'
      );
      const groups = listRevisionGroups(rejectEditor as unknown as LiveEditor);
      expect(groups).toHaveLength(1);
      resolveLiveRevisionGroupsAsOneUndo(
        rejectEditor as unknown as LiveEditor,
        groups,
        false
      );
      expect(rejectEditor.serialize()).toBe(before);
    } finally {
      destroyEditor(rejectEditor);
    }

    const acceptEditor = headerEditor();
    try {
      apply(
        acceptEditor,
        [{ op: 'move_section', anchor: '0;6', targetAnchor: '0;0' }],
        'header-rail-accept'
      );
      const groups = listRevisionGroups(acceptEditor as unknown as LiveEditor);
      expect(groups).toHaveLength(1);
      resolveLiveRevisionGroupsAsOneUndo(
        acceptEditor as unknown as LiveEditor,
        groups,
        true
      );
      expect(acceptEditor.revisions.length).toBe(0);
      expect(headings(acceptEditor).slice(0, 2)).toEqual(MOVED);
    } finally {
      destroyEditor(acceptEditor);
    }
  });
});

// The gap Anthony named: everything above proved that REJECTING restores the
// original, and `assertTrackedMutation` compares only the reject-side
// projection, so nothing proved that ACCEPTING produces the intended document.
// That is why several defects reported `ok: true` over a broken accept.
//
// Two properties, both about accept and neither derivable from a reject:
// the accepted document reads in the intended order, and the rail card's
// Accept - a different code path from `revisions.acceptAll()` - agrees with it.
describe('accepting a relocation is verified, not only rejecting it', () => {
  const NESTED = [
    'How We Support Clients',
    'Our service model has two halves.',
    'National Capabilities, Local Service',
    'National scale with a local team.',
    'Industry Experience',
    'Deep experience in your industry.',
    'Next Steps',
    'Confirm the coverage by Friday.'
  ];
  const at = (text: string) => NESTED.indexOf(text);
  const reorder = (order: string[]) =>
    order.flatMap((text) => [NESTED[at(text)], NESTED[at(text) + 1]]);

  const shapes: Array<[string, EditOp, string[]]> = [
    [
      'a move of a subsection above its parent',
      { op: 'move_section', anchor: '0;2', targetAnchor: '0;0' },
      reorder([
        'National Capabilities, Local Service',
        'How We Support Clients',
        'Industry Experience',
        'Next Steps'
      ])
    ],
    [
      'a move of a subsection below its sibling',
      { op: 'move_section', anchor: '0;4', targetAnchor: '0;2' },
      reorder([
        'How We Support Clients',
        'Industry Experience',
        'National Capabilities, Local Service',
        'Next Steps'
      ])
    ],
    [
      'a swap of two subsections',
      { op: 'swap_sections', anchor: '0;2', otherAnchor: '0;4' },
      reorder([
        'How We Support Clients',
        'Industry Experience',
        'National Capabilities, Local Service',
        'Next Steps'
      ])
    ],
    [
      'a copy of the last section to the front',
      { op: 'copy_section', anchor: '0;6', targetAnchor: '0;0' },
      [...reorder(['Next Steps']), ...NESTED]
    ]
  ];

  it.each(shapes)(
    'the accepted document reads in the intended order after %s',
    (_label, edit, expected) => {
      const editor = makeEditor(nestedFixture());
      try {
        expect(apply(editor, [edit], 'accept-order').results[0]).toMatchObject({
          ok: true
        });
        editor.revisions.acceptAll();
        expect(bodyTexts(editor)).toEqual(expected);
        expect(editor.revisions.length).toBe(0);
      } finally {
        destroyEditor(editor);
      }
    }
  );

  // One card, two buttons that reach it by different code: `acceptAll` walks
  // the revision collection, the rail card calls
  // `resolveLiveRevisionGroupsAsOneUndo` over the group. A user cannot tell
  // which they pressed, so the documents must not differ.
  it.each(shapes)('both accept routes agree byte for byte after %s', (
    _label,
    edit
  ) => {
    const viaAll = makeEditor(nestedFixture());
    const viaRail = makeEditor(nestedFixture());
    try {
      apply(viaAll, [edit], 'accept-all');
      apply(viaRail, [edit], 'accept-rail');
      viaAll.revisions.acceptAll();
      resolveLiveRevisionGroupsAsOneUndo(
        viaRail as unknown as LiveEditor,
        listRevisionGroups(viaRail as unknown as LiveEditor),
        true
      );
      expect(viaRail.serialize()).toBe(viaAll.serialize());
    } finally {
      destroyEditor(viaAll);
      destroyEditor(viaRail);
    }
  });

  // Moving the section that IS the document tail strands an empty paragraph on both
  // accept routes, the range carries its own paragraph mark. The stranded paragraph's
  // style is the field most sensitive to the order the rail resolves a group in
  it('the two accept routes agree on a tail-source move', () => {
    const edit: EditOp = {
      op: 'move_section',
      anchor: '0;6',
      targetAnchor: '0;0'
    };
    const viaAll = makeEditor(nestedFixture());
    const viaRail = makeEditor(nestedFixture());
    try {
      apply(viaAll, [edit], 'tail-source-all');
      apply(viaRail, [edit], 'tail-source-rail');
      viaAll.revisions.acceptAll();
      resolveLiveRevisionGroupsAsOneUndo(
        viaRail as unknown as LiveEditor,
        listRevisionGroups(viaRail as unknown as LiveEditor),
        true
      );
      // The content agrees. That is the half a user reads.
      expect(bodyTexts(viaRail)).toEqual(bodyTexts(viaAll));
      expect(bodyTexts(viaAll)).toEqual([
        ...reorder(['Next Steps', 'How We Support Clients']),
        ...NESTED.slice(at('National Capabilities, Local Service'), at('Next Steps')),
        ''
      ]);
      // The stranded paragraph is Normal on both routes, not the moved heading.
      expect(headings(viaAll)).not.toContain('');
      expect(headings(viaRail)).not.toContain('');
      expect(viaRail.serialize()).toBe(viaAll.serialize());
    } finally {
      destroyEditor(viaAll);
      destroyEditor(viaRail);
    }
  });
});

describe("scope 'section' reads the section the relocation would move", () => {
  it('a parent read no longer stops at its own first subsection', () => {
    const editor = makeEditor(nestedFixture());
    try {
      const parent = getDocumentInventory(editor as unknown as LiveEditor, {
        scope: 'section',
        sectionAnchor: '0;0'
      }) as any;
      expect(parent.inventory.map((entry: any) => entry.anchor)).toEqual([
        '0;0',
        '0;1',
        '0;2',
        '0;3',
        '0;4',
        '0;5'
      ]);

      // A subsection read still stops at its sibling: the rule is depth-aware,
      // not simply wider.
      const child = getDocumentInventory(editor as unknown as LiveEditor, {
        scope: 'section',
        sectionAnchor: '0;2'
      }) as any;
      expect(child.inventory.map((entry: any) => entry.anchor)).toEqual([
        '0;2',
        '0;3'
      ]);
    } finally {
      destroyEditor(editor);
    }
  });
});

describe('sentinel content is refused before any write', () => {
  it('refuses the placeholder shuffle the swap failure actually wrote', () => {
    const editor = makeEditor(nestedFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'replace_selection',
            anchor: '0;2',
            startOffset: '0;2;0',
            endOffset: '0;2;36',
            expect: 'National Capabilities, Local Service',
            replace: '__TMP_SWAP_HEADING_1__'
          },
          {
            op: 'replace_text',
            anchor: '0;3',
            find: 'National',
            replace: 'Industry'
          }
        ],
        'placeholder-shuffle'
      );
      expect(result.results[0]).toMatchObject({
        ok: false,
        error: 'sentinel_content_refused'
      });
      // The refusal is a correction, not a dead end.
      expect(result.results[0].message).toContain('swap_sections');
      // The whole change set is refused, so the sibling never ran either.
      expect(editor.serialize()).toBe(before);
      expect(editor.revisions.length).toBe(0);
    } finally {
      destroyEditor(editor);
    }
  });

  it('never refuses a read field: cleaning a placeholder up must work', () => {
    const editor = makeEditor({
      sections: [
        {
          blocks: [
            para('Alpha', 'Heading 1'),
            para('Premium: __TMP_PREMIUM__ per year')
          ]
        }
      ],
      styles: headingStyles()
    });
    try {
      const result = apply(
        editor,
        [
          {
            op: 'replace_text',
            anchor: '0;1',
            find: '__TMP_PREMIUM__',
            expect: 'Premium: __TMP_PREMIUM__ per year',
            replace: '$36,803.00'
          }
        ],
        'clean-up-placeholder'
      );
      expect(result.results[0]).toMatchObject({ ok: true });
      editor.revisions.acceptAll();
      expect(bodyTexts(editor)[1]).toBe('Premium: $36,803.00 per year');
    } finally {
      destroyEditor(editor);
    }
  });
});
