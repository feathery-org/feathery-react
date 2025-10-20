import React, {
  ComponentType,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import useBorder from '../../components/useBorder';
import Select, {
  components as SelectComponents,
  MultiValueGenericProps,
  MultiValueProps,
  OptionProps,
  ValueContainerProps
} from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { hoverStylesGuard } from '../../../utils/browser';
import InlineTooltip from '../../components/InlineTooltip';
import { DROPDOWN_Z_INDEX } from '../index';
import { Tooltip } from '../../components/Tooltip';
import { FORM_Z_INDEX } from '../../../utils/styles';
import Placeholder from '../../components/Placeholder';
import useSalesforceSync from '../../../hooks/useSalesforceSync';
import Overlay from '../../components/Overlay';

type OptionData = {
  tooltip?: string;
  value: string;
  label: string;
};

type Options = string[] | OptionData[];

const TooltipOption = ({
  children,
  ...props
}: OptionProps<OptionData, true>) => {
  const optionRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const containerRef = (props.selectProps as any).containerRef as
    | React.RefObject<HTMLElement | null>
    | undefined;

  return (
    <div
      ref={optionRef}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* @ts-ignore */}
      <SelectComponents.Option {...props}>{children}</SelectComponents.Option>
      {props.data.tooltip && optionRef.current && (
        <Overlay
          targetRef={optionRef}
          containerRef={containerRef}
          show={showTooltip}
          placement='right'
        >
          <Tooltip
            id={`tooltip-${props.data.value}`}
            css={{
              zIndex: FORM_Z_INDEX + 1,
              padding: '.4rem 0',
              transition: 'opacity .10s linear',
              '.tooltip-inner': {
                maxWidth: '200px',
                padding: '.25rem .5rem',
                color: '#fff',
                textAlign: 'center',
                backgroundColor: '#000',
                borderRadius: '.25rem',
                fontSize: 'smaller'
              }
            }}
          >
            {props.data.tooltip}
          </Tooltip>
        </Overlay>
      )}
    </div>
  );
};

type ExtendedSelectProps = {
  collapsedCount: number;
  containerRef: React.RefObject<HTMLElement | null>;
  collapseSelected: boolean;
  isMeasuring: boolean;
  rowHeight: number | null;
  visibleCount: number;
};

const useCollapsibleValues = (
  containerRef: React.RefObject<HTMLElement | null>,
  values: { value: string }[],
  enabled: boolean
) => {
  const totalCount = values.length;
  const [visibleCount, setVisibleCount] = useState(totalCount);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [rowHeight, setRowHeight] = useState<number | null>(null);
  const [measurementTick, setMeasurementTick] = useState(0);
  const pendingMeasurementRef = useRef(false);
  const queuedMeasurementRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const lastWidthRef = useRef<number | null>(null);

  const valuesSignature = useMemo(
    () => values.map((item) => item.value).join('|'),
    [values]
  );

  const requestMeasurement = useCallback(() => {
    if (!enabled) return;

    if (pendingMeasurementRef.current) {
      queuedMeasurementRef.current = true;
      return;
    }

    pendingMeasurementRef.current = true;
    queuedMeasurementRef.current = false;
    if (containerRef.current) {
      const chip = containerRef.current.querySelector(
        '[data-feathery-multi-value="true"]'
      ) as HTMLElement | null;
      if (chip) {
        const rect = chip.getBoundingClientRect();
        const style = window.getComputedStyle(chip);
        const computedHeight =
          rect.height +
          parseFloat(style.marginTop || '0') +
          parseFloat(style.marginBottom || '0');
        setRowHeight((prev) => {
          if (prev === null) return computedHeight;
          return Math.abs(prev - computedHeight) > 0.5 ? computedHeight : prev;
        });
      }
    }
    setIsMeasuring(true);
    setVisibleCount(totalCount);
    setMeasurementTick((tick) => tick + 1);
  }, [containerRef, enabled, totalCount]);

  useEffect(() => {
    if (enabled) requestMeasurement();
  }, [enabled, requestMeasurement, valuesSignature]);

  useEffect(() => {
    if (!enabled) return;

    const node = containerRef.current;
    if (!node || typeof window === 'undefined') return;

    const Observer = window.ResizeObserver;
    if (!Observer) return;

    const observer = new Observer((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      const width = entry.contentRect.width;

      if (lastWidthRef.current === null) {
        lastWidthRef.current = width;
        requestMeasurement();
        return;
      }

      if (Math.abs(width - lastWidthRef.current) > 0.5) {
        lastWidthRef.current = width;
        requestMeasurement();
      }
    });

    observer.observe(node);

    return () => observer.disconnect();
  }, [containerRef, enabled, requestMeasurement]);

  useLayoutEffect(() => {
    if (!pendingMeasurementRef.current || typeof window === 'undefined') return;

    frameRef.current = window.requestAnimationFrame(() => {
      pendingMeasurementRef.current = false;

      const container = containerRef.current;
      let nextVisible = totalCount;

      if (enabled && container) {
        const chips = Array.from(
          container.querySelectorAll('[data-feathery-multi-value="true"]')
        ) as HTMLElement[];

        if (chips.length) {
          const firstTop = chips[0].offsetTop;
          nextVisible = chips.length;

          for (let index = 0; index < chips.length; index += 1) {
            if (chips[index].offsetTop - firstTop > 1) {
              nextVisible = index;
              break;
            }
          }

          const rect = chips[0].getBoundingClientRect();
          const style = window.getComputedStyle(chips[0]);
          const computedHeight =
            rect.height +
            parseFloat(style.marginTop || '0') +
            parseFloat(style.marginBottom || '0');
          setRowHeight((prev) => {
            if (prev === null) return computedHeight;
            return Math.abs(prev - computedHeight) > 0.5
              ? computedHeight
              : prev;
          });
        }
      }

      setVisibleCount((prev) => (prev === nextVisible ? prev : nextVisible));
      setIsMeasuring(false);

      if (containerRef.current) {
        lastWidthRef.current = containerRef.current.getBoundingClientRect().width;
      }

      if (queuedMeasurementRef.current) {
        queuedMeasurementRef.current = false;
        requestMeasurement();
      }
    });

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [enabled, measurementTick, requestMeasurement, totalCount]);

  useEffect(() => {
    if (!enabled) {
      setVisibleCount(totalCount);
      setIsMeasuring(false);
      setRowHeight(null);
      pendingMeasurementRef.current = false;
      queuedMeasurementRef.current = false;
      lastWidthRef.current = null;
    }
  }, [enabled, totalCount]);

  const collapsedCount = enabled
    ? Math.max(totalCount - visibleCount, 0)
    : 0;

  return {
    visibleCount: enabled ? visibleCount : totalCount,
    collapsedCount,
    isMeasuring: enabled ? isMeasuring : false,
    rowHeight: enabled ? rowHeight : null
  };
};

const CollapsibleMultiValue = (props: MultiValueProps<OptionData, true>) => {
  const selectProps = props.selectProps as typeof props.selectProps &
    ExtendedSelectProps;

  const cutoff = selectProps.visibleCount;
  const hideCompletely =
    selectProps.collapseSelected &&
    !selectProps.isMeasuring &&
    props.index >= cutoff;
  if (hideCompletely) return null;

  const BaseMultiValue = SelectComponents.MultiValue as ComponentType<
    MultiValueProps<OptionData, true>
  >;

  const innerPropsStyle =
    props.innerProps && 'style' in props.innerProps
      ? (props.innerProps.style as React.CSSProperties | undefined)
      : undefined;
  const shouldMaskDuringMeasure =
    selectProps.collapseSelected &&
    selectProps.isMeasuring &&
    props.index >= cutoff;
  const mergedInnerProps = {
    ...props.innerProps
  } as typeof props.innerProps & {
    style?: React.CSSProperties;
    'data-feathery-multi-value'?: string;
  };
  mergedInnerProps['data-feathery-multi-value'] = 'true';
  if (shouldMaskDuringMeasure) {
    mergedInnerProps.style = {
      ...innerPropsStyle,
      opacity: 0,
      pointerEvents: 'none'
    };
  } else if (innerPropsStyle) {
    mergedInnerProps.style = innerPropsStyle;
  }

  return (
    <BaseMultiValue
      {...props}
      selectProps={selectProps}
      innerProps={mergedInnerProps}
    />
  );
};

const CollapsedIndicator = ({ collapsedCount }: { collapsedCount: number }) =>
  collapsedCount > 0 ? (
    <span className='rs-collapsed-chip'>+{collapsedCount}</span>
  ) : null;

const CollapsibleMultiValueContainer = (
  props: MultiValueGenericProps<OptionData, true>
) => {
  const selectProps = props.selectProps as typeof props.selectProps &
    ExtendedSelectProps & {
      value?: readonly OptionData[] | null;
    };
  const BaseContainer = SelectComponents
    .MultiValueContainer as ComponentType<
    MultiValueGenericProps<OptionData, true>
  >;

  if (!selectProps.collapseSelected) {
    return <BaseContainer {...props} />;
  }

  const valueList = Array.isArray(selectProps.value)
    ? (selectProps.value as readonly OptionData[])
    : [];
  const currentIndex = valueList.findIndex(
    (option: OptionData) => option.value === props.data.value
  );
  const targetIndex = Math.max(selectProps.visibleCount - 1, 0);
  const showIndicator =
    selectProps.collapsedCount > 0 &&
    selectProps.visibleCount > 0 &&
    currentIndex >= 0 &&
    currentIndex === targetIndex;

  return (
    <BaseContainer {...props}>
      {props.children}
      {showIndicator ? (
        <CollapsedIndicator collapsedCount={selectProps.collapsedCount} />
      ) : null}
    </BaseContainer>
  );
};

const CollapsibleValueContainer = (
  props: ValueContainerProps<OptionData, true>
) => {
  const selectProps = props.selectProps as typeof props.selectProps &
    ExtendedSelectProps;
  const BaseValueContainer = SelectComponents.ValueContainer as ComponentType<
    ValueContainerProps<OptionData, true>
  >;

  if (!selectProps.collapseSelected) {
    return <BaseValueContainer {...props} />;
  }

  const shouldShowIndicator =
    selectProps.collapsedCount > 0 && selectProps.visibleCount === 0;

  const innerPropsStyle =
    props.innerProps && 'style' in props.innerProps
      ? (props.innerProps.style as React.CSSProperties | undefined)
      : undefined;
  const measuringStyles =
    selectProps.isMeasuring && selectProps.rowHeight
      ? {
          maxHeight: `${selectProps.rowHeight}px`,
          overflow: 'hidden'
        }
      : {};
  const mergedInnerProps = {
    ...props.innerProps
  } as typeof props.innerProps & {
    style?: React.CSSProperties;
    'data-feathery-value-container'?: string;
  };
  mergedInnerProps['data-feathery-value-container'] = 'true';
  if (Object.keys(measuringStyles).length) {
    mergedInnerProps.style = {
      ...innerPropsStyle,
      ...measuringStyles
    };
  } else if (innerPropsStyle) {
    mergedInnerProps.style = innerPropsStyle;
  }

  return (
    <BaseValueContainer
      {...props}
      innerProps={mergedInnerProps}
    >
      {props.children}
      {shouldShowIndicator ? (
        <CollapsedIndicator collapsedCount={selectProps.collapsedCount} />
      ) : null}
    </BaseValueContainer>
  );
};

export default function DropdownMultiField({
  element,
  responsiveStyles,
  fieldLabel,
  inlineError,
  required = false,
  disabled = false,
  fieldVal = [],
  repeatIndex = null,
  editMode,
  onChange = () => {},
  elementProps = {},
  rightToLeft,
  children
}: any) {
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });
  const containerRef = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  const servar = element.servar;
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

  const translation = element.properties.translate || {};
  const noOptionsMessage = translation.no_options
    ? () => translation.no_options as string
    : undefined;

  const addFieldValOptions = (options: Options) => {
    const newOptions = Array.isArray(options) ? [...options] : [];
    if (!fieldVal) return newOptions;

    fieldVal.forEach((val: string) => {
      if (typeof newOptions[0] === 'string') {
        // handle string[]
        if (!newOptions.includes(val)) newOptions.push(val);
      } else if (!newOptions.some((option: any) => option.value === val)) {
        // handle OptionData[]
        newOptions.push({ value: val, label: val });
      }
    });

    return newOptions;
  };

  const labels = servar.metadata.option_labels || [];
  const tooltips = servar.metadata.option_tooltips || [];

  const labelMap: Record<string, string> = {};
  let options: any[] = [];

  if (shouldSalesforceSync) {
    options = dynamicOptions.map((option) => {
      labelMap[option.value] = option.label;
      return { value: option.value, label: option.label };
    });
  } else if (
    repeatIndex !== null &&
    servar.metadata.repeat_options?.[repeatIndex] !== undefined
  ) {
    const repeatOptions = servar.metadata.repeat_options[repeatIndex];
    options = addFieldValOptions(repeatOptions).map((option) => {
      if (typeof option === 'string') {
        labelMap[option] = option;
        return { value: option, label: option, tooltip: '' };
      }
      labelMap[option.value] = option.label;
      return option;
    });
  } else {
    options = addFieldValOptions(servar.metadata.options).map(
      (option, index) => {
        if (typeof option === 'string') {
          labelMap[option] = labels[index] || option;

          return {
            value: option,
            label: labels[index] || option,
            tooltip: tooltips[index] || ''
          };
        }

        labelMap[option.value] = option.label;

        return option;
      }
    );
  }

  const selectVal = fieldVal
    ? fieldVal.map((val: any) => ({ label: labelMap[val], value: val }))
    : [];

  const collapseSelected = !!servar.metadata.collapse_selected_options;

  const { visibleCount, collapsedCount, isMeasuring, rowHeight } =
    useCollapsibleValues(containerRef, selectVal, collapseSelected);

  const hasTooltip = !!element.properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;
  const create = servar.metadata.creatable_options;
  let formatCreateLabel: ((inputValue: string) => string) | undefined;
  if (create && translation.create_option_label) {
    const template = translation.create_option_label;
    const hasValuePlaceholder = template.includes('{value}');
    formatCreateLabel = hasValuePlaceholder
      ? (inputValue: string) => template.replace(/\{value\}/g, inputValue)
      : (inputValue: string) => `${template} "${inputValue}"`;
  }
  const Component = create ? CreatableSelect : Select;
  const selectComponentsOverride = useMemo(
    () =>
      collapseSelected
        ? {
            Option: TooltipOption,
            MultiValue: CollapsibleMultiValue,
            MultiValueContainer: CollapsibleMultiValueContainer,
            ValueContainer: CollapsibleValueContainer
          }
        : { Option: TooltipOption },
    [collapseSelected]
  );

  responsiveStyles.applyFontStyles('field');

  return (
    <div
      ref={containerRef}
      css={{
        maxWidth: '100%',
        width: '100%',
        height: '100%',
        position: 'relative',
        pointerEvents: editMode ? 'none' : 'auto',
        ...responsiveStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div
        css={{
          position: 'relative',
          width: '100%',
          whiteSpace: 'nowrap',
          ...responsiveStyles.getTarget('sub-fc'),
          ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
          '&:hover': hoverStylesGuard(
            disabled
              ? {}
              : {
                  ...responsiveStyles.getTarget('hover'),
                  ...borderStyles.hover
                }
          ),
          '&&': focused
            ? {
                ...responsiveStyles.getTarget('active'),
                ...borderStyles.active
              }
            : {}
        }}
      >
        {customBorder}
        <Component
          styles={{
            // @ts-ignore
            control: (baseStyles) => ({
              ...baseStyles,
              ...responsiveStyles.getTarget('field'),
              width: '100%',
              height: '100%',
              minHeight: 'inherit',
              border: 'none',
              boxShadow: 'none',
              backgroundColor: 'transparent',
              backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='%23${element.styles.font_color}'/></svg>")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: `${
                rightToLeft ? 'left' : 'right'
              } ${chevronPosition}px center`,
              position: 'relative'
            }),
            // @ts-ignore
            container: (baseStyles) => ({
              ...baseStyles,
              height: '100%',
              minHeight: 'inherit'
            }),
            // @ts-ignore
            valueContainer: (baseStyles, state) => {
              const selectProps = state.selectProps as typeof state.selectProps &
                ExtendedSelectProps & { inputValue?: string };
              const shouldWrap =
                selectProps.isMeasuring ||
                !selectProps.collapseSelected ||
                !!selectProps.inputValue;

              return {
                ...baseStyles,
                paddingInlineEnd: 28,
                display: 'flex',
                minWidth: 0,
                flexWrap: shouldWrap ? 'wrap' : 'nowrap',
                alignItems: 'center',
                ...(collapseSelected
                  ? {
                      '& .rs-collapsed-chip': {
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 8px',
                        margin: '2px',
                        borderRadius: baseStyles.borderRadius ?? 2,
                        backgroundColor:
                          baseStyles.backgroundColor ??
                          'rgba(221, 221, 221, 0.8)',
                        color: baseStyles.color ?? '#333',
                        fontSize: baseStyles.fontSize ?? '0.85em'
                      }
                    }
                  : {})
              };
            },
            // @ts-ignore
            multiValueLabel: (baseStyles) => ({
              ...baseStyles,
              whiteSpace: 'normal',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3
            }),
            indicatorSeparator: () => ({ display: 'none' }),
            indicatorsContainer: () => ({ display: 'none' }),
            // @ts-ignore
            menu: (baseStyles) => ({
              ...baseStyles,
              zIndex: DROPDOWN_Z_INDEX,
              textAlign: 'start'
            })
          }}
          components={selectComponentsOverride}
          // @ts-ignore React Select doesn't type custom props on selectProps
          containerRef={containerRef}
          // @ts-ignore React Select doesn't type custom props on selectProps
          visibleCount={visibleCount}
          // @ts-ignore React Select doesn't type custom props on selectProps
          collapsedCount={collapsedCount}
          // @ts-ignore React Select doesn't type custom props on selectProps
          isMeasuring={isMeasuring}
          // @ts-ignore React Select doesn't type custom props on selectProps
          rowHeight={rowHeight}
          // @ts-ignore React Select doesn't type custom props on selectProps
          collapseSelected={collapseSelected}
          inputId={servar.key}
          value={selectVal}
          required={required}
          isDisabled={disabled}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          noOptionsMessage={create ? () => null : noOptionsMessage}
          options={options}
          isOptionDisabled={() =>
            (servar.max_length && selectVal.length >= servar.max_length) ||
            loadingDynamicOptions
          }
          isMulti
          placeholder=''
          aria-label={element.properties.aria_label}
          formatCreateLabel={formatCreateLabel || undefined}
        />
        <Placeholder
          value={selectVal.length || focused}
          element={element}
          responsiveStyles={responsiveStyles}
          repeatIndex={repeatIndex}
        />
        <InlineTooltip
          containerRef={containerRef}
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
          repeat={element.repeat}
        />
      </div>
    </div>
  );
}
