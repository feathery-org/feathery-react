import IMask from 'imask';
import { useEffect, useCallback, useState, useRef } from 'react';

// combine imask functionality with react component & input
export function useIMask(
  opts: any,
  {
    onAccept,
    onComplete,
    ref = useRef<any | null>(null),
    defaultValue
  }: any = {}
) {
  const maskRef = useRef<any>(null);

  const onAcceptRef = useRef<any>(onAccept);
  useEffect(() => {
    onAcceptRef.current = onAccept;
  }, [onAccept]);

  const onCompleteRef = useRef<any>(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const [values, setValues] = useState({
    value: '',
    unmaskedValue: '',
    typedValue: undefined
  });

  // track prev values so onChange is only called if value changes
  const previousValuesRef = useRef({
    value: undefined,
    unmaskedValue: undefined,
    typedValue: undefined
  });

  const destroyMask = useCallback(() => {
    if (maskRef.current) {
      maskRef.current.destroy();
      maskRef.current = null;
    }
  }, []);

  const updateValues = useCallback(() => {
    const mask = maskRef.current;
    if (!mask) return;

    previousValuesRef.current = {
      value: mask.value,
      unmaskedValue: mask.unmaskedValue,
      typedValue: mask.typedValue
    };

    setValues({
      value: mask.value,
      unmaskedValue: mask.unmaskedValue,
      typedValue: mask.typedValue
    });
  }, []);

  const handleAccept = useCallback(
    (event?: InputEvent) => {
      const mask = maskRef.current;
      if (!mask) return;
      updateValues();
      if (!onAcceptRef.current) return;
      onAcceptRef.current(mask.value, mask, event);
    },
    [updateValues]
  );

  const handleComplete = useCallback(
    (event?: InputEvent) => {
      const mask = maskRef.current;
      if (!mask || !onCompleteRef.current) return;

      onCompleteRef.current(mask.value, mask, event);
    },
    [onComplete]
  );

  useEffect(() => {
    const element = ref.current;
    if (!element || !opts?.mask) {
      destroyMask();
      return;
    }

    if (!maskRef.current) {
      maskRef.current = IMask(element, opts);
      updateValues();

      if (defaultValue !== undefined) {
        maskRef.current.value = defaultValue;
        updateValues();
      }
    } else {
      maskRef.current.updateOptions(opts);
    }

    return () => {};
  }, [opts, destroyMask, updateValues, defaultValue]);

  useEffect(() => {
    const mask = maskRef.current;
    if (!mask) return;

    mask.on('accept', handleAccept);
    mask.on('complete', handleComplete);

    return () => {
      mask.off('accept', handleAccept);
      mask.off('complete', handleComplete);
    };
  }, [handleAccept, handleComplete]);

  useEffect(() => {
    return destroyMask;
  }, [destroyMask]);

  useEffect(() => {
    const mask = maskRef.current;
    if (!mask || values.value === undefined) return;

    if (previousValuesRef.current.value !== values.value) {
      mask.value = values.value;

      if (mask.value !== values.value) {
        handleAccept();
      }
    }
  }, [values.value, handleAccept]);

  return { maskRef };
}
