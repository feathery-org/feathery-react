import {
  FieldOptions,
  FieldProperties,
  FieldStyles
} from './fieldHelperFunctions';
import Field from './entities/Field';
import SimplifiedProduct from '../integrations/stripe/SimplifiedProduct';
import Cart from '../integrations/stripe/Cart';
import Collaborator from './entities/Collaborator';
import FeatheryClient from './featheryClient';
import { LogicRule } from '../types/Form';
import AssistantClient from '../assistant/AssistantClient';
import {
  ExtractionActionOptions,
  FillQuikParams,
  ForwardInboxEmailOptions,
  PageSelectionInput
} from '@feathery/client-utils';

export type AlloyEntities = Record<string, any>[];
export type LoanProCustomerObject = Record<string, any>;
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
type DocusignSigner = {
  // Required for esign signers; omit for paper signers (not a DocuSign recipient)
  email?: string;
  name: string;
  // 'esign' (default) signs electronically; 'paper' is excluded from the
  // envelope (no recipient/tabs) for offline signing
  signMethod?: 'esign' | 'paper';
  // Optional signing-order override; equal values sign in parallel
  routingOrder?: string;
  // Document visibility: 0-based document indices to hide from this signer
  excludedDocuments?: number[];
};
// One document in a multi-instance envelope: either fill a template fresh
// (documentId + fillData) or reuse a previously generated envelope (envelopeId).
// signerMap routes a template field's signer_index -> an index in `signers`.
type DocusignDocumentInstance = {
  documentId?: string;
  envelopeId?: string;
  fillData?: Record<string, any>;
  signerMap?: Record<string, number>;
};
type DocusignLibraryDocuments = {
  library: 'quik';
  groups: {
    forms: { id: string }[];
    rolePrefixes: string[];
    index: number;
  }[];
  field_mapping: { roleField: string; featheryField: string }[];
};
// Reminder + expiration schedule (day counts). Omit either block to leave that
// part on the DocuSign account default.
type DocusignNotification = {
  reminders?: { enabled?: boolean; delay?: number; frequency?: number };
  expirations?: { enabled?: boolean; after?: number; warn?: number };
};
export type SendDocusignParams = {
  documents?: string[];
  libraryDocuments?: DocusignLibraryDocuments;
  documentInstances?: DocusignDocumentInstance[];
  existingEnvelopeId?: string;
  signers?: DocusignSigner[];
  fillData?: Record<string, any>;
  emailSubject?: string;
  emailBlurb?: string;
  draft?: boolean;
  // Designate the envelope for wet (on-paper) signing; signers become optional
  wetSign?: boolean;
  // Show recipients the account's Electronic Record and Signature Disclosure
  useDisclosure?: boolean;
  // Custom reminder/expiration schedule for the envelope
  notification?: DocusignNotification;
  // DocuSign brand profile GUID to apply to the envelope
  brandId?: string;
  // Enforce per-signer document visibility (auto-on when a signer has
  // excludedDocuments)
  enforceSignerVisibility?: boolean;
};
export type GetDocusignEnvelopeParams = {
  envelopeId: string;
};

export interface FormInternalState {
  language: string | undefined;
  currentStep: any;
  previousStepName: string;
  visiblePositions: any;
  logicRules?: LogicRule[];
  assistantClient?: AssistantClient;
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
    pages?: PageSelectionInput
  ) => Promise<Record<string, string>>;
  forwardInboxEmail: (options: ForwardInboxEmailOptions) => Promise<void>;
  fillQuikForms: (params: FillQuikParams) => Promise<void>;
  sendDocusignEnvelope: (params: SendDocusignParams) => Promise<void>;
  getDocusignEnvelope: (params: GetDocusignEnvelopeParams) => Promise<any>;
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
