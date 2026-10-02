# Feathery

> React client library for [Feathery](https://feathery.io)

[![Release](https://github.com/feathery-org/feathery-react/actions/workflows/release.yml/badge.svg)](https://github.com/feathery-org/feathery-react/actions/workflows/release.yml) [![NPM](https://img.shields.io/npm/v/@feathery/react.svg)](https://www.npmjs.com/package/@feathery/react) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

Use this library to embed and extend Feathery forms in your codebase

## Documentation

For details on how to use this library, check out our [documentation](https://docs.feathery.io/develop/react).

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

### Explicit Quik document inputs

`generateDocuments` can fill each Quik PDF directly from Quik field names:

```js
await feathery.generateDocuments({
  documentIds: [
    {
      kind: 'quik',
      forms: [
        {
          id: 44249,
          fields: { '1own.FName': 'First', '1own.H.Email': 'first@example.com' }
        },
        {
          id: 44249,
          fields: {
            '1own.FName': 'Second',
            '1own.H.Email': 'second@example.com'
          }
        }
      ]
    }
  ],
  signMethod: 'docusign',
  envelopeAction: 'open_in_editor',
  toolbarActions: ['download', 'draft']
});
```

Each entry produces one PDF in order, including repeated form IDs. Supply string
values and the Quik role contacts needed for signing. `fields: {}` requests an
unfilled copy. Explicit inputs bypass saved session values, configured static,
CSV and Salesforce prefill, mapped signature images, and Quik integration
attachments. The active Quik integration still supplies credentials and test-mode
settings. Native templates in the same packet retain their existing behavior.

Omit `forms` to keep using the integration's existing form selection and mappings.
This option requires backend support for explicit Quik inputs to be deployed
before use; older backends discard the additional source properties.
