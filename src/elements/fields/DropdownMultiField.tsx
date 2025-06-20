import React, { useRef, useState } from 'react';
import useBorder from '../components/useBorder';
import Select, {
  components as SelectComponents,
  OptionProps
} from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { hoverStylesGuard } from '../../utils/browser';
import InlineTooltip from '../components/InlineTooltip';
import { DROPDOWN_Z_INDEX } from './index';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { FORM_Z_INDEX } from '../../utils/styles';
import Placeholder from '../components/Placeholder';
import useSalesforceSync from '../../hooks/useSalesforceSync';

type OptionData = {
  tooltip?: string;
  value: string;
  label: string;
};

type Options = string[] | OptionData[];

const TooltipOption = ({ children, ...props }: OptionProps<OptionData>) => {
  let optComponent = (
    // @ts-ignore
    <SelectComponents.Option {...props}>{children}</SelectComponents.Option>
  );

  if (props.data.tooltip) {
    optComponent = (
      <OverlayTrigger
        placement='right'
        // @ts-expect-error
        container={() => props.selectProps.container?.current}
        overlay={
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
        }
      >
        <div>{optComponent}</div>
      </OverlayTrigger>
    );
  }

  return optComponent;
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
    error: inlineError
  });
  const containerRef = useRef(null);

  const [focused, setFocused] = useState(false);
  const servar = element.servar;
  const { dynamicOptions, loadingDynamicOptions } = useSalesforceSync(
    servar.metadata.salesforce_sync
  );

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

  const labels = servar.metadata.option_labels;
  const labelMap: Record<string, string> = {};
  let options;

  if (servar.metadata.salesforce_sync) {
    if (loadingDynamicOptions) options = [];
    else {
      options = dynamicOptions.map((option) => {
        labelMap[option.value] = option.label;
        return { value: option.value, label: option.label };
      });
    }
  } else if (
    repeatIndex !== null &&
    servar.metadata.repeat_options !== undefined &&
    servar.metadata.repeat_options[repeatIndex] !== undefined
  ) {
    const repeatOptions = servar.metadata.repeat_options[repeatIndex];
    options = addFieldValOptions(repeatOptions).map((option: any) => {
      const value = option.value ?? option;
      const label = option.label ?? option;
      labelMap[value] = label;
      const tooltip = option.tooltip ?? '';

      return { value: value, label, tooltip };
    });
  } else {
    options = addFieldValOptions(servar.metadata.options).map(
      (option: any, index: number) => {
        const label = labels && labels[index] ? labels[index] : option;
        labelMap[option] = label;
        const tooltip = servar.metadata.option_tooltips?.[index];
        return { value: option, label, tooltip };
      }
    );
  }
  const selectVal = fieldVal
    ? fieldVal.map((val: any) => ({
        label: labelMap[val],
        value: val
      }))
    : [];

  const hasTooltip = !!element.properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;
  const create = servar.metadata.creatable_options;
  const Component = create ? CreatableSelect : Select;

  responsiveStyles.applyFontStyles('field');
  return (
    <div
      // react-select doesn't support changing refs well,
      // so instead we save ref in state so changes cause rerenders
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
              paddingInlineEnd: 28
            }),
            // @ts-ignore
            multiValueLabel: (baseStyles) => ({
              ...baseStyles,
              // allow word wrap
              whiteSpace: 'normal',
              // line clamp to 3 lines
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
          components={{ Option: TooltipOption }}
          // @ts-ignore
          container={containerRef}
          inputId={servar.key}
          value={selectVal}
          required={required}
          isDisabled={disabled}
          onChange={onChange}
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
          container={containerRef}
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
          repeat={element.repeat}
        />
      </div>
    </div>
  );
}
