import { FieldOptions } from './formHelperFunctions';

type InternalState = {
  [formUuid: string]: {
    currentStep: any;
    previousStepName: string;
    visiblePositions: any;
    client: any;
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
    updateFieldOptions: (
      stepData: any,
      loadStep?: null
    ) => (newOptions: FieldOptions) => void;
    setFieldErrors: (
      errors: Record<string, string | { index: number; message: string }>
    ) => void;
  };
};

const internalState: InternalState = {};

export default internalState;
