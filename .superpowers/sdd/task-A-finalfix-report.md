# Final-Fix Report — Table Multi-Row Selection

## I1 — Transpose + row selection: gate per-row checkbox on `!isTransposed`

**File changed:** `src/elements/basic/TableElement/index.tsx` line ~360

**What changed:** The per-row `{enableRowSelection && (<td>…</td>)}` guard was changed to `{enableRowSelection && !isTransposed && (<td>…</td>)}`. The header "select all" `<th>` was already inside the `{!isTransposed && <thead>}` block, so it needed no change.

**Test added:** `src/elements/basic/TableElement/tests/rowSelection.spec.tsx` — `describe('I1 - transpose mode disables row selection')` — renders with `enable_row_selection: true, transpose: true` and asserts `queryByRole('checkbox', { name: /select row/i })` returns null.

**Command:** `yarn test src/elements/basic/TableElement/ --watchAll=false` → 37 passed

---

## I2 — Register base row count, not filtered count

**Files changed:**
- `src/elements/basic/TableElement/useTableData.ts`: Added `baseNumRows` to the `UseTableDataReturn` type (line ~133) and to the return object (line ~518). `baseNumRows` was already computed internally but not exposed.
- `src/elements/basic/TableElement/index.tsx`: Destructured `baseNumRows` from `useTableData`; changed `registerTableRowCount(element.id, totalRows)` → `registerTableRowCount(element.id, baseNumRows)`; updated `useEffect` dependency array from `[element.id, totalRows]` to `[element.id, baseNumRows]`.

**Test added:** `src/elements/basic/TableElement/tests/rowSelection.spec.tsx` — `describe('I2 - registerTableRowCount uses base row count')` — seeds 5 base rows, renders with search enabled, calls `setSelectedRows('table1', [4])` (index >= any plausible filtered count), asserts `getSelectedRows('table1')` still equals `[4]` (not clamped away because registered count is 5, the base count).

**Command:** `yarn test src/elements/basic/TableElement/ --watchAll=false` → 37 passed

---

## M3 — Comment on `remapAfterDelete`

**File changed:** `src/utils/tableState.ts` line ~62

**What changed:** Added one-line comment: `// The delete flow triggers the rerender; this helper intentionally does not.`

---

## M5 — Dev warning in `setSelectedRows` when no rowCount registered

**File changed:** `src/utils/tableState.ts` — `setSelectedRows` function

**What changed:** Extracted `rowCount = getTableRowCount(tableId)` and added a `console.warn` when `rowCount === 0 && indices.length > 0`. The project uses `console.warn` directly throughout (error.ts, logic.ts, formContext.ts, offlineRequestHandler.ts) — no custom logger abstraction exists.

---

## M6 — Skipped

Tightening `Record<string, any>` to `Record<string, Table>` in `getInjectableTables`/`getAllTables` was skipped as instructed (not attempted without checking import cycles).

---

## All Tests

```
yarn test src/elements/basic/TableElement/ --watchAll=false
  Tests: 37 passed, 37 total

yarn test src/utils/__test__/ --watchAll=false
  Tests: 169 passed, 169 total
```

ESLint on changed files: 0 errors, 1 pre-existing warning (test file ignored by default pattern).
