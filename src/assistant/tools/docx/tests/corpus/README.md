# Document shape corpus

Sixteen synthetic documents, one per structural shape the engine has to survive:
flat with no headings, inferred headings, multi-level headings, merged cells,
nested tables, mirrored bindings, ambiguous bindings, pending revisions, comments,
headers and footers, and so on. Captured as SFDT through the real import path.

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
