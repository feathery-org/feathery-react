// CRA added this next line to feathery-frontend as an env file - should I do the same here?
/// <reference types="react" />
import { FeatheryFieldTypes, FieldValues, setValues } from '../utils/init';

export interface ElementProps {
  [fieldId: string]: {
    [propName: string]: string;
  };
}

type SetStep = (stepKey: string) => void;
// am I missing trigger actions?
type TriggerAction =
  | 'field'
  | 'click'
  | 'change'
  | 'addressSelect'
  | 'load'
  | 'blur';
type Trigger = {
  action: TriggerAction;
  id: string;
  text: string;
  type: string; // we should maybe make a type for the element types
};
type IntegrationData = { firebaseAuthId?: string }; // this typing is incomplete
type FieldData = {
  [fieldKey: string]: {
    displayText: string;
    type: string;
    value: FeatheryFieldTypes;
  };
};

interface Context {
  setValues: typeof setValues;
  setOptions: (newOptions: { [servarKey: string]: FeatheryFieldTypes }) => void;
  setProgress: (val: number) => void;
  setStep: (stepKey: string) => boolean;
  step: { style: { backgroundColor: string } };
  userId: string;
  stepName: string;
}

interface ContextOnChange extends Context {
  changeKeys: string[];
  integrationData: IntegrationData;
  trigger: TriggerAction;
  fields: FieldData;
  lastStep: boolean;
  elementRepeatIndex: number;
  valueRepeatIndex: number;
}

interface ContextOnLoad extends Context {
  fields: FieldData;
  stepName: string;
  previousStepName: string;
  lastStep: boolean;
  setStep: SetStep;
  firstStepLoaded: boolean;
  integrationData: IntegrationData;
}

interface ContextOnSubmit extends Context {
  // I haven't used the plaid integration so not quite sure how to type submitFields
  // does including Plaid field values change the type or is it still fine as FieldData
  submitFields: FieldData;
  fields: FieldData;
  elementRepeatIndex: number;
  lastStep: boolean;
  setErrors: (errors) => void;
  setStep: SetStep;
  firsStepSubmitted: boolean;
  integrationData: IntegrationData;
  trigger: Trigger;
}

interface ContextOnSkip extends Context {
  setStep: SetStep;
  trigger: Trigger;
}

interface ContextOnError extends Context {
  fields: FieldData;
  trigger: Trigger;
  elementRepeatIndex: number;
  errorFieldId: string;
  errorFieldType: string;
  errorMessage: string;
}

interface ContextOnCustomAction extends Context {
  trigger: Trigger;
}

interface ContextOnView extends Context {
  visibilityStatus: { elementId: string; isVisible: boolean };
}

export interface FormProps {
  formName: string;
  onChange?: (context: ContextOnChange) => Promise | void;
  onLoad?: (context: ContextOnLoad) => Promise | void;
  onFormComplete?: (context: Context) => Promise | void;
  onSubmit?: (context: ContextOnSubmit) => Promise | void;
  onSkip?: (context: ContextOnSkip) => Promise | void;
  onError?: (context: ContextOnError) => Promise | void;
  onCustomAction?: (context: ContextOnCustomAction) => Promise | void;
  onView?: (context: ContextOnView) => Promise | void;
  onViewElements?: string[];
  initialValues?: FieldValues;
  initialStepId?: string;
  usePreviousUserData?: boolean;
  elementProps?: ElementProps;
  style?: { [cssProperty: string]: string };
  className?: string;
  children?: JSX.Element;
}

export function Form(props: FormProps): JSX.Element;
