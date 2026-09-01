# Review editor harness

A browser page that mounts the shipped `DocumentViewer` against a local
fillable PDF, with no form and no backend.

```
./harness/review-editor/serve.sh
# → http://localhost:8771/harness/review-editor.html
```

Rebuild after changing anything under `src/elements/components/DocumentViewer/`:

```
npx webpack --config harness/review-editor/webpack.config.js
```

## Why it exists

Every automated test for the viewer runs in jsdom with pdf.js mocked, which
cannot reproduce the parts most likely to break:

- **no real pdf.js** — the AnnotationLayer contract (5.x moved
  linkService/annotationStorage to the constructor) and `setLayerDimensions`'s
  CSS-variable sizing (`round(down, var(--total-scale-factor) * …px,
  var(--scale-round-x))`) only fail against the real pinned CDN build. The
  missing `--scale-round-x` definition that collapsed every widget to 0x0 was
  invisible to jsdom and found by this page.
- **no real widgets** — whether typing/checking/selecting actually commits into
  `annotationStorage`, and whether `saveDocument()` writes those values back
  into the PDF bytes, is unprovable under mocks.
- **the /V-only case** — `sample-form.pdf`'s `prefilled` field carries a value
  with no appearance stream (saved with `updateFieldAppearances: false`), the
  shape Quik-generated forms have. The widget must still display it.

## What to try

| Action | What should happen |
| --- | --- |
| Type into Full name, check I agree, pick a Color, choose a State | Live widgets; the prefilled field shows `quik-style value`. |
| **Download** | `window.__harness.saves` gains an entry whose `values` — re-read from the saved bytes by a fresh pdf.js parse — contain everything entered; the finalize entry comes after it. Editor stays open (Sign is offered). |
| **Download** again with no new edits | No new save — the dirty flag cleared. |
| Edit again, then **Sign** | A second save with the new value, then a `sign` finalize; `completed: true` and the viewer closes. |
| Escape / Back while a save is in flight | Inert until the action settles. |

`window.__harness` holds `{ saves, finalizes, completed, closed, errors }`.

## Regenerating the fixture

`sample-form.pdf` is generated with pdf-lib (text, /V-only prefilled text,
checkbox, radio group, dropdown). See the PR that added this harness for the
generator script; any pdf-lib checkout can rerun it.

## Not part of the build

`bundle.js` is a local artifact (gitignored) and the entry lives outside
`src/`, so nothing here ships.
