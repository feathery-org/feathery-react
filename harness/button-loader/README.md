# Button loader size harness

A browser page that renders real `ButtonElement`s in fit-width cells and
measures the loader, with no form and no backend.

```
./harness/button-loader/serve.sh
# → http://localhost:8771/button-loader.html
```

Rebuild after changing `src/elements/basic/ButtonElement.tsx` or
`src/elements/components/TextNodes.tsx`:

```
npx webpack --config harness/button-loader/webpack.config.js
```

`measure()` in the console returns the button rect, the loader rect and an
overflow figure per case (negative means the loader is inside the button).

## Why it exists

Every automated test for the loader runs in jsdom, which has no layout engine.
Those tests can prove *which branch was taken* — overlaid-and-clamped vs. a
direct child that sizes the button — but not the thing that actually broke:

- **whether the loader ends up big enough to see.** The clamp is
  `max-width: 100%` against the button's content box, so it only misbehaves
  once a real browser has resolved that box.
- **whether the button's width holds across the loader toggle.** That is a
  shrink-to-fit computation; jsdom reports 0 for every rect.

The page imports the shipped component directly. Nothing is forked or faked.

## Reading a screenshot

Outline the loader before trusting your eyes:

```js
document.querySelectorAll('button svg').forEach((s) => {
  s.style.outline = '2px solid red';
  s.querySelectorAll('circle').forEach((c) => (c.style.animation = 'none'));
});
```

The default spinner's visible arc is a `stroke-dasharray` animation that starts
at zero length, and its ring is `#DBDFE8` — so a screenshot can catch a
correctly sized spinner looking absent. The size is the claim; the arc's phase
is noise.

## Gotchas

- **`entry.tsx` imports `src/index` first, on purpose.** `ButtonElement` sits
  in the middle of a cycle (`TextNodes` → `utils/init` → `LoginForm` → `Form`).
  Entering the graph at `ButtonElement` evaluates those modules in an order
  production never uses and throws a TDZ error before React mounts.
- **`ts-loader` runs with `transpileOnly`.** The package ships via rollup +
  babel, which strip types without checking them, so this matches the real
  bundle. It is also required: master currently has four unrelated
  `HubActionOptions` type errors and `utils/init` pulls that file in.
- **A fit cell is `width: max-content`, not `inline-flex`.** The button carries
  `flex: 1` (so `flex-basis: 0%`), and in a bare shrink-to-fit flex container
  that collapses it to min-content and wraps the label one character per line —
  which a real grid cell never does.

## Not part of the build

`bundle.js` is a local artifact and the entry lives outside `src/`, so nothing
here ships.
