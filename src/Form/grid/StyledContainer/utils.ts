import { getPxValue, isPx } from '../../../utils/hydration';

/**
 * Returns the type of the element that is being passed.
 * @param element - Element data
 * @returns {string | null}
 */
export const getElementType = (element: any) => {
  if (element?._type) return element._type;
  else if (element?.type) return element.type;
  else if (element?.servar?.type) return element.servar.type;
  return null;
};

export const isFillContainer = (div: HTMLDivElement) => {
  return Array.from(div.classList).includes('fill-container');
};

export const isFitContainer = (div: HTMLDivElement) => {
  return Array.from(div.classList).includes('fit-container');
};

export const isFitElement = (div: HTMLDivElement) => {
  return Array.from(div.classList).includes('fit-element');
};

export const getFieldValue = (obj: any, key: string, prefix = '') => {
  if (obj[`${prefix}${key}`]) return obj[`${prefix}${key}`];
  else return obj[key];
};

export const getStyle = (node: any, key: string, prefix = '') => {
  const styles = getFieldValue(node, 'styles', prefix);

  if (!styles[key]) {
    return node.styles[key];
  }

  return styles[key];
};

export const getStylePxValue = (style: any) => {
  if (isPx(style)) {
    return getPxValue(style);
  }

  return 0;
};

export const getImmediateDivs = (el: any) => {
  const children = [];

  for (let i = 0; i < el.childNodes.length; i++) {
    if (el.childNodes[i].nodeName === 'DIV') {
      children.push(el.childNodes[i]);
    }
  }

  return children;
};

/**
 * getRawNode
 * Returns the raw data of a node if necessary. `node.uuid` indicates that the node
 * is passed from the editor which means it needs to return `node.renderData`.
 */
export const getRawNode = (node: any) => {
  if (node.uuid) return node.renderData;
  else return node;
};

/**
 * hasDescendantFitNodes
 * Returns a boolean indicating whether the ref has descendant elements
 * that are Fit-width containers or elements.
 */
export const hasDescendantFitNodes = (ref: any) => {
  return (
    Array.from(ref.querySelectorAll('.fit-container')).length > 0 ||
    Array.from(ref.querySelectorAll('.fit-element')).length > 0
  );
};

/**
 * getParentFitContainers
 * Returns parent divs that are either a Fit-width container or element along
 * with utility functions for these divs.
 */
export const getParentFitContainers = (ref: any) => {
  const parents: any[] = [];

  if (!ref || !ref.parentNode) {
    return null;
  }

  const _getParentFitContainers = (div: any) => {
    const classes = Array.from(div.classList);

    if (classes.includes('fit-container')) {
      parents.push(div);
    }

    if (div.parentNode) {
      const parentClasses = Array.from(div.parentNode.classList);

      if (parentClasses.includes('styled-container')) {
        _getParentFitContainers(div.parentNode);
      }
    }
  };

  _getParentFitContainers(ref.parentNode);

  if (!parents.length) {
    return null;
  }

  // Capture the original maxWidth and width of all Fit-width parent containers
  const originalWidths = parents.map((parent: any) => ({
    width: parent.style.width,
    maxWidth: parent.style.maxWidth
  }));

  return {
    parents,
    expand: () => {
      // Allows expanding all the Fit-width containers to 100% width
      parents.forEach((parent: any) => {
        parent.style.maxWidth = '100%';
        parent.style.width = '100%';
      });
    },
    collapse: () => {
      // Collapses the parent Fit-width containers back to their original size
      parents.forEach((parent: any, i: number) => {
        parent.style.width = originalWidths[i].width;
        parent.style.maxWidth = originalWidths[i].maxWidth;
      });
    }
  };
};

export const resizeFitContainer = (div: any) => {
  const children = getImmediateDivs(div);

  if (!isFitContainer(div) || !children.length) {
    return; // Do nothing
  }

  // Expanding the width of the container to 100% allows to get an accurate size of it's children
  // if the container took up 100% of it's parent.
  div.style.maxWidth = '100%';
  div.style.width = '100%';

  const containerStyles = getComputedStyle(div);

  let childrenWidth = 0;

  // If the container is a "Column" axis, we add up the widths (or maxWidths) of it's children
  if (containerStyles.flexDirection === 'row') {
    childrenWidth = children.reduce((total: number, child: any) => {
      const childStyles = getComputedStyle(child);
      const childMaxWidth = childStyles.maxWidth;
      const childWidth = childStyles.width;
      let newTotal = total;

      if (isPx(childMaxWidth)) {
        newTotal += getPxValue(childMaxWidth);
      } else if (isPx(childWidth)) {
        newTotal += getPxValue(childWidth);
      } else {
        newTotal += child.offsetWidth;
      }

      if (isFitElement(child)) {
        newTotal +=
          getStylePxValue(childStyles.marginLeft) +
          getStylePxValue(childStyles.marginRight);
      }

      return newTotal;
    }, 0);

    childrenWidth +=
      getStylePxValue(containerStyles.gap) * (children.length - 1);
  } else {
    // If the container is a "Row" axis, we find the greatest width immediate child
    childrenWidth = children.reduce((greatest: number, child: any) => {
      if (isFillContainer(child)) {
        return greatest; // Disregard fill containers
      }

      const childStyles = getComputedStyle(child);
      const childMaxWidth = childStyles.maxWidth;
      const childWidth = childStyles.width;

      if (isPx(childMaxWidth)) {
        const val = getPxValue(childMaxWidth);

        if (val > greatest) {
          return val;
        }
      } else if (isPx(childWidth)) {
        const val = getPxValue(childWidth);

        if (val > greatest) {
          return val;
        }
      } else if (child.offsetWidth > greatest) {
        return child.offsetWidth;
      }

      return greatest;
    }, 0);
  }

  const containerMarginLeft = getStylePxValue(containerStyles.marginLeft);
  const containerMarginRight = getStylePxValue(containerStyles.marginRight);
  const totalMargin = containerMarginLeft + containerMarginRight;

  // Set the maxWidth to the calculated width of it's children and the width to 100% - total margin
  div.style.maxWidth = `${childrenWidth}px`;
  div.style.width = `calc(100% - ${totalMargin}px)`;
};
