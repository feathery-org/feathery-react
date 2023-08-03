import React, { PropsWithChildren, useRef } from 'react';
import { StyledContainer, getCellStyle } from '../StyledContainer';

type ContainerProps = PropsWithChildren & {
  node: any;
  viewport: any;
  runElementActions?: any;
  selected?: boolean;
};

/**
 * Container
 * This component adds additional logic to the StyledContainer that is unique
 * to rendering containers on hosted forms (not the editor).
 */
export const Container = ({
  node,
  runElementActions = () => {},
  selected,
  viewport,
  children
}: ContainerProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const additionalCss: any = {};
  let handleClick = () => {};

  if (!node.isElement) {
    const properties = node.properties ?? {};
    const actions = properties.actions ?? [];
    const [, cellHoverStyle = {}, cellActiveStyle = {}] = getCellStyle(node);

    const selectableStyles =
      actions.length > 0
        ? {
            cursor: 'pointer',
            transition: '0.2s ease all',
            ...(selected ? cellActiveStyle : {}),
            '&:hover': cellHoverStyle
          }
        : {};

    handleClick = () => {
      runElementActions({
        actions: actions,
        element: { id: node.id, properties },
        elementType: 'container'
      });
    };

    Object.assign(additionalCss, selectableStyles);
  }

  return (
    <StyledContainer
      ref={ref}
      node={node}
      css={additionalCss}
      onClick={handleClick}
      viewport={viewport}
    >
      {children}
    </StyledContainer>
  );
};
