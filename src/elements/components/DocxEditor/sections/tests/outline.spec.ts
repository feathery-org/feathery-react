// Ported from the syncfusion-json POC (test/outline.test.js, Word-section
// cases). The behavioural contract of section reordering: read the sections,
// permute sections[] by object identity, share untouched subtrees, and refuse
// (returning the document unchanged) on any blocking condition.
import {
  hasBlockingErrors,
  moveWordSection,
  readSections,
  reorderSections
} from '../outline';
import { SfdtDocument } from '../../bindings/core/sfdtTypes';

/* ---------------- synthetic fixtures ---------------- */

const para = (text: string) => ({ inlines: [{ text }] });
const inlinesBlock = (...items: Record<string, unknown>[]) => ({ inlines: items });
const section = (
  blocks: Record<string, unknown>[],
  sectionFormat: Record<string, unknown> = { breakCode: 'Continuous' }
) => ({ sectionFormat, blocks, headersFooters: {} });

// A six-Word-section document, each section labelled by its first paragraph.
const sixSections = (): SfdtDocument =>
  ({
    sections: [
      section([para('Project summary'), para('body')]),
      section([para('Scope of work')]),
      section([para('Costs')]),
      section([para('Expenses')]),
      section([para('Terms & conditions')]),
      section([para('Signatures')])
    ],
    styles: [],
    lists: []
  } as unknown as SfdtDocument);

const labels = (sfdt: SfdtDocument) => readSections(sfdt).nodes.map((n) => n.label);
const codes = (diags: { code: string }[]) => diags.map((d) => d.code);

/* ---------------- reading ---------------- */

test('readSections lists each top-level Word section in order', () => {
  const { nodes, diagnostics } = readSections(sixSections());
  expect(diagnostics).toEqual([]);
  expect(nodes.length).toBe(6);
  expect(nodes.map((n) => n.label)).toEqual([
    'Project summary',
    'Scope of work',
    'Costs',
    'Expenses',
    'Terms & conditions',
    'Signatures'
  ]);
  expect(nodes.every((n) => n.breakCode === 'Continuous' && n.movable)).toBe(true);
  expect(nodes.map((n) => n.id)).toEqual([
    'ws-0',
    'ws-1',
    'ws-2',
    'ws-3',
    'ws-4',
    'ws-5'
  ]);
});

test('a single-section document exposes one non-movable row', () => {
  const one = { sections: [section([para('only')])] } as unknown as SfdtDocument;
  const { nodes } = readSections(one);
  expect(nodes.length).toBe(1);
  expect(nodes[0].movable).toBe(false);
});

test('label falls back to Section N when the section has no text', () => {
  const doc = {
    sections: [section([{ inlines: [] }]), section([para('Two')])]
  } as unknown as SfdtDocument;
  expect(labels(doc)).toEqual(['Section 1', 'Two']);
});

test('summary describes each section by its structure', () => {
  const table = (rows: number) => ({
    rows: Array.from({ length: rows }, () => ({ cells: [{ blocks: [] }] }))
  });
  const heading = (text: string) => ({
    paragraphFormat: { styleName: 'Heading 1' },
    inlines: [{ text }]
  });
  const doc = {
    sections: [
      section([para('Just one line')]),
      section([table(9)]),
      section([heading('Expenses'), table(4)])
    ]
  } as unknown as SfdtDocument;
  expect(readSections(doc).nodes.map((n) => n.summary)).toEqual([
    'Paragraph',
    'Table · 9 rows',
    'Heading + table'
  ]);
});

test('summary detects a table wrapped in a content control (bound table)', () => {
  const heading = (text: string) => ({
    paragraphFormat: { styleName: 'Heading 1' },
    inlines: [{ text }]
  });
  // A bound table is a table block nested inside a block-level content control.
  const wrappedTable = {
    contentControlProperties: { tag: '[[table=expenses]]' },
    blocks: [{ rows: [{ cells: [{ blocks: [] }] }, { cells: [{ blocks: [] }] }] }]
  };
  const doc = {
    sections: [section([heading('Expenses'), wrappedTable])]
  } as unknown as SfdtDocument;
  expect(readSections(doc).nodes[0].summary).toBe('Heading + table');
});

test('reorderSections applies an explicit permutation by identity', () => {
  const doc = sixSections();
  const before = doc.sections!;
  // Move index 2 to the front, keep the rest in order.
  const { sfdt: next, movedTo, diagnostics } = reorderSections(
    doc,
    [2, 0, 1, 3, 4, 5]
  );
  expect(diagnostics).toEqual([]);
  expect(movedTo).toBeNull();
  expect(labels(next)).toEqual([
    'Costs',
    'Project summary',
    'Scope of work',
    'Expenses',
    'Terms & conditions',
    'Signatures'
  ]);
  expect(next.sections![0]).toBe(before[2]); // same object, moved
});

test('reorderSections is a no-op for the identity order', () => {
  const doc = sixSections();
  const result = reorderSections(doc, [0, 1, 2, 3, 4, 5]);
  expect(result.sfdt).toBe(doc);
  expect(result.movedTo).toBeNull();
});

test('reorderSections rejects a non-permutation', () => {
  const doc = sixSections();
  const result = reorderSections(doc, [0, 1, 2, 3, 4]); // missing an index
  expect(result.sfdt).toBe(doc);
  expect(result.diagnostics.map((d) => d.code)).toEqual(['outline-move-mismatch']);
});

test('reorderSections proceeds when tracked changes are present', () => {
  const doc = { ...sixSections(), trackChanges: true } as unknown as SfdtDocument;
  const result = reorderSections(doc, [5, 0, 1, 2, 3, 4]);
  expect(result.sfdt).not.toBe(doc);
  expect(codes(result.diagnostics)).toEqual([]);
  expect(labels(result.sfdt)[0]).toBe('Signatures');
});

test('reorderSections refuses a permutation that splits a cross-section bookmark', () => {
  const doc = {
    sections: [
      // Bookmark spans the (adjacent) sections 0 and 1; section 2 is plain.
      section([inlinesBlock({ bookmarkType: 0, name: 'bm' }, { text: 'start' })]),
      section([inlinesBlock({ text: 'end' }, { bookmarkType: 1, name: 'bm' })]),
      section([inlinesBlock({ text: 'plain' })])
    ]
  } as unknown as SfdtDocument;
  // Insert the plain section between the bookmark's two ends → splits it.
  const result = reorderSections(doc, [0, 2, 1]);
  expect(result.sfdt).toBe(doc);
  expect(result.diagnostics.map((d) => d.code)).toEqual(['split-bookmark']);
});

test('minified SFDT is refused rather than read as empty', () => {
  const { nodes, diagnostics } = readSections({ sec: [{ b: [] }] } as unknown as SfdtDocument);
  expect(nodes).toEqual([]);
  expect(codes(diagnostics)).toEqual(['optimized-sfdt']);
});

test('a document with no sections array is malformed, not empty', () => {
  const { diagnostics } = readSections({} as SfdtDocument);
  expect(codes(diagnostics)).toEqual(['malformed-sfdt']);
});

/* ---------------- moving ---------------- */

test('moveWordSection permutes sections[] by object identity (delta)', () => {
  const doc = sixSections();
  const before = doc.sections!;
  const { sfdt: next, diagnostics, movedTo } = moveWordSection(doc, {
    index: 2,
    delta: -2
  });
  expect(diagnostics).toEqual([]);
  expect(movedTo).toBe(0);
  expect(labels(next)).toEqual([
    'Costs',
    'Project summary',
    'Scope of work',
    'Expenses',
    'Terms & conditions',
    'Signatures'
  ]);
  const after = next.sections!;
  expect(after.length).toBe(before.length);
  expect(new Set(after).size).toBe(after.length); // no duplicates
  expect(after[0]).toBe(before[2]); // same object, moved
  after.forEach((s) => expect(before).toContain(s)); // permutation
});

test('moveWordSection with targetIndex/position (drag)', () => {
  const doc = sixSections();
  expect(
    labels(moveWordSection(doc, { index: 0, targetIndex: 5, position: 'after' }).sfdt)
  ).toEqual([
    'Scope of work',
    'Costs',
    'Expenses',
    'Terms & conditions',
    'Signatures',
    'Project summary'
  ]);
  expect(
    labels(moveWordSection(doc, { index: 5, targetIndex: 0, position: 'before' }).sfdt)
  ).toEqual([
    'Signatures',
    'Project summary',
    'Scope of work',
    'Costs',
    'Expenses',
    'Terms & conditions'
  ]);
});

test('untouched sections keep identity (structural sharing)', () => {
  const doc = sixSections();
  const next = moveWordSection(doc, { index: 2, delta: 1 }).sfdt;
  expect(next).not.toBe(doc);
  expect(next.sections).not.toBe(doc.sections);
  expect((next as { styles?: unknown }).styles).toBe((doc as { styles?: unknown }).styles);
  expect(next.sections![0]).toBe(doc.sections![0]); // untouched section is the same object
});

test('down then up returns byte-identical JSON', () => {
  const doc = sixSections();
  const down = moveWordSection(doc, { index: 2, delta: 1 }).sfdt;
  const back = moveWordSection(down, { index: 3, delta: -1 }).sfdt;
  expect(JSON.stringify(back)).toBe(JSON.stringify(doc));
});

/* ---------------- refusals (document returned unchanged) ---------------- */

const refuse = (doc: SfdtDocument, opts: Parameters<typeof moveWordSection>[1]) => {
  const r = moveWordSection(doc, opts);
  expect(r.sfdt).toBe(doc); // identity-equal: never partially rewritten
  expect(r.movedTo).toBeNull();
  return codes(r.diagnostics);
};

test('refuses to move past either end, or an out-of-range index', () => {
  const doc = sixSections();
  expect(refuse(doc, { index: 0, delta: -1 })).toEqual(['section-at-edge']);
  expect(refuse(doc, { index: 5, delta: 1 })).toEqual(['section-at-edge']);
  expect(refuse(doc, { index: 9, delta: 1 })).toEqual(['section-not-found']);
});

test('refuses when there is only one section', () => {
  const one = { sections: [section([para('only')])] } as unknown as SfdtDocument;
  expect(refuse(one, { index: 0, delta: 1 })).toEqual(['section-not-movable']);
});

test('refuses a move that would split a bookmark across sections', () => {
  const doc = {
    sections: [
      section([inlinesBlock({ bookmarkType: 0, name: 'bm' }, { text: 'start' })]),
      section([inlinesBlock({ text: 'mid' })]),
      section([inlinesBlock({ text: 'end' }, { bookmarkType: 1, name: 'bm' })])
    ]
  } as unknown as SfdtDocument;
  // Moving the middle section separates nothing: bm spans sections 0 and 2.
  expect(moveWordSection(doc, { index: 1, delta: 1 }).diagnostics).toEqual([]);
  // Moving section 0 pulls the bookmark start away from its end in section 2.
  expect(refuse(doc, { index: 0, delta: 1 })).toEqual(['split-bookmark']);
});

test('a pair fully inside the moved section is fine', () => {
  const doc = {
    sections: [
      section([
        inlinesBlock(
          { bookmarkType: 0, name: 'bm' },
          { text: 'x' },
          { bookmarkType: 1, name: 'bm' }
        )
      ]),
      section([para('other')])
    ]
  } as unknown as SfdtDocument;
  const r = moveWordSection(doc, { index: 0, delta: 1 });
  expect(r.diagnostics).toEqual([]);
  expect(labels(r.sfdt)).toEqual(['other', 'x']);
});

test('refuses a move that would split an editable range across sections', () => {
  const doc = {
    sections: [
      section([inlinesBlock({ editRangeId: 'e1', user: 'someone' }, { text: 'x' })]),
      section([inlinesBlock({ text: 'y' }, { editableRangeStart: { editRangeId: 'e1' } })])
    ]
  } as unknown as SfdtDocument;
  expect(refuse(doc, { index: 0, delta: 1 })).toEqual(['split-edit-range']);
});

test('moves even when tracked changes are present (flag or revisions)', () => {
  const withFlag = { ...sixSections(), trackChanges: true } as unknown as SfdtDocument;
  const a = moveWordSection(withFlag, { index: 0, delta: 1 });
  expect(a.sfdt).not.toBe(withFlag);
  expect(codes(a.diagnostics)).toEqual([]);
  expect(labels(a.sfdt)[0]).toBe('Scope of work');

  const withRevisions = {
    ...sixSections(),
    revisions: [{ revisionId: 'r1', revisionType: 'Insertion' }]
  } as unknown as SfdtDocument;
  const b = moveWordSection(withRevisions, { index: 0, delta: 1 });
  expect(b.sfdt).not.toBe(withRevisions);
  expect(codes(b.diagnostics)).toEqual([]);
});

test('hasBlockingErrors reflects error-severity diagnostics', () => {
  expect(hasBlockingErrors([])).toBe(false);
  expect(hasBlockingErrors([{ severity: 'warning', code: 'x', message: '', path: [] }])).toBe(
    false
  );
  expect(hasBlockingErrors([{ severity: 'error', code: 'x', message: '', path: [] }])).toBe(
    true
  );
});
