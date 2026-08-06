# Dynamic Document Blocks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A data-defined document — sections of h1/h2/h3/paragraph/table blocks with inline tokens — rendered into the Syncfusion editor via SFDT JSON, with two-way sync, a block side panel, an in-document Components/theming tab, and a debug panel.

**Architecture:** `DocumentData` is the single source of truth. All document I/O is SFDT JSON: data changes regenerate SFDT and `open()` it; document edits `serialize()` and are parsed/diffed back into data (no reopen while typing). Formula evaluation reuses the existing `documentTokens` pure modules (`grammar`, `plan`, `format`). Undo/redo is data-level history.

**Tech Stack:** TypeScript, React, jest, `@syncfusion/ej2-documenteditor` 34.1.31 (runtime loaded from CDN; local package is the SFDT schema reference). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-05-docx-dynamic-blocks-design.md`

## Global Constraints

- Repo: `~/feathery/feathery-react/.worktrees/docx-dynamic-blocks`, branch `feat/docx-dynamic-blocks`.
- Package manager: **yarn** (`yarn jest <path>`, `yarn typecheck`, `yarn lint`).
- Target is ES5 (no `BigInt`, no `??=`); repo prettier config applies.
- Immutability: never mutate `DocumentData` — every operation returns a new object.
- No new npm dependencies. Files stay under 800 lines.
- All new pure modules live in `src/documentBlocks/`; tests in `src/documentBlocks/tests/`.
- Existing suites must keep passing: `yarn jest src/documentTokens --silent` (247 tests).
- Commit after every task (conventional commits, no attribution footer).
- The existing token contract is unchanged: `TokenSpec`, `valueKey`, `buildPlan`, `recalc`, `renderValue`, `parseValue` are imported from `src/documentTokens/`, never copied.
- Anchors: block identity = SFDT bookmark pair named `fblk_<blockId>`; token instance = bookmark pair named `ftk_<valueKey(spec)>` (same name scheme the shipped token contract already uses). Bookmarks are the proven round-trip survivor; block-level content controls are a possible later upgrade, isolated behind `anchors.ts`.

## File Structure

```
src/documentBlocks/
├── types.ts            DocumentData/Section/Block/Cell/Inline/Theme
├── sampleDocument.ts   seed data used by dev flag and tests
├── anchors.ts          bookmark naming + SFDT bookmark inline shapes
├── sfdt/
│   ├── generate.ts     DocumentData → SFDT JSON string
│   └── parse.ts        SFDT JSON → ParsedDoc (blocks, text, token texts)
├── diff.ts             ParsedDoc + previous DocumentData → ops + events
├── theme.ts            components-doc SFDT → Theme; Theme+samples → SFDT
├── store.ts            immutable ops, undo/redo history, subscribe
├── tokens.ts           collect specs from data, recalc, render value map
├── blockSync.ts        editor wiring: open/serialize loop, debounce
├── BlockPanel.tsx      block cards side panel
├── ComponentsTab.tsx   second editor instance for theming
├── DebugPanel.tsx      live data JSON + SFDT pull/apply + event log
└── tests/              *.spec.ts per module
```

Modified files:
- `src/elements/components/DocxEditor/useDocxEditor.tsx` — `optimizeSfdt: false` + optional built-in toolbar
- `src/elements/components/DocxEditor/DocumentEditorContainer.tsx` — flag-gated tabs, panels, block sync wiring

---

### Task 1: Types and sample document

**Files:**
- Create: `src/documentBlocks/types.ts`
- Create: `src/documentBlocks/sampleDocument.ts`
- Test: `src/documentBlocks/tests/sampleDocument.spec.ts`

**Interfaces:**
- Consumes: `TokenSpec` from `../documentTokens/plan`.
- Produces: `BlockType`, `Inline`, `Cell`, `Block`, `Section`, `Theme`, `BlockFormats`, `DocumentData`, `EMPTY_THEME`, `blockIds(data)`, `allInlines(block)`, `SAMPLE_DOCUMENT`. Every later task imports these exact names.

- [ ] **Step 1: Write the failing test**

```ts
// src/documentBlocks/tests/sampleDocument.spec.ts
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { blockIds, allInlines } from '../types';

describe('sample document', () => {
  it('has unique block ids across all sections', () => {
    const ids = blockIds(SAMPLE_DOCUMENT);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('contains every block type at least once', () => {
    const types = SAMPLE_DOCUMENT.sections.flatMap((s) =>
      s.blocks.map((b) => b.type)
    );
    for (const t of ['h1', 'h2', 'h3', 'paragraph', 'table']) {
      expect(types).toContain(t);
    }
  });

  it('contains at least one field-backed and one computed token', () => {
    const inlines = SAMPLE_DOCUMENT.sections
      .flatMap((s) => s.blocks)
      .flatMap((b) => allInlines(b));
    const tokens = inlines.filter((i) => i.kind === 'token');
    expect(tokens.some((t: any) => t.spec.source)).toBe(true);
    expect(tokens.some((t: any) => t.spec.formula)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/documentBlocks/tests/sampleDocument.spec.ts`
Expected: FAIL — cannot find module '../sampleDocument'

- [ ] **Step 3: Write the implementation**

```ts
// src/documentBlocks/types.ts
/**
 * The data that defines a document. The document in the editor is a rendering
 * of this; every edit on either side converges back into one of these.
 */
import { TokenSpec } from '../documentTokens/plan';

export type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'table';

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'token'; spec: TokenSpec };

export type Cell = { content: Inline[] };

export type Block = {
  /** Anchor identity: the document carries a bookmark named fblk_<id>. */
  id: string;
  type: BlockType;
  /** h1/h2/h3/paragraph content. Absent for tables. */
  content?: Inline[];
  /** Table rows. Row 0 is the header row. Absent for non-tables. */
  rows?: Cell[][];
};

export type Section = { id: string; blocks: Block[] };

/**
 * SFDT format fragments captured from the Components document and re-applied
 * on every generate. Pass-through objects: whatever Syncfusion serializes for
 * the sample is what every instance gets.
 */
export type BlockFormats = {
  characterFormat?: Record<string, any>;
  paragraphFormat?: Record<string, any>;
};

export type Theme = {
  h1: BlockFormats;
  h2: BlockFormats;
  h3: BlockFormats;
  paragraph: BlockFormats;
  table: {
    tableFormat?: Record<string, any>;
    headerRow: BlockFormats & { cellFormat?: Record<string, any> };
    body: BlockFormats & { cellFormat?: Record<string, any> };
  };
};

export type DocumentData = {
  sections: Section[];
  theme: Theme;
};

export const EMPTY_THEME: Theme = {
  h1: {},
  h2: {},
  h3: {},
  paragraph: {},
  table: { headerRow: {}, body: {} }
};

export const blockIds = (data: DocumentData): string[] =>
  data.sections.flatMap((s) => s.blocks.map((b) => b.id));

/** Every inline in a block, regardless of shape — cells included. */
export const allInlines = (block: Block): Inline[] =>
  block.rows
    ? block.rows.flatMap((row) => row.flatMap((cell) => cell.content))
    : block.content ?? [];
```

```ts
// src/documentBlocks/sampleDocument.ts
/**
 * Seed document for development and tests: every block type, a field-backed
 * token, and a computed token, across two sections (= two pages).
 */
import { DocumentData, EMPTY_THEME } from './types';

export const SAMPLE_DOCUMENT: DocumentData = {
  theme: EMPTY_THEME,
  sections: [
    {
      id: 'sec_intro',
      blocks: [
        { id: 'blk_title', type: 'h1', content: [{ kind: 'text', text: 'Service Agreement' }] },
        {
          id: 'blk_intro',
          type: 'paragraph',
          content: [
            { kind: 'text', text: 'Prepared for ' },
            {
              kind: 'token',
              spec: {
                id: 'customer_name',
                source: 'customer_name',
                format: { kind: 'text' }
              }
            },
            { kind: 'text', text: '. All totals recalculate automatically.' }
          ]
        },
        { id: 'blk_scope_h', type: 'h2', content: [{ kind: 'text', text: 'Scope of Work' }] },
        { id: 'blk_scope_p', type: 'paragraph', content: [{ kind: 'text', text: 'The parties agree to the services below.' }] }
      ]
    },
    {
      id: 'sec_pricing',
      blocks: [
        { id: 'blk_pricing_h', type: 'h3', content: [{ kind: 'text', text: 'Pricing' }] },
        {
          id: 'blk_pricing_tbl',
          type: 'table',
          rows: [
            [
              { content: [{ kind: 'text', text: 'Item' }] },
              { content: [{ kind: 'text', text: 'Amount' }] }
            ],
            [
              { content: [{ kind: 'text', text: 'Design retainer' }] },
              {
                content: [
                  {
                    kind: 'token',
                    spec: {
                      id: 'retainer',
                      source: 'retainer',
                      format: { kind: 'currency', decimals: 2 }
                    }
                  }
                ]
              }
            ],
            [
              { content: [{ kind: 'text', text: 'Total (incl. 8% tax)' }] },
              {
                content: [
                  {
                    kind: 'token',
                    spec: {
                      id: 'total',
                      formula: 'ROUND(retainer * 1.08, 2)',
                      reads: ['retainer'],
                      format: { kind: 'currency', decimals: 2 }
                    }
                  }
                ]
              }
            ]
          ]
        }
      ]
    }
  ]
};
```

Note: check `src/documentTokens/grammar.ts` `FUNCTIONS` for the exact `ROUND` spelling before committing; if the grammar uses a different name, use that one in the sample formula.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/documentBlocks/tests/sampleDocument.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Typecheck and commit**

```bash
yarn typecheck
git add src/documentBlocks
git commit -m "feat: document blocks data model and sample document"
```

---

### Task 2: Anchors — bookmark naming and SFDT bookmark shapes

**Files:**
- Create: `src/documentBlocks/anchors.ts`
- Test: `src/documentBlocks/tests/anchors.spec.ts`

**Interfaces:**
- Consumes: `TokenSpec`, `valueKey` from `../documentTokens/plan`.
- Produces: `BLOCK_ANCHOR_PREFIX`, `blockBookmark(blockId)`, `tokenBookmark(spec)`, `bookmarkStart(name)`, `bookmarkEnd(name)`, `isBookmarkStart(inline)`, `isBookmarkEnd(inline)`, `bookmarkName(inline)`, `blockIdFromBookmark(name)`, `tokenKeyFromBookmark(name)`.

**Schema grounding (do this before writing code):** SFDT with `optimizeSfdt: false` writes a bookmark as an inline object `{ "characterFormat": {}, "bookmarkType": 0, "name": "x" }` (0 = start, 1 = end). Verify the key names against the local package source:

```bash
grep -rn "bookmarkType" node_modules/@syncfusion/ej2-documenteditor/src/document-editor/implementation/writer/sfdt-export.js | head -5
```

If the writer uses different key names in v34.1.31, use the writer's names — the writer is the contract, not this plan.

- [ ] **Step 1: Write the failing test**

```ts
// src/documentBlocks/tests/anchors.spec.ts
import {
  blockBookmark,
  tokenBookmark,
  bookmarkStart,
  bookmarkEnd,
  isBookmarkStart,
  bookmarkName,
  blockIdFromBookmark,
  tokenKeyFromBookmark
} from '../anchors';

describe('anchors', () => {
  it('round-trips a block id through its bookmark name', () => {
    expect(blockIdFromBookmark(blockBookmark('blk_title'))).toBe('blk_title');
    expect(blockIdFromBookmark('ftk_total')).toBeNull();
    expect(blockIdFromBookmark('unrelated')).toBeNull();
  });

  it('names a token bookmark by value key, matching the shipped contract', () => {
    expect(tokenBookmark({ id: 'total', format: { kind: 'text' } })).toBe('ftk_total');
    expect(tokenBookmark({ id: 'qty', index: 2, format: { kind: 'number' } })).toBe('ftk_qty__2');
    expect(tokenKeyFromBookmark('ftk_qty__2')).toBe('qty__2');
    expect(tokenKeyFromBookmark('fblk_x')).toBeNull();
  });

  it('emits SFDT bookmark inlines the parser can recognize', () => {
    const start = bookmarkStart('fblk_a');
    const end = bookmarkEnd('fblk_a');
    expect(isBookmarkStart(start)).toBe(true);
    expect(isBookmarkStart(end)).toBe(false);
    expect(bookmarkName(start)).toBe('fblk_a');
    expect(bookmarkName({ text: 'plain run' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/documentBlocks/tests/anchors.spec.ts`
Expected: FAIL — cannot find module '../anchors'

- [ ] **Step 3: Write the implementation**

```ts
// src/documentBlocks/anchors.ts
/**
 * How data identity survives inside the document: bookmark pairs.
 *
 * A bookmark is a pair of named zero-width markers that Word, Syncfusion, and
 * SFDT all round-trip losslessly — the same anchor the shipped token contract
 * uses (`ftk_<valueKey>`). Blocks get `fblk_<blockId>`. Everything the rest of
 * the system knows about anchors goes through this module, so switching to
 * block-level content controls later is a one-file change.
 */
import { TokenSpec, valueKey } from '../documentTokens/plan';

export const BLOCK_ANCHOR_PREFIX = 'fblk_';
const TOKEN_ANCHOR_PREFIX = 'ftk_';

export const blockBookmark = (blockId: string): string =>
  `${BLOCK_ANCHOR_PREFIX}${blockId}`;

export const tokenBookmark = (spec: TokenSpec): string =>
  `${TOKEN_ANCHOR_PREFIX}${valueKey(spec)}`;

export const blockIdFromBookmark = (name: string): string | null =>
  name.startsWith(BLOCK_ANCHOR_PREFIX)
    ? name.slice(BLOCK_ANCHOR_PREFIX.length)
    : null;

export const tokenKeyFromBookmark = (name: string): string | null =>
  name.startsWith(TOKEN_ANCHOR_PREFIX)
    ? name.slice(TOKEN_ANCHOR_PREFIX.length)
    : null;

/** SFDT inline for a bookmark start marker. */
export const bookmarkStart = (name: string): Record<string, any> => ({
  characterFormat: {},
  bookmarkType: 0,
  name
});

/** SFDT inline for a bookmark end marker. */
export const bookmarkEnd = (name: string): Record<string, any> => ({
  characterFormat: {},
  bookmarkType: 1,
  name
});

export const isBookmarkStart = (inline: any): boolean =>
  inline?.bookmarkType === 0 && typeof inline?.name === 'string';

export const isBookmarkEnd = (inline: any): boolean =>
  inline?.bookmarkType === 1 && typeof inline?.name === 'string';

export const bookmarkName = (inline: any): string | null =>
  typeof inline?.name === 'string' &&
  (inline.bookmarkType === 0 || inline.bookmarkType === 1)
    ? inline.name
    : null;
```

Note: `blockIdFromBookmark('ftk_total')` must return null — `ftk_` does not start with `fblk_`, so the prefix check alone is correct; no special-casing needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/documentBlocks/tests/anchors.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/anchors.ts src/documentBlocks/tests/anchors.spec.ts
git commit -m "feat: block and token bookmark anchors for SFDT"
```

---

### Task 3: SFDT generation

**Files:**
- Create: `src/documentBlocks/sfdt/generate.ts`
- Test: `src/documentBlocks/tests/generate.spec.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 2 anchors; `valueKey` from `../../documentTokens/plan`.
- Produces: `generateSfdt(data: DocumentData, tokenValues: Map<string, string>): string` — a JSON string ready for `documentEditor.open()`. `tokenValues` maps `valueKey(spec)` → already-rendered display text (rendering happened in tokens.ts); a token whose key is absent renders as the empty string. Generation never computes or formats a value.

Heading styles map: h1 → `Heading 1`, h2 → `Heading 2`, h3 → `Heading 3`, paragraph → `Normal`. Theme `BlockFormats` merge onto the paragraph's `paragraphFormat`/`characterFormat` after the style name, so the theme wins.

- [ ] **Step 1: Write the failing test**

```ts
// src/documentBlocks/tests/generate.spec.ts
import { generateSfdt } from '../sfdt/generate';
import { SAMPLE_DOCUMENT } from '../sampleDocument';
import { EMPTY_THEME } from '../types';

const gen = (data = SAMPLE_DOCUMENT, values = new Map<string, string>()) =>
  JSON.parse(generateSfdt(data, values));

describe('generateSfdt', () => {
  it('emits one SFDT section per data section', () => {
    const doc = gen();
    expect(doc.sections).toHaveLength(SAMPLE_DOCUMENT.sections.length);
    for (const section of doc.sections) {
      expect(section.blocks.length).toBeGreaterThan(0);
      expect(section.headersFooters).toEqual({});
    }
  });

  it('wraps every block in its fblk_ bookmark pair', () => {
    const text = JSON.stringify(gen());
    expect(text).toContain('"fblk_blk_title"');
    expect(text).toContain('"fblk_blk_pricing_tbl"');
    const starts = (text.match(/"bookmarkType":0/g) ?? []).length;
    const ends = (text.match(/"bookmarkType":1/g) ?? []).length;
    expect(starts).toBe(ends);
  });

  it('applies heading styles by block type', () => {
    const doc = gen();
    const para = doc.sections[0].blocks[0]; // blk_title, h1
    expect(para.paragraphFormat.styleName).toBe('Heading 1');
  });

  it('renders token values from the provided map inside ftk_ bookmarks', () => {
    const values = new Map([['customer_name', 'Acme Corp']]);
    const doc = gen(SAMPLE_DOCUMENT, values);
    const intro = doc.sections[0].blocks[1];
    const inlineTexts = intro.inlines.map((i: any) => i.text ?? '');
    expect(inlineTexts.join('')).toContain('Acme Corp');
    const names = intro.inlines.map((i: any) => i.name).filter(Boolean);
    expect(names).toContain('ftk_customer_name');
  });

  it('emits tables with header row and theme table format', () => {
    const themed = {
      ...SAMPLE_DOCUMENT,
      theme: {
        ...EMPTY_THEME,
        table: {
          tableFormat: { preferredWidthType: 'Percent', preferredWidth: 100 },
          headerRow: { characterFormat: { bold: true } },
          body: {}
        }
      }
    };
    const doc = gen(themed);
    const table = doc.sections[1].blocks.find((b: any) => b.rows);
    expect(table.rows).toHaveLength(3);
    expect(table.tableFormat.preferredWidthType).toBe('Percent');
    const headerRun = table.rows[0].cells[0].blocks[0].inlines.find(
      (i: any) => typeof i.text === 'string'
    );
    expect(headerRun.characterFormat.bold).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/documentBlocks/tests/generate.spec.ts`
Expected: FAIL — cannot find module '../sfdt/generate'

- [ ] **Step 3: Write the implementation**

```ts
// src/documentBlocks/sfdt/generate.ts
/**
 * DocumentData → SFDT JSON. Pure: no editor, no DOM. The inverse of parse.ts;
 * the round-trip test in parse.spec.ts is the contract between them.
 *
 * Generation never computes a token value — it renders what tokens.ts already
 * resolved. That keeps one evaluator in the system (documentTokens/plan).
 */
import {
  Block,
  BlockFormats,
  BlockType,
  Cell,
  DocumentData,
  Inline,
  Theme
} from '../types';
import {
  blockBookmark,
  bookmarkEnd,
  bookmarkStart,
  tokenBookmark
} from '../anchors';
import { valueKey } from '../../documentTokens/plan';

const HEADING_STYLES: Record<BlockType, string> = {
  h1: 'Heading 1',
  h2: 'Heading 2',
  h3: 'Heading 3',
  paragraph: 'Normal',
  table: 'Normal'
};

const textRun = (text: string, characterFormat: Record<string, any>) => ({
  characterFormat: { ...characterFormat },
  text
});

/** Inline[] → SFDT inlines, tokens wrapped in their ftk_ bookmark pair. */
const inlinesFor = (
  content: Inline[],
  characterFormat: Record<string, any>,
  tokenValues: Map<string, string>
): Record<string, any>[] => {
  const out: Record<string, any>[] = [];
  for (const inline of content) {
    if (inline.kind === 'text') {
      if (inline.text.length > 0) out.push(textRun(inline.text, characterFormat));
      continue;
    }
    const name = tokenBookmark(inline.spec);
    const rendered = tokenValues.get(valueKey(inline.spec)) ?? '';
    out.push(bookmarkStart(name));
    // No empty run between adjacent markers: Syncfusion drops empty runs, and
    // parse treats adjacent markers as an empty token value by design.
    if (rendered.length > 0) out.push(textRun(rendered, characterFormat));
    out.push(bookmarkEnd(name));
  }
  return out;
};

const paragraphFor = (
  block: Block,
  formats: BlockFormats,
  tokenValues: Map<string, string>
): Record<string, any> => {
  const characterFormat = { ...(formats.characterFormat ?? {}) };
  const anchor = blockBookmark(block.id);
  return {
    paragraphFormat: {
      styleName: HEADING_STYLES[block.type],
      ...(formats.paragraphFormat ?? {})
    },
    characterFormat,
    inlines: [
      bookmarkStart(anchor),
      ...inlinesFor(block.content ?? [], characterFormat, tokenValues),
      bookmarkEnd(anchor)
    ]
  };
};

const cellFor = (
  cell: Cell,
  formats: BlockFormats & { cellFormat?: Record<string, any> },
  tokenValues: Map<string, string>,
  leadingInlines: Record<string, any>[],
  trailingInlines: Record<string, any>[]
): Record<string, any> => ({
  blocks: [
    {
      paragraphFormat: { ...(formats.paragraphFormat ?? {}) },
      characterFormat: { ...(formats.characterFormat ?? {}) },
      inlines: [
        ...leadingInlines,
        ...inlinesFor(cell.content, formats.characterFormat ?? {}, tokenValues),
        ...trailingInlines
      ]
    }
  ],
  cellFormat: { ...(formats.cellFormat ?? {}) }
});

const tableFor = (
  block: Block,
  theme: Theme,
  tokenValues: Map<string, string>
): Record<string, any> => {
  const anchor = blockBookmark(block.id);
  const rows = (block.rows ?? []).map((row, rowIndex) => {
    const formats = rowIndex === 0 ? theme.table.headerRow : theme.table.body;
    return {
      rowFormat: { isHeader: rowIndex === 0 },
      cells: row.map((cell, cellIndex) => {
        // The block anchor opens AND closes inside the first cell's first
        // paragraph — a bookmark spanning cells does not survive Syncfusion's
        // serializer.
        const isAnchorCell = rowIndex === 0 && cellIndex === 0;
        return cellFor(
          cell,
          formats,
          tokenValues,
          isAnchorCell ? [bookmarkStart(anchor)] : [],
          isAnchorCell ? [bookmarkEnd(anchor)] : []
        );
      })
    };
  });
  return {
    rows,
    grid: (block.rows?.[0] ?? []).map(() => 1),
    tableFormat: { ...(theme.table.tableFormat ?? {}) }
  };
};

const blockFor = (
  block: Block,
  theme: Theme,
  tokenValues: Map<string, string>
): Record<string, any> =>
  block.type === 'table'
    ? tableFor(block, theme, tokenValues)
    : paragraphFor(block, theme[block.type], tokenValues);

export const generateSfdt = (
  data: DocumentData,
  tokenValues: Map<string, string>
): string => {
  const sections = data.sections.map((section) => ({
    sectionFormat: {},
    blocks: section.blocks.map((b) => blockFor(b, data.theme, tokenValues)),
    headersFooters: {}
  }));
  return JSON.stringify({ optimizeSfdt: false, sections });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/documentBlocks/tests/generate.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/sfdt src/documentBlocks/tests/generate.spec.ts
git commit -m "feat: SFDT generation from document data"
```

---

### Task 4: SFDT parsing and the round-trip contract

**Files:**
- Create: `src/documentBlocks/sfdt/parse.ts`
- Test: `src/documentBlocks/tests/parse.spec.ts`

**Interfaces:**
- Consumes: anchors (Task 2); `generateSfdt` (Task 3, in tests).
- Produces:

```ts
export type ParsedInlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'token'; key: string; text: string }; // key = valueKey, text = displayed value

export type ParsedBlock = {
  id: string | null;              // null = no fblk_ anchor found (adopted content)
  kind: 'paragraph' | 'table';
  styleName?: string;             // paragraphs only
  runs?: ParsedInlineRun[];       // paragraphs only
  cells?: ParsedInlineRun[][][];  // tables: [row][cell] → runs
};

export type ParsedDoc = { sections: ParsedBlock[][] };

export const parseSfdt = (sfdt: string): ParsedDoc;
```

Parsing rules the tests pin:
- A paragraph's runs are its inlines in order; consecutive text runs merge.
- Text between `ftk_X` start/end markers is one `token` run with `key: 'X'` (empty text when markers are adjacent). Token regions never nest.
- `fblk_` markers never appear as runs; they name `ParsedBlock.id`. For tables the anchor is found inside the first cell.
- A block with no `fblk_` bookmark parses with `id: null`.
- Table cells: a cell's paragraphs flatten to one run list, `'\n'` text runs between paragraphs.

- [ ] **Step 1: Write the failing test**

```ts
// src/documentBlocks/tests/parse.spec.ts
import { generateSfdt } from '../sfdt/generate';
import { parseSfdt } from '../sfdt/parse';
import { SAMPLE_DOCUMENT } from '../sampleDocument';

const VALUES = new Map([
  ['customer_name', 'Acme Corp'],
  ['retainer', '$1,500.00'],
  ['total', '$1,620.00']
]);

describe('parseSfdt', () => {
  it('round-trips the sample document: every block id, in order', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const ids = parsed.sections.flat().map((b) => b.id);
    expect(ids).toEqual(
      SAMPLE_DOCUMENT.sections.flatMap((s) => s.blocks.map((b) => b.id))
    );
  });

  it('round-trips paragraph text and token values', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const intro = parsed.sections[0][1];
    expect(intro.runs).toEqual([
      { kind: 'text', text: 'Prepared for ' },
      { kind: 'token', key: 'customer_name', text: 'Acme Corp' },
      { kind: 'text', text: '. All totals recalculate automatically.' }
    ]);
  });

  it('round-trips table cells with tokens', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    const table = parsed.sections[1].find((b) => b.kind === 'table')!;
    expect(table.id).toBe('blk_pricing_tbl');
    expect(table.cells![1][1]).toEqual([
      { kind: 'token', key: 'retainer', text: '$1,500.00' }
    ]);
  });

  it('parses an unanchored paragraph with id null', () => {
    const doc = JSON.parse(generateSfdt(SAMPLE_DOCUMENT, VALUES));
    doc.sections[0].blocks.push({
      paragraphFormat: { styleName: 'Normal' },
      characterFormat: {},
      inlines: [{ characterFormat: {}, text: 'typed below everything' }]
    });
    const parsed = parseSfdt(JSON.stringify(doc));
    const last = parsed.sections[0][parsed.sections[0].length - 1];
    expect(last.id).toBeNull();
    expect(last.runs).toEqual([{ kind: 'text', text: 'typed below everything' }]);
  });

  it('treats adjacent token markers as an empty token value', () => {
    const parsed = parseSfdt(generateSfdt(SAMPLE_DOCUMENT, new Map()));
    const intro = parsed.sections[0][1];
    const token = intro.runs!.find((r) => r.kind === 'token') as any;
    expect(token.text).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/documentBlocks/tests/parse.spec.ts`
Expected: FAIL — cannot find module '../sfdt/parse'

- [ ] **Step 3: Write the implementation**

```ts
// src/documentBlocks/sfdt/parse.ts
/**
 * SFDT JSON → the shapes diff.ts compares against DocumentData.
 *
 * Reads only what sync needs: block identity, style, text, token values.
 * Formatting is deliberately ignored — the theme owns formatting, and reading
 * it back would make every bold word a data change.
 *
 * Tolerant by construction: unknown inline kinds (images, fields, comments)
 * are skipped, not thrown on, so a user's manual insertions cannot break sync.
 */
import {
  blockIdFromBookmark,
  bookmarkName,
  isBookmarkEnd,
  isBookmarkStart,
  tokenKeyFromBookmark
} from '../anchors';

export type ParsedInlineRun =
  | { kind: 'text'; text: string }
  | { kind: 'token'; key: string; text: string };

export type ParsedBlock = {
  id: string | null;
  kind: 'paragraph' | 'table';
  styleName?: string;
  runs?: ParsedInlineRun[];
  cells?: ParsedInlineRun[][][];
};

export type ParsedDoc = { sections: ParsedBlock[][] };

/** Fold one paragraph's inlines into runs; reports any block anchor found. */
const runsOf = (
  inlines: any[]
): { runs: ParsedInlineRun[]; anchor: string | null } => {
  const runs: ParsedInlineRun[] = [];
  let anchor: string | null = null;
  let openToken: { key: string; text: string } | null = null;

  const pushText = (text: string) => {
    const last = runs[runs.length - 1];
    if (last && last.kind === 'text') {
      runs[runs.length - 1] = { kind: 'text', text: last.text + text };
    } else {
      runs.push({ kind: 'text', text });
    }
  };

  for (const inline of inlines ?? []) {
    const name = bookmarkName(inline);
    if (name !== null) {
      const blockId = blockIdFromBookmark(name);
      if (blockId !== null) {
        if (isBookmarkStart(inline)) anchor = anchor ?? blockId;
        continue; // block markers are identity, not content
      }
      const tokenKey = tokenKeyFromBookmark(name);
      if (tokenKey !== null) {
        if (isBookmarkStart(inline)) {
          openToken = { key: tokenKey, text: '' };
        } else if (isBookmarkEnd(inline) && openToken?.key === tokenKey) {
          runs.push({ kind: 'token', key: openToken.key, text: openToken.text });
          openToken = null;
        }
        continue;
      }
      continue; // foreign bookmark (user/Word) — identity we don't own
    }
    if (typeof inline?.text === 'string') {
      if (openToken) openToken.text += inline.text;
      else if (inline.text.length > 0) pushText(inline.text);
    }
    // anything else (images, fields, comments) is skipped
  }
  // A start with no end (torn by an edit): surface what was typed as a token
  // still, so the value is not silently lost.
  if (openToken) {
    runs.push({ kind: 'token', key: openToken.key, text: openToken.text });
  }
  return { runs, anchor };
};

const parseParagraph = (block: any): ParsedBlock => {
  const { runs, anchor } = runsOf(block.inlines);
  return {
    id: anchor,
    kind: 'paragraph',
    styleName: block.paragraphFormat?.styleName ?? 'Normal',
    runs
  };
};

const parseTable = (block: any): ParsedBlock => {
  let anchor: string | null = null;
  const cells: ParsedInlineRun[][][] = (block.rows ?? []).map((row: any) =>
    (row.cells ?? []).map((cell: any) => {
      const cellRuns: ParsedInlineRun[] = [];
      (cell.blocks ?? []).forEach((para: any, i: number) => {
        const { runs, anchor: found } = runsOf(para.inlines);
        if (found && !anchor) anchor = found;
        if (i > 0) cellRuns.push({ kind: 'text', text: '\n' });
        cellRuns.push(...runs);
      });
      return cellRuns;
    })
  );
  return { id: anchor, kind: 'table', cells };
};

export const parseSfdt = (sfdt: string): ParsedDoc => {
  const doc = JSON.parse(sfdt);
  const sections: ParsedBlock[][] = (doc.sections ?? []).map((section: any) =>
    (section.blocks ?? []).map((block: any) =>
      block.rows ? parseTable(block) : parseParagraph(block)
    )
  );
  return { sections };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/documentBlocks/tests/parse.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the whole new suite and commit**

Run: `yarn jest src/documentBlocks --silent`
Expected: all pass

```bash
git add src/documentBlocks/sfdt/parse.ts src/documentBlocks/tests/parse.spec.ts
git commit -m "feat: SFDT parsing with generate/parse round-trip contract"
```

---

### Task 5: Diff — absorbing document edits into data

**Files:**
- Create: `src/documentBlocks/diff.ts`
- Test: `src/documentBlocks/tests/diff.spec.ts`

**Interfaces:**
- Consumes: Task 1 types; `ParsedDoc`, `ParsedBlock`, `ParsedInlineRun` (Task 4); `TokenSpec`, `valueKey` from `../documentTokens/plan`.
- Produces:

```ts
export type SyncEvent =
  | { type: 'blockChanged'; blockId: string }
  | { type: 'blockDeleted'; blockId: string }
  | { type: 'blockAdopted'; blockId: string }
  | { type: 'tokenEdited'; key: string; text: string };

export type AbsorbResult = {
  data: DocumentData;                 // new object; theme carried over untouched
  events: SyncEvent[];
  tokenEdits: Map<string, string>;    // valueKey → new display text
};

export const absorbDocEdits = (
  prev: DocumentData,
  parsed: ParsedDoc,
  renderedValues: Map<string, string>  // what generate last rendered per token
): AbsorbResult;
```

Rules (each is a test):
1. Blocks match by id. A matched paragraph's new `content` comes from its runs: text runs → text inlines; token runs → the token inline with that `valueKey` from anywhere in `prev` (global spec lookup), so specs survive editing around them. Emit `blockChanged` only when content actually differs.
2. A token run whose text differs from `renderedValues.get(key)` lands in `tokenEdits` and emits `tokenEdited`. Token text equal to the rendered value is not an edit.
3. A data block whose id is absent from `parsed` is dropped → `blockDeleted`.
4. A parsed block with `id: null` is adopted at its parsed position: type from `styleName` (`Heading 1` → h1, `Heading 2` → h2, `Heading 3` → h3, anything else → paragraph; tables → table), id `blk_a1`, `blk_a2`, … (first free numeric suffix given existing ids) → `blockAdopted`. Token runs with unknown keys become plain text.
5. Block order inside a section follows the parsed order (document-side moves win).
6. Tables: cells map 1:1; a parsed table with more/fewer rows than data adopts/drops rows (extra parsed rows become text-only cells). Cell content diffing follows rule 1.
7. If `parsed` has more sections than `prev`, extra parsed sections' blocks append to the last data section; fewer sections = those sections' blocks were deleted (rule 3 applies per block).

- [ ] **Step 1: Write the failing test**

```ts
// src/documentBlocks/tests/diff.spec.ts
import { absorbDocEdits } from '../diff';
import { generateSfdt } from '../sfdt/generate';
import { parseSfdt } from '../sfdt/parse';
import { SAMPLE_DOCUMENT } from '../sampleDocument';

const RENDERED = new Map([
  ['customer_name', 'Acme Corp'],
  ['retainer', '$1,500.00'],
  ['total', '$1,620.00']
]);

const roundTrip = () => parseSfdt(generateSfdt(SAMPLE_DOCUMENT, RENDERED));

describe('absorbDocEdits', () => {
  it('is a no-op on an unedited round-trip', () => {
    const { data, events, tokenEdits } = absorbDocEdits(
      SAMPLE_DOCUMENT,
      roundTrip(),
      RENDERED
    );
    expect(events).toEqual([]);
    expect(tokenEdits.size).toBe(0);
    expect(data.sections).toEqual(SAMPLE_DOCUMENT.sections);
  });

  it('absorbs edited paragraph text, preserving the token spec', () => {
    const parsed = roundTrip();
    parsed.sections[0][1].runs = [
      { kind: 'text', text: 'Now prepared for ' },
      { kind: 'token', key: 'customer_name', text: 'Acme Corp' },
      { kind: 'text', text: '.' }
    ];
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const intro = data.sections[0].blocks[1];
    expect(intro.content![0]).toEqual({ kind: 'text', text: 'Now prepared for ' });
    expect(intro.content![1]).toEqual(SAMPLE_DOCUMENT.sections[0].blocks[1].content![1]);
    expect(events).toEqual([{ type: 'blockChanged', blockId: 'blk_intro' }]);
  });

  it('reports an edited token value without treating it as content', () => {
    const parsed = roundTrip();
    (parsed.sections[0][1].runs![1] as any).text = 'Bravo Inc';
    const { events, tokenEdits } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    expect(tokenEdits.get('customer_name')).toBe('Bravo Inc');
    expect(events).toContainEqual({
      type: 'tokenEdited',
      key: 'customer_name',
      text: 'Bravo Inc'
    });
  });

  it('drops a block deleted in the document', () => {
    const parsed = roundTrip();
    parsed.sections[0] = parsed.sections[0].filter((b) => b.id !== 'blk_scope_p');
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    expect(data.sections[0].blocks.map((b) => b.id)).not.toContain('blk_scope_p');
    expect(events).toContainEqual({ type: 'blockDeleted', blockId: 'blk_scope_p' });
  });

  it('adopts an unanchored paragraph at its position with a fresh id', () => {
    const parsed = roundTrip();
    parsed.sections[0].splice(2, 0, {
      id: null,
      kind: 'paragraph',
      styleName: 'Heading 2',
      runs: [{ kind: 'text', text: 'New heading typed in the doc' }]
    });
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const adopted = data.sections[0].blocks[2];
    expect(adopted.type).toBe('h2');
    expect(adopted.id).toMatch(/^blk_a\d+$/);
    expect(adopted.content).toEqual([
      { kind: 'text', text: 'New heading typed in the doc' }
    ]);
    expect(events).toContainEqual({ type: 'blockAdopted', blockId: adopted.id });
  });

  it('absorbs a cell edit in a table', () => {
    const parsed = roundTrip();
    parsed.sections[1].find((b) => b.kind === 'table')!.cells![1][0] = [
      { kind: 'text', text: 'Design retainer (monthly)' }
    ];
    const { data, events } = absorbDocEdits(SAMPLE_DOCUMENT, parsed, RENDERED);
    const table = data.sections[1].blocks.find((b) => b.type === 'table')!;
    expect(table.rows![1][0].content).toEqual([
      { kind: 'text', text: 'Design retainer (monthly)' }
    ]);
    expect(events).toContainEqual({ type: 'blockChanged', blockId: 'blk_pricing_tbl' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/documentBlocks/tests/diff.spec.ts`
Expected: FAIL — cannot find module '../diff'

- [ ] **Step 3: Write the implementation**

```ts
// src/documentBlocks/diff.ts
/**
 * Folds a parsed document back into DocumentData. The document's order wins
 * (a block moved in the doc moves in data); the data's token specs win (the
 * document carries values, never definitions).
 */
import { Block, BlockType, Cell, DocumentData, Inline } from './types';
import { ParsedBlock, ParsedDoc, ParsedInlineRun } from './sfdt/parse';
import { TokenSpec, valueKey } from '../documentTokens/plan';

export type SyncEvent =
  | { type: 'blockChanged'; blockId: string }
  | { type: 'blockDeleted'; blockId: string }
  | { type: 'blockAdopted'; blockId: string }
  | { type: 'tokenEdited'; key: string; text: string };

export type AbsorbResult = {
  data: DocumentData;
  events: SyncEvent[];
  tokenEdits: Map<string, string>;
};

const STYLE_TO_TYPE: Record<string, BlockType> = {
  'Heading 1': 'h1',
  'Heading 2': 'h2',
  'Heading 3': 'h3'
};

/** Every token spec in the data, by value key — specs survive doc edits. */
const specIndex = (data: DocumentData): Map<string, TokenSpec> => {
  const index = new Map<string, TokenSpec>();
  for (const section of data.sections) {
    for (const block of section.blocks) {
      const inlines = block.rows
        ? block.rows.flatMap((r) => r.flatMap((c) => c.content))
        : block.content ?? [];
      for (const inline of inlines) {
        if (inline.kind === 'token') index.set(valueKey(inline.spec), inline.spec);
      }
    }
  }
  return index;
};

const inlinesFromRuns = (
  runs: ParsedInlineRun[],
  specs: Map<string, TokenSpec>
): Inline[] =>
  runs.map((run) =>
    run.kind === 'token' && specs.has(run.key)
      ? ({ kind: 'token', spec: specs.get(run.key)! } as Inline)
      : ({ kind: 'text', text: run.text } as Inline)
  );

const collectTokenEdits = (
  runs: ParsedInlineRun[],
  rendered: Map<string, string>,
  tokenEdits: Map<string, string>,
  events: SyncEvent[]
) => {
  for (const run of runs) {
    if (run.kind !== 'token') continue;
    const last = rendered.get(run.key) ?? '';
    if (run.text !== last && !tokenEdits.has(run.key)) {
      tokenEdits.set(run.key, run.text);
      events.push({ type: 'tokenEdited', key: run.key, text: run.text });
    }
  }
};

const nextAdoptedId = (taken: Set<string>): string => {
  let n = 1;
  while (taken.has(`blk_a${n}`)) n += 1;
  const id = `blk_a${n}`;
  taken.add(id);
  return id;
};

export const absorbDocEdits = (
  prev: DocumentData,
  parsed: ParsedDoc,
  renderedValues: Map<string, string>
): AbsorbResult => {
  const specs = specIndex(prev);
  const prevById = new Map<string, Block>();
  for (const s of prev.sections) for (const b of s.blocks) prevById.set(b.id, b);

  const events: SyncEvent[] = [];
  const tokenEdits = new Map<string, string>();
  const taken = new Set(prevById.keys());
  const seen = new Set<string>();

  const rebuildBlock = (pb: ParsedBlock): Block => {
    const existing = pb.id ? prevById.get(pb.id) : undefined;

    if (pb.kind === 'table') {
      for (const row of pb.cells ?? []) {
        for (const cell of row) collectTokenEdits(cell, renderedValues, tokenEdits, events);
      }
      const rows: Cell[][] = (pb.cells ?? []).map((row) =>
        row.map((cellRuns) => ({ content: inlinesFromRuns(cellRuns, specs) }))
      );
      if (existing) {
        seen.add(existing.id);
        const next = { ...existing, rows };
        if (JSON.stringify(next.rows) !== JSON.stringify(existing.rows)) {
          events.push({ type: 'blockChanged', blockId: existing.id });
          return next;
        }
        return existing;
      }
      const id = nextAdoptedId(taken);
      events.push({ type: 'blockAdopted', blockId: id });
      return { id, type: 'table', rows };
    }

    collectTokenEdits(pb.runs ?? [], renderedValues, tokenEdits, events);
    const content = inlinesFromRuns(pb.runs ?? [], specs);
    if (existing) {
      seen.add(existing.id);
      const next = { ...existing, content };
      if (JSON.stringify(next.content) !== JSON.stringify(existing.content)) {
        events.push({ type: 'blockChanged', blockId: existing.id });
        return next;
      }
      return existing;
    }
    const id = nextAdoptedId(taken);
    events.push({ type: 'blockAdopted', blockId: id });
    return {
      id,
      type: STYLE_TO_TYPE[pb.styleName ?? ''] ?? 'paragraph',
      content
    };
  };

  // Document order wins. Extra parsed sections fold into the last data section.
  const sections = prev.sections.map((section, i) => {
    const parsedBlocks =
      i === prev.sections.length - 1
        ? parsed.sections.slice(i).flat()
        : parsed.sections[i] ?? [];
    return { ...section, blocks: parsedBlocks.map(rebuildBlock) };
  });

  for (const id of prevById.keys()) {
    if (!seen.has(id)) events.push({ type: 'blockDeleted', blockId: id });
  }

  // A block whose only change was a token VALUE is not a content change: the
  // rebuilt inline is the same token node, so equality already handled it.
  return { data: { ...prev, sections }, events, tokenEdits };
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/documentBlocks/tests/diff.spec.ts`
Expected: PASS (6 tests). The no-op test is the important one — if it fails, generate/parse/diff disagree somewhere and every later layer would loop.

- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/diff.ts src/documentBlocks/tests/diff.spec.ts
git commit -m "feat: absorb document edits back into block data"
```

---

### Task 6: Theme — components document and extraction

**Files:**
- Create: `src/documentBlocks/theme.ts`
- Test: `src/documentBlocks/tests/theme.spec.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 2 anchors (`bookmarkStart`, `bookmarkEnd`, `bookmarkName`, `isBookmarkStart`).
- Produces:
  - `componentsSfdt(theme: Theme): string` — SFDT for the Components tab: one labeled sample per block type, each anchored by a bookmark `cmp_h1` / `cmp_h2` / `cmp_h3` / `cmp_paragraph` / `cmp_table`, current theme applied so styling accumulates.
  - `extractTheme(sfdt: string): Theme` — reads each sample's formats back.

Extraction rules (each is a test):
- For paragraph-type samples: `paragraphFormat` (minus `styleName` — the style stays owned by generate) and the first text run's `characterFormat`.
- For the table sample: `tableFormat`, header row = row 0's first cell (`cellFormat` + first paragraph/run formats), body = row 1's first cell.
- A missing sample leaves that theme entry `{}` (partial styling must not wipe other types).

- [ ] **Step 1: Write the failing test**

```ts
// src/documentBlocks/tests/theme.spec.ts
import { componentsSfdt, extractTheme } from '../theme';
import { EMPTY_THEME } from '../types';

describe('theme', () => {
  it('round-trips: an untouched components doc extracts the theme it was built from', () => {
    const theme = {
      ...EMPTY_THEME,
      h1: { characterFormat: { fontSize: 28, bold: true }, paragraphFormat: { textAlignment: 'Center' } }
    };
    const extracted = extractTheme(componentsSfdt(theme));
    expect(extracted.h1.characterFormat).toMatchObject({ fontSize: 28, bold: true });
    expect(extracted.h1.paragraphFormat).toMatchObject({ textAlignment: 'Center' });
    expect(extracted.h1.paragraphFormat?.styleName).toBeUndefined();
  });

  it('extracts an edited character format from a sample', () => {
    const doc = JSON.parse(componentsSfdt(EMPTY_THEME));
    // simulate the user bolding the h2 sample in the editor
    for (const block of doc.sections[0].blocks) {
      const names = (block.inlines ?? []).map((i: any) => i.name).filter(Boolean);
      if (names.includes('cmp_h2')) {
        for (const inline of block.inlines) {
          if (typeof inline.text === 'string') {
            inline.characterFormat = { ...inline.characterFormat, bold: true, fontColor: '#336699' };
          }
        }
      }
    }
    const extracted = extractTheme(JSON.stringify(doc));
    expect(extracted.h2.characterFormat).toMatchObject({ bold: true, fontColor: '#336699' });
  });

  it('extracts table header and body formats separately', () => {
    const theme = {
      ...EMPTY_THEME,
      table: {
        tableFormat: { preferredWidthType: 'Percent' },
        headerRow: { characterFormat: { bold: true }, cellFormat: { shading: { backgroundColor: '#eeeeee' } } },
        body: { characterFormat: {} }
      }
    };
    const extracted = extractTheme(componentsSfdt(theme));
    expect(extracted.table.tableFormat).toMatchObject({ preferredWidthType: 'Percent' });
    expect(extracted.table.headerRow.characterFormat).toMatchObject({ bold: true });
    expect(extracted.table.headerRow.cellFormat).toMatchObject({ shading: { backgroundColor: '#eeeeee' } });
  });

  it('leaves theme entries empty when a sample is missing', () => {
    const doc = JSON.parse(componentsSfdt(EMPTY_THEME));
    doc.sections[0].blocks = doc.sections[0].blocks.filter((b: any) => {
      const text = JSON.stringify(b);
      return !text.includes('cmp_h3');
    });
    const extracted = extractTheme(JSON.stringify(doc));
    expect(extracted.h3).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn jest src/documentBlocks/tests/theme.spec.ts`
Expected: FAIL — cannot find module '../theme'

- [ ] **Step 3: Write the implementation**

```ts
// src/documentBlocks/theme.ts
/**
 * The Components document: one sample per block type, styled with the
 * editor's own toolbar. Its serialized formats ARE the theme — extraction
 * reads them back and generate re-applies them to every instance.
 */
import { BlockFormats, Theme } from './types';
import { bookmarkEnd, bookmarkStart, bookmarkName, isBookmarkStart } from './anchors';

const SAMPLE_ANCHORS = ['cmp_h1', 'cmp_h2', 'cmp_h3', 'cmp_paragraph', 'cmp_table'] as const;

const SAMPLE_TEXT: Record<string, { style: string; text: string }> = {
  cmp_h1: { style: 'Heading 1', text: 'Heading 1 — top-level title' },
  cmp_h2: { style: 'Heading 2', text: 'Heading 2 — section heading' },
  cmp_h3: { style: 'Heading 3', text: 'Heading 3 — subsection heading' },
  cmp_paragraph: { style: 'Normal', text: 'Paragraph — body copy sample. Style this text and every paragraph follows.' }
};

const sampleParagraph = (anchor: string, formats: BlockFormats) => ({
  paragraphFormat: {
    styleName: SAMPLE_TEXT[anchor].style,
    ...(formats.paragraphFormat ?? {})
  },
  characterFormat: {},
  inlines: [
    bookmarkStart(anchor),
    { characterFormat: { ...(formats.characterFormat ?? {}) }, text: SAMPLE_TEXT[anchor].text },
    bookmarkEnd(anchor)
  ]
});

const sampleCell = (
  text: string,
  formats: BlockFormats & { cellFormat?: Record<string, any> },
  extra: Record<string, any>[] = []
) => ({
  blocks: [
    {
      paragraphFormat: { ...(formats.paragraphFormat ?? {}) },
      characterFormat: {},
      inlines: [...extra, { characterFormat: { ...(formats.characterFormat ?? {}) }, text }]
    }
  ],
  cellFormat: { ...(formats.cellFormat ?? {}) }
});

const sampleTable = (theme: Theme) => ({
  rows: [
    {
      rowFormat: { isHeader: true },
      cells: [
        sampleCell('Header', theme.table.headerRow, [bookmarkStart('cmp_table')]),
        sampleCell('Header', theme.table.headerRow)
      ]
    },
    {
      rowFormat: { isHeader: false },
      cells: [
        sampleCell('Body cell', theme.table.body),
        sampleCell('Body cell', theme.table.body)
      ]
    }
  ],
  grid: [1, 1],
  tableFormat: { ...(theme.table.tableFormat ?? {}) }
});

export const componentsSfdt = (theme: Theme): string => {
  const typeOf: Record<string, BlockFormats> = {
    cmp_h1: theme.h1,
    cmp_h2: theme.h2,
    cmp_h3: theme.h3,
    cmp_paragraph: theme.paragraph
  };
  const blocks: Record<string, any>[] = [];
  for (const anchor of SAMPLE_ANCHORS) {
    if (anchor === 'cmp_table') {
      blocks.push(sampleTable(theme));
      // close the table anchor in a trailing paragraph — a bookmark cannot
      // end inside a different cell than it starts in.
      blocks.push({
        paragraphFormat: { styleName: 'Normal' },
        characterFormat: {},
        inlines: [bookmarkEnd('cmp_table')]
      });
    } else {
      blocks.push(sampleParagraph(anchor, typeOf[anchor]));
    }
  }
  return JSON.stringify({
    optimizeSfdt: false,
    sections: [{ sectionFormat: {}, blocks, headersFooters: {} }]
  });
};

const stripStyleName = (pf?: Record<string, any>): Record<string, any> | undefined => {
  if (!pf) return undefined;
  const { styleName, ...rest } = pf;
  return rest;
};

const firstRunFormat = (para: any): Record<string, any> | undefined => {
  for (const inline of para?.inlines ?? []) {
    if (typeof inline.text === 'string') return inline.characterFormat ?? {};
  }
  return undefined;
};

const anchorsIn = (block: any): string[] => {
  const names: string[] = [];
  const walk = (paras: any[]) => {
    for (const p of paras)
      for (const i of p.inlines ?? []) {
        const n = bookmarkName(i);
        if (n && isBookmarkStart(i)) names.push(n);
      }
  };
  if (block.rows) {
    for (const row of block.rows) for (const cell of row.cells ?? []) walk(cell.blocks ?? []);
  } else {
    walk([block]);
  }
  return names;
};

export const extractTheme = (sfdt: string): Theme => {
  const doc = JSON.parse(sfdt);
  const theme: Theme = { h1: {}, h2: {}, h3: {}, paragraph: {}, table: { headerRow: {}, body: {} } };
  const keyOf: Record<string, 'h1' | 'h2' | 'h3' | 'paragraph'> = {
    cmp_h1: 'h1',
    cmp_h2: 'h2',
    cmp_h3: 'h3',
    cmp_paragraph: 'paragraph'
  };

  for (const section of doc.sections ?? []) {
    for (const block of section.blocks ?? []) {
      const anchors = anchorsIn(block);
      for (const anchor of anchors) {
        if (keyOf[anchor] && !block.rows) {
          theme[keyOf[anchor]] = {
            paragraphFormat: stripStyleName(block.paragraphFormat),
            characterFormat: firstRunFormat(block)
          };
        }
        if (anchor === 'cmp_table' && block.rows) {
          const headerCell = block.rows[0]?.cells?.[0];
          const bodyCell = block.rows[1]?.cells?.[0];
          theme.table = {
            tableFormat: block.tableFormat ?? {},
            headerRow: {
              characterFormat: firstRunFormat(headerCell?.blocks?.[0]),
              paragraphFormat: stripStyleName(headerCell?.blocks?.[0]?.paragraphFormat),
              cellFormat: headerCell?.cellFormat ?? {}
            },
            body: {
              characterFormat: firstRunFormat(bodyCell?.blocks?.[0]),
              paragraphFormat: stripStyleName(bodyCell?.blocks?.[0]?.paragraphFormat),
              cellFormat: bodyCell?.cellFormat ?? {}
            }
          };
        }
      }
    }
  }
  return theme;
};
```

Note: `anchorsIn` on a table only sees `cmp_table` if the START marker is in the first cell — the trailing-paragraph END marker is outside the table, which is exactly why only the start is checked.

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn jest src/documentBlocks/tests/theme.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/theme.ts src/documentBlocks/tests/theme.spec.ts
git commit -m "feat: components document generation and theme extraction"
```

---

### Task 7: Store — immutable operations and undo/redo

**Files:**
- Create: `src/documentBlocks/store.ts`
- Test: `src/documentBlocks/tests/store.spec.ts`

**Interfaces:**
- Consumes: Task 1 types; `SyncEvent` (Task 5).
- Produces:

```ts
export type UpdateOrigin = 'panel' | 'document' | 'history' | 'theme';

export type BlockStore = {
  getData: () => DocumentData;
  /** Every mutation goes through apply; one call = one undo step. */
  apply: (
    mutate: (data: DocumentData) => DocumentData,
    origin: UpdateOrigin
  ) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  subscribe: (
    fn: (data: DocumentData, origin: UpdateOrigin) => void
  ) => () => void;
};

export const createBlockStore = (initial: DocumentData): BlockStore;

// Prebuilt mutations (all pure, all covered by tests):
export const insertBlock = (
  sectionId: string,
  afterBlockId: string | null,
  type: BlockType,
  id: string
) => (data: DocumentData) => DocumentData;
export const deleteBlock = (blockId: string) => (data: DocumentData) => DocumentData;
export const updateBlockContent = (blockId: string, content: Inline[]) =>
  (data: DocumentData) => DocumentData;
export const updateCell = (blockId: string, row: number, col: number, content: Inline[]) =>
  (data: DocumentData) => DocumentData;
export const setTheme = (theme: Theme) => (data: DocumentData) => DocumentData;
```

Behaviors to pin with tests (write one `it` per line):
- `apply` replaces data immutably; the previous object is untouched.
- `undo` restores the previous data and notifies with origin `'history'`; `redo` reverses it. A fresh `apply` clears the redo stack.
- `insertBlock('sec_x', null, 'table', 'blk_new')` prepends to the section; a new table gets 3×3 rows — header `Column 1..3`, body cells `Cell`.
- `insertBlock` after an id places it immediately after that block.
- `deleteBlock` removes it from whichever section holds it.
- `updateCell` replaces one cell's content, leaving every other cell identical (same reference).
- `subscribe` fires on every apply/undo/redo with the origin passed through; unsubscribe stops it.

Implementation sketch (the mutations are ~5 lines each — map sections, map blocks, spread):

```ts
export const createBlockStore = (initial: DocumentData): BlockStore => {
  let data = initial;
  const past: DocumentData[] = [];
  const future: DocumentData[] = [];
  const listeners = new Set<(d: DocumentData, o: UpdateOrigin) => void>();
  const notify = (origin: UpdateOrigin) =>
    listeners.forEach((fn) => fn(data, origin));

  return {
    getData: () => data,
    apply: (mutate, origin) => {
      const next = mutate(data);
      if (next === data) return; // no-op mutations do not pollute history
      past.push(data);
      future.length = 0;
      data = next;
      notify(origin);
    },
    undo: () => {
      const prev = past.pop();
      if (!prev) return;
      future.push(data);
      data = prev;
      notify('history');
    },
    redo: () => {
      const next = future.pop();
      if (!next) return;
      past.push(data);
      data = next;
      notify('history');
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }
  };
};
```

New-table default (inside `insertBlock` when `type === 'table'`):

```ts
const defaultRows = (): Cell[][] => [
  [1, 2, 3].map((n) => ({ content: [{ kind: 'text', text: `Column ${n}` }] })),
  [1, 2, 3].map(() => ({ content: [{ kind: 'text', text: 'Cell' }] })),
  [1, 2, 3].map(() => ({ content: [{ kind: 'text', text: 'Cell' }] }))
];
```

Other type defaults: h1/h2/h3 → `[{ kind: 'text', text: 'New heading' }]`, paragraph → `[{ kind: 'text', text: 'New paragraph' }]`.

- [ ] **Step 1: Write the failing tests** (one `it` per behavior above, in `src/documentBlocks/tests/store.spec.ts`, importing `createBlockStore`, `insertBlock`, `deleteBlock`, `updateBlockContent`, `updateCell`, `setTheme` and `SAMPLE_DOCUMENT`)

- [ ] **Step 2: Run to verify failure** — `yarn jest src/documentBlocks/tests/store.spec.ts` → cannot find module '../store'

- [ ] **Step 3: Implement** `src/documentBlocks/store.ts` per the sketch — every mutation returns a new object, `data === next` short-circuits, mutations that find no matching block/section return `data` unchanged.

- [ ] **Step 4: Run to verify pass** — `yarn jest src/documentBlocks/tests/store.spec.ts`

- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/store.ts src/documentBlocks/tests/store.spec.ts
git commit -m "feat: block store with immutable ops and data-level undo"
```

---

### Task 8: Tokens — collect, resolve, and write back

**Files:**
- Modify: `src/documentBlocks/types.ts` (add `values?: Record<string, string | number>` to `DocumentData` — in-memory token values, e.g. a token with neither `source` nor `formula`)
- Create: `src/documentBlocks/tokens.ts`
- Test: `src/documentBlocks/tests/tokens.spec.ts`

**Interfaces:**
- Consumes: Task 1 types; `TokenSpec`, `valueKey`, `buildPlan`, `recalc` from `../documentTokens/plan`; `renderValue`, `parseValue` from `../documentTokens/format`; `FieldAccess` from `../documentTokens/cycleTypes`.
- Produces:

```ts
/** Every token spec in the document, one per value key. */
export const collectSpecs = (data: DocumentData): TokenSpec[];

export type ResolvedTokens = {
  rendered: Map<string, string>;  // valueKey → display text (generateSfdt input)
  errors: Map<string, string>;    // valueKey → formula/cycle error
};

/**
 * Seed inputs from the form (FieldAccess) and data.values, run the existing
 * recalc over the existing plan, render everything through the spec's format.
 */
export const resolveTokens = (
  data: DocumentData,
  fields: FieldAccess | null
): ResolvedTokens;

/**
 * Route one edited token value to its owner: field-backed → FieldAccess.write;
 * in-memory input → a data mutation (for store.apply). Computed tokens are not
 * writable — returns null and the caller regenerates to restore the value.
 */
export const routeTokenEdit = (
  data: DocumentData,
  fields: FieldAccess | null,
  key: string,
  text: string
): ((d: DocumentData) => DocumentData) | null;
```

Behaviors to pin with tests:
- `collectSpecs(SAMPLE_DOCUMENT)` finds `customer_name`, `retainer`, `total` — one spec per value key even if a token appears twice.
- `resolveTokens` with a stub `FieldAccess` (`read` returns `'Acme Corp'` for `customer_name`, `1500` for `retainer`) renders `customer_name → 'Acme Corp'`, `retainer → '$1,500.00'`, `total → '$1,620.00'` (computed by the real grammar through `buildPlan`/`recalc`).
- A formula error (temporarily give a spec the formula `'total +'`) lands in `errors`, not `rendered`.
- `routeTokenEdit` on `retainer` with `'$2,000'` calls `fields.write` with `{ spec, value: 2000 }` (numeric formats parse through `parseValue`; text formats pass the raw string) and returns null (no data mutation needed).
- `routeTokenEdit` on a computed token (`total`) returns null and writes nothing.
- `routeTokenEdit` on an in-memory input token (spec with no `source`/`formula`) returns a mutation that sets `data.values[key]`.

Implementation notes:
- `resolveTokens`: `const plan = buildPlan(collectSpecs(data))`; seed `values: Map<string, number>` — for each non-computed spec, raw = `fields?.read(spec) ?? data.values?.[valueKey(spec)]`; numbers pass through, strings go through `parseValue` for numeric formats. Text-format tokens skip the numeric map entirely and render their raw string. Then `recalc(plan, values)`, then render every spec: numeric → `renderValue(values.get(key), spec.format)`, text → `String(raw ?? '')`.
- Look at how `tokenCycle.ts` seeds values before recalc and mirror its treatment of text vs numeric tokens — the semantics must match what shipped.

- [ ] **Step 1: Write the failing tests** per the behaviors above.
- [ ] **Step 2: Run to verify failure** — `yarn jest src/documentBlocks/tests/tokens.spec.ts`
- [ ] **Step 3: Implement** `src/documentBlocks/tokens.ts` (~120 lines) and the one-line `types.ts` addition.
- [ ] **Step 4: Run to verify pass**, then run `yarn jest src/documentBlocks src/documentTokens --silent` — the documentTokens suite must still be green.
- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks
git commit -m "feat: token resolution and write-back over block data"
```

---

### Task 9: Block sync — the editor loop

**Files:**
- Create: `src/documentBlocks/blockSync.ts` (pure attach function; no React)
- Test: `src/documentBlocks/tests/blockSync.spec.ts`

**Interfaces:**
- Consumes: everything above; `FieldAccess`.
- Produces:

```ts
export type SyncLogEntry = {
  at: number;                     // Date.now()
  kind: 'open' | 'absorb' | 'tokenWrite' | 'recalcReopen' | 'themeApplied';
  detail: string;                 // compact human-readable summary
};

export type EditorSurface = {
  open: (sfdt: string) => void;
  serialize: () => string;
  addEventListener: (name: 'contentChange', fn: () => void) => void;
  removeEventListener?: (name: 'contentChange', fn: () => void) => void;
  /** Scroll container, for restore after reopen. Optional. */
  scrollContainer?: () => { scrollTop: number } | null;
};

export type BlockSync = {
  detach: () => void;
  getLog: () => SyncLogEntry[];
  subscribeLog: (fn: (log: SyncLogEntry[]) => void) => () => void;
  /** Force a regenerate+open (debug panel's Apply-data button). */
  refresh: () => void;
};

export const attachBlockSync = (
  editor: EditorSurface,
  store: BlockStore,
  fields: FieldAccess | null,
  debounceMs?: number  // default 400
): BlockSync;
```

The loop, exactly:
1. On attach: `resolveTokens` → `generateSfdt` → `editor.open()` (guarded by an `applying` flag so the resulting contentChange is ignored). Log `open`.
2. On store change with origin `'panel' | 'history' | 'theme'`: same as (1), restoring `scrollTop` after open. Origin `'document'` does NOT reopen — that change came from the document.
3. On contentChange (not applying): debounce; then `serialize` → `parseSfdt` → `absorbDocEdits(store.getData(), parsed, lastRendered)`.
   - For each `tokenEdits` entry: `routeTokenEdit`; field writes go through `fields.write` (log `tokenWrite`). Mutations batch into one `store.apply(..., 'document')`.
   - If `events` has block changes/adds/deletes: `store.apply(() => result.data, 'document')`. Log `absorb` with event summary.
   - After absorbing, `resolveTokens` again; if any rendered value differs from what the document currently shows (compare against `parsed`'s token runs), regenerate + reopen (log `recalcReopen`) — this is what moves a computed total after its input was edited in the document.
4. `detach` removes the listener and unsubscribes.

Test with a **fake editor** (an object with `open`/`serialize` spies and a manually-fired contentChange) and jest fake timers:
- attach opens the generated sample once.
- a panel `store.apply` reopens; a `'document'`-origin apply does not.
- a simulated document edit (fake `serialize` returns the generated SFDT with a text run changed) absorbs into the store without reopening.
- a simulated token edit (serialize returns SFDT with `retainer`'s run text `'$2,000.00'`) calls `fields.write` with 2000 and reopens once (computed `total` moved).
- detach stops reactions.

- [ ] **Step 1: Write the failing tests** per the five scenarios.
- [ ] **Step 2: Run to verify failure** — `yarn jest src/documentBlocks/tests/blockSync.spec.ts`
- [ ] **Step 3: Implement** `src/documentBlocks/blockSync.ts` (~150 lines).
- [ ] **Step 4: Run to verify pass**; run `yarn jest src/documentBlocks --silent`.
- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/blockSync.ts src/documentBlocks/tests/blockSync.spec.ts
git commit -m "feat: block sync loop between store and editor via SFDT"
```

---

### Task 10: Editor settings — readable SFDT and optional built-in toolbar

**Files:**
- Modify: `src/elements/components/DocxEditor/useDocxEditor.tsx` (the `new ej.documenteditor.DocumentEditorContainer({...})` call, currently around line 565)
- Test: existing `src/elements/components/DocxEditor/DocumentEditorContainer.spec.tsx` must keep passing.

Changes:
1. Add `documentEditorSettings: { optimizeSfdt: false }` to the container constructor config — unconditionally. Readable SFDT is required by every parse in this feature and harmless otherwise (slightly larger serialize output).
2. Add an optional `builtinToolbar?: boolean` field to the hook's options type; when true, construct with `enableToolbar: true, showPropertiesPane: true` (the Components tab needs Syncfusion's formatting UI; the main editor keeps the custom `DocxToolbar`). Inject `ej.documenteditor.Toolbar` in both cases (already done).

- [ ] **Step 1: Make both edits** — the settings object and the `builtinToolbar` option threaded from the hook's options to the constructor.
- [ ] **Step 2: Verify** — `yarn typecheck && yarn jest src/elements/components/DocxEditor --silent`
Expected: all existing tests pass (they mock the CDN editor; the new config keys are inert in mocks).
- [ ] **Step 3: Commit**

```bash
git add src/elements/components/DocxEditor/useDocxEditor.tsx
git commit -m "feat: readable SFDT serialization and optional builtin toolbar"
```

---

### Task 11: Block panel UI

**Files:**
- Create: `src/documentBlocks/BlockPanel.tsx`
- Test: `src/documentBlocks/tests/BlockPanel.spec.tsx`

**Interfaces:**
- Consumes: `BlockStore` + mutations (Task 7), types (Task 1).
- Produces: `default BlockPanel({ store }: { store: BlockStore })`, `blockPanelEnabled(windowLike): boolean` reading `windowLike?.featheryDocxBlocks?.panel`.

Follow `TokenPanel.tsx`'s conventions exactly: inline `styles` object, `useState` + `store.subscribe` in a `useEffect`, no CSS files, no new deps.

Panel layout, top to bottom:
- Header: "Blocks", undo/redo buttons wired to `store.undo`/`store.redo`, disabled off `canUndo`/`canRedo`.
- One group per section (section id as the group label).
- One card per block: type badge (`H1`/`H2`/`H3`/`P`/`TABLE`), then:
  - paragraph-family: one `<textarea>` per text inline (editing calls `store.apply(updateBlockContent(...), 'panel')` with the edited inline replaced); tokens render as read-only chips between them showing `spec.id` (+ `ƒ` marker when computed).
  - table: an html `<table>` of `<input>`s, one per plain-text cell; cells containing tokens render the chip instead. Edits call `store.apply(updateCell(...), 'panel')`.
  - footer row: "＋ h1 | h2 | h3 | ¶ | table" insert-below buttons (`store.apply(insertBlock(sectionId, block.id, type, freshId()), 'panel')` where `freshId` is `'blk_' + Math.random().toString(36).slice(2, 8)` checked against existing ids), and a "✕ delete" button.
  - clicking a computed token chip (`ƒ`) expands an inline formula `<input>` under the card; submitting applies a mutation that replaces that token's `spec.formula` everywhere its value key appears (`store.apply(..., 'panel')`) — formula editing lives only in the panel, exactly as the spec requires.

Testing (React Testing Library is already in the repo — see `TrackedChangeGroups.spec.tsx` for setup):
- renders a card per block of `SAMPLE_DOCUMENT`.
- typing in a paragraph textarea applies `updateBlockContent` (assert via `store.getData()`).
- clicking delete removes the block; undo restores it.
- clicking "＋ table" inserts a table block with 3 rows after that card.
- editing a computed token's formula through its chip updates `spec.formula` in `store.getData()`.

- [ ] **Step 1: Write the failing tests** (5 above)
- [ ] **Step 2: Run to verify failure** — `yarn jest src/documentBlocks/tests/BlockPanel.spec.tsx`
- [ ] **Step 3: Implement** `BlockPanel.tsx` (~250 lines)
- [ ] **Step 4: Run to verify pass**; `yarn typecheck`
- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/BlockPanel.tsx src/documentBlocks/tests/BlockPanel.spec.tsx
git commit -m "feat: block side panel with insert, edit, delete, undo"
```

---

### Task 12: Debug panel UI

**Files:**
- Create: `src/documentBlocks/DebugPanel.tsx`
- Test: `src/documentBlocks/tests/DebugPanel.spec.tsx`

**Interfaces:**
- Consumes: `BlockStore` (Task 7), `BlockSync` (Task 9).
- Produces: `default DebugPanel({ store, sync, editor }: { store: BlockStore; sync: BlockSync; editor: EditorSurface })`, `debugPanelEnabled(windowLike)` reading `windowLike?.featheryDocxBlocks?.debug`.

Three stacked collapsible sections (same inline-style conventions as TokenPanel):
1. **Data** — `<pre>` of `JSON.stringify(store.getData(), null, 2)`, refreshed via `store.subscribe`.
2. **SFDT** — `<textarea>` + "Pull" button (`editor.serialize()` into the textarea) + "Apply" button (`editor.open(textarea value)` wrapped in try/catch, parse errors shown inline in red).
3. **Log** — reverse-chronological list from `sync.getLog()`, refreshed via `sync.subscribeLog`; each row `HH:MM:SS  kind  detail`.

Tests: renders data JSON containing a known block id; Pull puts `serialize()`'s return into the textarea; a log entry appears after `sync` emits (use the fake editor from Task 9's spec to drive one absorb).

- [ ] **Step 1: Write the failing tests** (3 above)
- [ ] **Step 2: Run to verify failure** — `yarn jest src/documentBlocks/tests/DebugPanel.spec.tsx`
- [ ] **Step 3: Implement** `DebugPanel.tsx` (~180 lines)
- [ ] **Step 4: Run to verify pass**; `yarn typecheck`
- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks/DebugPanel.tsx src/documentBlocks/tests/DebugPanel.spec.tsx
git commit -m "feat: debug panel with live data, SFDT pull/apply, event log"
```

---

### Task 13: Components tab and container wiring

**Files:**
- Create: `src/documentBlocks/ComponentsTab.tsx`
- Modify: `src/elements/components/DocxEditor/DocumentEditorContainer.tsx`
- Test: `src/documentBlocks/tests/ComponentsTab.spec.tsx`; existing `DocumentEditorContainer.spec.tsx` keeps passing.

**ComponentsTab** (`{ store }: { store: BlockStore }`):
- Mounts a second editor through the same CDN-loading path the main editor uses. Extract the load-and-create logic from `useDocxEditor` if it is cleanly reusable; if not, use `useDocxEditor` itself with `builtinToolbar: true` and no source/serviceUrl (SFDT-only, zero server calls).
- On ready: `editor.open(componentsSfdt(store.getData().theme))`.
- On the components editor's contentChange, debounced 600 ms: `extractTheme(editor.serialize())` → `store.apply(setTheme(extracted), 'theme')`. The main document reopens through the Task 9 loop (origin `'theme'`); the components document itself is never reopened by that loop.
- Tab visibility does not unmount the main editor (display: none, not conditional render) — Syncfusion re-creation is expensive and loses state.

**DocumentEditorContainer wiring** — all of it gated behind `featheryWindow()?.featheryDocxBlocks?.enabled`, following exactly how `tokenPanelEnabled` is gated today:
- Create the store once (`useRef`): initial data from `featheryWindow().featheryDocxBlocks.data ?? SAMPLE_DOCUMENT`.
- In `onEditorReady`, when blocks are enabled: skip `attachTokenCycle` (two owners of token writes would fight — the block sync owns tokens in a blocks document) and instead `attachBlockSync(editorSurface, store, formFieldAccess)`, where `editorSurface` adapts the Syncfusion instance: `{ open: (s) => ed.open(s), serialize: () => ed.serialize(), addEventListener: ..., scrollContainer: () => ed.documentHelper?.viewerContainer }`.
- Subscribe the store and call `featheryWindow().featheryDocxBlocks.onDataChange?.(data)` on every change — the host-callback persistence boundary from the spec.
- Render: a tab strip (`Document | Components`) above the editor area, `BlockPanel` on the right when `blockPanelEnabled`, `DebugPanel` at the bottom when `debugPanelEnabled`, `ComponentsTab` kept mounted but hidden unless active.

Tests: `ComponentsTab.spec.tsx` — with a mocked editor surface, a simulated contentChange whose `serialize` returns a components doc with a bolded h2 sample results in `store.getData().theme.h2.characterFormat.bold === true`. Container spec — with the flag off, nothing new renders (snapshot unchanged); existing tests pass untouched.

- [ ] **Step 1: Write the failing ComponentsTab test**
- [ ] **Step 2: Run to verify failure** — `yarn jest src/documentBlocks/tests/ComponentsTab.spec.tsx`
- [ ] **Step 3: Implement** `ComponentsTab.tsx` and the container wiring
- [ ] **Step 4: Verify** — `yarn jest src/documentBlocks src/elements/components/DocxEditor --silent && yarn typecheck && yarn lint`
Expected: everything green, including the untouched container spec.
- [ ] **Step 5: Commit**

```bash
git add src/documentBlocks src/elements/components/DocxEditor/DocumentEditorContainer.tsx
git commit -m "feat: components theming tab and flag-gated container wiring"
```

---

### Task 14: Live verification with the hosted-forms driver

**Files:** none created — this task verifies in a real browser and fixes what it finds. Any fix follows the same test-first rule against the module it touches.

Workflow (from project memory — `~/.claude/projects/-Users-treb-feathery/memory/project_feathery_react_linking.md`):

- [ ] **Step 1: Build and link**

```bash
cd ~/feathery/feathery-react/.worktrees/docx-dynamic-blocks
yarn build:node   # rollup ESM+CJS, ~60s
# patch BACKEND_ENV for local backend (rollup does not bake it):
sed -i '' "s/process\.env\.BACKEND_ENV/'local'/g" dist/fthry_index.*.js cjs/fthry_index.*.js
```

Then run the `link-forms` zsh function (in `~/.zshrc`) — it registers hosted-forms-next's react and links `@feathery/react` from the current checkout. **Known caveat:** linking from a git worktree has broken `react/jsx-runtime` resolution before; the worktree has its own full `node_modules` (yarn install was run), which is the first mitigation. If the hosted form still fails with a webpackMissingModule/jsx-runtime error, check the branch out in the main tree (`~/feathery/feathery-react`) for this task instead (stash/commit the main tree's current state first).

- [ ] **Step 2: Start the host and open a docx form**

Start hosted-forms-next dev server; open a form whose step contains a document container (the DocxEditor). In the browser console, before the editor mounts:

```js
window.featheryDocxBlocks = { enabled: true, panel: true, debug: true };
```

Reload. Rerun `yarn build:node` + the sed patch after every SDK source change (the build is one-shot, not watch).

- [ ] **Step 3: Drive the checklist** (each line verified in the browser; the debug panel's data view and event log are the assertions):

1. Sample document renders: title, intro with token value, headings, pricing table; two pages (one per section).
2. Type into a paragraph in the document → after the debounce, Data view shows the new text absorbed into that block; no reopen happened (caret still in place); log shows `absorb`.
3. Edit the retainer token's value in the document → the total cell updates (one `recalcReopen` in the log), and the form field holds the new number.
4. Edit the same field from the form UI (if the step shows it) → document value updates.
5. Panel: insert a table below a paragraph → 3×3 table appears in the document at the right position.
6. Panel: edit a cell → document cell updates. Type in a document cell → panel/Data view updates.
7. Delete a block in the panel → it leaves the document. Select-all-delete a paragraph in the document → it leaves the Data view (`blockDeleted` logged).
8. Type a new paragraph at the end of the document → adopted (`blockAdopted` logged, appears in panel).
9. Components tab: bold + recolor the H2 sample with the toolbar → every h2 in the Document tab restyles (`themeApplied`/reopen logged).
10. Undo (panel button) reverses the last operation and its propagations in one step; redo reapplies.
11. SFDT pane: Pull shows readable JSON (verify `optimizeSfdt` produced verbose keys); Apply of a hand-tweaked pull round-trips.
12. Anchor survival: after all of the above, the log shows zero spurious `blockAdopted`/`blockDeleted` events — bookmarks survived real editing.

- [ ] **Step 4: Fix what fails.** Known likely suspects, in order: SFDT key-name drift (fix in `anchors.ts`/`generate.ts` against a pulled serialize), Syncfusion normalizing generated SFDT on open (adjust generate to emit what serialize round-trips), scroll restore after reopen, debounce interplay with Syncfusion's own contentChange batching. Every fix: reproduce in a jest test against the pulled real SFDT (save it as a fixture in `src/documentBlocks/tests/fixtures/`), then fix, then re-drive.

- [ ] **Step 5: Final gate and commit**

```bash
yarn jest src/documentBlocks src/documentTokens src/elements/components/DocxEditor --silent
yarn typecheck && yarn lint
git add -A && git commit -m "fix: adjustments from live editor verification"
```

---

## Execution notes

- Tasks 1–9 are pure-module work — no browser, fast cycles. Tasks 10–13 touch React/editor code with jest coverage. Task 14 is the only task needing the linked host.
- If Task 14 reveals that Syncfusion rewrites generated SFDT into a shape parse.ts does not expect (the top risk in the spec), the fix belongs in generate/parse against real fixtures — the module boundaries were drawn so nothing else changes.
- The `feat/docx-linked-tokens` reconcile machinery (`tokenCycle`, `controls`, `structureWatchdog`) is deliberately untouched: it keeps serving legacy (non-blocks) documents, and the flag decides which system owns a given editor instance. Deleting/merging the old path is a follow-up branch once this one proves out.

