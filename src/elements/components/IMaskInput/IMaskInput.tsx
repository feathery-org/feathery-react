import React, {
  forwardRef,
  useRef,
  useEffect,
  InputHTMLAttributes
} from 'react';
import { useIMask } from './useIMask';
import IMask from 'imask';

type IMaskOptionsType = Parameters<typeof IMask>[1];

type IMaskInputProps = InputHTMLAttributes<HTMLInputElement> &
  Partial<IMaskOptionsType> & {
    inputRef?: React.Ref<HTMLInputElement>;
    onAccept?: (value: string, maskRef: any, e?: InputEvent) => void;
    onComplete?: (value: string, maskRef: any, e?: InputEvent) => void;
    value?: string;
    unmask?: boolean | 'typed';
  };

const MASK_PROPS = [
  'mask',
  'prepare',
  'prepareChar',
  'validate',
  'commit',
  'overwrite',
  'eager',
  'skipInvalid',
  'placeholderChar',
  'displayChar',
  'lazy',
  'definitions',
  'blocks',
  'enum',
  'from',
  'to',
  'pattern',
  'format',
  'parse',
  'autofix',
  'radix',
  'thousandsSeparator',
  'mapToRadix',
  'scale',
  'normalizeZeros',
  'padFractionalZeros',
  'min',
  'max',
  'dispatch',
  'onAccept',
  'onComplete',
  'inputRef',
  'unmask'
] as const;

function splitProps(props: any) {
  // split component props into props for mask and for input
  const maskOptions: Record<string, any> = {};
  // @ts-ignore
  const inputProps: Record<string, any> = { ...props };
  MASK_PROPS.forEach((propName) => {
    if (propName in props) {
      maskOptions[propName] = (props as any)[propName];
      delete inputProps[propName];
    }
  });
  if (!('defaultValue' in inputProps) && props.value !== undefined) {
    inputProps.defaultValue = maskOptions.mask ? '' : props.value;
  }
  delete inputProps.value;

  return [maskOptions, inputProps];
}

function getValue(value: any, maskRef: any, unmask: any) {
  if (unmask === true) {
    return maskRef.unmaskedValue;
  } else if (unmask === 'typed') {
    return maskRef.typedValue;
  }

  return value;
}
export const IMaskInput = forwardRef<HTMLInputElement, IMaskInputProps>(
  (props, ref) => {
    const innerRef = useRef<HTMLInputElement>(null);

    const { value, unmask, inputRef, onAccept, onComplete } = props;
    const [maskOptions, inputProps] = splitProps(props);

    const { maskRef } = useIMask(maskOptions, {
      ref: innerRef,
      onAccept: (value: any, maskRef: any, event: any) => {
        onAccept?.(getValue(value, maskRef, unmask), maskRef, event);
      },
      onComplete: (value: any, maskRef: any, event: any) => {
        onComplete?.(getValue(value, maskRef, unmask), maskRef, event);
      },
      defaultValue: value
    });

    useUpdateValue(maskRef, value, unmask);
    useHandleInputRefs(ref, innerRef, inputRef);

    return <input ref={innerRef} {...inputProps} />;
  }
);

IMaskInput.displayName = 'IMaskInput';

// when value changes from outside input, also update the mask input
function useUpdateValue(maskRef: any, value: any, unmask: any) {
  useEffect(() => {
    if (maskRef.current && value !== undefined) {
      const currentValue =
        unmask === true
          ? maskRef.current.unmaskedValue
          : unmask === 'typed'
          ? maskRef.current.typedValue
          : maskRef.current.value;

      if (value !== currentValue) {
        maskRef.current.value = value;
      }
    }
  }, [value, unmask]);
}

// manage the forwarded ref, the inputRef prop, and the internal innerRef
function useHandleInputRefs(ref: any, innerRef: any, inputRef: any) {
  useEffect(() => {
    if (ref) {
      if (typeof ref === 'function') {
        ref(innerRef.current);
      } else {
        ref.current = innerRef.current;
      }
    }
  }, [ref, innerRef.current]);

  useEffect(() => {
    if (inputRef) {
      if (typeof inputRef === 'function') {
        inputRef(innerRef.current);
      } else if (inputRef.current) {
        (inputRef as React.MutableRefObject<HTMLInputElement | null>).current =
          innerRef.current;
      }
    }
  }, [inputRef, innerRef.current]);
}
