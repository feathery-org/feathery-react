import { FeatheryFieldTypes, setValues } from '../utils/init';

export interface ElementProps {
  [fieldId: string]: {
    [propName: string]: string;
  };
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

export interface Context {
  setValues: typeof setValues;
  setOptions: (newOptions: { [servarKey: string]: FeatheryFieldTypes }) => void;
  setProgress: (val: number) => void;
  setStep: SetStep;
  step: { style: { backgroundColor: string } };
  userId: string;
  stepName: string;
}

export interface ContextOnChange extends Context {
  changeKeys: string[];
  integrationData: IntegrationData;
  trigger: 'field' | 'addressSelect';
  fields: FieldData;
  lastStep: boolean;
  elementRepeatIndex: number;
  valueRepeatIndex: number;
}

export interface ContextOnLoad extends Context {
  fields: FieldData;
  stepName: string;
  previousStepName: string;
  lastStep: boolean;
  setStep: SetStep;
  firstStepLoaded: boolean;
  integrationData: IntegrationData;
}

export interface ContextOnSubmit extends Context {
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

export interface ContextOnSkip extends Context {
  trigger: Trigger;
  lastStep: boolean;
}

export interface ContextOnError extends Context {
  fields: FieldData;
  trigger: Trigger;
  elementRepeatIndex: number;
  errorFieldId: string;
  errorFieldType: string;
  errorMessage: string;
}

export interface ContextOnCustomAction extends Context {
  trigger: Trigger;
}

export interface ContextOnView extends Context {
  visibilityStatus: { elementId: string; isVisible: boolean };
}
