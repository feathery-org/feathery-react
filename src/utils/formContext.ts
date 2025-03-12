import { featheryWindow } from './browser';
import {
  changeStep,
  FieldOptions,
  formatAllFormFields,
  getAllElements
} from './formHelperFunctions';
import {
  defaultClient,
  FieldValues,
  getFieldValues,
  initState,
  setFieldValues,
  updateUserId
} from './init';
import internalState, {
  AlloyEntities,
  IntegrationActionIds,
  IntegrationActionOptions,
  setFormInternalState
} from './internalState';
import { validateElements } from './validation';

/**
 * Used by contextRef in <Form />, renderAt for vanillajs, and the lifecycle
 * methods
 *
 * @param formUuid
 * @returns Form context object
 */
export const getFormContext = (formUuid: string) => {
  // If internal state for the formUuid doesn't exist, initialize it so that
  // there will be object stability for the for state object props.  Important for
  // use of certain props in the callback functions.
  let formState = internalState[formUuid];
  if (!formState) {
    formState = { fields: {} } as any;
    setFormInternalState(formUuid, formState);
  }

  return {
    userId: initState.userId,
    _getInternalUserId: () => initState._internalUserId,
    fields: formState.fields,
    products: formState.products,
    cart: formState.cart,
    collaborator: formState.collaborator,
    setFormCompletion: () => {
      const { client, currentStep } = formState;
      return client.registerEvent({
        step_key: currentStep.key,
        next_step_key: '',
        event: 'skip',
        completed: true
      });
    },
    setProgress: (val: any) => formState.setUserProgress(val),
    updateUserId,
    goToStep: (stepKey: any) => {
      const { currentStep, navigate, steps, setStepKey, client, trackHashes } =
        formState;
      changeStep(
        stepKey,
        currentStep.key,
        steps,
        setStepKey,
        navigate,
        client,
        trackHashes
      );
    },
    isTestForm: () => initState.isTestEnv,
    isLastStep: () => {
      const step = formState.currentStep;
      return step.next_conditions.length === 0;
    },
    getStepProperties: () => {
      const state = formState;
      const step = state?.currentStep ?? {};
      const rootStyles = step
        ? step.subgrids.find((grid: any) => grid.position.length === 0).styles
        : {};
      const hideIfMap: Record<string, any> = {};
      getAllElements(step).forEach(([el, type]) => {
        if (!el.hide_ifs.length) return;
        const id = type === 'field' ? el.servar.key : el.id;
        hideIfMap[id] = {
          elementType: type,
          rules: el.hide_ifs.map((hideIf: any) => ({
            comparisonField: hideIf.field_key,
            comparator: hideIf.comparison,
            comparisonValues: hideIf.values
          }))
        };
      });
      return {
        totalSteps: Object.keys(state.steps).length,
        stepName: step.key ?? '',
        previousStepName: state.previousStepName,
        backgroundColor: rootStyles?.background_color ?? 'FFFFFF',
        language: state.language,
        hideRules: hideIfMap
      };
    },
    validateStep: (showErrors = true) => {
      const {
        currentStep,
        visiblePositions,
        formRef,
        formSettings,
        getErrorCallback,
        setInlineErrors
      } = formState;

      const { errors } = validateElements({
        step: currentStep,
        visiblePositions,
        triggerErrors: showErrors,
        errorType: formSettings.errorType,
        formRef,
        errorCallback: getErrorCallback(),
        setInlineErrors
      });
      return errors;
    },
    openUrl: async (url: string, target = '_blank') => {
      if (target !== '_blank') {
        const formClient = formState.client;
        await Promise.all([
          defaultClient.flushCustomFields(),
          formClient.flushCustomFields(),
          formClient.submitQueue,
          formClient.eventQueue
        ]);
        // submitQueue may have updated when awaiting the first time
        await formClient.submitQueue;
      }
      featheryWindow()?.open(url, target, 'noopener');
    },
    runIntegrationActions: (
      actionIds: IntegrationActionIds,
      options: IntegrationActionOptions
    ) => formState.runIntegrationActions(actionIds, options),
    runAIExtraction: async (
      extractionId: string,
      options = { waitForCompletion: true },
      pages?: number[]
    ) => formState.runAIExtraction(extractionId, options, pages),
    setCalendlyUrl: (url: string) => formState.setCalendlyUrl(url),
    applyAlloyJourney: (journeyToken: string, entities: AlloyEntities) =>
      formState.applyAlloyJourney(journeyToken, entities),
    // deprecated
    setFieldValues: (userVals: FieldValues): void => {
      console.warn(
        'setFieldValues is deprecated.  Please use the fields object and set the value directly in individual fields instead.'
      );
      return setFieldValues(userVals);
    },
    // deprecated
    getFieldValues: () => {
      console.warn(
        'getFieldValues is deprecated.  Please use the fields object instead.'
      );
      return getFieldValues();
    },
    // @deprecated
    // TODO: remove when support for setFieldOptions is dropped
    setFieldOptions: (newOptions: FieldOptions) => {
      console.warn(
        'setFieldOptions is deprecated.  Please use the fields object instead and set the options directly on individual fields.'
      );
      return formState.updateFieldOptions(newOptions);
    },
    // @deprecated
    // TODO: remove when support for getFormFields is dropped
    getFormFields: () => {
      console.warn(
        'getFormFields is deprecated.  Please use the fields object instead.'
      );
      return formatAllFormFields(formState.steps, true);
    },
    // @deprecated
    // TODO: remove when support for setFieldErrors is dropped
    setFieldErrors: (
      errors: Record<string, string | { index: number; message: string }>
    ) => {
      console.warn(
        'setFieldErrors is deprecated.  Please use the fields object instead and set the error directly on a field.'
      );
      return formState.setFieldErrors(errors);
    }
  };
};
