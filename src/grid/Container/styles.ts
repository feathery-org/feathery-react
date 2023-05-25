import ResponsiveStyles from '../../elements/styles';
import { isFill, isFit, isPx } from '../../utils/hydration';

export const DEFAULT_MIN_FILL_SIZE = 10;
export const DEFAULT_MIN_SIZE = 50;

export const getCellStyle = (cell: any, viewport?: 'desktop' | 'mobile') => {
  const styles = new ResponsiveStyles(cell, [
    'cell',
    'cellHover',
    'cellActive'
  ]);
  styles.applyBorders({ target: 'cell' });
  styles.applyCorners('cell');
  styles.applyBoxShadow('cell');
  styles.applyBackgroundImageStyles('cell');
  styles.apply('cell', 'background_color', (c: any) => ({
    backgroundColor: c ? `#${c}` : null
  }));
  styles.applySelectorStyles('cellActive', 'selected_', true);
  styles.applySelectorStyles('cellHover', 'hover_');

  return [
    styles.getTarget('cell', undefined, viewport === 'mobile'),
    styles.getTarget('cellHover', undefined, viewport === 'mobile'),
    styles.getTarget('cellActive', undefined, viewport === 'mobile')
  ];
};

export const getContainerStyles = (
  node: any,
  rawNode?: any,
  viewport?: 'desktop' | 'mobile'
): ResponsiveStyles => {
  const hasChildren = node.children && node.children.length > 0;
  const styles = new ResponsiveStyles(rawNode ?? node, ['container'], true);

  // Apply flex basis rule
  if (node.parent) {
    styles.apply('container', ['parent_height'], (parentHeight: any) => {
      return {
        flexBasis: isFit(parentHeight) || !node.isElement ? 0 : 'fit-content'
      };
    });
  }

  /**
   * Apply width styles
   */
  styles.apply(
    'container',
    [
      'width',
      'width_unit',
      'children_width',
      'parent_vertical_align',
      'parent_horizontal_align',
      'parent_axis',
      'external_padding_left',
      'external_padding_right',
      'padding_left',
      'padding_right',
      'content_responsive'
    ],
    (
      width: any,
      widthUnit: any,
      childrenWidth: any,
      parentVerticalAlign: any,
      parentHorizontalAlign: any,
      parentAxis: any,
      marginLeft: any,
      marginRight: any,
      paddingLeft: any,
      paddingRight: any,
      contentResponsive: any
    ) => {
      const s: any = {};
      const xTotalMargin = node.isElement
        ? paddingLeft + paddingRight
        : marginLeft + marginRight;

      if (widthUnit === 'px') {
        s.minWidth = 'min-content';
        s.width = '100%';

        if (parentAxis === 'column') {
          s.flexBasis = '100%';
        }

        s.maxWidth = `${width}${widthUnit}`;
      } else if (isFit(width)) {
        s.width = 'fit-content !important';
        s.minWidth = 'min-content';
        s.maxWidth = childrenWidth ? `${childrenWidth}px` : 'fit-content';

        if (!hasChildren && !node.isElement) {
          if (parentAxis === 'column') {
            s.width = 'auto';
            s.flexBasis = `${DEFAULT_MIN_SIZE}px`;
            s.minWidth = `${DEFAULT_MIN_SIZE}px`;
            s.flexGrow = 0;
            s.flexShrink = 0;
          } else {
            s.width = `${DEFAULT_MIN_SIZE}px`;
            s.maxWidth = `${DEFAULT_MIN_SIZE}px`;
          }
        } else if (parentAxis === 'column') {
          s.flexBasis = '100%';
        }
      } else if (isFill(width)) {
        if (
          !(parentVerticalAlign || parentHorizontalAlign) &&
          parentAxis === 'column'
        ) {
          s.alignSelf = 'stretch';
        }

        s.width = 'auto';
        s.minWidth = 'min-content';

        if (parentAxis === 'column') {
          s.flexGrow = 1;
          s.flexShrink = 0;
        } else {
          s.width = '100%';
        }
      } else if (widthUnit === '%') {
        if (parentAxis === 'column') {
          s.flexBasis = `${width}${widthUnit}`;
          s.minWidth = 'min-content';
        } else {
          s.width = `${width}${widthUnit}`;
        }
      }

      if (xTotalMargin && s.width) {
        s.width = `calc(${s.width} - ${xTotalMargin}px)`;
      }

      if (contentResponsive) {
        s.minWidth = 'fit-content !important';
      }

      return s;
    }
  );

  /**
   * Apply height styles
   */
  styles.apply(
    'container',
    [
      'height',
      'height_unit',
      'parent_vertical_align',
      'parent_horizontal_align',
      'parent_axis',
      'external_padding_top',
      'external_padding_bottom',
      'padding_top',
      'padding_bottom'
    ],
    (
      height: any,
      heightUnit: any,
      parentVerticalAlign: any,
      parentHorizontalAlign: any,
      parentAxis: any,
      marginTop: any,
      marginBottom: any,
      paddingTop: any,
      paddingBottom: any
    ) => {
      const s: any = {};
      const yTotalMargin = node.isElement
        ? paddingTop + paddingBottom
        : marginTop + marginBottom;

      if (heightUnit === 'px') {
        s.minHeight = 'fit-content';
        s.height = 'auto';

        if (parentAxis === 'row') {
          s.flexBasis = `${height}${heightUnit}`;
          s.flexGrow = 0;
          s.flexShrink = 0;
        }
      } else if (isFit(height)) {
        s.height = 'fit-content !important';
        s.maxHeight = 'fit-content';
        s.minHeight = 'min-content';

        if (!hasChildren && !node.isElement) {
          if (parentAxis === 'row') {
            s.height = 'auto';
            s.flexBasis = `${DEFAULT_MIN_SIZE}px`;
            s.flexGrow = 0;
            s.flexShrink = 0;
          } else {
            s.height = `${DEFAULT_MIN_SIZE}px`;
            s.maxHeight = `${DEFAULT_MIN_SIZE}px`;
          }
        }
      } else if (isFill(height)) {
        if (
          !(parentVerticalAlign || parentHorizontalAlign) &&
          parentAxis === 'row'
        ) {
          s.alignSelf = 'stretch';
        }

        s.height = 'auto';
        s.minHeight = node.parent
          ? 'min-content'
          : `${DEFAULT_MIN_FILL_SIZE}px`;

        if (parentAxis === 'row') {
          s.flexGrow = 1;
          s.flexShrink = 0;
        } else if (!node.parent) {
          s.minHeight = '100%';
        } else {
          s.height = '100%';
        }
      } else if (heightUnit === '%') {
        if (parentAxis === 'row') {
          s.flexBasis = `${height}${heightUnit}`;
          s.minHeight = 'min-content';
        } else {
          s.height = `${height}${heightUnit}`;
        }
      }

      if (yTotalMargin && s.height === '100%') {
        s.height = `calc(100% - ${yTotalMargin}px)`;
      }

      return s;
    }
  );

  /**
   * Apply vertical self alignment
   */
  styles.apply(
    'container',
    ['vertical_layout', 'parent_axis'],
    (verticalLayout: any, parentAxis: any) => {
      const s: any = {};
      const alignDirection = parentAxis === 'row' ? 'justifySelf' : 'alignSelf';

      if (verticalLayout) {
        s[alignDirection] = verticalLayout;
      }

      return s;
    }
  );

  /**
   * Apply horizontal self alignment
   */
  styles.apply(
    'container',
    ['layout', 'parent_axis'],
    (layout: any, parentAxis: any) => {
      const s: any = {};
      const alignDirection = parentAxis === 'row' ? 'alignSelf' : 'justifySelf';

      if (layout) {
        let targetStyle = layout;

        if (targetStyle === 'left') targetStyle = 'flex-start';
        else if (targetStyle === 'right') targetStyle = 'flex-end';

        s[alignDirection] = targetStyle;
      }

      return s;
    }
  );

  /**
   * Apply styles for when parent is the root without pixel dimensions
   */
  if (node.parent && !node.parent.parent) {
    styles.apply(
      'container',
      ['parent_width', 'viewport', 'width', 'width_unit'],
      (parentWidth: any, viewport: any, width: any, widthUnit: any) => {
        const s: any = {};

        if (!isPx(parentWidth) && viewport !== 'mobile' && widthUnit === 'px') {
          s.minWidth = `${width}${widthUnit}`;
        }

        return s;
      }
    );

    styles.apply(
      'container',
      ['parent_height', 'viewport', 'height', 'height_unit'],
      (parentHeight: any, viewport: any, height: any, heightUnit: any) => {
        const s: any = {};

        if (
          !isPx(parentHeight) &&
          viewport !== 'mobile' &&
          heightUnit === 'px'
        ) {
          s.minHeight = `${height}${heightUnit}`;
        }

        return s;
      }
    );
  }

  /**
   * Apply empty root container styles
   */
  if (!node.parent && !hasChildren) {
    styles.apply(
      'container',
      ['height', 'width'],
      (height: any, width: any) => {
        const s: any = {};

        if (isFit(width)) s.minWidth = `${DEFAULT_MIN_SIZE}px`;
        if (isFit(height)) s.minHeight = `${DEFAULT_MIN_SIZE}px`;

        return s;
      }
    );
  }

  /**
   * Apply margin
   */
  styles.apply(
    'container',
    [
      'external_padding_top',
      'external_padding_right',
      'external_padding_bottom',
      'external_padding_left'
    ],
    (marginTop: any, marginRight: any, marginBottom: any, marginLeft: any) => {
      const s: any = {};

      s.marginTop = marginTop ?? 0;
      s.marginRight = marginRight ?? 0;
      s.marginBottom = marginBottom ?? 0;
      s.marginLeft = marginLeft ?? 0;

      return s;
    }
  );

  /**
   * Apply grid styles
   */
  if (hasChildren) {
    // Apply flex direction
    styles.apply('container', ['axis'], (axis: any) => {
      return {
        flexDirection: axis === 'column' ? 'row' : 'column'
      };
    });

    // Apply gap
    styles.apply('container', ['gap'], (gap: any) => {
      if (gap) {
        return {
          gap: `${gap}px`
        };
      }

      return {};
    });
  }

  // Apply alignment
  styles.apply(
    'container',
    ['vertical_align', 'horizontal_align', 'axis'],
    (verticalAlign: any, horizontalAlign: any, axis: any) => {
      const s: any = {};

      if (axis === 'column') {
        s.alignItems = verticalAlign ?? 'flex-start';
        s.justifyContent = horizontalAlign ?? 'left';
      } else {
        s.alignItems = horizontalAlign ?? 'flex-start';
        s.justifyContent = verticalAlign ?? 'left';
      }

      return s;
    }
  );

  // Apply padding
  styles.apply(
    'container',
    ['padding_top', 'padding_right', 'padding_bottom', 'padding_left'],
    (
      paddingTop: any,
      paddingRight: any,
      paddingBottom: any,
      paddingLeft: any
    ) => {
      const s: any = {};
      const style = node.isElement ? 'margin' : 'padding';

      if (paddingTop) s[`${style}Top`] = `${paddingTop}px`;
      if (paddingRight) s[`${style}Right`] = `${paddingRight}px`;
      if (paddingBottom) s[`${style}Bottom`] = `${paddingBottom}px`;
      if (paddingLeft) s[`${style}Left`] = `${paddingLeft}px`;

      return s;
    }
  );

  // Apply visibility
  styles.apply('container', 'visibility', (visibility: any) => {
    return {
      display: visibility === 'hidden' ? 'none' : 'flex'
    };
  });

  return styles.getTarget('container', undefined, viewport === 'mobile');
};
