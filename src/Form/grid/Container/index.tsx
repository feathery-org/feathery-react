import React, { PropsWithChildren, useRef } from 'react';
import { StyledContainer, getCellStyle } from '../StyledContainer';
import { ACTION_STORE_FIELD } from '../../../utils/elementActions';

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
  let handleClick: any;

  if (!node.isElement) {
    const properties = node.properties ?? {};
    const actions = properties.actions ?? [];
    const [, cellHoverStyle = {}, cellActiveStyle = {}] = getCellStyle(node);

    const selectableStyles =
      actions.length > 0
        ? {
            cursor: 'pointer',
            transition:
              '0.2s ease opacity, color, background-color, border-width, border-color, outline, box-shadow',
            ...(selected ? cellActiveStyle : {}),
            '&:hover': cellHoverStyle
          }
        : {};

    handleClick = (e: any) => {
      const newActions = JSON.parse(JSON.stringify(actions));
      newActions.forEach((action: any) => {
        if (
          action.type === ACTION_STORE_FIELD &&
          action.custom_store_field_key === e.target.id
        ) {
          // Don't run value changes for fields that were clicked and already had
          // their values changed
          action.retain_click_value = true;
        }
      });

      runElementActions({
        actions: newActions,
        element: node,
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
