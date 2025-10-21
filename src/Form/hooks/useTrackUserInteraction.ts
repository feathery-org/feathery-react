import { RefObject, useEffect } from 'react';
import {
  FEATHERY_INTERACTION_EVENT,
  INTERACTION_EVENT_TYPES,
  isInteractionDetected,
  setInteractionDetected
} from '../../utils/interactionState';
import { featheryWindow } from '../../utils/browser';

export function useTrackUserInteraction(
  formRef: RefObject<any>,
  activeStep: string,
  stepKey: string,
  formName: string
) {
  useEffect(() => {
    if (isInteractionDetected()) return;
    const formElement = formRef.current;
    if (!formElement) return;

    const handleInteraction = () => {
      if (isInteractionDetected()) return;
      setInteractionDetected();

      // Dispatch custom event to notify all FeatheryClient instances
      // there may be multiple clients (form client, default client, etc.)
      // custom event is an efficient way to notify all of them.
      const event = new CustomEvent(FEATHERY_INTERACTION_EVENT);
      featheryWindow().dispatchEvent(event);

      INTERACTION_EVENT_TYPES.forEach((eventType) => {
        formElement.removeEventListener(eventType, handleInteraction, true);
      });
    };

    INTERACTION_EVENT_TYPES.forEach((eventType) => {
      formElement.addEventListener(eventType, handleInteraction, true);
    });

    return () => {
      INTERACTION_EVENT_TYPES.forEach((eventType) => {
        formElement.removeEventListener(eventType, handleInteraction, true);
      });
    };
  }, [activeStep, stepKey, formName]);
}
