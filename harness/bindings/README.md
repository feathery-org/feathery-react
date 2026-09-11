# Document bindings harness

A browser page that drives the **ported** binding engine against a real
Syncfusion editor, with no form, no backend and no React.

```
./harness/bindings/serve.sh
# → http://localhost:8770/harness/bindings.html
```

Rebuild after changing anything under `src/elements/components/DocxEditor/bindings/`:

```
npx webpack --config harness/bindings/webpack.config.js
```

## Headless integration lane

The repository also has a real-Chrome lane for document-editor structural and
layout behavior. Run it with:

```
yarn test:headless
```

The lane builds its temporary host bundle automatically, launches a throwaway
system Chrome profile, and runs the `*.headless.spec.ts` cases under
`src/assistant/tools/docx/tests/headless/`. Set `CHROME_PATH` when Chrome or
Chromium is not installed in one of the standard locations. Screenshots are
written to the gitignored `.headless-evidence/` directory when a test requests
visual evidence.

These tests cover behavior that requires the live editor, including composed
table changes (duplicate plus row operations), column dependencies, tracked
subtotal updates, restriping, rollback, and operation tracing. The regular
Jest command excludes this lane; use `yarn test:headless` explicitly.

## Why it exists

Most automated tests for this engine run in jsdom, which cannot reproduce the
parts most likely to break. The headless lane complements them with a real
Syncfusion editor:

- **no real caret** — so how far the keystroke guard actually reaches is unproven
- **no hidden editable div** — its `textInput` and `blur` events never fire, and
  those are what commit an edit
- **no real event ordering** — `contentChange` and `selectionChange` interleave
  differently under real typing than under API calls, and the commit triggers
  depend on that order

The page imports the shipped modules directly. Nothing is forked or faked, so
what it does here is what a form does.

## What to try

| Action | What should happen |
| --- | --- |
| Type in a Qty cell, press **Enter** | Line total, subtotal, grand total and combined total all update. Grand total updates in the table *and* in the prose sentence. |
| Type in a Qty cell, then **Tab** to the next cell | Same, committed by the caret leaving the cell rather than by Enter. |
| Type in a Qty cell, then click the side panel | Same, committed by editor blur - an edit is never stranded. |
| Type mid-value and keep typing | Nothing recalculates until you commit. Reconciling every keystroke would renormalize text under your cursor. |
| Delete the `$` from a Unit price, commit | It comes back as `$150.00`, and the totals do **not** move - the value never changed. |
| Type over a locked total | The engine's computed value wins on the next commit. |
| **Ctrl+Z** once after a committed edit | Your own edit reverts - not the engine's fan-out. This is the whole point of the patch path. |
| Type letters into a Qty cell | The keystroke guard's real reach. Expect it to be inert inside these tables - the engine reports the enclosing `[[table=costs]]` wrapper, not the inline field. The `invalid-input` diagnostic is the actual backstop. |
| Type `abc` into a Qty cell and commit | A blocking diagnostic appears; **Check save** refuses. |
| Insert a row with the toolbar's Table menu | Row adoption: the new row gets bindings inferred from the row above, and the aggregate grows. |
| **Add costs row** button | The `runCommand` path. Reloads the document, so native undo is destroyed by design; **Snapshot undo** covers it instead. |
| **Set project.name** | Fan-out to both occurrences at once. |
| **[[token]] template** | Watch tokens become live fields and every formula compute from defaults. |

The status panel shows the controller phase, dirty state, both undo stacks and
per-phase timings. Any network call is blocked and logged - the engine should
need none, so a `BLOCKED` line means a harness bug.

## Not part of the build

`bundle.js` is a local artifact and the entry lives outside `src/`, so nothing
here ships. The engine's internals are not public API and a harness is no reason
to make them so.
