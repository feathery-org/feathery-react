# Dynamic document blocks — design

Data defines the entire document: sections, blocks, content, formulas, values.
The document is a rendering of that data; edits in the document propagate back
into it. A side panel inserts and edits blocks; a Components tab styles each
block type in-document and the theme propagates to every instance; a debug
panel exposes the live data and the sync traffic.

- **Repo:** `feathery-react`, branch `feat/docx-dynamic-blocks`
  (worktree `.worktrees/docx-dynamic-blocks`), based on `origin/master` with
  `origin/feat/docx-linked-tokens` merged (247 documentTokens tests green).
- **Prototype:** `~/dev/test-merge-sync` is concept reference only.

## Terminology

| Term | Meaning |
| --- | --- |
| **Block** | One component instance: `h1`, `h2`, `h3`, `paragraph`, or `table` |
| **Section** | A group of blocks, separated by page breaks; reorderable as a unit |
| **Token** | An inline field inside block content (the linked-tokens system) |
| **Theme** | Per-block-type formatting, authored in the Components tab |

## Data model (single source of truth)

```ts
type BlockType = 'h1' | 'h2' | 'h3' | 'paragraph' | 'table';

interface DocumentData {
  sections: Section[];   // page-break separated; reorder = reorder pages
  theme: Theme;          // per-type formatting extracted from Components doc
}

interface Section { id: string; blocks: Block[]; }

interface Block {
  id: string;            // anchor tag in the document
  type: BlockType;
  content?: Inline[];    // h1/h2/h3/paragraph
  rows?: Cell[][];       // table; each cell is Inline[]
}

interface Cell { content: Inline[]; }

type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'token'; /* linked-token spec — field-backed or computed */ };
```

Cells are normal content: plain text that may contain tokens, exactly like
paragraph content. Token values/formulas remain owned by the existing
documentTokens plan (field-backed values by the form engine — the single-owner
rule is unchanged).

Sections are **modeled now, UI later**: generation emits page breaks between
sections and the panel groups blocks by section, but section-reorder UI is a
later layer.

Ownership: in-memory component state + host callbacks (`onDataChange` emits the
data JSON). No backend persistence in this phase. A built-in sample
`DocumentData` seeds development.

## Sync architecture — the pure JSON loop

The editor is configured with `optimizeSfdt: false` so `serialize()` returns
readable SFDT JSON. All document interaction goes through SFDT read/write, not
selection/editor-API surgery:

```
data change (panel, theme, structure, token recalc)
  └→ generateSfdt(data) → editor.open(sfdt) → restore scroll/caret best-effort

document edit (user types)
  └→ contentChange → debounce → editor.serialize() → parseSfdt(json)
       → diff against data → update block content / cells / token values
       → recalc tokens → if downstream values changed, regenerate + reopen
```

Key properties:

- Edits originating in the document do **not** re-open the document (data
  absorbs them; the doc already shows them) — typing stays smooth.
- Undo/redo is a data-level history (one entry per user action, propagations
  included), rendered by regenerate+reopen. Syncfusion's native undo stack is
  not used for data-driven documents.
- A block anchor missing from serialized SFDT = the block was deleted in the
  document → removed from data. Content typed outside any anchor is adopted as
  a new paragraph block.

### Anchors in SFDT

- **Blocks:** each block is wrapped in a block-level content control (or
  bookmark pair if block-level controls prove unreliable in SFDT round-trips —
  decided by a spike, see Open questions) whose tag is the block id.
- **Tokens:** keep the existing content-control anchors from the linked-tokens
  branch unchanged — compatibility with already-shipped token documents — but
  they are now *read and written as JSON nodes* inside `parseSfdt`/
  `generateSfdt` instead of via `selection`/`editor` calls.

### What is adapted from `feat/docx-linked-tokens`

| Module | Fate |
| --- | --- |
| `grammar.ts`, `plan.ts`, `format.ts` (formula eval, token specs, recalc, rendering) | **Kept as-is** — already pure |
| `rows.ts` (repeat groups) | **Kept** — row growth expressed as data-driven table rows where applicable |
| `tokenCycle.ts` reconcile loop | **Adapted** — same single-owner reconcile contract, but reads/writes flow through SFDT parse/generate |
| `controls.ts` (selection surgery, caret tracking, control lookup) | **Largely replaced** by SFDT parse/generate; caret-adjacent heuristics become unnecessary |
| `structureWatchdog.ts` | **Reassessed** — the JSON loop compares full structure every pass, which is what the watchdog approximated |
| `TokenPanel.tsx` | **Absorbed** into the new side panel + debug panel |

New pure modules (jest-tested, no editor instance needed):

- `src/documentBlocks/sfdt/generate.ts` — `DocumentData` → SFDT JSON
  (blocks, anchors, theme formatting, page breaks between sections).
- `src/documentBlocks/sfdt/parse.ts` — SFDT JSON → blocks/cells/token values
  (walks sections → blocks → table rows → cells → inlines, splitting at
  anchor boundaries; the recursive walk covers headersFooters and nested
  tables so nothing is silently skipped).
- Round-trip self-check: `generate(data)` → `parse` → deep-equals `data`.

## Components tab

Two tabs above the editor: **Document** and **Components**. The Components tab
is a second DocumentEditor instance opened with a generated SFDT containing one
labeled sample of each block type (H1, H2, H3, Paragraph, Table with header
row), each wrapped in a `cmp_<type>` anchor.

Styling happens with the editor's own formatting toolbar directly on the
samples. On the components document's `contentChange` (debounced): serialize →
extract each sample's `characterFormat`/`paragraphFormat` (+ table
borders/shading/header-row format for tables) → write into `theme` → the main
document regenerates. Every instance of the block type restyles.

Theme is part of `DocumentData`, so it exports, undoes, and round-trips like
everything else.

## Side panel

Blocks listed as cards in document order, grouped under section headers.
Per card:

- type badge, content editor (text with inline token chips — reuse the token
  editing UX from TokenPanel where it fits)
- tables: grid of cell inputs
- delete block, insert-below (choose one of the 5 types)
- new table default: 3×3, header row + placeholder cell text

Panel edits update data → regenerate. Token formula editing stays in the
panel (formulas have no document representation).

## Debug panel

Modeled on the SFDT-lab artifact; dev-flag gated the same way
`tokenPanelEnabled` is today. Three areas:

1. **Live data** — pretty-printed `DocumentData` JSON, auto-updating.
2. **SFDT pane** — pull (`serialize()` → pane) and apply (pane → `open()`),
   with the pull auto-refreshing on contentChange.
3. **Event log** — scrolling log of sync events: doc edit → data update,
   data → regenerate/reopen, token recalcs, block adoptions/deletions,
   theme extractions. Each entry timestamped with a compact payload summary.

## Dev workflow

Hosted-forms driver: `link-forms` links this checkout into
`~/feathery/hosted-forms-next`; a hosted form renders the DocxEditor and is
driven in a real browser. Build with `yarn build:node` (rollup) per the
linking notes; webpack UMD dev build does not work for Vite-era hosts.

Known caveat: yarn-linking from a git worktree has broken jsx-runtime
resolution before. First attempt: full `yarn install` inside the worktree so
it has real `node_modules`. Fallback: check the branch out in the main tree
for live-testing sessions.

## Testing

- Pure modules (`generate`, `parse`, theme extraction, diffing) — jest, with
  the round-trip self-check as the anchor test.
- Existing 247 documentTokens tests keep passing; tests for replaced modules
  are ported to the SFDT path rather than deleted.
- Document-layer behavior (typing, deletion, adoption, components styling)
  verified by driving the hosted form in a browser.

## Risks / open questions

- **Block-level content controls in SFDT round-trips** — spike first; fall
  back to bookmark pairs if Syncfusion mangles them on serialize/open.
- **`open()` cost on large documents** — regenerate+reopen on every panel
  keystroke needs the existing debounce discipline; if it's visibly slow on
  real documents, batch panel edits (apply on blur) before reaching for
  incremental writes.
- **SFDT shape drift between Syncfusion releases** — no published schema; pin
  the version and keep the round-trip self-check as the canary.
- **Caret/scroll restore after reopen** — best-effort; acceptable because
  reopen only happens for panel/structure/theme changes, not while typing in
  the document.
