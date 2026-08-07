import React, { useMemo } from 'react';
import { isNum, stringifyWithNull } from '../../utils/primitives';
import Delta from 'quill-delta';
import useTextEdit from './useTextEdit';
import { hasIconGlyph, IconGlyph } from './icons/iconGlyph';
import { fieldValues, initInfo } from '../../utils/init';
import { ACTION_NEXT } from '../../utils/elementActions';

export const TEXT_VARIABLE_PATTERN = /{{.*?}}/g;

// Chrome and Safari paint text selection with this blue. Pinning it explicitly
// is what lets an icon embed's manual highlight match the surrounding text
// instead of falling back to the `Highlight` system color, which is a different
// shade. Builder-only: it is applied in edit mode.
const SELECTION_BACKGROUND = '#b4d5fe';

export function replaceTextVariables(text: string, repeat?: any) {
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

  // Inline icon embeds (`{ insert: { icon: 'IconHeart' } }`) contribute no plain
  // text, so anything keyed off `properties.text` has to account for them
  // separately.
  const iconEmbedNames = (element.properties.text_formatted ?? [])
    .filter((op: any) => typeof op.insert === 'object')
    .map((op: any) => op.insert?.icon)
    .join(',');

  editableProps.css = {
    ...editableProps.css,
    ...responsiveStyles.getTarget(cssTarget),
    // The label's 2px bottom padding nudges plain text toward optical center,
    // but it pushes the glyph off center in an icon-only label. Drop it only
    // when an icon is present so existing text keeps its metrics.
    ...(iconEmbedNames ? { paddingBottom: 0 } : {})
  };

  // While typing, the browser can drop characters into bare text nodes that
  // sit outside the styled per-op spans (empty label, caret at the end, after
  // an icon embed). Those nodes inherit from this wrapper, so in edit mode
  // seed it with the last run's resolved font styles — appended text then
  // matches until blur re-serializes it into a proper op.
  // ponytail: heuristic — typing at a boundary BETWEEN differently-styled runs
  // still shows the last run's style until blur; per-caret-run inheritance
  // would need an input listener.
  if (editMode === 'editable') {
    const lastAttrs = (element.properties.text_formatted ?? []).at(
      -1
    )?.attributes;
    if (lastAttrs) {
      editableProps.css = {
        ...editableProps.css,
        ...responsiveStyles.getRichFontStyles(lastAttrs)
      };
    }
    // Icon embeds can't take the native selection highlight (see below), so we
    // paint it ourselves — which means pinning text selection to the same
    // color, or the two halves of one selection don't match.
    editableProps.css = {
      ...editableProps.css,
      '&::selection, & *::selection': {
        backgroundColor: SELECTION_BACKGROUND
      }
    };
  }

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

    return (
      <span
        id={`span-${element.id}`}
        ref={spanRef}
        {...editableProps}
        // Key on the icon names as well as the plain text: icon embeds
        // contribute no plain text, so an icon-only change (e.g. deleting an
        // icon in the contenteditable) must still remount the wrapper —
        // diffing children against browser-mutated DOM throws removeChild
        // NotFoundError. Attribute-only edits deliberately don't remount,
        // which would drop the user's selection mid-formatting.
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
          delta
            .filter((op) => !!op.insert)
            .map((op, i, ops) => {
              // Icon-only labels: whitespace-only text ops (e.g. a trailing
              // "\n") render as real spans beside the glyph and knock it off
              // center. When every string op is whitespace and an embed
              // exists, skip the whitespace — the icon(s) are the content.
              // EXCEPT while focused for editing: those spans are the only
              // caret targets, so they must stay clickable.
              const editingNow = editMode === 'editable' && focused;
              const iconOnly =
                !editingNow &&
                ops.some((o) => typeof o.insert === 'object') &&
                ops.every(
                  (o) =>
                    typeof o.insert === 'object' || !(o.insert as string).trim()
                );
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

              // Inline icon embed: `{ insert: { icon, glyph } }`, where `glyph`
              // holds the persisted shape data and `icon` is the name it was
              // picked under. The wrapper carries the op's resolved font styles
              // so the glyph (stroke = currentColor, 1em) tracks the run's color
              // and size. In edit mode the node is contenteditable=false and
              // tagged with data-feathery-icon so the builder's blur serializer
              // can map it back to its op.
              if (typeof op.insert === 'object') {
                const iconName = (op.insert as any)?.icon;
                const glyph = (op.insert as any)?.glyph;
                if (!hasIconGlyph(glyph)) return null;
                return (
                  <span
                    key={i}
                    data-index={i}
                    data-feathery-icon={iconName}
                    contentEditable={editMode ? false : undefined}
                    onClick={onClick}
                    css={{
                      display: 'inline-flex',
                      verticalAlign: '-0.125em',
                      cursor,
                      // Mirrors the native text selection — set by
                      // syncIconSelection in useTextEdit since browsers paint
                      // no highlight over an SVG in a contenteditable=false
                      // node. Uses the same color the label pins ::selection
                      // to, so a selection spanning text and icons is one
                      // continuous band.
                      '&[data-icon-selected]': {
                        backgroundColor: SELECTION_BACKGROUND
                      },
                      ...responsiveStyles.getRichFontStyles(attrs)
                    }}
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
