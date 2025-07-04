import { bootstrapStyles } from '../styles';

import React, { useEffect, useRef, useState } from 'react';
import InlineTooltip from '../components/InlineTooltip';
import useBorder from '../components/useBorder';
import countryData from '../components/data/countries';
import { getStateOptions, hasState } from '../components/data/states';
import { css, Global } from '@emotion/react';
import { hoverStylesGuard, iosScrollOnFocus } from '../../utils/browser';
import { fieldValues } from '../../utils/init';
import useSalesforceSync from '../../hooks/useSalesforceSync';

export default function DropdownField({
  element,
  responsiveStyles,
  fieldLabel,
  inlineError,
  required = false,
  disabled = false,
  fieldVal = '',
  repeatIndex = null,
  countryCode = '',
  editMode,
  rightToLeft,
  onChange = () => {},
  setRef = () => {},
  elementProps = {},
  children
}: any) {
  const { borderStyles, customBorder } = useBorder({
    element,
    error: inlineError,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });
  const [focused, setFocused] = useState(false);
  const [curCountry, setCurCountry] = useState(null);
  const containerRef = useRef(null);
  const servar = element.servar;
  const short = servar.metadata.store_abbreviation;
  const { dynamicOptions, loadingDynamicOptions, shouldSalesforceSync } =
    useSalesforceSync(servar.metadata.salesforce_sync, editMode);

  useEffect(() => {
    if (servar.type === 'gmap_state') {
      const code = countryCode.toLowerCase() || servar.metadata.default_country;
      if (code && fieldVal && !hasState(code, fieldVal, short, true)) {
        fieldVal = '';
        onChange({ target: { value: fieldVal } });
      }
      setCurCountry(code || 'us');
    }
  }, [countryCode, setCurCountry]);

  let options;
  if (shouldSalesforceSync) {
    options = dynamicOptions.map((option) => (
      <option key={option.value} value={option.value}>
        {option.label}
      </option>
    ));
  } else if (servar.type === 'gmap_state') {
    if (curCountry === null) options = [];
    else if (fieldVal && !hasState(curCountry, fieldVal, short)) {
      // If user selected a country without states defined
      options = [
        <option key={fieldVal} value={fieldVal}>
          {fieldVal}
        </option>
      ];
    } else
      options = getStateOptions(
        curCountry,
        short,
        servar.metadata.include_territories
      );
  } else if (servar.type === 'gmap_country') {
    options = countryData.map(({ countryCode, countryName }) => {
      const val = servar.metadata.store_abbreviation
        ? countryCode
        : countryName;
      return (
        <option key={countryCode} value={val}>
          {countryName}
        </option>
      );
    });
  } else {
    const labels = servar.metadata.option_labels;
    const tooltips = servar.metadata.option_tooltips;
    if (repeatIndex !== null && servar.metadata.repeat_options?.[repeatIndex]) {
      const repeatOptions = servar.metadata.repeat_options[repeatIndex];
      options = repeatOptions.map((option: any) => {
        const value = option.value ?? option;
        const label = option.label ?? option;
        const tooltip = option.tooltip ?? '';

        return (
          <option key={value} value={value} title={tooltip}>
            {label}
          </option>
        );
      });
    } else {
      options = servar.metadata.options.map((option: any, index: number) => {
        const label = labels && labels[index] ? labels[index] : option;
        const tooltip = tooltips?.[index] ?? '';
        const allVals = (fieldValues[servar.key] ?? []) as string[];
        if (
          servar.repeated &&
          servar.metadata.unique_repeat_options &&
          option !== fieldVal &&
          allVals.includes(option)
        )
          return null;
        return (
          <option key={option} value={option} title={tooltip}>
            {label}
          </option>
        );
      });
    }
  }

  const hasTooltip = !!element.properties.tooltipText;
  const chevronPosition = hasTooltip ? 30 : 10;

  responsiveStyles.applyFontStyles('field', !fieldVal);
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
        <Global
          styles={css`
            option {
              color: black;
            }
          `}
        />
        {customBorder}
        <select
          css={{
            ...bootstrapStyles,
            ...responsiveStyles.getTarget('field'),
            width: '100%',
            height: '100%',
            border: 'none',
            boxShadow: 'none',
            backgroundColor: 'transparent',
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            backgroundImage: `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6' fill='none'><path d='M0 0.776454L0.970744 0L5 4.2094L9.02926 0L10 0.776454L5 6L0 0.776454Z' fill='%23${element.styles.font_color}'/></svg>")`,
            backgroundRepeat: 'no-repeat',
            backgroundPosition: `${
              rightToLeft ? 'left' : 'right'
            } ${chevronPosition}px center`,
            [rightToLeft ? 'paddingLeft' : 'paddingRight']: 30,
            position: 'relative'
          }}
          id={servar.key}
          value={fieldVal ?? ''}
          required={required}
          disabled={disabled || loadingDynamicOptions}
          aria-label={element.properties.aria_label}
          onChange={onChange}
          onFocus={(event) => {
            setFocused(true);
            iosScrollOnFocus(event);
          }}
          onBlur={() => setFocused(false)}
          ref={setRef}
        >
          <option key='' value='' disabled={required} />
          {options}
        </select>
        <span
          css={{
            position: 'absolute',
            pointerEvents: 'none',
            [rightToLeft ? 'right' : 'left']: '0.75rem',
            transition: '0.2s ease all',
            top: '50%',
            ...responsiveStyles.getTarget('placeholder'),
            ...(fieldVal ? responsiveStyles.getTarget('placeholderFocus') : {}),
            [`input:focus + &`]: {
              ...responsiveStyles.getTarget('placeholderFocus'),
              ...responsiveStyles.getTarget('placeholderActive')
            }
          }}
        >
          {element.properties.placeholder || ''}
        </span>
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
