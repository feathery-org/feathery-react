import React, { useMemo, useState } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  applyHeightWidthMarginByFontSize,
  composeCheckableInputStyle
} from './CheckboxField';
import InlineTooltip from '../components/InlineTooltip';

const applyRadioGroupStyles = (element: any, responsiveStyles: any) => {
  responsiveStyles.addTargets('radioGroup');
  applyHeightWidthMarginByFontSize(responsiveStyles, 'radioGroup');
  return responsiveStyles;
};

function RadioButtonGroupField({
  element,
  responsiveStyles,
  fieldLabel,
  required = false,
  disabled = false,
  fieldVal = '',
  otherVal = '',
  onChange = () => {},
  onOtherChange = () => {},
  onEnter = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const [otherSelect, setOtherSelect] = useState({});
  const otherChecked =
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    (otherSelect[servar.key] || fieldVal) && fieldVal === otherVal;
  const otherTextDisabled = !otherChecked || disabled;
  const otherLabel = servar.metadata.other_label ?? 'Other';

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, responsiveStyles);
    applyRadioGroupStyles(element, responsiveStyles);
    responsiveStyles.apply('row', 'row_separation', (a: number) => {
      return { marginBottom: `${a || 5}px` };
    });
    return responsiveStyles;
  }, [responsiveStyles]);

  const labels = servar.metadata.option_labels;
  const tooltips = servar.metadata.option_tooltips ?? [];

  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        ...responsiveStyles.getTarget('fc'),
        position: 'relative'
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      {servar.metadata.options.map((opt: any, i: number) => {
        const optionLabel = labels && labels[i] ? labels[i] : opt;
        return (
          <div
            key={`${servar.key}-${i}`}
            css={{
              display: 'flex',
              ...styles.getTarget('row')
            }}
          >
            <input
              type='radio'
              id={`${servar.key}-${i}`}
              // All radio buttons in group must have same name to be evaluated
              // together
              name={servar.key}
              checked={fieldVal === opt}
              required={required}
              disabled={disabled}
              onChange={onChange}
              aria-label={element.properties.aria_label}
              value={opt}
              style={{
                padding: 0,
                lineHeight: 'normal'
              }}
              css={{
                ...composeCheckableInputStyle(styles, disabled, true),
                ...styles.getTarget('radioGroup'),
                ...(disabled ? responsiveStyles.getTarget('disabled') : {}),
                '&:focus-visible': { border: '1px solid rgb(74, 144, 226)' }
              }}
            />
            <label
              htmlFor={`${servar.key}-${i}`}
              css={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                ...styles.getTarget('checkboxLabel')
              }}
            >
              {optionLabel}
            </label>
            <InlineTooltip
              id={`${element.id}-${opt}`}
              text={tooltips[i]}
              responsiveStyles={responsiveStyles}
              absolute={false}
            />
          </div>
        );
      })}
      {servar.metadata.other && (
        <div style={{ display: 'flex' }}>
          <input
            type='radio'
            id={`${servar.key}-`}
            key={`${servar.key}-`}
            name={servar.key}
            checked={otherChecked}
            disabled={disabled}
            onChange={(e) => {
              setOtherSelect({
                ...otherSelect,
                [servar.key]: true
              });
              onChange(e);
            }}
            value={otherVal || ''}
            style={{
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckableInputStyle(styles, disabled, true),
              ...styles.getTarget('radioGroup'),
              ...(disabled ? responsiveStyles.getTarget('disabled') : {})
            }}
          />
          <label
            htmlFor={`${servar.key}-`}
            css={styles.getTarget('checkboxLabel')}
          >
            {otherLabel}
          </label>
          <ReactForm.Control
            type='text'
            // Paired with flex grow, will not expand parent width
            htmlSize={1}
            css={{
              marginLeft: '5px',
              ...bootstrapStyles,
              paddingLeft: '0.4rem',
              flexGrow: 1,
              ...responsiveStyles.getTarget('field'),
              ...(otherTextDisabled
                ? responsiveStyles.getTarget('disabled')
                : {})
            }}
            id={servar.key}
            value={otherVal || ''}
            onChange={onOtherChange}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter') onEnter(e);
            }}
            maxLength={servar.max_length}
            minLength={servar.min_length}
            required={otherChecked}
            disabled={otherTextDisabled}
          />
          <InlineTooltip
            id={`${element.id}-`}
            text={servar.metadata.other_tooltip}
            responsiveStyles={responsiveStyles}
            absolute={false}
          />
        </div>
      )}
    </div>
  );
}

export default RadioButtonGroupField;
