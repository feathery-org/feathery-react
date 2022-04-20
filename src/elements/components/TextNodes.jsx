import React, { useMemo } from 'react';
import { isNum } from '../../utils/primitives';
import Delta from 'quill-delta';
import { stringifyWithNull } from '../../utils/string';
import useTextEdit from './useTextEdit';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

function TextNodes({
  element,
  values,
  applyStyles,
  handleRedirect,
  conditions = [],
  editable = false,
  focused = false,
  textCallbacks = {}
}) {
  const { spanRef, editableProps } = useTextEdit({
    editable,
    focused,
    ...textCallbacks
  });

  return useMemo(() => {
    const text = element.properties.text;
    let delta = new Delta(element.properties.text_formatted);

    conditions.forEach((cond) => {
      if (cond.element_type === 'text' && cond.element_id === element.id) {
        let start = cond.metadata.start;
        let end = cond.metadata.end;
        let fullSpan = false;
        if (start === undefined && end === undefined) {
          start = 0;
          end = text.length;
          fullSpan = true;
        }
        delta = delta.compose(
          new Delta()
            .retain(start)
            .retain(end - start, { start, end, fullSpan })
        );
      }
    });
    return (
      <span ref={spanRef} {...editableProps} key={text}>
        {delta
          .filter((op) => op.insert)
          .map((op, i) => {
            let text = op.insert;
            if (values) {
              // replace placeholder variables and populate newlines
              text = text.replace(TEXT_VARIABLE_PATTERN, (pattern) => {
                const pStr = pattern.slice(2, -2);
                if (pStr in values) {
                  const pVal = values[pStr];
                  if (Array.isArray(pVal)) {
                    if (pVal.length === 0) {
                      return pattern;
                    } else if (
                      isNaN(element.repeat) ||
                      element.repeat >= pVal.length
                    ) {
                      return stringifyWithNull(pVal[0]);
                    } else {
                      return stringifyWithNull(pVal[element.repeat]);
                    }
                  } else return stringifyWithNull(pVal);
                } else return pattern;
              });
            }

            const attrs = op.attributes || {};
            let onClick = () => {};
            let cursor = 'inherit';
            if (!editable) {
              if (attrs.font_link) {
                onClick = () =>
                  window.open(attrs.font_link, '_blank', 'noopener noreferrer');
                cursor = 'pointer';
              } else if (isNum(attrs.start) && isNum(attrs.end)) {
                onClick = () => {
                  handleRedirect({
                    metadata: {
                      elementType: 'text',
                      elementIDs: [element.id],
                      trigger: 'click',
                      start: attrs.fullSpan ? undefined : attrs.start,
                      end: attrs.fullSpan ? undefined : attrs.end
                    }
                  });
                };
                cursor = 'pointer';
              }
            }

            return (
              <span
                key={i}
                data-index={i}
                css={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  cursor,
                  ...applyStyles.getRichFontStyles(attrs)
                }}
                onClick={onClick}
              >
                {text}
              </span>
            );
          })}
      </span>
    );
  }, [element, applyStyles, editableProps]);
}

export default TextNodes;
