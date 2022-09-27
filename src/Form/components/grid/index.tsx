import React from 'react';
import Cell from './Cell';
import ResponsiveStyles from '../../../elements/styles';
import { getDefaultFieldValue } from '../../../utils/formHelperFunctions';
import { TEXT_VARIABLE_PATTERN } from '../../../utils/hydration';
import { adjustColor } from '../../../utils/styles';
import {
  LINK_NONE,
  LINK_SELECT_PRODUCT
} from '../../../elements/basic/ButtonElement';
import { fieldValues } from '../../../utils/init';

const Grid = ({ step, form, viewport }: any) => {
  const formattedStep = formatStep(JSON.parse(JSON.stringify(step)), viewport);

  const repeatPosition =
    viewport === 'mobile'
      ? step.mobile_repeat_position || step.repeat_position
      : step.repeat_position;

  if (Array.isArray(repeatPosition) && repeatPosition.length > 0) {
    const repeatNode =
      formattedStep.map[getMapKey({ position: repeatPosition })];
    if (repeatNode) addRepeatedCells(repeatNode);
  }

  return (
    <Subgrid
      tree={formattedStep.tree}
      form={form}
      viewport={viewport}
      flags={{ fieldSeen: false }}
    />
  );
};

const Subgrid = ({
  tree: node,
  form,
  axis = null,
  viewport = 'desktop',
  flags
}: any) => {
  if (node.isElement || node.isEmpty) {
    return (
      <CellContainer key={getMapKey(node)} node={node} axis={axis}>
        {!node.isEmpty && <Cell form={form} node={node} flags={flags} />}
      </CellContainer>
    );
  } else {
    return (
      <CellContainer node={node} axis={axis}>
        <GridContainer node={node}>
          {node.children.map((child: any, i: any) => {
            axis = node.axis;
            return (
              <Subgrid
                key={getMapKey(child) + ':' + i}
                tree={child}
                axis={axis}
                form={form}
                viewport={viewport}
                flags={flags}
              />
            );
          })}
        </GridContainer>
      </CellContainer>
    );
  }
};

const getCellStyle = (cell: any) => {
  const responsiveStyles = new ResponsiveStyles(cell, [
    'cell',
    'cellHover',
    'cellActive'
  ]);
  responsiveStyles.applyBorders({ target: 'cell' });
  responsiveStyles.applyCorners('cell');
  responsiveStyles.applyBackgroundImageStyles('cell');
  responsiveStyles.apply('cell', 'background_color', (c: any) => ({
    backgroundColor: c ? `#${c}` : null
  }));
  responsiveStyles.apply('cellHover', 'background_color', (a: any) => {
    const color = `${adjustColor(a || 'ffffffff', -20)}`;
    return {
      backgroundColor: color,
      borderColor: color
    };
  });
  responsiveStyles.apply('cellActive', 'background_color', (a: any) => {
    const color = `${adjustColor(a || 'ffffffff', -45)} !important`;
    return {
      backgroundColor: color,
      borderColor: color
    };
  });

  return [
    responsiveStyles.getTarget('cell'),
    responsiveStyles.getTarget('cellHover'),
    responsiveStyles.getTarget('cellActive')
  ];
};

const getCellContainerStyle = (axis: string, layout: string) => {
  const dimension = axis === 'column' ? 'width' : 'height';

  const common = {
    display: 'flex'
  };

  const dimensionName = dimension[0].toUpperCase() + dimension.substring(1);
  const minDimension = `min${dimensionName}`;
  const maxDimension = `max${dimensionName}`;

  switch (layout) {
    case 'fit':
      return {
        ...common,
        [minDimension]: 0,
        [dimension]: 'fit-content'
      };
    case 'fill':
      return {
        ...common,
        flex: 1,
        [minDimension]: 0
      };
    default:
      return {
        ...common,
        [dimension]: parseInt(layout),
        [maxDimension]: parseInt(layout),
        [minDimension]: 0
      };
  }
};

const CellContainer = ({
  children,
  node: {
    key,
    isElement,
    parent,
    style,
    grid_size: gridSize,
    properties = null
  },
  axis,
  selected,
  buttonOnClick = () => {}
}: any) => {
  if (!parent) return children;

  const cellContainerStyle = getCellContainerStyle(axis, gridSize);

  if (!properties) properties = {};
  const onClick = (e: React.MouseEvent) => {
    if (properties.link && properties.link !== LINK_NONE) {
      e.stopPropagation();
      buttonOnClick({ id: key, properties });
    }
  };

  if (style) {
    const [cellStyle, cellHoverStyle, cellActiveStyle] = getCellStyle({
      styles: style
    });

    const {
      link = LINK_NONE,
      product_id: productId,
      selected_product_id_field: selectedProductIdField
    } = properties;

    const hasSubGridLink =
      link && ![LINK_NONE, LINK_SELECT_PRODUCT].includes(link);
    const hasSubGridStripeLink =
      link === LINK_SELECT_PRODUCT && productId && selectedProductIdField;
    const subgridIsSelectable =
      !isElement && (hasSubGridLink || hasSubGridStripeLink);

    const selectableStyles = {
      cursor: 'pointer',
      transition: '0.2s ease all',
      ...(selected ? cellActiveStyle : {}),
      '&:hover': cellHoverStyle
    };

  if (node.style) {
    const cellStyle = getCellStyle({ styles: node.style });

    return (
      <div
        css={{
          ...cellContainerStyle,
          ...cellStyle,
          ...(subgridIsSelectable ? selectableStyles : {})
        }}
        onClick={onClick}
      >
        {children}
      </div>
    );
  }

  return (
    <div style={cellContainerStyle} onClick={onClick}>
      {children}
    </div>
  );
};

const GridContainer = ({ children, node: { axis } }: any) => {
  return (
    <div
      style={{
        flexDirection: axis === 'column' ? 'row' : 'column',
        flexWrap: 'nowrap',
        display: 'flex',
        position: 'relative',
        minHeight: '100%',
        minWidth: '100%'
      }}
    >
      {children}
    </div>
  );
};

const formatStep = (step: any, viewport: string) => {
  step = convertStepToViewport(step, viewport);

  const map = buildGridMap(step);

  const tree = buildGridTree(map, [], viewport);

  return { map, tree };
};

const getMapKey = (node: any) => {
  if (!node.position) return null;
  return node.position.join(',') || 'root';
};

// TODO use getAllElements
const typeMap = {
  progress_bars: 'progress_bar',
  images: 'image',
  texts: 'text',
  buttons: 'button',
  servar_fields: 'field',
  videos: 'video'
};

const fields = [
  'subgrids',
  'texts',
  'buttons',
  'servar_fields',
  'progress_bars',
  'images',
  'videos'
];

const convertStepToViewport = (step: any, viewport: any) => {
  fields.forEach((field) => {
    step[field].forEach((obj: any, i: any) => {
      step[field][i] =
        field === 'subgrids'
          ? convertToViewport(obj, viewport, viewportProperties.subgrids)
          : convertToViewport(obj, viewport, viewportProperties.elements);
    });
  });

  step.subgrids = step.subgrids.filter((subgrid: any) => subgrid.position);

  return step;
};

const viewportProperties = {
  step: ['width', 'height', 'repeat_position'],
  subgrids: ['position', 'axis', 'style', 'grid_size'],
  elements: ['position']
};

const convertToViewport = (obj: any, viewport: any, props: any) => {
  if (viewport === 'desktop') return obj;

  props.forEach((prop: any) => {
    const viewportProp = `${viewport}_${prop}`;
    if (obj[viewportProp]) {
      obj[prop] = obj[viewportProp];
    }
  });

  return obj;
};

const buildGridMap = (step: any) => {
  const map: any[string] = {};
  let rootSubgrid = {};
  const cells: any = [];

  const addObjectsToMap = (obj: any, type: any) => {
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (typeMap[type]) obj.type = typeMap[type];
    if (type === 'subgrids' && obj.position.length === 0) {
      if (Array.isArray(obj.styles)) {
        obj.styles.forEach((style: any) => {
          const cellData = { ...style };
          cellData.position = [...obj.position, cellData.position];
          cells.push(cellData);
        });
      }

      return (rootSubgrid = obj);
    }

    const previous = map[getMapKey(obj)];
    const prevObj: any = {};
    if (previous) {
      prevObj.grid_size = previous.grid_size;
      prevObj.style = previous.style;
    }

    map[getMapKey(obj)] = { ...obj, ...prevObj };

    if (type === 'subgrids') {
      if (Array.isArray(obj.styles)) {
        obj.styles.forEach((style: any) => {
          const cellData = { ...style };
          cellData.position = [...obj.position, cellData.position];
          cells.push(cellData);
        });
      }
    }
  };

  fields.forEach((field) =>
    step[field]?.forEach((obj: any) => addObjectsToMap(obj, field))
  );

  if (cells) {
    // @ts-expect-error TS(7006): Parameter 'cell' implicitly has an 'any' type.
    cells.forEach((cell) => {
      const key = getMapKey(cell);
      if (!map[key]) {
        map[key] = { isEmpty: true, position: cell.position };
      }
      map[key].cellData = cell;
    });
  }

  (map as any).root = { step, ...rootSubgrid };

  return map;
};

const addRepeatedCells = (node: any) => {
  const index = [...node.position].pop();
  if (!node.parent) return 0;

  const numberOfRepeats = repeatCount(node);
  if (numberOfRepeats) {
    node.parent.children[index] = repeat({ ...node }, 0);
    for (let i = 0; i < numberOfRepeats; ++i) {
      const repeatIndex = i + 1;
      node.parent.children.splice(
        index + repeatIndex,
        0,
        repeat(
          { ...node.parent.children[index] },
          repeatIndex,
          repeatIndex === numberOfRepeats
        )
      );
    }
  } else {
    node.parent.children[index] = repeat({ ...node }, 0);
  }

  return numberOfRepeats;
};

const repeat = (node: any, repeatIndex: number, last = false) => {
  node.repeat = repeatIndex;
  node.lastRepeat = last;
  if (node.children) {
    const newChildren: any = [];
    node.children.forEach((child: any) => {
      newChildren.push(repeat({ ...child }, repeatIndex, last));
    });
    node.children = newChildren;
  }
  return node;
};

const getTextVariables = (node: any) => {
  let textVariables = [];

  const text = node?.properties?.text;
  if (text) {
    const match = text.match(TEXT_VARIABLE_PATTERN);
    if (match) textVariables = match;
  }

  return textVariables.map((variable: any) => variable.slice(2, -2));
};

const getAllTextVariables = (node: any, variables = []) => {
  const textVariables = getTextVariables(node);
  if (textVariables)
    // @ts-expect-error TS(2345): Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
    textVariables.forEach((variable: any) => variables.push(variable));

  if (node.children) {
    node.children.forEach((child: any) =>
      getAllTextVariables(child, variables)
    );
  }

  return variables;
};

const repeatCountByTextVariables = (node: any) => {
  let count = 0;
  const textVariables = getAllTextVariables(node);
  textVariables.forEach((variable) => {
    const variableValues = fieldValues[variable];
    if (Array.isArray(variableValues))
      count = Math.max(count, variableValues.length - 1);
  });
  return count;
};

const getRepeatableFields = (node: any, servars: Array<any>) => {
  if (node.servar?.repeated) servars.push(node);

  if (node.children) {
    node.children.forEach((child: any) => getRepeatableFields(child, servars));
  }

  return servars;
};

const repeatCountByFields = (node: any) => {
  let count = 0;
  const repeatableServars: Array<any> = [];
  getRepeatableFields(node, repeatableServars);
  repeatableServars.forEach((servar) => {
    count = Math.max(count, getNumberOfRepeatingValues(servar));
  });
  return count;
};

// If the final value is still default, do not render another repeat
const getNumberOfRepeatingValues = (node: any) => {
  const servar = node.servar ?? {};
  const fieldValue = fieldValues[servar.key ?? ''];
  if (!Array.isArray(fieldValue)) return 0;

  const defaultValue = getDefaultFieldValue(node);
  const hasDefaultLastValue =
    fieldValue[fieldValue.length - 1] === defaultValue;
  return servar.repeat_trigger === 'set_value' && !hasDefaultLastValue
    ? fieldValue.length
    : fieldValue.length - 1;
};

const repeatCount = (node: any) => {
  return Math.max(repeatCountByFields(node), repeatCountByTextVariables(node));
};

const buildGridTree = (gridMap: any, position: any[] = [], viewport: any) => {
  const node = gridMap[getMapKey({ position })];
  if (!node) return { isEmpty: true, position };

  let i = 0;
  let nextPos = [...position, i];
  let hasNextChild = gridMap[getMapKey({ position: nextPos })];

  while (hasNextChild) {
    const actualChild = buildGridTree(gridMap, [...position, i], viewport);
    actualChild.parent = node;
    node.children.push(actualChild);

    i = i + 1;
    nextPos = [...position, i];
    hasNextChild = gridMap[getMapKey({ position: nextPos })];
  }
  return node;
};

export default Grid;
