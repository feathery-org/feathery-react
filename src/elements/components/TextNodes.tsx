import React, { useMemo } from 'react';
import { isNum, stringifyWithNull } from '../../utils/primitives';
import Delta from 'quill-delta';
import useTextEdit from './useTextEdit';
import { openTab } from '../../utils/browser';
import { LINK_NEXT, LINK_NONE } from '../basic/ButtonElement';

const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

const applyNewDelta = (
  delta: any,
  start?: number | undefined,
  end?: number | undefined
) => {
  if (start !== undefined && end !== undefined)
    return delta.compose(
      new Delta().retain(start).retain(end - start, { start, end })
    );
  else
    return delta.compose(
      new Delta().retain(delta.length(), { fullSpan: true })
    );
};

function TextNodes({
  element,
  values,
  applyStyles,
  conditions = [],
  editMode,
  focused = false,
  textSpanOnClick = () => {},
  textCallbacks = {}
}: any) {
  const { spanRef, editableProps } = useTextEdit({
    editable: editMode === 'editable',
    focused,
    ...textCallbacks
  });

  return useMemo(() => {
    const text = element.properties.text;
    let delta = new Delta(element.properties.text_formatted);
    const link = element.properties.link;
    if (link === LINK_NEXT) {
      conditions.forEach((cond: any) => {
        if (cond.element_type === 'text' && cond.element_id === element.id) {
          const start = cond.metadata.start;
          const end = cond.metadata.end;
          delta = applyNewDelta(delta, start, end);
        }
      });
    } else if (link !== LINK_NONE) delta = applyNewDelta(delta);

    return (
      <span
        id={`span-${element.id}`}
        ref={spanRef}
        {...editableProps}
        key={text}
      >
        {delta
          // @ts-expect-error TS(2322): Type 'string | object | undefined' is not assignab... Remove this comment to see the full error message
          .filter((op) => op.insert)
          .map((op, i) => {
            let text: any = op.insert;
            if (values) {
              // replace placeholder variables and populate newlines
              text = text.replace(TEXT_VARIABLE_PATTERN, (pattern: any) => {
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
            if (!editMode) {
              if (attrs.font_link) {
                onClick = () => openTab(attrs.font_link);
                cursor = 'pointer';
              } else if (
                attrs.fullSpan ||
                (isNum(attrs.start) && isNum(attrs.end))
              ) {
                onClick = () =>
                  textSpanOnClick(element, attrs.start, attrs.end);
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
