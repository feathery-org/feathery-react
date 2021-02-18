# feathery-react

> React library for Feathery

[![NPM](https://img.shields.io/npm/v/feathery-react.svg)](https://www.npmjs.com/package/feathery-react) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install
You can use `yarn` or `npm`.
### Yarn
```bash
yarn add feathery-react
```
### npm
```bash
npm install --save feathery-react
```

## API Guide
The following is an example React component that uses the Feathery library.
```JavaScript
import { Feathery } from 'feathery-react';

function App() {
  // Initialize Feathery to Peter
  Feathery.init('apiKey', 'peter@feathery.tech');

  const [fields, setFields] = useState({});
  useEffect(() => {
    // Access the fields that Peter filled out in the form
    Feathery
      .fetchFields()
      .then(fields => console.log(fields));
  }, [])

  // Show the `onboarding` Feathery form
  return <Feathery.Form
    formKey='onboarding'
    onSubmit={(fields, stepNumber, lastStep) => console.log(fields)}
  />
}
```

### `Feathery.init`
Function that initializes the Feathery library to the correct user and auth info.
This is necessary before using the rest of the API and can be called multiple times.

#### Parameters
1. `userKey`\
   Type: `string`\
   Unique ID of the user who is accessing Feathery. This can be anything as long as it's unique per user.
2. `apiKey`\
   Type: `string`\
   Feathery API Key. This authorizes the library to communicate with Feathery servers.

### `<Feathery.Form>`
Initialize this component in your React app at the location where
you want a Feathery form to appear. It renders an HTML `form` element.

#### Props
1. `formKey`\
   Type: `string`\
   ID of the Feathery form to display
2. `onSubmit(fields, stepNumber, lastStep)`\
   Type: `function`\
   Callback function to access user-submitted form information.
   It's called every time the user submits a step of the form.\
   Parameters (in order):
    * `fields`: An array of the form
      `[{displayText: <string>, key: <string>, type: <enum>, value: <polymorphic>}]`.\
      For example, `[{displayText: 'How old are you?', key: 'age', type: 'integer_field', value: 21 }]`.\
      Note that if the field is of `file_upload` type, the value will be a File object.
    * `stepNumber`: An `int` that's the zero-indexed step number being submitted.
    * `lastStep`: A `boolean` that is `True` when the step being submitted is
      the last step the user needs to complete.

### `Feathery.fetchFields`
Function that returns a Promise containing an array of the same shape as the
`fields` param of the `<Feathery.Form> onSubmit` callback function.
For example, `[{displayText: 'How old are you?', key: 'age', type: 'integer_field', value: 21 }]`.\

If the user doesn't exist, the map will be empty. If the user doesn't have a
value for a particular field, the field value will be `null`.

This method is implemented as a singleton, so there will only be one
global source of data.

## License
MIT © [Peter Dun](https://github.com/bo-dun-1)
