import React, { PropsWithChildren } from 'react';
import { Container } from '../../../grid';
import { getCellStyle } from '../../../grid/Container/styles';

type CellProps = PropsWithChildren & {
  node: any;
  runElementActions: any;
  selected: boolean;
};

export const Cell = ({
  node,
  runElementActions = () => {},
  selected,
  children
}: CellProps) => {
  const properties = node.properties ?? {};
  const actions = properties.actions ?? [];
  const additionalCss: any = {};
  const [cellHoverStyle = {}, cellActiveStyle = {}] = getCellStyle(node);

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
    <Container
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
    </Container>
  );
};
