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
   If `true`, `fallback` is ignored and the children of `<Feathery>` will be rendered even if user settings are not yet available. In this case, user settings returned by the hook will be `null`.\
   Default: `false`

**Usage**

Basic Usage

```JavaScript

<Feathery sdkKey='SDK_KEY' userKey='USER_KEY'>
    <App />
</Feathery>


```

With `fallback`

```JavaScript

<Feathery sdkKey='SDK_KEY' userKey='USER_KEY' fallback={<Loader />}>
    <App />
</Feathery>


```

With `async`

```JavaScript

<Feathery sdkKey='SDK_KEY' userKey='USER_KEY' async>
    <App />
</Feathery>

```

### `useFeathery` Hook

Use the `useFeathery` hook to access user settings. Since it uses React's Context API, it will only work in components inside `<Feathery>`.

```JavaScript

import { useFeathery } from 'feathery-react-client-sdk';

```

_It accepts no arguments._

### Return Value

`useFeathery` returns user settings in an object with the following properties:

1. `loading`\
   `boolean`\
   `true` when settings are being fetched, `false` otherwise. Can be used to display loading state when `async` is `true`.

2. `settings`\
   `object` or `null`\
   An object containing all of the settings as key-value pairs. If the settings are not yet loaded, `settings` is `null`.

3. `error`\
   `Error object` or `false`\
   If an error occures while settings are being fetched, `error` is set.

### Usage

```JavaScript

const MyComponent = () => {

    { settings, error } = useFeathery();

    // No need to check for loading when using fallback, <Feathery> takes care of rendering the loading UI.
    return(
        <>
            { error && <div> Oops! An error occured: { error.message } </div> }
            { flags && <div> Settings loaded! </div> }
        </>
    );
}

```

## License

MIT © [rohan-dhar](https://github.com/rohan-dhar)
