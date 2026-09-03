# Document shape corpus

Seventeen synthetic documents, one per structural shape the engine has to survive:
flat with no headings, inferred headings, multi-level headings, merged cells,
nested tables, mirrored bindings, ambiguous bindings, pending revisions, comments,
and so on. Captured as SFDT through the real import path.

NOT headers and footers. This list used to claim that shape and it was never
here - no document in this directory has a header or footer story, and neither
does the local corpus's client template. The claim was load-bearing: a
relocation test selected a `headers-footers` shape, found nothing, silently fell
through to another shape, and spent its life comparing an empty headersFooters
to itself. A captured headers-footers document does exist at
`browser-only/headers-footers.sfdt.json` in the local corpus, and it stays there:
measured 2026-08-27 with the same probe and harness, `headings-bound` imports and
serializes in 1.5s while that shape never completes, killed at 150s after an
earlier run was killed at 600s. Vendoring it would hang CI rather than widen it.
Tests needing a header story build one inline; see relocationCharacterization.

These are VENDORED so the corpus sweeps run in CI. They used to be read from an
absolute path on one laptop, which meant the two highest-yield tests in this
workstream ran nowhere else. Between them they caught insert_hyperlink destroying
the anchored paragraph on all seventeen shapes, and move_section destroying
binding tags through a refusal. Neither was caught by any tracked test.

WITHHELD DELIBERATELY: `real-customer-template` is genuine client content and is
not vendored. Specs that want it must skip when it is absent - see
corpusShapes.ts. The local corpus at ~/Desktop/docx-test-corpus keeps the full
set including that document and the .docx sources.

Regenerate a shape by opening its .docx through the real import and serializing.

## flagship-proposal, and why it is the odd one out

Every other shape here was CAPTURED: a .docx opened through the real import path
and serialized. `flagship-proposal` is AUTHORED, from a specification, by
`robin-harness/corpus/build-flagship.mjs`, and checked by `verify-flagship.mjs`
beside it. Regenerate it by running the builder, not by re-importing a .docx.

It is deliberately the hardest shape in the set: fifteen bound item rows in three
categories, a three-level formula chain (a subtotal summing the table's own
column through a dotted ref, a tax computed from that subtotal, and a total
summing both), an unbound striped table, merged header cells, a nested table, two
bookmarks - one safely inside a row and one spanning four - a foreign author's
pending deletion, and a real tail table. It exists so schema and partition work
has something that can actually fail.

It also costs: adding it took the docx suite from about 30 seconds to about 68, varying between 60 and 74 with machine load.

WHAT IT DOES NOT HAVE, and this is not an oversight: header and footer stories.
The full document, `flagship-proposal.headers.sfdt.json`, is kept in the harness
and is BROWSER ONLY. Measured 2026-08-27 in this harness, one variable changing:

| variant | result |
| --- | --- |
| the body alone, no header or footer stories | 83ms |
| those header and footer stories on a one-paragraph body | 15ms |
| both together | never completes, killed at 300s |

Neither ingredient is fatal on its own; the interaction is. jsdom has no text
metrics, so page height never resolves, and laying a repeating header across a
body long enough to paginate does not terminate. That is the same reason the
captured `headers-footers` shape lives under `browser-only/` in the local corpus,
and the reason no shape in this directory has a header story. A test that needs
one either builds a single-page document inline - see relocationCharacterization
- or runs in a browser.
