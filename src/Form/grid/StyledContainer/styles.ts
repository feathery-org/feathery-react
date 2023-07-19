import ResponsiveStyles from '../../../elements/styles';
import { isFill, isFit, isPx } from '../../../utils/hydration';
import { getElementType } from './utils';

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
  viewport?: 'desktop' | 'mobile' // Passed only by the editor, not hosted forms
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

      s.minWidth = 'min-content';
      s.width = '100%';

      if (node.isElement) {
        s.flex = '0 1 auto';

        if (isFill(widthUnit)) {
          s.maxWidth = '100%';
        }

        if (isFit(widthUnit)) {
          s.maxWidth = 'fit-content';
        }

        if (widthUnit === 'px' || widthUnit === '%') {
          if (getElementType(node) === 'checkbox') {
            s.maxWidth = 'max-content';
          } else {
            s.maxWidth = `${width}${widthUnit}`;
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

      if (parentAxis === 'column') {
        s.flexGrow = 0;
        s.flexShrink = 1;
        s.flexBasis = 'auto';
      }

      if (widthUnit === 'px') {
        s.maxWidth = `${width}${widthUnit}`;
      }

      if (isFit(width) || isFit(widthUnit)) {
        s.minWidth = 'min-content';
        s.maxWidth = 'fit-content';

        if (!hasChildren) {
          if (parentAxis === 'column') {
            s.minWidth = `${DEFAULT_MIN_SIZE}px`;
          } else {
            s.width = `${DEFAULT_MIN_SIZE}px`;
          }
        }
      }

      if (isFill(width) || isFill(widthUnit)) {
        s.maxWidth = '100%';

        if (parentAxis === 'column') {
          s.flexGrow = 1;
          s.flexShrink = 100;
        } else {
          s.width = '100%';
        }

        if (!hasChildren) {
          s.minWidth = `${DEFAULT_MIN_SIZE}px`;
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
      'parent_axis',
      'external_padding_top',
      'external_padding_bottom',
      'padding_top',
      'padding_bottom'
    ],
    (
      height: any,
      heightUnit: any,
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

      s.minHeight = 'fit-content';
      s.height = 'auto';

      if (node.isElement) {
        s.flex = '0 1 auto';

        if (isFill(heightUnit)) {
          s.maxHeight = '100%';
        }

        if (isFit(heightUnit)) {
          s.maxHeight = 'fit-content';
        }

        if (heightUnit === '%') {
          s.height = '100%';
          s.maxHeight = `${height}${heightUnit}`;

          if (parentAxis === 'column') {
            s.height = `100%`;
          }
        }

        if (yTotalMargin && s.height === '100%' && heightUnit !== 'px') {
          s.height = `calc(100% - ${yTotalMargin}px)`;
        }

        return s;
      }

      if (parentAxis === 'row') {
        s.flexGrow = 0;
        s.flexShrink = 0;
        s.flexBasis = 'auto';
      }

      // Pixel containers
      if (heightUnit === 'px') {
        s.minHeight = `${height}${heightUnit}`;
        s.maxHeight = `max-content`;
      }

      // Fit containers
      if (isFit(height) || isFit(heightUnit)) {
        s.maxHeight = 'fit-content';

        if (!hasChildren) {
          if (parentAxis === 'row') {
            s.minHeight = `${DEFAULT_MIN_SIZE}px`;
          } else {
            s.height = `${DEFAULT_MIN_SIZE}px`;
          }
        }
      }

      // Fill containers
      if (isFill(height) || isFill(heightUnit)) {
        s.maxHeight = '100%';

        if (parentAxis === 'row') {
          s.flexGrow = 1;
        } else {
          s.alignSelf = 'stretch';
        }

        if (!hasChildren) {
          s.minHeight = `${DEFAULT_MIN_SIZE}px`;
        }
      }

      if (yTotalMargin && s.height === '100%' && heightUnit !== 'px') {
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
    const s: any = {};

    // Apply visibility depending on if the node is from the editor or hosted forms.
    // (node.uuid indicates that the node is from the editor)
    if (node.uuid) {
      s.opacity = visibility === 'hidden' ? '0.25' : '1';
    } else {
      s.display = visibility === 'hidden' ? 'none' : 'flex';
    }

    return s;
  });

  /**
   * Apply root container styles
   */
  if (!node.parent) {
    styles.apply(
      'container',
      ['viewport', 'width', 'width_unit'],
      (_viewport: any, width: any, widthUnit: any) => {
        const vp = viewport || _viewport;
        const s: any = {};

        if (!isPx(widthUnit) && vp !== 'mobile') {
          s.boxSizing = 'content-box';
        }

        // The following styles allow Fill containers to shrink regardless of margin in their children on mobile viewport
        if (isFill(width)) {
          s.minWidth = 'auto';
          s.boxSizing = 'border-box';
        }

        return s;
      }
    );
  }

  return styles.getTarget('container', undefined, viewport === 'mobile');
};

export const getInnerContainerStyles = (
  node: any,
  rawNode?: any,
  viewport?: 'desktop' | 'mobile' // Passed only by the editor, not hosted forms
): ResponsiveStyles => {
  const hasChildren = node.children && node.children.length > 0;
  const styles = new ResponsiveStyles(
    rawNode ?? node,
    ['inner-container'],
    true
  );

  /**
   * Apply styles for when parent is the root without pixel dimensions
   */
  if (node.parent && !node.parent.parent && !node.isElement) {
    styles.apply(
      'inner-container',
      ['parent_width', 'viewport', 'width', 'width_unit'],
      (parentWidth: any, _viewport: any, width: any, widthUnit: any) => {
        const vp = viewport || _viewport;
        const s: any = {};

        if (!isPx(parentWidth) && widthUnit === 'px') {
          // Ensure to set `auto` if mobile to unset the desktop property
          s.minWidth = vp !== 'mobile' ? `${width}${widthUnit}` : 'auto';
        }

        return s;
      }
    );

    styles.apply(
      'inner-container',
      ['parent_height', 'viewport', 'height', 'height_unit'],
      (parentHeight: any, _viewport: any, height: any, heightUnit: any) => {
        const vp = viewport || _viewport;
        const s: any = {};

        if (!isPx(parentHeight) && heightUnit === 'px') {
          // Ensure to set `auto` if mobile to unset the desktop property
          s.minHeight = vp !== 'mobile' ? `${height}${heightUnit}` : 'auto';
        }

        return s;
      }
    );
  }

  /**
   * Apply height styles
   */
  styles.apply(
    'inner-container',
    ['height', 'height_unit'],
    (height: any, heightUnit: any) => {
      const s: any = {};

      if (node.isElement) {
        if (heightUnit === 'px') {
          s.minHeight = `${height}${heightUnit}`;
        }
      }

      return s;
    }
  );

  /**
   * Apply grid styles
   */
  if (hasChildren) {
    // Apply flex direction
    styles.apply('inner-container', ['axis'], (axis: any) => {
      return {
        flexDirection: axis === 'column' ? 'row' : 'column'
      };
    });

    // Apply gap
    styles.apply('inner-container', ['gap'], (gap: any) => {
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
    'inner-container',
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

  return styles.getTarget('inner-container', undefined, viewport === 'mobile');
};
