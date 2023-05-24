import { getPxValue, isPx } from '../../utils/hydration';
import { getRawNode } from './utils';

const getFieldValue = (obj: any, key: string, prefix = '') => {
  if (obj[`${prefix}${key}`]) return obj[`${prefix}${key}`];
  else return obj[key];
};

const _formatContainerStyles = (_node: any, fieldPrefix = '') => {
  const node = getRawNode(_node);
  const styles = JSON.parse(JSON.stringify(node[`${fieldPrefix}styles`] ?? {}));

  if (!_node.isElement) {
    const nodeWidth = getFieldValue(node, 'width', fieldPrefix);
    const nodeHeight = getFieldValue(node, 'height', fieldPrefix);
    const nodeChildren = _node.children || [];

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

    styles.children_width = nodeChildren.reduce((total: number, n: any) => {
      const child = getRawNode(n);
      const childWidth = getFieldValue(child, 'width', fieldPrefix);

      if (isPx(childWidth)) {
        return total + getPxValue(childWidth);
      }

      return total;
    }, 0);
  }

  styles.viewport = !fieldPrefix ? 'desktop' : 'mobile';
  styles.axis = getFieldValue(node, 'axis', fieldPrefix);

  if (_node.parent) {
    const parent = getRawNode(_node.parent);
    const parentStyles = parent[`${fieldPrefix}styles`] ?? {};

    styles.parent_width = getFieldValue(parent, 'width', fieldPrefix);
    styles.parent_height = getFieldValue(parent, 'height', fieldPrefix);
    styles.parent_axis = getFieldValue(parent, 'axis', fieldPrefix) ?? null;
    styles.parent_vertical_align = parentStyles.vertical_align ?? null;
    styles.parent_horizontal_align = parentStyles.horizontal_align ?? null;
  }

  return styles;
};

export const formatContainerStyles = (node: any) => {
  return {
    styles: _formatContainerStyles(node),
    mobile_styles: _formatContainerStyles(node, 'mobile_')
  };
};
