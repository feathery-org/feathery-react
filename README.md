# feathery-react-client-sdk

> React SDK for Feathery

[![NPM](https://img.shields.io/npm/v/feathery-react-client-sdk.svg)](https://www.npmjs.com/package/feathery-react-client-sdk) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save feathery-react-client-sdk
```

## API Guide

### `<Feathery>` Component

This SDK exposes the `<Feathery>` component. Your app (or the component that needs to access user settings) should be wrapped with `<Feathery>`.

```JavaScript

import { Feathery } from 'feathery-react-client-sdk';

```

### Props

1. `sdkKey` and `userKey`\
   Type: `string` or `boolean`\
   `sdkKey` is used for authentication and `userKey` refers to the user whose settings are being accessed. If either of these are missing or set to `false`, the settings are not fetched but the children are rendered by default.\
   Default: `false`

**Usage**

Basic Usage

```JavaScript

<Feathery sdkKey='SDK_KEY' userKey='USER_KEY'/>


## License

MIT © [Peter Dun](https://github.com/bo-dun-1)
