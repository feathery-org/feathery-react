import React from 'react';
import { featheryWindow } from '../../../../utils/browser';

type DeviceRotationOptions = {
  enabled?: boolean;
};

/**
 * Hook to listen for device rotation events.
 *
 * @param onRotate Callback to be called when the device is rotated.
 * @param options Options for the hook, { enabled: boolean }.
 */
export function useDeviceRotation(
  onRotate: () => void,
  { enabled = true }: DeviceRotationOptions
) {
  const callbackRef = React.useRef(onRotate);

  React.useEffect(() => {
    callbackRef.current = onRotate;
  }, [onRotate]);

  React.useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleOrientationChange() {
      if (callbackRef.current) {
        callbackRef.current();
      }
    }

    featheryWindow().addEventListener(
      'orientationchange',
      handleOrientationChange
    );

    return () => {
      featheryWindow().removeEventListener(
        'orientationchange',
        handleOrientationChange
      );
    };
  }, [enabled]);
}
