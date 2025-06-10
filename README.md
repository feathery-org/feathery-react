# Feathery

> React client library for [Feathery](https://feathery.io)

[![Feathery](https://circleci.com/gh/feathery-org/feathery-react.svg?style=svg)](https://feathery.io) [![NPM](https://img.shields.io/npm/v/@feathery/react.svg)](https://www.npmjs.com/package/@feathery/react) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

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
