import React, { useMemo } from 'react';
import ReactForm from 'react-bootstrap/Form';
import { bootstrapStyles } from '../styles';
import { applyCheckboxStyles, composeCheckboxStyle } from './CheckboxField';

const applyCheckboxGroupStyles = (element, applyStyles) => {
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
  onClick = () => {},
  elementProps = {},
  children
}) {
  const servar = element.servar;
  const otherChecked = fieldVal.includes(otherVal);

  const styles = useMemo(() => {
    applyCheckboxStyles(element, applyStyles);
    applyCheckboxGroupStyles(element, applyStyles);

    return applyStyles;
  }, [applyStyles]);

  return (
    <div
      css={{
        display: 'flex',
        flexWrap: 'wrap',
        width: '100%',
        position: 'relative',
        ...applyStyles.getTarget('fc')
      }}
      {...elementProps}
    >
      {fieldLabel}
      {servar.metadata.options.map((opt, i) => {
        return (
          <ReactForm.Check
            type='checkbox'
            id={`${servar.key}-${i}`}
            key={`${servar.key}-${i}`}
            name={opt}
            label={opt}
            checked={fieldVal.includes(opt)}
            onChange={onChange}
            onClick={onClick}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              marginBottom: '18px',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={{
              ...composeCheckboxStyle(styles, true),
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
            onClick={onClick}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: 0,
              lineHeight: 'normal'
            }}
            css={composeCheckboxStyle(styles, true)}
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
            onClick={onClick}
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
