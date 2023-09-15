import React from 'react';

function MatrixField({
  element,
  responsiveStyles,
  fieldLabel,
  fieldVal = {},
  onChange = () => {},
  elementProps = {},
  children
}: any) {
  const servar = element.servar;
  const allDisabled = element.properties.disabled ?? false;
  const inputType = servar.metadata.multiple ? 'checkbox' : 'radio';

  const { backgroundColor, borderRadius, height } =
    responsiveStyles.getTarget('sub-fc');

  const options = servar.metadata.options;
  const optionFraction = 100 / (options.length + 1);
  const widthStyle = { minWidth: '100px', width: `${optionFraction}%` };
  return (
    <div
      css={{
        width: '100%',
        ...responsiveStyles.getTarget('fc'),
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        height
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div style={{ display: 'flex', flexDirection: 'row', marginBottom: 6 }}>
        <div style={widthStyle} />
        {options.map((opt: any, i: number) => {
          // headers
          return (
            <div
              key={i}
              style={{
                flex: 1,
                fontWeight: 600,
                justifyContent: 'center',
                alignItems: 'center',
                display: 'flex',
                textAlign: 'center'
              }}
            >
              {opt}
            </div>
          );
        })}
      </div>
      {servar.metadata.questions.map((question: any, i: number) => {
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'row',
              backgroundColor: backgroundColor,
              borderRadius: borderRadius,
              marginBottom: 6
            }}
          >
            <div style={{ ...widthStyle, fontWeight: 400, padding: 8 }}>
              {question.label}
            </div>
            {options.map((opt: any, j: number) => {
              const questionVal = fieldVal[question.id];
              const isChecked =
                Array.isArray(questionVal) && questionVal.includes(opt);

              return (
                <div
                  key={j}
                  style={{ flex: 1, justifyContent: 'center', display: 'flex' }}
                >
                  <input
                    type={inputType}
                    name={`${servar.key}-${i}`}
                    data-question-id={question.id}
                    value={opt}
                    disabled={allDisabled}
                    checked={isChecked}
                    onChange={onChange}
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export default MatrixField;
