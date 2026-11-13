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
  formName: string,
  additionalRef?: RefObject<HTMLElement | null>
) {
  useEffect(() => {
    if (isInteractionDetected()) return;
    const elements = [formRef.current, additionalRef?.current].filter(Boolean);
    if (!elements.length) return;

    const handleInteraction = () => {
      if (isInteractionDetected()) return;
      setInteractionDetected();

      // Dispatch custom event to notify all FeatheryClient instances
      // there may be multiple clients (form client, default client, etc.)
      // custom event is an efficient way to notify all of them.
      const event = new CustomEvent(FEATHERY_INTERACTION_EVENT);
      featheryWindow().dispatchEvent(event);

      INTERACTION_EVENT_TYPES.forEach((eventType) => {
        elements.forEach((element) =>
          element.removeEventListener(eventType, handleInteraction, true)
        );
      });
    };

    INTERACTION_EVENT_TYPES.forEach((eventType) => {
      elements.forEach((element) =>
        element.addEventListener(eventType, handleInteraction, true)
      );
    });

    return () => {
      INTERACTION_EVENT_TYPES.forEach((eventType) => {
        elements.forEach((element) =>
          element.removeEventListener(eventType, handleInteraction, true)
        );
      });
    };
  }, [formRef, additionalRef, activeStep, stepKey, formName]);
}
