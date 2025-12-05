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
  type: 'button' | 'text' | 'field' | 'addressSelect' | 'table';
  repeatIndex: number;
  // Table-specific fields
  row?: number;
  action?: string;
  column?: string;
  cell_data?: any;
  row_data?: Record<string, any>;
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

interface LogicRuleBase {
  id: string;
  name: string;
  trigger_event: string;
  steps: string[];
  elements: string[];
  enabled: boolean;
  valid: boolean;
}
// the server_side code is not exposed to the form
export type ServerSideLogicRule = LogicRuleBase & {
  server_side: true;
};
export type ClientSideLogicRule = LogicRuleBase & {
  server_side: false;
  code: string;
};
export type LogicRule = ServerSideLogicRule | ClientSideLogicRule;
