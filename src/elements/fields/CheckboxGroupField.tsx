import React, { useMemo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import {
  applyCheckableInputStyles,
  composeCheckableInputStyle
} from './CheckboxField';

const applyCheckboxGroupStyles = (element: any, applyStyles: any) => {
  applyStyles.addTargets(['checkboxGroup']);
  applyStyles.applyWidth('checkboxGroup');
  return applyStyles;
};

function CheckboxGroupField({
  element,
  applyStyles,
  fieldLabel,
  fieldVal = [],
  otherVal = '',
  onChange = () => {},
  onOtherChange = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const otherChecked = fieldVal.includes(otherVal);

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, applyStyles);
    applyCheckboxGroupStyles(element, applyStyles);

    return applyStyles;
  }, [applyStyles]);

  return (
    <div
      css={{
        position: 'relative',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {fieldLabel}
      {servar.metadata.options.map((opt: any, i: any) => {
        return (
          <ReactForm.Check
            type='checkbox'
            id={`${servar.key}-${i}`}
            key={`${servar.key}-${i}`}
            name={opt}
            label={opt}
            checked={fieldVal.includes(opt)}
            onChange={onChange}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: '18px',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckableInputStyle(styles, true),
              ...styles.getTarget('checkboxGroup')
            }}
          />
        );
      })}
      {servar.metadata.other && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            marginBottom: '18px',
            ...styles.getTarget('checkboxGroup')
          }}
        >
          <ReactForm.Check
            type='checkbox'
            id={`${servar.key}-`}
            key={`${servar.key}-`}
            name={otherVal}
            label='Other'
            checked={otherChecked}
            onChange={onChange}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={composeCheckableInputStyle(styles, true)}
          />
          <ReactForm.Control
            type='text'
            css={{
              marginLeft: '5px',
              width: 'initial',
              ...bootstrapStyles,
              ...applyStyles.getTarget('field'),
              '&:focus': applyStyles.getTarget('active'),
              '&:hover': applyStyles.getTarget('hover')
            }}
            id={servar.key}
            value={otherVal || ''}
            onChange={onOtherChange}
            maxLength={servar.max_length}
            minLength={servar.min_length}
            required={otherChecked}
            disabled={!otherChecked}
          />
        </div>
      )}
      {children}
    </div>
  );
}

export default CheckboxGroupField;
