# Document bindings harness

A browser page that drives the **ported** binding engine against a real
Syncfusion editor, with no form, no backend and no React.

```
./harness/bindings/serve.sh
# → http://localhost:8770/harness/bindings.html
```

`serve.sh` builds the bundle before serving.
Rebuild after changing anything the entry pulls in - everything under
`src/elements/components/DocxEditor/bindings/`, and the assistant's
`src/assistant/tools/docx/` for the assistant's page below:

```
npx webpack --config harness/bindings/webpack.config.js
```

`bundle.js` is gitignored, so a fresh clone has to build once before either page
loads.

## Why it exists

Every automated test for this engine runs in jsdom, which cannot reproduce the
parts most likely to break:

- **no real caret** — so how far the keystroke guard actually reaches is unproven
- **no hidden editable div** — its `textInput` and `blur` events never fire, and
  those are what commit an edit
- **no real event ordering** — `contentChange` and `selectionChange` interleave
  differently under real typing than under API calls, and the commit triggers
  depend on that order

The page imports the shipped modules directly. Nothing is forked or faked, so
what it does here is what a form does.

## What to try

| Action                                            | What should happen                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Type in a Qty cell, press **Enter**               | Line total, subtotal, grand total and combined total all update. Grand total updates in the table _and_ in the prose sentence.                                                                                         |
| Type in a Qty cell, then **Tab** to the next cell | Same, committed by the caret leaving the cell rather than by Enter.                                                                                                                                                    |
| Type in a Qty cell, then click the side panel     | Same, committed by editor blur - an edit is never stranded.                                                                                                                                                            |
| Type mid-value and keep typing                    | Nothing recalculates until you commit. Reconciling every keystroke would renormalize text under your cursor.                                                                                                           |
| Delete the `$` from a Unit price, commit          | It comes back as `$150.00`, and the totals do **not** move - the value never changed.                                                                                                                                  |
| Type over a locked total                          | The engine's computed value wins on the next commit.                                                                                                                                                                   |
| **Ctrl+Z** once after a committed edit            | Your own edit reverts - not the engine's fan-out. This is the whole point of the patch path.                                                                                                                           |
| Type letters into a Qty cell                      | The keystroke guard's real reach. Expect it to be inert inside these tables - the engine reports the enclosing `[[table=costs]]` wrapper, not the inline field. The `invalid-input` diagnostic is the actual backstop. |
| Type `abc` into a Qty cell and commit             | A blocking diagnostic appears; **Check save** refuses.                                                                                                                                                                 |
| Insert a row with the toolbar's Table menu        | Row adoption: the new row gets bindings inferred from the row above, and the aggregate grows.                                                                                                                          |
| **Add costs row** button                          | The `runCommand` path. Reloads the document, so native undo is destroyed by design; **Snapshot undo** covers it instead.                                                                                               |
| **Set project.name**                              | Fan-out to both occurrences at once.                                                                                                                                                                                   |
| **[[token]] template**                            | Watch tokens become live fields and every formula compute from defaults.                                                                                                                                               |

The status panel shows the controller phase, dirty state, both undo stacks and
per-phase timings. Any network call is blocked and logged - the engine should
need none, so a `BLOCKED` line means a harness bug.

## The assistant's half: `harness/robin-bound-ops.html`

Same bundle, same fixture, but driven through `createDocxEditorBridge` - the
entry point the assistant's tool dispatch uses - instead of by hand.
Each button is one `applyDocumentEdits` call against the open bound document,
and the panel reports the route each op took.

| Action                             | What should happen                                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **insert_row + fill**              | All four ops report `route=engine`. A new bound line item appears, its line total computes, and the subtotal, total and both prose totals follow.                                          |
| **set_cell_text (Qty 12 → 20)**    | `route=engine`. The whole dependent chain moves; no revision is authored.                                                                                                                  |
| **duplicate_table**                | `route=engine`. The Expenses table is cloned with its own styling into a fresh `expenses_copy` namespace, so editing the copy cannot leak into the source.                                 |
| **delete_row**                     | `route=engine`. The row and its bindings go together and the aggregates shrink.                                                                                                            |
| **replace_text (unbound heading)** | `route=editor`. Nothing bound is involved, so this stays an ordinary tracked write - two revisions in the review pane. This is the gate: bindings do not lock the document down wholesale. |
| **write a locked total**           | Refused with `target_is_bound_formula`, and the message names the inputs that _can_ be changed.                                                                                            |
| **unsourced number**               | Refused with `model_authored_number`: a figure the engine did not compute has to say where it came from.                                                                                   |

## Not part of the build

`bundle.js` is a local artifact and the entry lives outside `src/`, so nothing
here ships. The engine's internals are not public API and a harness is no reason
to make them so.

The third page next door, `harness/tracked-changes.html`, is the review rail's
harness rather than the engine's: it seeds tagged tracked changes against the
package's own `dist/index.js` (`yarn dev`), served by the same server. Its
header comment says how to run it.
