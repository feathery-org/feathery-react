import { useRef } from 'react';
import { ClickActionElement } from '..';

interface ActionButtonState {
  button: ClickActionElement;
  isElementActionRunning?: boolean;
  isUserLogicRunning?: boolean;
}

export function useCheckButtonAction(
  setButtonLoader: (button: any) => Promise<void>,
  clearLoaders: () => void
) {
  const buttonActionStateRef = useRef<ActionButtonState | null>(null);

  const isButtonActionRunning = () =>
    buttonActionStateRef.current?.isElementActionRunning ||
    buttonActionStateRef.current?.isUserLogicRunning;

  const updateButtonActionState = (
    elementType: string,
    element: any,
    triggerPayload?: Record<string, any>
  ) => {
    let isRunning = elementType === 'button';

    if (elementType === 'table' && triggerPayload?.action !== undefined) {
      isRunning = true;
      const buttonId = `${element.id}_${triggerPayload.rowIndex}_${triggerPayload.action}`;
      element = {
        id: buttonId,
        properties: element.properties || {},
        repeat: element.repeat
      };
    }

    if (isRunning) {
      buttonActionStateRef.current = {
        button: element,
        isElementActionRunning: true
      };
    } else {
      buttonActionStateRef.current = null;
    }
  };

  const clearButtonActionState = () => {
    if (buttonActionStateRef.current) {
      buttonActionStateRef.current = {
        ...buttonActionStateRef.current,
        isElementActionRunning: false
      };
    }
  };

  const _setButtonLoading = async (isLoading: boolean) => {
    // Loader is only valid if there is a tracked button
    if (!buttonActionStateRef?.current?.button) {
      return;
    }

    if (isLoading) {
      await setButtonLoader(buttonActionStateRef.current.button);
    } else if (!isButtonActionRunning()) {
      // Clear the loaders only when both isElementActionRunning and isUserLogicRunning are false
      clearLoaders();
    }
  };

  const setUserLogicRunning = async (isRunning: boolean) => {
    if (!buttonActionStateRef.current) {
      return;
    }

    buttonActionStateRef.current = {
      ...buttonActionStateRef.current,
      isUserLogicRunning: isRunning
    };

    _setButtonLoading(isRunning);
  };

  return {
    isButtonActionRunning,
    updateButtonActionState,
    clearButtonActionState,
    setUserLogicRunning
  };
}
