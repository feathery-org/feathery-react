import { FeatheryFieldTypes } from '../utils/init';
import { getFormContext } from '../utils/formContext';

export interface ElementProps {
  [fieldId: string]: {
    [propName: string]: string;
  };
}

export interface PopupOptions {
  show?: boolean;
  onHide?: () => void;
}

export type SetStep = (stepKey: string) => void;
export type SetErrors = (errors: {
  [fieldKey: string]: string | { index: number; message: string };
}) => void;

type Trigger = {
  id: string;
  text: string;
  type: 'button' | 'text' | 'field';
};

export type IntegrationData = any;
export type FieldData = {
  [fieldKey: string]: {
    displayText: string;
    type: string;
    value: FeatheryFieldTypes;
  };
};

export type FormContext = ReturnType<typeof getFormContext>;

export interface ContextOnChange extends FormContext {
  changeKeys: string[];
  integrationData: IntegrationData;
  trigger: 'field' | 'addressSelect';
  fields: FieldData;
  lastStep: boolean;
  elementRepeatIndex: number;
  valueRepeatIndex: number;
}

export interface ContextOnLoad extends FormContext {
  fields: FieldData;
  stepName: string;
  previousStepName: string;
  lastStep: boolean;
  setStep: SetStep;
  firstStepLoaded: boolean;
  integrationData: IntegrationData;
}

export interface ContextOnSubmit extends FormContext {
  // Need to figure out how to better convey the possible Plaid information in submitFields
  submitFields: FieldData;
  fields: FieldData;
  elementRepeatIndex: number;
  lastStep: boolean;
  setErrors: SetErrors;
  firsStepSubmitted: boolean;
  integrationData: IntegrationData;
  trigger: Trigger;
}

export interface ContextOnSkip extends FormContext {
  trigger: Trigger;
  lastStep: boolean;
}

export interface ContextOnError extends FormContext {
  fields: FieldData;
  trigger: Trigger;
  elementRepeatIndex: number;
  errorFieldId: string;
  errorFieldType: string;
  errorMessage: string;
}

export interface ContextOnCustomAction extends FormContext {
  trigger: Trigger;
}

export interface ContextOnView extends FormContext {
  visibilityStatus: { elementId: string; isVisible: boolean };
}
