import React, { useMemo } from 'react';
import { isNum } from '../../utils/primitives';
import Delta from 'quill-delta';
import { stringifyWithNull } from '../../utils/string';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

function TextNodes({
  element,
  values,
  applyStyles,
  handleRedirect,
  conditions = []
}) {
  return useMemo(() => {
    let delta = new Delta(element.properties.text_formatted);
    conditions.forEach((cond) => {
      if (cond.element_type === 'text' && cond.element_id === element.id) {
        let start = cond.metadata.start;
        let end = cond.metadata.end;
        let fullSpan = false;
        if (start === undefined && end === undefined) {
          start = 0;
          end = element.properties.text.length;
          fullSpan = true;
        }
        delta = delta.compose(
          new Delta()
            .retain(start)
            .retain(end - start, { start, end, fullSpan })
        );
      }
    });
    return delta
      .filter((op) => op.insert)
      .map((op, i) => {
        let text = op.insert;
        if (values) {
          // replace placeholder variables and populate newlines
          text = op.insert.replace(TEXT_VARIABLE_PATTERN, (pattern) => {
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

        let onClick = () => {};
        let cursor = 'inherit';
        const attrs = op.attributes || {};
        if (attrs.font_link) {
          onClick = () => window.open(attrs.font_link, '_blank');
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

        return (
          <span
            key={i}
            css={{
              whiteSpace: 'pre-wrap',
              cursor,
              ...applyStyles.getRichFontStyles(attrs)
            }}
            onClick={onClick}
          >
            {text}
          </span>
        );
      });
  }, [element, applyStyles]);
}

export default TextNodes;
