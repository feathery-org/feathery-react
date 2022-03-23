import React, { useMemo, useRef } from 'react';
import { isNum } from '../../utils/primitives';
import Delta from 'quill-delta';
import { stringifyWithNull } from '../../utils/string';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

const editableProps = ({
  onTextSelect = () => {},
  onTextKeyDown = () => {},
  onTextBlur = () => {},
  spanRef
}) => ({
  contentEditable: true,
  suppressContentEditableWarning: true,
  onSelect: () => onTextSelect(window.getSelection()),
  onKeyDown: (e) => onTextKeyDown(e, spanRef.current, window.getSelection()),
  onBlur: onTextBlur
});

function TextNodes({
  element,
  values,
  applyStyles,
  handleRedirect,
  conditions = [],
  editable = false,
  textCallbacks = {}
}) {
  const spanRef = useRef();

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
    const spanProps = editable
      ? editableProps({ ...textCallbacks, spanRef })
      : {};
    return (
      <span
        ref={spanRef}
        {...spanProps}
        css={{ outline: 'none', minWidth: '5px', display: 'inline-block' }}
        key={text}
      >
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
            let cursor = 'text';
            if (!editable) {
              cursor = 'inherit';
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
  }, [element, applyStyles]);
}

export default TextNodes;
