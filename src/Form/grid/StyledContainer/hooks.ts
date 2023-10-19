import { useEffect, useMemo } from 'react';
import {
  getImmediateDivs,
  getParentFitContainers,
  getRawNode,
  getStyle,
  isFitContainer,
  isFitElement,
  resizeFitContainer,
  whichTransitionEvent
} from './utils';
import { formatContainerStyles } from './transform';
import {
  DEFAULT_MIN_SIZE,
  getCellStyle,
  getContainerStyles,
  getInnerContainerStyles
} from './styles';
import { isFill, isFit, isPx } from '../../../utils/hydration';
import { featheryDoc } from '../../../utils/browser';

/**
 * useFormattedNode
 * In order to purely use ResponsiveStyles on Containers for styles, useFormattedNode appends additional
 * meta data to the node's styles such as it's parent's axis, etc
 */
export const useFormattedNode = (_node: any, raw?: any) => {
  const [node, rawNode] = useMemo(() => {
    const targetNode = raw ?? getRawNode(_node);
    const nodeStyles = formatContainerStyles(_node);
    const rawNode = {
      ...targetNode,
      styles: {
        ...targetNode.styles,
        ...nodeStyles.styles
      },
      mobile_styles: {
        ...targetNode.styles,
        ...nodeStyles.mobile_styles
      }
    };

    return _node.model || _node.element
      ? [_node, rawNode]
      : [rawNode, undefined];
  }, [_node, raw]);

  return { node, rawNode };
};

export const useContainerStyles = (
  node: any,
  rawNode: any,
  css?: any,
  viewport?: any
) => {
  const styles = useMemo(() => {
    const [cellStyle = {}] = node.isElement
      ? [{}]
      : getCellStyle(rawNode ?? node, viewport);

    const _styles = {
      position: 'relative',
      minWidth: !node.isElement ? `${DEFAULT_MIN_SIZE}px` : 'min-content',
      minHeight: !node.isElement ? `${DEFAULT_MIN_SIZE}px` : 'min-content',
      boxSizing: 'border-box',
      ...css,
      ...getContainerStyles(node, rawNode, viewport),
      ...cellStyle
    };

    if (node.isElement) {
      _styles.flexDirection = 'column';
    }

    return _styles;
  }, [node, rawNode, css, viewport]);

  const innerStyles = useMemo(() => {
    const _innerStyles: any = {
      position: 'relative',
      display: 'flex',
      flexWrap: 'nowrap',
      width: '100%',
      height: '100%',
      boxSizing: 'border-box',
      ...getInnerContainerStyles(node, rawNode, viewport)
    };

    if (node.isElement) {
      _innerStyles.flexDirection = 'column';
    }

    return _innerStyles;
  }, [node, rawNode, css, viewport]);

  return { styles, innerStyles };
};

/**
 * useNodeType
 * Returns a memoized string that indicates the type of node. This is attached to each container as a class on the div
 * to allow identifying divs without knowledge of their node.
 */
export const useNodeType = (node: any, rawNode: any, viewport: any) => {
  return useMemo(() => {
    const targetNode = rawNode ?? node;
    const fieldPrefix = viewport === 'desktop' ? '' : 'mobile_';
    let type = node.isElement ? 'element' : 'container';

    const widthValue = getStyle(targetNode, 'width', fieldPrefix) || '';
    const widthUnit = getStyle(targetNode, 'width_unit', fieldPrefix) || '';
    const width = `${widthValue}${widthUnit}`;

    if (isPx(width)) type = `px-${type}`;
    else if (isFit(width)) type = `fit-${type}`;
    else if (isFill(width)) type = `fill-${type}`;

    return type;
  }, [node, rawNode, viewport]);
};

export const useContainerEngine = (node: any, rawNode: any, ref: any) => {
  // This effect is used to ignore "ResizeObserver loop limit exceeded" errors. They are benign.
  useEffect(() => {
    const errorHandler = (e: any) => {
      if (
        e.message === 'ResizeObserver loop limit exceeded' ||
        e.message ===
          'ResizeObserver loop completed with undelivered notifications.'
      ) {
        // eslint-disable-next-line
        const resizeObserverErrDiv = document.getElementById(
          'webpack-dev-server-client-overlay-div'
        );
        // eslint-disable-next-line
        const resizeObserverErr = document.getElementById(
          'webpack-dev-server-client-overlay'
        );
        if (resizeObserverErr) {
          resizeObserverErr.setAttribute('style', 'display: none');
        }
        if (resizeObserverErrDiv) {
          resizeObserverErrDiv.setAttribute('style', 'display: none');
        }
      }
    };

    addEventListener('error', errorHandler);

    return () => {
      removeEventListener('error', errorHandler);
    };
  }, []);

  /**
   * This effect is used to resize Fit-width containers according to their children.
   * Resizing is required because pixel-width elements should be responsive in a way where they can
   * shrink if there isn't enough space but the Fit-width container should not force this. The Fit-width
   * container should allow it's children to expand if there is room exterior to the container.
   */
  useEffect(() => {
    if (
      !ref ||
      !ref.current ||
      !(isFitElement(ref.current) || isFitContainer(ref.current))
    ) {
      return; // Do nothing
    }

    const div = ref.current;
    const children = getImmediateDivs(div);
    const document = featheryDoc();
    const transitionEvent = whichTransitionEvent();
    let observer: any = null;
    let canvas: any = null;

    const resizeCurrentFitContainer = () => {
      const parentFitContainers = getParentFitContainers(div);

      if (parentFitContainers) {
        parentFitContainers.expand();
      }

      resizeFitContainer(div);

      if (parentFitContainers) {
        parentFitContainers.collapse();
      }
    };

    const resizeParentFitContainers = () => {
      if (ref.current) {
        const parentFitContainers = getParentFitContainers(ref.current);

        if (parentFitContainers) {
          for (const parent of parentFitContainers.parents) {
            resizeFitContainer(parent);
          }
        }
      }
    };

    // If the element is fit, we must observe if the content changes to resize parent fit containers
    if (isFitElement(div) && node.uuid) {
      observer = new ResizeObserver(() => resizeParentFitContainers());
      observer.observe(div);
    }

    // If the element is fit, we will resize it's parent containers once all fonts are loaded to ensure correct sizing
    if (isFitElement(div) && !node.uuid && document) {
      document.fonts.ready.then(() => resizeParentFitContainers());
    }

    // If the container is a fit container, we need to alter it's max-width to allow children to expand accordingly
    if (isFitContainer(div) && children.length > 0) {
      resizeCurrentFitContainer();

      // For the editor, we need to also resize after transitions finish (between viewport changes)
      if (node.uuid) {
        canvas = document.querySelector('div[data-testid="editor-canvas"]');

        if (canvas) {
          canvas.addEventListener(
            transitionEvent,
            resizeCurrentFitContainer,
            false
          );
        }
      }
    }

    return () => {
      if (ref.current) {
        /**
         * If the ref still exists, we need to unset any changes that were made to the width
         * and maxWidth as these changes could live between changing steps and cause the layout
         * to look incorrect.
         */
        ref.current.style.width = null;
        ref.current.style.maxWidth = null;
      }

      if (observer) {
        observer.disconnect();
        observer = null; // For garbage collection
      }

      if (canvas) {
        canvas.removeEventListener(transitionEvent, resizeCurrentFitContainer);
      }
    };
  }, [node, rawNode, ref]);
};
