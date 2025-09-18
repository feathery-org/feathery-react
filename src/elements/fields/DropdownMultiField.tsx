import React, { useEffect, useRef, useState } from 'react';
import Select, {
  components as SelectComponents,
  OptionProps,
  GroupBase,
  ValueContainerProps,
  MultiValue,
  ActionMeta
} from 'react-select';
import useBorder from '../components/useBorder';
import CreatableSelect from 'react-select/creatable';
import { hoverStylesGuard } from '../../utils/browser';
import InlineTooltip from '../components/InlineTooltip';
import { DROPDOWN_Z_INDEX } from './index';
import { Tooltip } from '../components/Tooltip';
import { FORM_Z_INDEX } from '../../utils/styles';
import Placeholder from '../components/Placeholder';
import useSalesforceSync from '../../hooks/useSalesforceSync';
import Overlay from '../components/Overlay';

const MORE_INDICATOR_WIDTH = 80;

type OptionData = {
  tooltip?: string;
  value: string;
  label: string;
};

type Options = string[] | OptionData[];

const TooltipOption = ({ children, ...props }: OptionProps<OptionData>) => {
  const optionRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(false);

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
          // @ts-expect-error
          containerRef={props.selectProps.containerRef}
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

const CustomValueContainer = <
  Option,
  IsMulti extends boolean,
  Group extends GroupBase<Option>
>(
  props: ValueContainerProps<Option, IsMulti, Group>
) => {
  const ValueContainerWrapper =
    SelectComponents.ValueContainer as unknown as React.ComponentType<
      ValueContainerProps<Option, IsMulti, Group>
    >;

  const [moreCount, setMoreCount] = useState(0);

  const valueContainerRef = useRef<HTMLDivElement | null>(null);
  const moreIndicatorRef = useRef<HTMLDivElement | null>(null);

  const totalItems = props.getValue().length;

  // Calculate the total width of all the option items
  // in order to show the +N more indicator
  useEffect(() => {
    if (!valueContainerRef.current) return;

    const update = () => {
      const el = valueContainerRef.current;
      if (!el) return;

      const containerWidth = el.clientWidth;

      const optionItems = Array.from(
        el.querySelectorAll('.react-select__multi-value')
      ) as HTMLElement[];

      let itemTotalWidth = 0;

      for (let i = 0; i < optionItems.length; i++) {
        itemTotalWidth +=
          (optionItems[i]?.offsetLeft || 0) +
          (optionItems[i]?.offsetWidth || 0);

        if (itemTotalWidth > containerWidth - MORE_INDICATOR_WIDTH) {
          setMoreCount(totalItems - 1 - i);
          break;
        } else {
          setMoreCount(0);
        }
      }
    };

    update();

    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(valueContainerRef.current);

    return () => resizeObserver.disconnect();
  }, [props.getValue()]);

  const childrenContainer = [];
  const optionItemContainer = [];
  const inputContainer = [];

  if (totalItems > 0 && Array.isArray(props.children)) {
    // It is required to show the option item array and the input element separately
    // in order to show the +N more indicator, and
    // this indicator will be located between the option items and the input element

    let optionItems = props.children[0];

    if (Array.isArray(optionItems)) {
      optionItems = optionItems.slice(0, totalItems - moreCount);
    }

    optionItemContainer.push(optionItems);
    inputContainer.push(props.children[1]);
  } else {
    // Show all the children (the optional placeholder and input element)
    // if there is no selected item.

    childrenContainer.push(props.children);
  }

  return (
    <ValueContainerWrapper {...props} innerProps={{ ref: valueContainerRef }}>
      {childrenContainer}

      {optionItemContainer}
      {moreCount > 0 && (
        <div
          ref={moreIndicatorRef}
          style={{
            display: 'flex',
            justifyContent: 'center',
            width: `${MORE_INDICATOR_WIDTH}px`,
            backgroundColor: '#e6e6e6',
            padding: '2px 6px',
            fontSize: '15px',
            borderRadius: '2px',
            cursor: 'pointer'
          }}
        >
          +{moreCount} more
        </div>
      )}
      {inputContainer}
    </ValueContainerWrapper>
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [focused, setFocused] = useState(false);

  const servar = element.servar;
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

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

  const handleChange = (
    newValue: MultiValue<any>,
    actionMeta: ActionMeta<any>
  ) => {
    onChange(newValue, actionMeta);

    if (!isCompactOptions) {
      return;
    }

    // Manually set the focus to the input
    // when the option items, +N more indicator and the input element are generated by CustomValueContainer
    // This will be generated when the number of selected items are updated (add, update and delete => newValue.length < 2)
    if (
      (actionMeta.action === 'remove-value' ||
        actionMeta.action === 'select-option' ||
        actionMeta.action === 'clear') &&
      newValue.length < 2
    ) {
      setTimeout(() => {
        const inputEl = containerRef?.current?.querySelector<HTMLInputElement>(
          '.react-select__input'
        );
        inputEl?.focus();
      });
    }
  };

  const selectVal = fieldVal
    ? fieldVal.map((val: any) => ({ label: labelMap[val], value: val }))
    : [];

  const hasTooltip = !!element.properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;
  const create = servar.metadata.creatable_options;
  const Component = create ? CreatableSelect : Select;

  responsiveStyles.applyFontStyles('field');

  const isCompactOptions = element.styles.compact_options;

  // The width and height are fixed when the compact options checkbox is on

  const styleWidth = isCompactOptions
    ? `${element.styles.width}${element.styles.width_unit}`
    : '100%';

  const styleHeight = isCompactOptions
    ? `${element.styles.height}${element.styles.height_unit}`
    : '100%';

  const containerWidth = containerRef.current?.offsetWidth || 0;

  return (
    <div
      ref={containerRef}
      css={{
        maxWidth: styleWidth,
        width: styleWidth,
        height: styleHeight,
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
          classNamePrefix='react-select' // This is for the query selector of the option items and input
          hideSelectedOptions={!isCompactOptions} // Show the select option list if the compact options is on
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
            valueContainer: (baseStyles) => ({
              ...baseStyles,
              paddingInlineEnd: 28,
              ...(isCompactOptions && {
                display: 'flex',
                flexWrap: 'nowrap',
                overflow: 'hidden'
              })
            }),
            // @ts-ignore
            multiValue: (baseStyles) => ({
              ...baseStyles,
              // Set the minWidth in order to show the remove button (X) and label partially
              minWidth: isCompactOptions ? '40px' : 'unset'
            }),
            // @ts-ignore
            multiValueLabel: (baseStyles) => ({
              ...baseStyles,
              // Allow word wrap when the compact options is on
              whiteSpace: isCompactOptions ? 'nowrap' : 'normal',
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
            }),
            // @ts-ignore
            multiValueRemove: (baseStyles) => ({
              ...baseStyles,
              cursor: 'pointer'
            }),
            // @ts-ignore
            input: (baseStyles) => ({
              ...baseStyles,
              ...(isCompactOptions && {
                // Prevent the input element from breaking the container layout
                maxWidth: `${containerWidth / 2}px`,
                overflow: 'hidden',
                flexShrink: 1
              })
            })
          }}
          components={{
            Option: TooltipOption,
            ...(isCompactOptions && { ValueContainer: CustomValueContainer })
          }}
          // @ts-ignore
          containerRef={containerRef}
          inputId={servar.key}
          value={selectVal}
          required={required}
          isDisabled={disabled}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          noOptionsMessage={create ? () => null : undefined}
          options={options}
          isOptionDisabled={() =>
            (servar.max_length && selectVal.length >= servar.max_length) ||
            loadingDynamicOptions
          }
          isMulti
          placeholder=''
          aria-label={element.properties.aria_label}
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
