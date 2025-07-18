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

export type Trigger = {
  id: string;
  _servarId?: string;
  text?: string;
  type: 'button' | 'text' | 'field' | 'addressSelect';
  repeatIndex: number;
};

export type FieldData = {
  [fieldKey: string]: {
    displayText: string;
    type: string;
    value: FeatheryFieldTypes;
  };
};

export type FormContext = ReturnType<typeof getFormContext>;

export interface ContextOnChange extends FormContext {
  trigger: Trigger;
  integrationData: Record<string, any>;
  valueRepeatIndex: number;
}

type ActionData = Record<string, any> & {
  type: string;
};
export interface ContextOnAction extends FormContext {
  trigger: Trigger;
  actions: string[];
  actionData: ActionData[];
}

export interface ContextOnSubmit extends FormContext {
  // Need to figure out how to better convey the possible Plaid information in submitFields
  submitFields: FieldData;
  trigger: Trigger;
}

export interface ContextOnError extends FormContext {
  trigger: Trigger;
  errorFieldId: string;
  errorFieldType: string;
  errorMessage: string;
}

export interface ContextOnView extends FormContext {
  visibilityStatus: { elementId: string; isVisible: boolean };
}

export interface PositionedElement {
  position: number[];
}

export interface Subgrid extends PositionedElement {
  id: string;
  repeated: boolean;
}
