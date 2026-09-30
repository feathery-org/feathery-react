import { isAsciiTextField, toAscii } from './ascii';

export function asciiOption(option: any): any {
  if (typeof option === 'string')
    return { value: toAscii(option), label: option };
  if (option && typeof option.value === 'string')
    return { ...option, value: toAscii(option.value) };
  return option;
}

export function asciiElement(element: any, enabled: boolean): any {
  const servar = element.servar;
  if (!enabled || !isAsciiTextField(servar?.type)) return element;
  const metadata = servar.metadata ?? {};
  if (!metadata.options && !metadata.repeat_options) return element;

  const options = metadata.options?.map((option: any) =>
    typeof option === 'string' ? toAscii(option) : asciiOption(option)
  );
  const optionLabels = metadata.options?.map(
    (option: any, index: number) => metadata.option_labels?.[index] || option
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
