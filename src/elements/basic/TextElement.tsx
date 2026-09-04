import React, { useMemo } from 'react';
import TextNodes from '../components/TextNodes';
import { certificationNameProps } from '../fields/shared/certification';
import { isNum } from '../../utils/primitives';
import useBorder from '../components/useBorder';
import { hoverStylesGuard } from '../../utils/browser';

// TODO(peter): deprecate once customers have upgraded and backend migrated
function legacyAlignment(alignment: any) {
  if (!alignment) {
    return undefined;
  }

  switch (alignment) {
    case 'flex-start':
      return 'left';
    case 'flex-end':
      return 'right';
    default:
      return alignment;
  }
}

function applyTextStyles(element: any, responsiveStyles: any) {
  responsiveStyles.addTargets('text', 'textHover');
  responsiveStyles.apply('text', 'horizontal_align', (a: any) => ({
    textAlign: legacyAlignment(a)
  }));
  responsiveStyles.apply('text', 'line_height', (a: any) => ({
    lineHeight: isNum(a) ? `${a}px` : 'normal'
  }));
  responsiveStyles.apply('text', 'letter_spacing', (a: any) => ({
    letterSpacing: isNum(a) ? `${a}px` : 'normal'
  }));
  responsiveStyles.apply('text', 'text_transform', (a: any) => ({
    textTransform: a || 'none'
  }));
  responsiveStyles.applyColor('text', 'background_color', 'backgroundColor');
  responsiveStyles.applyCorners('text');
  responsiveStyles.apply(
    'text',
    [
      'uploader_padding_top',
      'uploader_padding_right',
      'uploader_padding_bottom',
      'uploader_padding_left'
    ],
    (a: any, b: any, c: any, d: any) => {
      // Guard per side: existing text elements have no uploader_padding_* keys
      const s: any = {};
      if (isNum(a)) s.paddingTop = `${a}px`;
      if (isNum(b)) s.paddingRight = `${b}px`;
      if (isNum(c)) s.paddingBottom = `${c}px`;
      if (isNum(d)) s.paddingLeft = `${d}px`;
      // The text box is width: 100%; keep padding inside that width like the
      // native <button> box model, or the box overflows its grid cell
      if (Object.keys(s).length) s.boxSizing = 'border-box';
      return s;
    }
  );

  responsiveStyles.applyColor(
    'textHover',
    `hover_background_color`,
    'backgroundColor',
    true
  );
  responsiveStyles.applySpanSelectorStyles('textHover', 'hover_');

  return responsiveStyles;
}

function TextElement({
  element,
  responsiveStyles,
  editMode,
  focused = false,
  textCallbacks = {},
  textSpanOnClick = () => {},
  conditions = [],
  elementProps = {},
  children,
  featheryContext
}: any) {
  const styles = useMemo(
    () => applyTextStyles(element, responsiveStyles),
    [responsiveStyles]
  );
  const { borderStyles, customBorder } = useBorder({
    element,
    corners: true,
    breakpoint: responsiveStyles.getMobileBreakpoint()
  });
  return (
    <div
      css={{
        position: 'relative',
        maxWidth: '100%',
        width: '100%',
        ...styles.getTarget('text'),
        '&:hover': hoverStylesGuard(
          editMode
            ? {}
            : {
                ...styles.getTarget('textHover'),
                ...borderStyles.hover
              }
        )
      }}
      {...certificationNameProps(element.properties?.text, element.key)}
      {...elementProps}
    >
      {customBorder}
      {children}
      <TextNodes
        element={element}
        responsiveStyles={responsiveStyles}
        textSpanOnClick={textSpanOnClick}
        conditions={conditions}
        editMode={editMode}
        focused={focused}
        textCallbacks={textCallbacks}
        featheryContext={featheryContext}
      />
    </div>
  );
}

export default TextElement;
