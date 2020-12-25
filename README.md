# feathery-react-client-sdk

> React SDK for Feathery

[![NPM](https://img.shields.io/npm/v/feathery-react-client-sdk.svg)](https://www.npmjs.com/package/feathery-react-client-sdk) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save feathery-react-client-sdk
```

## API Guide

### `<Feathery>`

Include the `<Feathery>` component in your React app at the location where
you want the onboarding flow to appear. It renders a `div` that contains
the onboarding flow and expands to fill the height of its parent container.

```JavaScript
import { Feathery } from 'feathery-react-client-sdk';
```

### Props

1. `userKey`\
   Type: `string`\
   Unique ID of the user who is onboarding. This can be anything as long as it's unique per user.
2. `sdkKey`\
   Type: `string`\
   Feathery API Key. This authorizes your SDK to communicate with Feathery servers.
3. `redirectURI` - Optional\
   Type: `string`\
   URL to redirect to after user completes the onboarding flow. If not present, the component returns `null` after the onboarding flow is completed.
4. `clientKey` - Optional\
   Type: `string`\
   Authentication token to authorize non-Feathery API actions


### Usage

```JavaScript
<Feathery
    sdkKey='SDK_KEY'
    userKey='peter@feathery.tech'
    redirectURI='https://homepage.com'
    clientKey='CLIENT_KEY'
/>
```

## License

MIT © [Peter Dun](https://github.com/bo-dun-1)
