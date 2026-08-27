# Document shape corpus

Sixteen synthetic documents, one per structural shape the engine has to survive:
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
