import { FIT, MIN_AXIS_SIZE, getPxValue, isPx } from '../../../utils/hydration';
import { getFieldValue, getRawNode, getStyle } from './utils';

const getChildrenPxWidth = (_node: any, fieldPrefix = '') => {
  const node = getRawNode(_node);

  if (_node.isElement) {
    let totalWidth = 0;

    const widthUnit = getStyle(node, 'width_unit', fieldPrefix);
    if (widthUnit === 'px') {
      totalWidth += Number.parseFloat(getStyle(node, 'width', fieldPrefix));
    }

    const paddingLeft =
      Number.parseFloat(getStyle(node, 'padding_left', fieldPrefix)) || 0;
    const paddingRight =
      Number.parseFloat(getStyle(node, 'padding_right', fieldPrefix)) || 0;
    totalWidth += paddingLeft + paddingRight;

    return totalWidth;
  }

  if (!_node.isElement) {
    const width = getFieldValue(node, 'width', fieldPrefix);
    let totalWidth = 0;

    const marginLeft =
      getStyle(node, 'external_padding_left', fieldPrefix) || 0;
    const marginRight =
      getStyle(node, 'external_padding_right', fieldPrefix) || 0;
    totalWidth += marginLeft + marginRight;

    const gap = getStyle(node, 'gap', fieldPrefix) || 0;
    totalWidth += gap;

    if (isPx(width)) {
      return getPxValue(width);
    } else {
      const children = _node.children || [];

      if (children.length === 0) {
        return totalWidth + MIN_AXIS_SIZE;
      }

      return (
        totalWidth +
        children.reduce((total: number, n: any) => {
          return total + getChildrenPxWidth(n, fieldPrefix);
        }, 0)
      );
    }
  }

  return 0;
};

const getChildrenPercWidth = (_node: any, fieldPrefix = '') => {
  const children = _node.children || [];

  if (!children.length) {
    return 0;
  }

  const total = children.reduce((_total: number, n: any) => {
    const node = getRawNode(n);

    if (!n.isElement) {
      return _total;
    }

    const widthUnit = getStyle(node, 'width_unit', fieldPrefix);

    if (widthUnit === '%') {
      return _total + getStyle(node, 'width', fieldPrefix);
    }

    return _total;
  }, 0);

  return total > 100 ? 100 : total;
};

const getMaxWidth = (_node: any, fieldPrefix = '') => {
  const childrenPxWidth = getChildrenPxWidth(_node, fieldPrefix);
  const childrenPercWidth = getChildrenPercWidth(_node, fieldPrefix);

  return `calc(${childrenPxWidth}px + ${childrenPercWidth}%)`;
};

const getGreatestMaxWidth = (_node: any, fieldPrefix = '') => {
  if (_node.isElement) {
    return 0;
  }

  const children = _node.children || [];

  if (!children.length) {
    return getChildrenPxWidth(_node, fieldPrefix);
  }

  let max = 0;

  children.forEach((n: any) => {
    if (n.isElement) {
      const width = getChildrenPxWidth(n, fieldPrefix);

      if (width > max) {
        max = width;
      }
    }

    if (!n.isElement) {
      const node = getRawNode(n);
      const axis = getFieldValue(node, 'axis', fieldPrefix);

      if (axis === 'column') {
        const width = getChildrenPxWidth(n, fieldPrefix);

        if (width > max) {
          max = width;
        }
      } else {
        const node = getRawNode(n);
        const nodeWidth = getFieldValue(node, 'width', fieldPrefix);

        if (isPx(nodeWidth)) {
          const pxValue = getPxValue(nodeWidth);

          if (pxValue > max) {
            max = pxValue;
          }
        } else {
          const width = getGreatestMaxWidth(n, fieldPrefix);

          if (width > max) {
            max = width;
          }
        }
      }
    }
  });

  return max;
};

const getGreatestMaxPercWidth = (_node: any, fieldPrefix = '') => {
  if (_node.isElement) {
    return 0;
  }

  const children = _node.children || [];

  if (!children.length) {
    return 0;
  }

  let max = 0;

  children.forEach((n: any) => {
    if (n.isElement) {
      const node = getRawNode(n);
      const widthUnit = getStyle(node, 'width_unit', fieldPrefix);

      if (widthUnit === '%') {
        const width = getStyle(node, 'width', fieldPrefix);

        if (width > max) {
          max = width;
        }
      }
    }
  });

  return max;
};

const hasFitElements = (_node: any, fieldPrefix = '') => {
  if (!(_node.children || []).length) {
    return false;
  }

  return _node.children.some((n: any) => {
    if (!n.isElement) {
      return false;
    }

    const node = getRawNode(n);
    const widthUnit = getStyle(node, 'width_unit', fieldPrefix);

    if (widthUnit === FIT) {
      return true;
    }

    return false;
  });
};

const _formatContainerStyles = (_node: any, fieldPrefix = '') => {
  const node = getRawNode(_node);
  const styles = JSON.parse(JSON.stringify(node[`${fieldPrefix}styles`] ?? {}));

  if (!_node.isElement) {
    const nodeWidth = getFieldValue(node, 'width', fieldPrefix);
    const nodeHeight = getFieldValue(node, 'height', fieldPrefix);

    if (isPx(nodeWidth)) {
      styles.width = getPxValue(nodeWidth);
      styles.width_unit = 'px';
    } else {
      styles.width = nodeWidth;
    }

    if (isPx(nodeHeight)) {
      styles.height = getPxValue(nodeHeight);
      styles.height_unit = 'px';
    } else {
      styles.height = nodeHeight;
    }

    styles.max_width = getMaxWidth(_node, fieldPrefix);
    styles.has_fit_elements = hasFitElements(_node, fieldPrefix);
    styles.greatest_max_width = getGreatestMaxWidth(_node, fieldPrefix);
    styles.greatest_perc_max_width = getGreatestMaxPercWidth(
      _node,
      fieldPrefix
    );
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
