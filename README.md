# Feathery

> React client library for [Feathery](https://feathery.io)

[![Release](https://github.com/feathery-org/feathery-react/actions/workflows/release.yml/badge.svg)](https://github.com/feathery-org/feathery-react/actions/workflows/release.yml) [![NPM](https://img.shields.io/npm/v/@feathery/react.svg)](https://www.npmjs.com/package/@feathery/react) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

Use this library to embed and extend Feathery forms in your codebase

## Documentation

For details on how to use this library, check out our [documentation](https://docs.feathery.io/develop/react).

## Storybook

`yarn storybook` serves stories for a handful of elements (button, text,
progress bar, table, text field, checkbox) at http://localhost:6006. They render
through the same `Elements` registry the form uses, so styling runs through
`ResponsiveStyles` exactly as it does in production.

Styling is layered, each layer overriding the one before:

1. **Theme preset** — the paintbrush menu in the toolbar (`stories/theme/tokens.ts`).
   The menu also lists every theme in your org, fetched from a Feathery
   backend, and choosing one styles all elements from it (**backend** is the
   one `.env.local` names). Copy `.env.example` to `.env.local` to configure it.
2. **Theme tokens** — per-story controls such as `primaryColor` or `borderRadius`.
3. **Raw styles** — a `rawStyles` object of Feathery style keys (`shadow_blur_radius`, …) merged last.

`stories/theme/toFeatheryStyles.ts` maps tokens onto each element's `styles`.
To add a preset, add an entry to `themePresets`.

Elements that render differently in the form builder (button, text, text field,
table) have an `editMode` control to switch between the live form and the
builder canvas.

## FAQ

### Q: How do I use the Feathery React library with Vite?

**A:** Remember to add a `global` definition in your Vite config. For example, the following config could be used:

```aiignore
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  resolve: {
    alias: {},
  },
  plugins: [react()],
  server: {
    port: 3000,
  },
  preview: {
    port: 3000,
  },
  define: {
    // By default, Vite doesn't include shims for NodeJS
    global: "window",
  },
});
```

## License

[BSL](https://github.com/feathery-org/feathery-react/blob/master/LICENSE)
