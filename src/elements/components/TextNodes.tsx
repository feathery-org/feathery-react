import React, { useMemo } from 'react';
import { isNum, stringifyWithNull } from '../../utils/primitives';
import Delta from 'quill-delta';
import useTextEdit from './useTextEdit';
import { openTab } from '../../utils/browser';
import { fieldValues } from '../../utils/init';
import { ACTION_NEXT } from '../../utils/elementActions';

export const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

export function replaceTextVariables(text: string, repeat: any) {
  if (!text) return '';

  return text.replace(TEXT_VARIABLE_PATTERN, (pattern: any) => {
    const pStr = pattern.slice(2, -2);
    if (pStr in fieldValues) {
      const pVal = fieldValues[pStr];
      if (Array.isArray(pVal)) {
        if (pVal.length === 0) {
          return pattern;
        } else if (isNaN(repeat) || repeat >= pVal.length) {
          return stringifyWithNull(pVal[0]);
        } else {
          return stringifyWithNull(pVal[repeat]);
        }
      } else return stringifyWithNull(pVal);
    } else return pattern;
  });
}

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
  responsiveStyles,
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
    const actions = element.properties.actions;
    if (actions.some((action: any) => action.type === ACTION_NEXT)) {
      conditions.forEach((cond: any) => {
        if (cond.element_type === 'text' && cond.element_id === element.id) {
          const start = cond.metadata.start;
          const end = cond.metadata.end;
          delta = applyNewDelta(delta, start, end);
        }
      });
    } else if (actions.length > 0) delta = applyNewDelta(delta);

    return (
      <span
        id={`span-${element.id}`}
        ref={spanRef}
        {...editableProps}
        key={text}
      >
        {delta
          .filter((op) => !!op.insert)
          .map((op, i) => {
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
                onClick = () => textSpanOnClick(attrs.start, attrs.end);
                cursor = 'pointer';
              }
            }

            const text = editMode
              ? (op.insert as string)
              : replaceTextVariables(op.insert as string, element.repeat);

            return (
              <span
                key={i}
                data-index={i}
                css={{
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'break-word',
                  cursor,
                  ...responsiveStyles.getRichFontStyles(attrs)
                }}
                onClick={onClick}
              >
                {text}
              </span>
            );
          })}
      </span>
    );
  }, [element, responsiveStyles, editableProps]);
}

export default TextNodes;
