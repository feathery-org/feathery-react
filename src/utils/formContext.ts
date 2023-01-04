import { changeStep, FieldOptions } from './formHelperFunctions';
import { initInfo, setValues } from './init';
import { validateElements } from './validation';

export const getFormContext = (
  newStep: any,
  props: {
    client: any;
    formName: string;
    formRef: React.MutableRefObject<any>;
    formSettings: any;
    getErrorCallback: (
      props1?: Record<string, unknown>
    ) => (props2?: Record<string, unknown>) => Promise<void>;
    history: any;
    setInlineErrors: React.Dispatch<
      React.SetStateAction<Record<string, { message: string; index: number }>>
    >;
    setUserProgress: React.Dispatch<React.SetStateAction<null>>;
    steps: any;
    updateFieldOptions: (
      stepData: any,
      loadStep?: null
    ) => (newOptions: FieldOptions) => void;
  }
) => ({
  setValues,
  setFormCompletion: (flag: boolean) =>
    props.client.registerEvent({
      step_key: newStep.key,
      event: 'load',
      completed: flag
    }),
  setOptions: props.updateFieldOptions(props.steps),
  setProgress: (val: any) => props.setUserProgress(val),
  setStep: (stepKey: any) => {
    changeStep(stepKey, newStep.key, props.steps, props.history);
  },
  step: {
    style: {
      backgroundColor: newStep?.default_background_color
    }
  },
  userId: initInfo().userId,
  stepName: newStep?.key ?? '',
  validateStep: (showErrors = true) => {
    const { errors } = validateElements({
      elements: [...newStep.servar_fields, ...newStep.buttons],
      triggerErrors: showErrors,
      errorType: props.formSettings.errorType,
      formRef: props.formRef,
      errorCallback: props.getErrorCallback(),
      setInlineErrors: props.setInlineErrors
    });
    return errors;
  }
});

export type FormContext = ReturnType<typeof getFormContext>;
