import React, { PropsWithChildren } from 'react';
import { StyledContainer, getCellStyle } from '../StyledContainer';

type ContainerProps = PropsWithChildren & {
  node: any;
  runElementActions: any;
  selected: boolean;
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
  children
}: ContainerProps) => {
  const properties = node.properties ?? {};
  const actions = properties.actions ?? [];
  const additionalCss: any = {};
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

  Object.assign(additionalCss, selectableStyles);

  return (
    <StyledContainer
      node={node}
      css={additionalCss}
      onClick={() => {
        runElementActions({
          actions: actions,
          element: { id: properties.callback_id, properties },
          elementType: 'container'
        });
      }}
    >
      {children}
    </StyledContainer>
  );
};
