import { useEffect, useRef } from 'react';
import { featheryDoc } from '../../../../utils/browser';
import { getViewport } from '../../../../elements/styles';

export const isFixedContainer = (node: any, rawNode?: any) => {
  const _node = rawNode ?? node;
  const styles =
    getViewport() === 'mobile' ? _node.mobile_styles : _node.styles;

  return !!styles?.fixed;
};

export const useFixedContainer = (
  node: any,
  rawNode?: any,
  isFixed = false
) => {
  const fixedContainerRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef(node || rawNode);
  const getNode = () => (nodeRef.current ? nodeRef.current : node || rawNode);

  useEffect(() => {
    nodeRef.current = node || rawNode;
  }, [node, rawNode]);

  useEffect(() => {
    let _node = getNode();

    if (_node.uuid || !isFixed) {
      return; // Disable all fixed behaviour on the editor
    }

    if (fixedContainerRef.current) {
      const doc = featheryDoc();
      const container = doc.querySelector(`div[data-id="${_node.id}"]`);

      if (container) {
        const setPositionAndDimensions = () => {
          if (!fixedContainerRef.current || !container) {
            return;
          }

          _node = getNode();

          const { top, left } = container.getBoundingClientRect();
          const isParentRoot = !_node.parent.parent;
          const isFirstChild = _node.parent.children[0].id === _node.id;
          const isLastChild =
            _node.parent.children[_node.parent.children.length - 1].id ===
            _node.id;

          if (isParentRoot && isFirstChild) {
            // To account for headers, set the top to 0 if the container is the first child of root
            fixedContainerRef.current.style.top = '0';
          } else if (isParentRoot && isLastChild) {
            // To account for footers, set the bottom to 0 if the container is the last child of root
            fixedContainerRef.current.style.bottom = '0';
          } else if (!isParentRoot || (!isFirstChild && !isLastChild)) {
            // Set the top of the fixed container to the top of the original container
            fixedContainerRef.current.style.top = `${top}px`;
          }

          fixedContainerRef.current.style.height = `${container.offsetHeight}px`; // Height will be taken from the original container
          fixedContainerRef.current.style.width = `${container.offsetWidth}px`; // Width will be taken from the original container
          fixedContainerRef.current.style.left = `${left}px`; // Left will be taken from the original container
        };

        setPositionAndDimensions();

        // Resize observer is used to recalculate the dimensions (width/height) of the fixed container when the original container resizes
        let resizeObserver: any = new ResizeObserver(() =>
          setPositionAndDimensions()
        );

        // Parent resize observer is used to recalculate the position (top/left/bottom) of the fixed container
        // This is necessary as a fill container parent can shrink in size but not cause the fixed container to shrink, instead it would move due to the shrinking.
        let parentResizeObserver: any = new ResizeObserver(() =>
          setPositionAndDimensions()
        );

        resizeObserver.observe(container);
        parentResizeObserver.observe(doc.querySelector('body'));

        return () => {
          resizeObserver.disconnect();
          resizeObserver = null;

          parentResizeObserver.disconnect();
          parentResizeObserver = null;
        };
      }
    }
  }, [isFixed]);

  return fixedContainerRef;
};
