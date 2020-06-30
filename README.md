# feathery-react-client-sdk

> React SDK for Feathery

[![NPM](https://img.shields.io/npm/v/feathery-react-client-sdk.svg)](https://www.npmjs.com/package/feathery-react-client-sdk) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install

```bash
npm install --save feathery-react-client-sdk
```

## API Guide

### `<Feathery>` Component

The SDK exposes the `<Feathery>` component, inside which, flags are accessible. Your app, or the components which need access to flags should be wrapped inside the `<Feathery>` component. The component will render out all the children passed to it.

```JavaScript

import { Feathery } from 'feathery-react-client-sdk';

```

### Props

1. `sdkKey` and `userKey`\
   Type: `string` or `boolean`\
   The component expects `sdkKey` and `userKey` props to fetch flags. In case either are missing, or are passed in as `false`, the components does not fetch the flags, and the children are rendered.\
   Default: `false`
2. `fallback`\
   Type:`React Component`\
   While the flags are being fetched, a fallback UI is rendered, which can be passed in by the `fallback` prop.\
   Default: `null`
3. `async`\
   If the children components should render out even if the flags are not fetched, `async` prop can be passed in as `true`. While the flags are not loaded, the flags retunred by the hooks will be `null`, and it up to the children to render UI while the flags are loading. When `async` is true, `fallback` is ignored. \
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
