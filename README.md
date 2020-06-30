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
2. `fallback`\
   Type: `React Component`\
   This fallback component is rendered while user settings are unavailable.\
   Default: `null`
3. `async`\
   Type: `boolean`\
   If `true`, the children of `<Feathery>` will be rendered even if user settings are not yet available. In this case, user settings returned by the hook will be `null`. When `async` is `false`, `fallback` is ignored and rendering only happens once user settings become available.\
   Default: `false`

**Usage**

Basic Usage

```JavaScript

<Feathery sdkKey='SDK-KEY' userKey='USER_KEY'>
    <App />
</Feathery>


```

With `fallback`

```JavaScript

<Feathery sdkKey='SDK-KEY' userKey='USER_KEY' fallback={<Loader />}>
    <App />
</Feathery>


```

With `async`

```JavaScript

<Feathery sdkKey='SDK-KEY' userKey='USER_KEY' async>
    <App />
</Feathery>

```

### `useFeathery` Hook

The SDK exposes the `useFeathery` hook, which can be used to access flags' state. It uses React's Context API under the hood and can only work in components inside the `<Feathery>` component.

```JavaScript

import { useFeathery } from 'feathery-react-client-sdk';

```

_It accepts no arguments._

### Return Value

It returns the flag's state, which is an object consisting of the following keys:

1. `loading`\
   `boolean`\
   `true` when flags are being loaded, `false` otherwise. Can be used to display a loaded when `async` is `true`.

2. `flags`\
   `object` or `null`\
   An object containing all the flags as key-value pairs. If the flags are not loaded, `flags` is `null`.

3. `error`\
   `Error object` or `false`\
   If an error occures during the fetching of flags, like Fetch request failing, invalid keys etc., an `error` is set with an Error object.

### Usage

```JavaScript

const MyComponent = () => {

    { flags, error } = useFeathery();

    // No need to check for loading when using with fallback, <Feathery> takes care of rendering loading UI.
    return(
        <>
            { error && <div> Oops! En error occured: { error.message } </div> }
            { flags && <div> Flags loaded! </div> }
        </>
    );
}

```

## License

MIT © [rohan-dhar](https://github.com/rohan-dhar)
