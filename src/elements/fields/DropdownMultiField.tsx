import React, { useState } from 'react';
import useBorder from '../components/useBorder';
import Select, { components } from 'react-select';
import CreatableSelect from 'react-select/creatable';
import { featheryDoc, hoverStylesGuard } from '../../utils/browser';
import InlineTooltip from '../components/InlineTooltip';
import { DROPDOWN_Z_INDEX } from './index';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { FORM_Z_INDEX } from '../../utils/styles';

const TooltipOption = ({ children, ...props }: any) => {
  let optComponent = (
    <components.Option {...props}>{children}</components.Option>
  );

  if (props.data.tooltip) {
    optComponent = (
      <OverlayTrigger
        placement='right'
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
  editMode,
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError
  });
  const [focused, setFocused] = useState(false);

  const servar = element.servar;
  const labels = servar.metadata.option_labels;
  const labelMap: Record<string, string> = {};
  const options = servar.metadata.options.map((option: any, index: number) => {
    const label = labels && labels[index] ? labels[index] : option;
    labelMap[option] = label;
    const tooltip = servar.metadata.option_tooltips?.[index];
    return { value: option, label, tooltip };
  });
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
      css={{
        maxWidth: '100%',
        width: '100%',
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
              backgroundPosition: `right ${chevronPosition}px center`,
              position: 'relative'
            }),
            container: (baseStyles) => ({
              ...baseStyles,
              height: '100%',
              minHeight: 'inherit'
            }),
            indicatorSeparator: () => ({ display: 'none' }),
            indicatorsContainer: () => ({ display: 'none' }),
            menuPortal: (baseStyles) => ({
              ...baseStyles,
              zIndex: DROPDOWN_Z_INDEX
            })
          }}
          components={{ Option: TooltipOption }}
          id={servar.key}
          value={selectVal}
          required={required}
          isDisabled={disabled}
          onChange={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          noOptionsMessage={create ? () => null : undefined}
          options={options}
          isOptionDisabled={() =>
            servar.max_length && selectVal.length >= servar.max_length
          }
          isMulti
          menuPortalTarget={featheryDoc().body}
          placeholder=''
          aria-label={element.properties.aria_label}
        />
        <span
          css={{
            position: 'absolute',
            pointerEvents: 'none',
            left: '0.75rem',
            transition: '0.2s ease all',
            top: '50%',
            ...responsiveStyles.getTarget('placeholder'),
            ...(fieldVal.length > 0 || focused
              ? responsiveStyles.getTarget('placeholderFocus')
              : {}),
            ...(focused ? responsiveStyles.getTarget('placeholderActive') : {})
          }}
        >
          {element.properties.placeholder || ''}
        </span>
        <InlineTooltip
          id={element.id}
          text={element.properties.tooltipText}
          responsiveStyles={responsiveStyles}
        />
      </div>
    </div>
  );
}
