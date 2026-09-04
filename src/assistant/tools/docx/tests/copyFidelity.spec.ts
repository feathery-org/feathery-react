// The fidelity contract of a COPY: every block of the source range arrives at
// the destination reading exactly what the source reads, as one rejectable
// group, without disturbing anything else in the document.
//
// The matrix is built by TRANSFORMING `buildCostsFixture` through the
// production tag DSL rather than hand-rolling SFDT, so every variant keeps the
// canonical shapes the binding engine actually sees. Identity semantics (what
// names a copy's bindings take) are asserted in their own describe blocks;
// the matrix here asserts CONTENT, so it holds across mechanism changes.
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
  EditOp,
  LiveEditor
} from '../syncfusionDocumentOps';
import { buildCostsFixture } from '../../../../elements/components/DocxEditor/bindings/core/tests/fixtures/costsFixture';
import {
  attachBindings,
  AttachedBindings
} from '../../../../elements/components/DocxEditor/bindings/attachBindings';
import { SyncfusionEditorLike } from '../../../../elements/components/DocxEditor/bindings/editorAdapter';
import {
  formatTag,
  parseTag
} from '../../../../elements/components/DocxEditor/bindings/core/tagDsl';
import { scanBindings } from '../../../../elements/components/DocxEditor/bindings/core/sfdtAdapter';
import { listRevisionGroups } from '../../../../utils/documentEditorPrimitives';

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

function makeEditor(sfdt: any): DocumentEditor {
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
    documentEditorSettings: { optimizeSfdt: false }
  });
  editor.appendTo(host);
  editor.open(JSON.stringify(sfdt));
  return editor;
}

function destroy(editor: DocumentEditor): void {
  const element = editor.element;
  editor.destroy();
  element?.remove();
}

const parsed = (editor: DocumentEditor) => JSON.parse(editor.serialize());

const apply = (editor: DocumentEditor, edits: EditOp[], changeSetId: string) =>
  applyDocumentEdits(editor as unknown as LiveEditor, { edits, changeSetId });

// ---------------------------------------------------------------------------
// Fixture transforms, all through the production tag DSL.
// ---------------------------------------------------------------------------

/** Rewrite every parseable binding Definition in place; `null` keeps it. */
function mapTags(node: any, edit: (def: any) => any | null): void {
  if (Array.isArray(node)) {
    node.forEach((entry) => mapTags(entry, edit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const props = node.contentControlProperties;
  if (typeof props?.tag === 'string') {
    let def: any = null;
    try {
      def = parseTag(props.tag);
    } catch {
      def = null;
    }
    const next = def && edit(def);
    if (next) node.contentControlProperties = { ...props, tag: formatTag(next) };
  }
  for (const value of Object.values(node)) mapTags(value, edit);
}

const withGlobal = (sfdt: any, name: string): any => {
  mapTags(sfdt, (def) => (def.name === name ? { ...def, isGlobal: true } : null));
  return sfdt;
};

const withDelKeep = (sfdt: any, name: string): any => {
  mapTags(sfdt, (def) =>
    def.name === name ? { ...def, isDeletable: false } : null
  );
  return sfdt;
};

/** Replace each block-level content control with the blocks it wraps. */
function unwrapTables(sfdt: any): any {
  for (const section of sfdt.sections)
    section.blocks = section.blocks.flatMap((block: any) =>
      block.contentControlProperties &&
      Array.isArray(block.blocks) &&
      !block.rows &&
      !block.inlines
        ? block.blocks
        : [block]
    );
  return sfdt;
}

/**
 * Remove every content control, leaving plain text and plain tables. Inline
 * controls are replaced by the runs they wrap - a bare nested run group is not
 * a shape SyncFusion keeps, so merely deleting the properties loses the text.
 */
function stripTags(node: any): any {
  if (Array.isArray(node)) {
    node.forEach(stripTags);
    return node;
  }
  if (node && typeof node === 'object') {
    delete node.contentControlProperties;
    if (Array.isArray(node.inlines))
      node.inlines = node.inlines.flatMap((inline: any) =>
        Array.isArray(inline?.inlines) ? inline.inlines : [inline]
      );
    for (const value of Object.values(node)) stripTags(value);
  }
  return node;
}

// ---------------------------------------------------------------------------
// Readbacks.
// ---------------------------------------------------------------------------

/** Every flattened text (body paragraphs and table cells) in document order. */
const flatTexts = (editor: DocumentEditor): string[] =>
  flattenSfdt(parsed(editor)).map((block) => block.text);

/** The flattened texts covered by the top-level blocks [from, from+count). */
const flatTextsOf = (
  editor: DocumentEditor,
  from: number,
  count: number
): string[] =>
  flattenSfdt(parsed(editor))
    .filter((block) => {
      const top = Number(block.anchor.split(';')[1]);
      return (
        block.anchor.split(';')[0] === '0' && top >= from && top < from + count
      );
    })
    .map((block) => block.text);

/** How often `window` appears as a contiguous slice of `texts`. */
const contiguousRuns = (texts: string[], window: string[]): number => {
  let runs = 0;
  for (let at = 0; at + window.length <= texts.length; at++)
    if (window.every((text, offset) => texts[at + offset] === text)) runs++;
  return runs;
};

const rejectAll = (editor: DocumentEditor): void => {
  const pending = Array.from({ length: editor.revisions.length }, (_, index) =>
    editor.revisions.get(index)
  );
  for (const revision of pending.reverse()) revision.reject();
};

/** Raw top-level table-ness pattern, e.g. 'PTPTP' for para/table alternation. */
const blockPattern = (editor: DocumentEditor, from: number, count: number) =>
  parsed(editor)
    .sections[0].blocks.slice(from, from + count)
    .map((block: any) => {
      if (block.rows) return 'T';
      if (block.contentControlProperties && Array.isArray(block.blocks))
        return 'W';
      return 'P';
    })
    .join('');

// ---------------------------------------------------------------------------
// The copy_section matrix over wrapper-free content.
// ---------------------------------------------------------------------------

describe('copy_section carries every block of a wrapper-free range', () => {
  // Source unit `0;0` covers blocks 0..4 (heading through "Amount due...");
  // source unit `0;4` is the single "Amount due..." paragraph. The tail target
  // (`0;8` after) exercises the created-landing-paragraph path; `0;5` before is
  // an ordinary mid-document caret.
  const tail = { targetAnchor: '0;8', position: 'after' };
  const cases: Array<
    [string, () => any, { anchor: string; from: number; count: number }, any]
  > = [
    [
      'plain paragraphs',
      () => stripTags(unwrapTables(buildCostsFixture())),
      { anchor: '0;4', from: 4, count: 1 },
      tail
    ],
    [
      'a bare table between plain paragraphs',
      () => stripTags(unwrapTables(buildCostsFixture())),
      { anchor: '0;0', from: 0, count: 5 },
      tail
    ],
    [
      'inline non-global controls',
      () => unwrapTables(buildCostsFixture()),
      { anchor: '0;4', from: 4, count: 1 },
      tail
    ],
    [
      'inline global controls',
      () => withGlobal(unwrapTables(buildCostsFixture()), 'project.name'),
      { anchor: '0;4', from: 4, count: 1 },
      tail
    ],
    [
      'mixed controls and a bare table',
      () => unwrapTables(buildCostsFixture()),
      { anchor: '0;0', from: 0, count: 5 },
      tail
    ],
    [
      'a mid-document target',
      () => unwrapTables(buildCostsFixture()),
      { anchor: '0;0', from: 0, count: 5 },
      { targetAnchor: '0;5', position: 'before' }
    ]
  ];

  it.each(cases)('copies %s completely', (_name, doc, source, target) => {
    const editor = makeEditor(doc());
    const attached: AttachedBindings = attachBindings(
      editor as unknown as SyncfusionEditorLike,
      { convertTokensOnOpen: false }
    );
    try {
      const before = editor.serialize();
      const window = flatTextsOf(editor, source.from, source.count);
      expect(window.length).toBeGreaterThan(0);
      expect(contiguousRuns(flatTexts(editor), window)).toBe(1);

      const result = apply(
        editor,
        [{ op: 'copy_section', anchor: source.anchor, ...target }],
        `copy-fidelity-${source.anchor}-${target.targetAnchor}`
      );

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'copy_section',
        route: 'editor'
      });
      // One group: one rail card resolves the whole copy.
      expect(result.changeSet?.groups).toHaveLength(1);
      // The source run now reads twice, contiguously - nothing lost, nothing
      // truncated, nothing else duplicated.
      expect(contiguousRuns(flatTexts(editor), window)).toBe(2);

      const revisions = Array.from(
        { length: editor.revisions.length },
        (_, index) => editor.revisions.get(index)
      );
      expect(revisions.length).toBeGreaterThan(0);
      expect(
        revisions.every(
          (revision) =>
            revision.author === 'Robin' && revision.revisionType === 'Insertion'
        )
      ).toBe(true);

      rejectAll(editor);
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      attached.dispose();
      destroy(editor);
    }
  });
});

// ---------------------------------------------------------------------------
// duplicate_table on the plain (unbound) route: separators and neighbours.
// ---------------------------------------------------------------------------

describe('duplicate_table keeps the copy separate from adjacent tables', () => {
  it('separates the copy from its source and leaves the other table alone', () => {
    const editor = makeEditor(stripTags(unwrapTables(buildCostsFixture())));
    try {
      const before = editor.serialize();
      const sourceCells = flatTextsOf(editor, 2, 1);

      const result = apply(
        editor,
        [{ op: 'duplicate_table', anchor: '0;2;0;0;0', rows: 'copy' }],
        'duplicate-plain'
      );

      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'duplicate_table',
        route: 'editor'
      });
      // Word renders adjacent tables as one, so an empty paragraph lands
      // between the source and the copy - and none after, because the next
      // block is already a paragraph.
      expect(blockPattern(editor, 2, 4)).toBe('TPTP');
      expect(flatTextsOf(editor, 4, 1)).toEqual(sourceCells);
      // The document's other table is untouched.
      expect(
        flatTexts(editor).filter((text) => text === 'Travel')
      ).toHaveLength(1);

      rejectAll(editor);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroy(editor);
    }
  });

});

// ---------------------------------------------------------------------------
// What a copy preserves beyond text: list numbering and page geometry.
// ---------------------------------------------------------------------------

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
  }
];

const para = (text: string, styleName?: string) => ({
  inlines: text ? [{ text }] : [],
  ...(styleName ? { paragraphFormat: { styleName } } : {})
});

describe('a copied numbered run stays on its list', () => {
  const numberedFixture = () => ({
    sections: [
      {
        blocks: [
          para('Steps', 'Heading 1'), // 0;0
          {
            paragraphFormat: { listFormat: { listId: 0, listLevelNumber: 0 } },
            inlines: [{ text: 'First step' }]
          },
          {
            paragraphFormat: { listFormat: { listId: 0, listLevelNumber: 0 } },
            inlines: [{ text: 'Second step' }]
          },
          para('Coda', 'Heading 1'), // 0;3
          para('Done.') // 0;4
        ]
      }
    ],
    styles: headingStyles(),
    lists: [{ abstractListId: 0, listId: 0 }],
    abstractLists: [
      {
        abstractListId: 0,
        levels: [
          {
            characterFormat: {},
            paragraphFormat: { leftIndent: 36, firstLineIndent: -18 },
            followCharacter: 'Tab',
            listLevelPattern: 'Arabic',
            numberFormat: '%1.',
            restartLevel: 0,
            startAt: 1
          }
        ]
      }
    ]
  });

  it('every copied paragraph still resolves to the same numbering pattern', () => {
    const editor = makeEditor(numberedFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'copy_section',
            anchor: '0;0',
            targetAnchor: '0;3',
            position: 'after'
          }
        ],
        'copy-numbered-run'
      );
      expect(result.results[0]).toMatchObject({ ok: true });

      const sfdt = parsed(editor);
      const numbered = sfdt.sections
        .flatMap((section: any) => section.blocks)
        .filter((block: any) =>
          (block.inlines ?? []).some((inline: any) =>
            String(inline.text ?? '').endsWith('step')
          )
        );
      expect(numbered).toHaveLength(4);
      // Every copied paragraph is still NUMBERED, resolving through the
      // document's list tables to the same Arabic "%1." pattern the source
      // uses. Which list instance the copy joins is the mechanism's business;
      // that it renders as the same kind of numbered list is not.
      for (const block of numbered) {
        const listId = block.paragraphFormat?.listFormat?.listId;
        const list = sfdt.lists.find((entry: any) => entry.listId === listId);
        const abstract = sfdt.abstractLists.find(
          (entry: any) => entry.abstractListId === list?.abstractListId
        );
        expect(abstract?.levels?.[0]).toMatchObject({
          listLevelPattern: 'Arabic',
          numberFormat: '%1.'
        });
      }

      rejectAll(editor);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroy(editor);
    }
  });
});

describe('a copy landing in another Word section adopts its geometry', () => {
  const PORTRAIT = { pageWidth: 612, pageHeight: 792, leftMargin: 72 };
  const LANDSCAPE = { pageWidth: 792, pageHeight: 612, leftMargin: 36 };
  const twoSectionFixture = () => ({
    sections: [
      {
        sectionFormat: { ...PORTRAIT },
        blocks: [
          para('Overview', 'Heading 1'), // 0;0
          para('Intro body.'), // 0;1
          para('Approach', 'Heading 1'), // 0;2
          para('Approach body.') // 0;3
        ]
      },
      {
        sectionFormat: { ...LANDSCAPE },
        blocks: [
          para('Schedule', 'Heading 1'), // 1;0
          para('Schedule body.') // 1;1
        ]
      }
    ],
    styles: headingStyles()
  });

  it('copies across the section break without disturbing either geometry', () => {
    const editor = makeEditor(twoSectionFixture());
    try {
      const before = editor.serialize();
      const result = apply(
        editor,
        [
          {
            op: 'copy_section',
            anchor: '0;0',
            expect: 'Overview',
            targetAnchor: '1;0',
            position: 'before'
          }
        ],
        'copy-across-sections'
      );
      expect(result.results[0]).toMatchObject({ ok: true });

      const sfdt = parsed(editor);
      // The paste carries content, never section structure: still two Word
      // sections, each keeping its own page geometry.
      expect(
        sfdt.sections.map((section: any) => section.sectionFormat.pageWidth)
      ).toEqual([612, 792]);
      // The copy lives in the landscape section, governed by its geometry;
      // the original still opens the portrait one.
      const texts = (section: any) =>
        section.blocks.flatMap((block: any) =>
          (block.inlines ?? []).map((inline: any) => inline.text ?? '')
        );
      expect(texts(sfdt.sections[1])).toContain('Intro body.');
      expect(texts(sfdt.sections[0])).toContain('Intro body.');

      rejectAll(editor);
      expect(editor.serialize()).toBe(before);
    } finally {
      destroy(editor);
    }
  });
});

// ---------------------------------------------------------------------------
// Binding identity: a copy is not a move, so it gets identities of its own.
// ---------------------------------------------------------------------------

/** Multiset of every binding tag in the document, tag -> occurrence count. */
function tagCounts(node: any, out: Map<string, number> = new Map()): Map<string, number> {
  if (Array.isArray(node)) {
    node.forEach((entry) => tagCounts(entry, out));
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const tag = node.contentControlProperties?.tag;
  if (typeof tag === 'string' && tag.startsWith('[['))
    out.set(tag, (out.get(tag) ?? 0) + 1);
  for (const value of Object.values(node)) tagCounts(value, out);
  return out;
}

describe('a copied section gets its own binding identities', () => {
  // The costs fixture without its tables: a heading, "Project: <project.name>
  // ... " and "Amount due for <project.name>: <grand_total>." - so the copied
  // unit `0;0` (blocks 0..2) holds a repeated non-global field and a formula,
  // and the out-of-range `combined_total` formula references the original.
  const proseFixture = () => {
    const sfdt = buildCostsFixture();
    const blocks = sfdt.sections[0].blocks as any[];
    sfdt.sections[0].blocks = [
      blocks[0],
      blocks[1],
      blocks[4],
      blocks[5],
      blocks[8],
      blocks[9]
    ];
    return sfdt;
  };
  const copyToTail: EditOp[] = [
    { op: 'copy_section', anchor: '0;0', targetAnchor: '0;3', position: 'after' }
  ];

  const run = (doc: any, assert: (editor: DocumentEditor, before: Map<string, number>) => void) => {
    const editor = makeEditor(doc);
    const attached: AttachedBindings = attachBindings(
      editor as unknown as SyncfusionEditorLike,
      { convertTokensOnOpen: false }
    );
    try {
      const serialized = editor.serialize();
      const before = tagCounts(JSON.parse(serialized));
      const result = apply(editor, copyToTail, 'copy-identity');
      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'copy_section',
        route: 'editor'
      });
      assert(editor, before);
      rejectAll(editor);
      expect(editor.serialize()).toBe(serialized);
    } finally {
      attached.dispose();
      destroy(editor);
    }
  };

  it('renames a non-global field once, carrying its current value', () => {
    run(proseFixture(), (editor, before) => {
      const index = scanBindings(parsed(editor));
      // The original identity is untouched; the copy is ONE fresh identity
      // covering both copied occurrences, showing the value the user saw.
      expect(index.fields.get('project.name')).toHaveLength(2);
      expect(
        index.fields.get('project.name_2')?.map((entry) => entry.text)
      ).toEqual(['Website relaunch', 'Website relaunch']);
      // The copied formula follows the same rule and keeps its expression:
      // its references were not part of the copy, so they are preserved.
      expect(index.formulas.get('grand_total')).toHaveLength(1);
      expect(index.formulas.get('grand_total_2')?.[0].def).toMatchObject({
        kind: 'formula',
        expression: 'sum(costs_subtotal,costs_tax)'
      });
      // The document's other formula still references the ORIGINAL - a copy
      // must never steal references that pointed at its source.
      expect(index.formulas.get('combined_total')?.[0].def).toMatchObject({
        expression: 'sum(grand_total,expenses_total)'
      });
      // Tag multiset: nothing the source had was lost or mutated; the copy
      // only ADDED tags, every one wearing a fresh name.
      const after = tagCounts(parsed(editor));
      for (const [tag, count] of before) expect(after.get(tag)).toBe(count);
      const added = [...after].filter(([tag]) => !before.has(tag));
      expect(added.map(([tag]) => tag).sort()).toEqual([
        expect.stringContaining('name=grand_total_2'),
        expect.stringContaining('name=project.name_2')
      ]);
    });
  });

  it('keeps a global field on its shared name, occurrences rising', () => {
    run(withGlobal(proseFixture(), 'project.name'), (editor, before) => {
      const index = scanBindings(parsed(editor));
      const occurrences = index.fields.get('project.name');
      expect(occurrences).toHaveLength(4);
      expect(occurrences?.every((entry) => entry.def.isGlobal)).toBe(true);
      expect(index.fields.has('project.name_2')).toBe(false);
      // Multiset, not membership: the global tag's COUNT is what rises.
      const globalTag = [...before.keys()].find((tag) =>
        tag.includes('name=project.name')
      )!;
      expect(tagCounts(parsed(editor)).get(globalTag)).toBe(
        before.get(globalTag)! + 2
      );
    });
  });

  it('transfers del=keep onto the fresh identity', () => {
    run(withDelKeep(proseFixture(), 'project.name'), (editor) => {
      const index = scanBindings(parsed(editor));
      const copied = index.fields.get('project.name_2');
      expect(copied).toHaveLength(2);
      expect(
        copied?.every((entry) => entry.def.isDeletable === false)
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Block-wrapped tables: the shape a multi-block paste used to silently lose.
// ---------------------------------------------------------------------------

describe('copy_section over a block-wrapped table', () => {
  const runWrapped = (
    doc: any,
    edit: EditOp,
    assert: (editor: DocumentEditor) => void
  ) => {
    const editor = makeEditor(doc);
    const attached: AttachedBindings = attachBindings(
      editor as unknown as SyncfusionEditorLike,
      { convertTokensOnOpen: false }
    );
    try {
      const before = editor.serialize();
      const result = apply(editor, [edit], 'copy-wrapped');
      expect(result.results[0]).toMatchObject({
        ok: true,
        op: 'copy_section',
        route: 'editor'
      });
      expect(result.changeSet?.groups).toHaveLength(1);
      assert(editor);
      // One rail card covers the whole copy, and rejecting the pending
      // revisions restores the document byte for byte.
      expect(listRevisionGroups(editor as unknown as LiveEditor)).toHaveLength(
        1
      );
      rejectAll(editor);
      expect(editor.revisions.length).toBe(0);
      expect(editor.serialize()).toBe(before);
    } finally {
      attached.dispose();
      destroy(editor);
    }
  };

  it.each([
    ['to the document tail', { targetAnchor: '0;8', position: 'after' }, 10],
    ['to a mid-document target', { targetAnchor: '0;5', position: 'before' }, 5]
  ] as Array<[string, any, number]>)(
    'copies the whole section %s, renaming what it carries',
    (_name, target, copyAt) => {
      runWrapped(
        buildCostsFixture(),
        { op: 'copy_section', anchor: '0;0', ...target },
        (editor) => {
          // Block for block, wrapped table included: the copy reads exactly
          // what the source section reads.
          expect(flatTextsOf(editor, copyAt, 5)).toEqual(
            flatTextsOf(editor, 0, 5)
          );
          const index = scanBindings(parsed(editor));
          // The copied table is a table of its own: fresh id, fresh row ids.
          expect(index.tables.get('costs')).toBeDefined();
          expect(
            index.tables.get('costs_copy')?.rows.map((row) => row.rowId)
          ).toEqual(['costs_copy_r1', 'costs_copy_r2']);
          // The copied non-global field is ONE fresh identity covering both
          // copied occurrences; formulas follow the renames.
          expect(index.fields.get('project.name_2')).toHaveLength(2);
          expect(index.formulas.get('costs_tax_2')?.[0].def).toMatchObject({
            expression: 'mul(costs_subtotal_2,tax_rate_2)'
          });
        }
      );
    }
  );

  it('keeps a global field shared across the copy', () => {
    runWrapped(
      buildCostsFixture({ globalTaxRate: true }),
      { op: 'copy_section', anchor: '0;0', targetAnchor: '0;8', position: 'after' },
      (editor) => {
        const index = scanBindings(parsed(editor));
        const occurrences = index.fields.get('tax_rate');
        expect(occurrences).toHaveLength(3);
        expect(occurrences?.every((entry) => entry.def.isGlobal)).toBe(true);
        // The copied formula still references the one shared identity.
        expect(index.formulas.get('costs_tax_2')?.[0].def).toMatchObject({
          expression: 'mul(costs_subtotal_2,tax_rate)'
        });
      }
    );
  });

  it('separates two adjacent wrapped tables copied in one range', () => {
    // Both wrapped tables in one section unit, directly adjacent - the copy
    // must arrive with a separator paragraph between them, or Word renders
    // them as one table.
    const doc = buildCostsFixture();
    const blocks = doc.sections[0].blocks as any[];
    doc.sections[0].blocks = [
      blocks[0], // heading
      blocks[1], // "Project: ..."
      blocks[2], // wrapped costs table
      blocks[6], // wrapped expenses table, flush against it
      blocks[8], // "Combined total ..."
      blocks[5], // "Expenses" heading, now bounding the unit from below
      blocks[9]
    ];
    runWrapped(
      doc,
      { op: 'copy_section', anchor: '0;0', targetAnchor: '0;5', position: 'after' },
      (editor) => {
        expect(blockPattern(editor, 7, 6)).toBe('PPWPWP');
        const index = scanBindings(parsed(editor));
        expect(index.tables.has('costs_copy')).toBe(true);
        expect(index.tables.has('expenses_copy')).toBe(true);
      }
    );
  });

  it('copies a range that ENDS in a wrapped table', () => {
    const doc = buildCostsFixture();
    (doc.sections[0].blocks as any[]).splice(3, 2);
    runWrapped(
      doc,
      { op: 'copy_section', anchor: '0;0', targetAnchor: '0;6', position: 'after' },
      (editor) => {
        expect(blockPattern(editor, 8, 3)).toBe('PPW');
        expect(scanBindings(parsed(editor)).tables.has('costs_copy')).toBe(
          true
        );
      }
    );
  });
});
