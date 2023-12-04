import React, { useMemo } from 'react';
import { isNum, stringifyWithNull } from '../../utils/primitives';
import Delta from 'quill-delta';
import useTextEdit from './useTextEdit';
import { openTab } from '../../utils/browser';
import { fieldValues, initInfo } from '../../utils/init';
import { ACTION_NEXT } from '../../utils/elementActions';
import jsonpath from 'jsonpath';

export const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

export function replaceTextVariables(text: string, repeat: any) {
  if (!text) return '';

  return text.replace(TEXT_VARIABLE_PATTERN, (pattern: any) => {
    const pStr = pattern.slice(2, -2);
    if (pStr === 'feathery_user_id') return initInfo().userId;
    if (pStr in fieldValues) {
      const pVal = fieldValues[pStr];
      if (Array.isArray(pVal)) {
        if (pVal.length === 0) {
          return pattern;
        } else if (isNaN(repeat)) {
          return pVal.join(', ');
        } else if (repeat >= pVal.length) {
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

function TextNode({
  index,
  cursor,
  onClick = () => {},
  fontStyles,
  text
}: any) {
  return (
    <span
      data-index={index}
      css={{
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        cursor,
        ...fontStyles
      }}
      onClick={onClick}
    >
      {text}
    </span>
  );
}

function TextNodes({
  element,
  responsiveStyles,
  cssTarget = '',
  conditions = [],
  editMode,
  disabled = false,
  focused = false,
  textSpanOnClick = () => {},
  textCallbacks = {},
  featheryContext = {}
}: any) {
  const { spanRef, editableProps } = useTextEdit({
    editable: editMode === 'editable',
    focused,
    ...textCallbacks
  });

  editableProps.css = {
    ...editableProps.css,
    ...responsiveStyles.getTarget(cssTarget)
  };

  return useMemo(() => {
    const text = element.properties.text;
    let delta = new Delta(element.properties.text_formatted);
    const actions = element.properties.actions ?? [];
    if (actions.some((action: any) => action.type === ACTION_NEXT)) {
      conditions.forEach((cond: any) => {
        if (cond.element_type === 'text' && cond.element_id === element.id) {
          const start = cond.metadata.start;
          const end = cond.metadata.end;
          delta = applyNewDelta(delta, start, end);
        }
      });
    } else if (actions.length > 0) delta = applyNewDelta(delta);

    // If text_mode property is set to 'data', then we don't want to render the text_formatted
    // property, instead we the text from the data element specified in the text_source property
    let textFromData = null;

    if (element.properties.text_mode === 'data') {
      let textSource = element.properties.text_source ?? '';
      // convert to valid jsonpath
      if (textSource.startsWith('feathery'))
        textSource = textSource.replace('feathery', '$');
      try {
        textFromData = jsonpath.value(featheryContext, textSource);
      } catch (e) {
        // Ignoring errors due to things like unset text_source, deleted products etc.
      }
    }
    const textIsFromData =
      element.properties.text_mode === 'data' && textFromData !== null;

    return (
      <span
        id={`span-${element.id}`}
        ref={spanRef}
        {...editableProps}
        key={text}
      >
        {textIsFromData ? (
          <TextNode
            index={0}
            cursor='inherit'
            fontStyles={responsiveStyles.getRichFontStyles(
              element.properties?.text_formatted[0]?.attributes ?? {}
            )}
            text={textFromData}
          />
        ) : (
          delta
            .filter((op) => !!op.insert)
            .map((op, i) => {
              const attrs = op.attributes || {};
              let onClick = () => {};
              let cursor = 'inherit';
              if (!editMode && !disabled) {
                if (attrs.font_link) {
                  const link = replaceTextVariables(
                    attrs.font_link,
                    element.repeat
                  );
                  onClick = () => openTab(link);
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
                <TextNode
                  key={i}
                  index={i}
                  cursor={cursor}
                  fontStyles={responsiveStyles.getRichFontStyles(attrs)}
                  onClick={onClick}
                  text={text}
                />
              );
            })
        )}
      </span>
    );
  }, [element, responsiveStyles, editableProps]);
}

export default TextNodes;
