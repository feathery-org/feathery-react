import { getPxValue, isPx } from '../../../utils/hydration';
import { getFieldValue, getRawNode, getStyle } from './utils';

/**
 * _formatContainerStyles
 * Applies additional meta data to the node's styles for accurate rendering of styles using ResponsiveStyles.
 */
const _formatContainerStyles = (_node: any, fieldPrefix = '') => {
  const node = getRawNode(_node);
  const styles = JSON.parse(JSON.stringify(node[`${fieldPrefix}styles`] ?? {}));

  if (!_node.isElement) {
    for (const axis of ['width', 'height']) {
      let dimension = getFieldValue(node, axis, fieldPrefix);
      // Older Robin builds stored explicit mobile sizing only in mobile_styles.
      if (fieldPrefix && !node[`${fieldPrefix}${axis}`]) {
        const unit = styles[`${axis}_unit`];
        if (unit === 'fill' || unit === 'fit') dimension = unit;
        else if (unit === 'px' && typeof styles[axis] === 'number')
          dimension = `${styles[axis]}px`;
      }
      if (isPx(dimension)) {
        styles[axis] = getPxValue(dimension);
        styles[`${axis}_unit`] = 'px';
      } else {
        styles[axis] = dimension;
        if (dimension === 'fill' || dimension === 'fit')
          styles[`${axis}_unit`] = dimension;
      }
    }
  }

  styles.viewport = !fieldPrefix ? 'desktop' : 'mobile';
  styles.axis = getFieldValue(node, 'axis', fieldPrefix);

  if (_node.parent) {
    const parent = getRawNode(_node.parent);

    styles.parent_width = getFieldValue(parent, 'width', fieldPrefix);
    styles.parent_height = getFieldValue(parent, 'height', fieldPrefix);
    styles.parent_axis = getFieldValue(parent, 'axis', fieldPrefix) ?? null;

    const parentVerticalAlign =
      getStyle(parent, 'vertical_align', fieldPrefix) ?? null;
    const parentHorizontalAlign =
      getStyle(parent, 'horizontal_align', fieldPrefix) ?? null;

    styles.parent_vertical_align = parentVerticalAlign;
    styles.parent_horizontal_align = parentHorizontalAlign;
  }

  return styles;
};

export const formatContainerStyles = (node: any) => {
  return {
    styles: _formatContainerStyles(node),
    mobile_styles: _formatContainerStyles(node, 'mobile_')
  };
};
