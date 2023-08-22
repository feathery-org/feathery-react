import React from 'react';

function MatrixField({
  element,
  responsiveStyles,
  fieldLabel,
  required = false,
  fieldVal = {},
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;

  const allDisabled = element.properties.disabled ?? false;
  const labels = servar.metadata.option_labels;
  return (
    <div
      css={{
        width: '100%',
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
          <div key={`${servar.key}-${i}`} css={{ display: 'flex' }}>
            <input
              type='radio'
              id={`${servar.key}-${i}`}
              // All radio buttons in group must have same name to be evaluated
              // together
              name={servar.key}
              checked={fieldVal === opt}
              required={required}
              disabled={allDisabled}
              onChange={onChange}
              value={opt}
              style={{
                marginBottom: '18px',
                padding: 0,
                lineHeight: 'normal'
              }}
            />
            <label htmlFor={`${servar.key}-${i}`}>{optionLabel}</label>
          </div>
        );
      })}
    </div>
  );
}

export default MatrixField;
