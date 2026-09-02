import React, { useMemo } from 'react';
import { isNum, stringifyWithNull } from '../../utils/primitives';
import Delta from 'quill-delta';
import useTextEdit from './useTextEdit';
import { fieldValues, initInfo, initState } from '../../utils/init';
import { ACTION_NEXT } from '../../utils/elementActions';
import { formatNumberValue } from '../fields/TextField/mask';

export const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

/**
 * Renders one interpolated value. Number fields that opted into showing their
 * format carry their units and precision here; everything else stringifies
 * exactly as it always has.
 */
function renderValue(key: string, value: any) {
  const servar = initState.textVariableFormats[key];
  return servar ? formatNumberValue(servar, value) : stringifyWithNull(value);
}

export function replaceTextVariables(text: string, repeat?: any) {
  if (!text) return '';

  return text.replace(TEXT_VARIABLE_PATTERN, (pattern: any) => {
    const pStr = pattern.slice(2, -2);
    if (pStr === 'feathery_user_id') return initInfo().userId;
    if (pStr in fieldValues) {
      const pVal = fieldValues[pStr];
      if (Array.isArray(pVal)) {
        if (pVal.length === 0) {
          return '';
        } else if (isNaN(repeat)) {
          return pVal.map((entry) => renderValue(pStr, entry)).join(', ');
        } else if (repeat >= pVal.length) {
          return renderValue(pStr, pVal[0]);
        } else {
          return renderValue(pStr, pVal[repeat]);
        }
      } else return renderValue(pStr, pVal);
    }
    // A real field the user hasn't filled renders empty, while a name that
    // matches no field stays literal so authors see what they typed.
    return initState.knownFieldKeys.has(pStr) ? '' : pattern;
  });
}

// Not using jsonpath because of issues with NextJS
const extractProperty = (obj: any, path: string[]): any => {
  if (path.length === 0) return obj;
  const [key, ...rest] = path;
  if (obj[key] === undefined) return null;
  return extractProperty(obj[key], rest);
};

/**
 * The value a 'data' text mode element pulls out of featheryContext, or null
 * if the element isn't data bound or its source resolves to nothing.
 */
export function resolveDataText(element: any, featheryContext: any = {}) {
  if (element.properties.text_mode !== 'data') return null;
  let textSource = element.properties.text_source ?? '';
  // convert to path relative to featheryContext
  if (textSource.startsWith('feathery.'))
    textSource = textSource.replace('feathery.', '');
  return extractProperty(featheryContext, textSource.split('.'));
}

// A data value goes to React as a child, and React draws nothing for a boolean
// or a function. Stringifying those would report an empty label as content.
const asRenderedByReact = (value: any) =>
  typeof value === 'boolean' || typeof value === 'function'
    ? ''
    : stringifyWithNull(value);

/**
 * The plain text this element actually renders, with data sources and text
 * variables resolved. A label of only {{unfilled_field}} renders nothing, so
 * it reads as empty here even though properties.text is set.
 */
export function getRenderedText(
  element: any,
  featheryContext: any = {},
  editMode?: any
): string {
  const textFromData = resolveDataText(element, featheryContext);
  if (textFromData !== null) return asRenderedByReact(textFromData);
  return new Delta(element.properties.text_formatted)
    .filter((op: any) => !!op.insert)
    .map((op: any) =>
      editMode
        ? (op.insert as string)
        : replaceTextVariables(op.insert as string, element.repeat)
    )
    .join('');
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
  text,
  link,
  editMode
}: any) {
  const styles = {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    cursor,
    ...fontStyles
  };
  return link && !editMode ? (
    <a
      data-index={index}
      css={styles}
      href={link}
      target='_blank'
      rel='noreferrer'
    >
      {text}
    </a>
  ) : (
    <span data-index={index} css={styles} onClick={onClick}>
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
  featheryContext = {},
  expand = true
}: any) {
  const { spanRef, editableProps } = useTextEdit({
    editable: editMode === 'editable',
    focused,
    expand,
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
    const textFromData = resolveDataText(element, featheryContext);
    const textIsFromData = textFromData !== null;

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
            editMode={editMode}
          />
        ) : (
          delta
            .filter((op) => !!op.insert)
            .map((op, i) => {
              const attrs = op.attributes || {};
              let onClick = () => {};
              let cursor = 'inherit';
              let link = '';
              if (!editMode && !disabled) {
                if (attrs.font_link) {
                  link = replaceTextVariables(attrs.font_link, element.repeat);
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
                  link={link}
                  editMode={editMode}
                />
              );
            })
        )}
      </span>
    );
  }, [element, responsiveStyles, editableProps]);
}

export default TextNodes;
