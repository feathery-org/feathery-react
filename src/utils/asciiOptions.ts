import { isAsciiTextField, toAscii } from './ascii';

// Option lists hold bare values or {value, label} objects.
export function optionValue(option: any): any {
  return option?.value ?? option;
}

function optionLabel(option: any): any {
  return typeof option === 'string'
    ? option
    : option?.label ?? optionValue(option);
}

// Every option keeps its shape. A bare string only becomes {value, label} when
// converting changes it: repeat_options and runtime picklists have no parallel
// label array, so the object is the only place the original display text fits.
export function asciiOption(option: any): any {
  if (typeof option === 'string') {
    const value = toAscii(option);
    return value === option ? option : { value, label: option };
  }
  if (option && typeof option.value === 'string')
    return { ...option, value: toAscii(option.value) };
  return option;
}

export function asciiElement(element: any, enabled: boolean): any {
  const servar = element.servar;
  if (!enabled || !isAsciiTextField(servar?.type)) return element;
  const metadata = servar.metadata ?? {};
  if (!metadata.options && !metadata.repeat_options) return element;

  // Default options carry labels in option_labels, so their values stay bare.
  const options = metadata.options?.map((option: any) =>
    typeof option === 'string' ? toAscii(option) : asciiOption(option)
  );
  const optionLabels = metadata.options?.map(
    (option: any, index: number) =>
      metadata.option_labels?.[index] || optionLabel(option)
  );
  const repeatOptions = metadata.repeat_options?.map((options: any) =>
    Array.isArray(options) ? options.map(asciiOption) : options
  );
  return {
    ...element,
    servar: {
      ...servar,
      metadata: {
        ...metadata,
        ...(options && { options, option_labels: optionLabels }),
        ...(repeatOptions && { repeat_options: repeatOptions })
      }
    }
  };
}
