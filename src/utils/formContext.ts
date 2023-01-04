import { changeStep, FieldOptions } from './formHelperFunctions';
import { initInfo, setValues, validateStep } from './init';

export const getFormContext = (
  newStep: any,
  props: {
    history: any;
    client: any;
    updateFieldOptions: (
      stepData: any,
      loadStep?: null
    ) => (newOptions: FieldOptions) => void;
    setUserProgress: React.Dispatch<React.SetStateAction<null>>;
    steps: any;
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
  validateStep
});

export type FormContext = ReturnType<typeof getFormContext>;
