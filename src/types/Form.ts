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
  // Other servars changed by the same interaction, e.g. the city/state/country
  // an address autocomplete fills alongside the address line.
  _relatedServarIds?: string[];
  text?: string;
  type:
    | 'button'
    | 'text'
    | 'field'
    | 'addressSelect'
    | 'table'
    | 'tab'
    | 'progress_bar';
  repeatIndex: number;
  // Table-specific fields
  rowIndex?: number;
  action?: string;
  rowData?: Record<string, any>;
  // Set for data-cell clicks; absent for row-level/action clicks
  columnIndex?: number;
  columnKey?: string;
  columnName?: string;
  // Tab/stepper-specific fields
  entryIndex?: number;
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
  properties?: { allow_empty?: boolean; [key: string]: any };
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
