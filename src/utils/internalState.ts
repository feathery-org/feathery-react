import { FieldOptions, FieldStyles } from './formHelperFunctions';
import Field from './Field';
import SimplifiedProduct from '../integrations/stripe/SimplifiedProduct';
import Cart from '../integrations/stripe/Cart';

interface FormInternalState {
  currentStep: any;
  previousStepName: string;
  visiblePositions: any;
  client: any;
  fields: Record<string, Field>;
  products: Record<string, SimplifiedProduct>;
  cart: Cart;
  formName: string;
  formRef: React.MutableRefObject<any>;
  formSettings: any;
  getErrorCallback: (
    props1?: Record<string, unknown>
  ) => (props2?: Record<string, unknown>) => Promise<boolean>;
  history: any;
  inlineErrors: Record<string, { message: string; index: number }>;
  setInlineErrors: React.Dispatch<
    React.SetStateAction<Record<string, { message: string; index: number }>>
  >;
  setUserProgress: React.Dispatch<React.SetStateAction<null>>;
  steps: any;
  updateFieldOptions: (newOptions: FieldOptions) => void;
  updateFieldStyles: (fieldKey: string, newStyles: FieldStyles) => void;
  setFieldErrors: (
    errors: Record<string, string | { index: number; message: string }>
  ) => void;
}
type InternalState = {
  [formUuid: string]: FormInternalState;
};

const internalState: InternalState = {};

// Function that will take a formUuid string and create a new internalState object for the form.
// It also takes an object of stateValues to set on the internalState object for the form
export const setFormInternalState = (
  formUuid: string,
  stateValues: Record<string, any>,
  keysToKeepStable: string[] = []
) => {
  // if the formUuid is already in the internalState object, use it
  const state = internalState[formUuid] ?? {};

  // now overlay each of the stateValues entries onto the corresponding property in the internalState object using Object.assign
  Object.entries(stateValues).forEach(([key, value]) => {
    // if the key in the state object is null or undefined or not and object,
    // then set it to the value from the stateValues object.
    // Otherwise, overlay the obj value from the stateValues object onto the obj value in the state object using Object.assign
    const stateKey: keyof FormInternalState = key as keyof FormInternalState;
    if (
      state[stateKey] === undefined ||
      state[stateKey] === null ||
      typeof state[stateKey] !== 'object' ||
      !keysToKeepStable.includes(stateKey as string)
    )
      state[stateKey] = value;
    else {
      Object.assign(state[stateKey], value);
    }
  });

  // return the form's internalState object
  internalState[formUuid] = state;
  return internalState[formUuid];
};

export default internalState;
