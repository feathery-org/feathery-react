import React, { useMemo } from 'react';
import TextHoverTooltip from '../components/TextHoverTooltip';
import {
  applyCheckableInputStyles,
  composeCheckableInputStyle
} from './CheckboxField';

function MatrixField({
  element,
  responsiveStyles,
  fieldLabel,
  fieldVal = {},
  repeatIndex = null,
  onChange = () => {},
  elementProps = {},
  disabled = false,
  children
}: any) {
  const servar = element.servar;
  const allowMultiple = servar.metadata.multiple;
  const inputType = allowMultiple ? 'checkbox' : 'radio';

  const { backgroundColor, borderRadius } =
    responsiveStyles.getTarget('sub-fc');

  const styles = useMemo(() => {
    applyCheckableInputStyles(element, responsiveStyles);
    return responsiveStyles;
  }, [responsiveStyles]);

  const options = servar.metadata.options;
  const optionFraction = 100 / (options.length + 1);
  const widthStyle = { minWidth: '100px', width: `${optionFraction}%` };

  const firstColStyle = { ...widthStyle, fontWeight: 400, padding: 8 };

  return (
    <div
      css={{
        width: '100%',
        height: '100%',
        ...responsiveStyles.getTarget('fc'),
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}
      {...elementProps}
    >
      {children}
      {fieldLabel}
      <div style={{ display: 'flex', flexDirection: 'row', marginBottom: 6 }}>
        <div css={firstColStyle} />
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
      {servar.metadata.questions.map((q: any, i: number) => {
        const highlight = q.highlight_color
          ? `#${q.highlight_color}`
          : backgroundColor;
        return (
          <div
            key={i}
            style={{
              display: 'flex',
              flexDirection: 'row',
              backgroundColor: highlight,
              borderRadius,
              marginBottom: 6
            }}
          >
            <TextHoverTooltip text={q.tooltip}>
              <div css={firstColStyle}>{q.label}</div>
            </TextHoverTooltip>
            {options.map((opt: any, j: number) => {
              const questionVal = fieldVal[q.id];
              const isChecked =
                Array.isArray(questionVal) && questionVal.includes(opt);

              return (
                <div
                  key={j}
                  css={{
                    flex: 1,
                    justifyContent: 'center',
                    alignItems: 'center',
                    display: 'flex'
                  }}
                >
                  <input
                    type={inputType}
                    name={
                      repeatIndex !== null
                        ? `${servar.key}-${i}-${repeatIndex}`
                        : `${servar.key}-${i}`
                    }
                    aria-label={element.properties.aria_label}
                    data-question-id={q.id}
                    value={opt}
                    disabled={disabled || q.read_only}
                    checked={isChecked}
                    onChange={onChange}
                    css={composeCheckableInputStyle(
                      styles,
                      disabled,
                      !allowMultiple
                    )}
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
