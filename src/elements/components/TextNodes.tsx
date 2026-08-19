import React, { useMemo } from 'react';
import { isNum, stringifyWithNull } from '../../utils/primitives';
import Delta from 'quill-delta';
import useTextEdit from './useTextEdit';
import { hasIconGlyph, IconGlyph } from './icons/iconGlyph';
import { fieldValues, initInfo, initState } from '../../utils/init';
import { ACTION_NEXT } from '../../utils/elementActions';

export const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

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
          return pVal.join(', ');
        } else if (repeat >= pVal.length) {
          return stringifyWithNull(pVal[0]);
        } else {
          return stringifyWithNull(pVal[repeat]);
        }
      } else return stringifyWithNull(pVal);
    }
    // A real field the user hasn't filled renders empty, while a name that
    // matches no field stays literal so authors see what they typed.
    return initState.knownFieldKeys.has(pStr) ? '' : pattern;
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

  const iconEmbedNames = (element.properties.text_formatted ?? [])
    .filter((op: any) => typeof op.insert === 'object')
    .map((op: any) => op.insert?.icon)
    .join(',');

  editableProps.css = {
    ...editableProps.css,
    ...responsiveStyles.getTarget(cssTarget),
    // Remove baseline padding from labels that contain icons.
    ...(iconEmbedNames ? { paddingBottom: 0 } : {})
  };

  // Not using jsonpath because of issues with NextJS
  const extractProperty = (obj: any, path: string[]): any => {
    if (path.length === 0) return obj;
    const [key, ...rest] = path;
    if (obj[key] === undefined) return null;
    return extractProperty(obj[key], rest);
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
      // convert to path relative to featheryContext
      if (textSource.startsWith('feathery.'))
        textSource = textSource.replace('feathery.', '');
      textFromData = extractProperty(featheryContext, textSource.split('.'));
    }
    const textIsFromData =
      element.properties.text_mode === 'data' && textFromData !== null;
    const ops = delta.filter((op) => !!op.insert);
    const isIconOp = (op: any) =>
      typeof op.insert === 'object' && hasIconGlyph(op.insert?.glyph);
    const editingNow = editMode === 'editable' && focused;
    const iconOnly =
      !editingNow &&
      ops.some(isIconOp) &&
      ops.every(
        (op) =>
          isIconOp(op) || (typeof op.insert === 'string' && !op.insert.trim())
      );

    return (
      <span
        id={`span-${element.id}`}
        ref={spanRef}
        {...editableProps}
        // Remount browser-edited DOM only when icon membership changes.
        key={`${text}|${iconEmbedNames}`}
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
          ops.map((op, i) => {
            if (iconOnly && typeof op.insert === 'string') return null;
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

            // data-feathery-icon lets the builder restore embeds after editing.
            if (typeof op.insert === 'object') {
              const iconName = (op.insert as any)?.icon;
              const glyph = (op.insert as any)?.glyph;
              if (!hasIconGlyph(glyph)) return null;
              const iconStyles = {
                display: 'inline-flex',
                verticalAlign: '-0.125em',
                cursor,
                ...responsiveStyles.getRichFontStyles(attrs)
              };
              return link && !editMode ? (
                <a
                  key={i}
                  data-index={i}
                  data-feathery-icon={iconName}
                  css={iconStyles}
                  href={link}
                  target='_blank'
                  rel='noreferrer'
                >
                  <IconGlyph glyph={glyph} />
                </a>
              ) : (
                <span
                  key={i}
                  data-index={i}
                  data-feathery-icon={iconName}
                  contentEditable={editMode ? false : undefined}
                  onClick={onClick}
                  css={iconStyles}
                >
                  <IconGlyph glyph={glyph} />
                </span>
              );
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
