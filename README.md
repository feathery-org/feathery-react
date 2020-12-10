# feathery-react-client-sdk

> React SDK for Feathery

[![NPM](https://img.shields.io/npm/v/feathery-react-client-sdk.svg)](https://www.npmjs.com/package/feathery-react-client-sdk) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save feathery-react-client-sdk
```

## API Guide

### `<Feathery>` Component

This SDK exposes the `<Feathery>` component. Include it where you want
the onboarding flow to appear in your app.

```JavaScript
import { Feathery } from 'feathery-react-client-sdk';
```

### Props

1. `userKey`\
   Type: `string`\
   Unique ID of the user who is onboarding
2. `sdkKey`\
   Type: `string`\
   Feathery API Key
3. `redirectURI`\
   Type: `string`\
   URL to redirect to after user completes the onboarding flow
4. `clientKey` - Optional\
   Type: `string`\
   Authentication token to authorize non-Feathery API actions


### Usage

```JavaScript
<Feathery
    sdkKey='SDK_KEY'
    userKey='USER_KEY'
    redirectURI='https://homepage.com'
    clientKey='CLIENT_KEY'
/>
```

## License

MIT © [Peter Dun](https://github.com/bo-dun-1)
