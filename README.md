# feathery-react-client-sdk

> React SDK for Feathery

[![NPM](https://img.shields.io/npm/v/feathery-react-client-sdk.svg)](https://www.npmjs.com/package/feathery-react-client-sdk) [![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

## Install
You can use `yarn` or `npm`.
### Yarn
```bash
yarn add feathery-react-client-sdk
```
### npm
```bash
npm install --save feathery-react-client-sdk
```

## API Guide
The following is an example React component that uses the Feathery library.
```JavaScript
import { Feathery } from 'feathery-react-client-sdk';

function App() {
  // Initialize Feathery to Peter
  Feathery.init('sdkKey', 'peter@feathery.tech');

  const [fields, setFields] = useState({});
  useEffect(() => {
    // Access the fields that Peter filled out in the form
    Feathery
      .fetchFields()
      .then(fields => {setFields(fields)});
  }, [])

  // Show the `onboarding` Feathery form
  return <Feathery.Form
    formKey='onboarding'
    onSubmit={(fieldInfo, stepNumber, lastStep) => cache(fieldInfo)}
    clientKey='clientKey'
  />
}
```

### `Feathery.init`
Function that initializes the Feathery library to the correct user and auth info.
This is necessary before using the rest of the API.

#### Parameters
1. `userKey`\
   Type: `string`\
   Unique ID of the user who is accessing Feathery. This can be anything as long as it's unique per user.
2. `sdkKey`\
   Type: `string`\
   Feathery API Key. This authorizes your SDK to communicate with Feathery servers.

### `<Feathery.Form>`
Initialize this component in your React app at the location where
you want a Feathery form to appear. It renders a `form` that contains
the form and expands to fill its parent container.

#### Props
1. `formKey`\
   Type: `string`\
   ID of the Feathery form to display
2. `onSubmit(fieldInfo, stepNumber, lastStep)`\
   Type: `function`\
   Callback function to access user-submitted form information.
   It's called every time the user submits a step of the form.\
   Parameters (in order):
    * `fieldInfo`: An array of the form
      `[{name: <fieldName>, key: <fieldKey>, type: <fieldType>, value: <fieldValue>}]`.\
      For example, `[{name: 'How old are you?', key: 'age', type: 'integer_field', value: 21 }]`.\
      Note that if the field is of `file_upload` type, the value will be a File object.
    * `stepNumber`: An `int` that's the zero-indexed step number that is being submitted.
    * `lastStep`: A `boolean` that is `True` when the step being submitted is
      the last step the user needs to complete.
3. `clientKey` - Optional\
   Type: `string`\
   Authentication token to authorize non-Feathery API actions

### `Feathery.fetchFields`
Function that returns a Promise containing a map of user field inputs of the form
`{fieldKey: fieldValue}`.

If the user doesn't exist, the map will be empty. If the user doesn't have a
value for a particular field, the field value will be `null`.

This method is implemented as a singleton, so there will only be one
global source of data.

## License
MIT © [Peter Dun](https://github.com/bo-dun-1)
