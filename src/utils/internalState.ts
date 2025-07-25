import {
  FieldOptions,
  FieldProperties,
  FieldStyles
} from './formHelperFunctions';
import Field from './entities/Field';
import SimplifiedProduct from '../integrations/stripe/SimplifiedProduct';
import Cart from '../integrations/stripe/Cart';
import Collaborator from './entities/Collaborator';
import FeatheryClient from './featheryClient';

export type IntegrationActionIds = string[] | string;
export type IntegrationActionOptions = {
  waitForCompletion?: boolean;
  multiple?: boolean;
};
export type RunIntegrationActions = (
  actionIds: IntegrationActionIds,
  options: IntegrationActionOptions
) => Promise<{ ok: boolean; error?: string; payload?: any }>;

export type ExtractionActionOptions = {
  waitForCompletion?: boolean;
  pages?: number[];
  variantId?: string;
  meetingUrl?: string;
};

export type AlloyEntities = Record<string, any>[];
export type ApplyAlloyJourney = (
  journeyToken: string,
  entities: AlloyEntities
) => Promise<{ ok: boolean; error?: string; payload?: any }>;
export type LoanProCustomerObject = Record<string, any>;
export type SearchLoanProCustomer = () => Promise<{
  ok: boolean;
  error?: any;
  payload?: any;
}>;
export type CreateLoanProCustomer = (
  bodyParams: LoanProCustomerObject
) => Promise<{ ok: boolean; error?: any; payload?: any }>;
export type GetConfigParams = {
  filter?: Record<string, any>;
  keys?: string[];
  unique?: boolean;
};
export type GetConfig = ({
  filter,
  keys,
  unique
}: GetConfigParams) => Promise<Record<string, any>[]>;

export interface FormInternalState {
  language: string | undefined;
  currentStep: any;
  previousStepName: string;
  visiblePositions: any;
  client: FeatheryClient;
  formName: string;
  formId: string;
  fields: Record<string, Field>;
  products: Record<string, SimplifiedProduct>;
  cart: Cart;
  collaborator: Collaborator;
  trackHashes?: boolean;
  formRef: React.MutableRefObject<any>;
  formSettings: any;
  getErrorCallback: (
    props1?: Record<string, unknown>
  ) => (props2?: Record<string, unknown>) => Promise<boolean>;
  navigate: any;
  inlineErrors: Record<string, { message: string; index: number }>;
  setInlineErrors: React.Dispatch<
    React.SetStateAction<Record<string, { message: string; index: number }>>
  >;
  setUserProgress: React.Dispatch<React.SetStateAction<null>>;
  steps: any;
  setStepKey: (key: string) => void;
  updateFieldOptions: (newOptions: FieldOptions, repeatIndex?: number) => void;
  updateFieldStyles: (fieldKey: string, newStyles: FieldStyles) => void;
  updateFieldProperties: (
    fieldKey: string,
    newProperties: FieldProperties,
    onServar?: boolean
  ) => void;
  setFieldErrors: (
    errors: Record<string, string | { index: number; message: string }>
  ) => void;
  setCalendlyUrl: (url: string) => void;
  runAIExtraction: (
    extractionId: string,
    options: ExtractionActionOptions | boolean,
    pages?: number[]
  ) => Promise<Record<string, string>>;
  getConfig: GetConfig;
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
