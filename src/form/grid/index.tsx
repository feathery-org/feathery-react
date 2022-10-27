import React from 'react';
import Cell from './Cell';
import ApplyStyles from '../../elements/styles';
import { getDefaultFieldValue } from '../../utils/formHelperFunctions';
import { TEXT_VARIABLE_PATTERN } from '../../utils/hydration';
import { adjustColor } from '../../utils/styles';
import { LINK_NONE, LINK_STRIPE } from '../../elements/basic/ButtonElement';
const Grid = ({ step, form, values, viewport }: any) => {
  const formattedStep = formatStep(JSON.parse(JSON.stringify(step)), viewport);

  const repeatPosition =
    viewport === 'mobile'
      ? step.mobile_repeat_position || step.repeat_position
      : step.repeat_position;

  if (Array.isArray(repeatPosition) && repeatPosition.length > 0) {
    const repeatNode =
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      formattedStep.map[getMapKey({ position: repeatPosition })];
    if (repeatNode) addRepeatedCells(repeatNode, values);
  }

  return (
    <Subgrid
      tree={formattedStep.tree}
      form={form}
      values={values}
      viewport={viewport}
    />
  );
};

const Subgrid = ({
  tree: node,
  form,
  layout = null,
  axis = null,
  values,
  viewport = 'desktop'
}: any) => {
  const { buttonOnClick, getButtonSelectionState } = form;
  if (node.isElement || node.isEmpty) {
    return (
      <CellContainer
        key={getMapKey(node)}
        node={node}
        axis={axis}
        layout={layout}
      >
        {!node.isEmpty && <Cell form={form} node={node} />}
      </CellContainer>
    );
  } else {
    return (
      <CellContainer
        node={node}
        axis={axis}
        layout={layout}
        selected={getButtonSelectionState({
          id: node.key,
          properties: node.properties
        })}
        buttonOnClick={buttonOnClick}
      >
        <GridContainer node={node}>
          {node.children.map((child: any, i: any) => {
            layout = node.layout[i];
            axis = node.axis;
            return (
              <Subgrid
                key={getMapKey(child) + ':' + i}
                tree={child}
                axis={axis}
                layout={layout}
                form={form}
                values={values}
                viewport={viewport}
              />
            );
          })}
        </GridContainer>
      </CellContainer>
    );
  }
};

const getCellStyle = (cell: any) => {
  const applyStyles = new ApplyStyles(cell, [
    'cell',
    'cellHover',
    'cellActive'
  ]);
  applyStyles.applyBorders({ target: 'cell' });
  applyStyles.applyCorners('cell');
  applyStyles.applyBackgroundImageStyles('cell');
  applyStyles.apply('cell', 'background_color', (c: any) => ({
    backgroundColor: c ? `#${c}` : null
  }));
  applyStyles.apply('cellHover', 'background_color', (a: any) => {
    const color = `${adjustColor(a || 'ffffffff', -20)}!important`;
    return {
      backgroundColor: color,
      borderColor: color
    };
  });
  applyStyles.apply('cellActive', 'background_color', (a: any) => {
    const color = `${adjustColor(a || 'ffffffff', -45)}`;
    return {
      backgroundColor: color,
      borderColor: color
    };
  });

  return [
    applyStyles.getTarget('cell'),
    applyStyles.getTarget('cellHover'),
    applyStyles.getTarget('cellActive')
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
  node: { key, isElement, parent, cellData, properties = null },
  axis,
  layout,
  selected,
  buttonOnClick = () => {}
}: any) => {
  if (!parent) return children;

  const cellContainerStyle = getCellContainerStyle(axis, layout);

  if (!properties) properties = {};
  const onClick = (e: React.MouseEvent) => {
    if (properties.link && properties.link !== LINK_NONE) {
      e.stopPropagation();
      buttonOnClick({ id: key, properties });
    }
  };

  if (cellData) {
    const [cellStyle, cellHoverStyle, cellActiveStyle] = getCellStyle(cellData);
    const {
      link = LINK_NONE,
      product_id: productId,
      selected_product_id_field: selectedProductIdField
    } = properties;

    const hasSubGridLink = link && ![LINK_NONE, LINK_STRIPE].includes(link);
    const hasSubGridStripeLink =
      link === LINK_STRIPE && productId && selectedProductIdField;
    const subgridIsSelectable =
      !isElement && (hasSubGridLink || hasSubGridStripeLink);

    return (
      <div
        style={{
          ...cellContainerStyle,
          ...cellStyle,
          ...(selected ? cellActiveStyle : {})
        }}
        css={{
          '&:hover': subgridIsSelectable ? cellHoverStyle : {}
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
  subgrids: ['layout', 'position', 'axis', 'styles'],
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
  const map = {};
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
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    map[getMapKey(obj)] = obj;
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
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      if (!map[key]) {
        // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
        map[key] = { isEmpty: true, position: cell.position };
      }
      // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
      map[key].cellData = cell;
    });
  }

  (map as any).root = { step, ...rootSubgrid };

  return map;
};

const addRepeatedCells = (node: any, values: any) => {
  const index = [...node.position].pop();
  if (!node.parent) return 0;

  const numberOfRepeats = repeatCount(node, values);
  if (numberOfRepeats) {
    // @ts-expect-error TS(2554): Expected 4 arguments, but got 3.
    node.parent.children[index] = repeat({ ...node }, values, 0);
    for (let i = 0; i < numberOfRepeats; ++i) {
      node.parent.layout.splice(index + i, 0, node.parent.layout[index]);
      const repeatIndex = i + 1;
      node.parent.children.splice(
        index + repeatIndex,
        0,
        repeat(
          { ...node.parent.children[index] },
          values,
          repeatIndex,
          repeatIndex === numberOfRepeats
        )
      );
    }
  } else {
    // @ts-expect-error TS(2554): Expected 4 arguments, but got 3.
    node.parent.children[index] = repeat({ ...node }, values, 0);
  }

  return numberOfRepeats;
};

const repeat = (node: any, values: any, repeatIndex: any, last: any) => {
  node.repeat = repeatIndex;
  node.lastRepeat = last;
  if (node.children) {
    const newChildren: any = [];
    node.children.forEach((child: any) => {
      newChildren.push(repeat({ ...child }, values, repeatIndex, last));
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

const repeatCountByTextVariables = (node: any, values: any) => {
  let count = 0;
  const textVariables = getAllTextVariables(node);
  textVariables.forEach((variable) => {
    const variableValues = values[variable];
    if (Array.isArray(variableValues))
      count = Math.max(count, variableValues.length - 1);
  });
  return count;
};

const getRepeatableFields = (node: any, servars = []) => {
  if (node.servar) {
    const { repeated, repeat_trigger: repeatTrigger } = node.servar;
    if (repeated && repeatTrigger) {
      // @ts-expect-error TS(2345): Argument of type 'any' is not assignable to parame... Remove this comment to see the full error message
      servars.push(node);
    }
  }

  if (node.children) {
    node.children.forEach((child: any) => getRepeatableFields(child, servars));
  }

  return servars;
};

const repeatCountByFields = (node: any, values: any) => {
  let count = 0;
  const repeatableServars = getRepeatableFields(node);
  repeatableServars.forEach((servar) => {
    count = Math.max(count, getNumberOfRepeatableValues(servar, values));
  });
  return count;
};

// If the final value is still default, do not render another repeat
const getNumberOfRepeatableValues = (node: any, values: any) => {
  const defaultValue = getDefaultFieldValue(node);
  const fieldValues = values[node?.servar?.key];
  if (!Array.isArray(fieldValues)) return 0;
  const hasDefaultLastValue =
    fieldValues[fieldValues.length - 1] === defaultValue;
  return hasDefaultLastValue ? fieldValues.length - 1 : fieldValues.length;
};

const repeatCount = (node: any, values: any) => {
  return Math.max(
    repeatCountByFields(node, values),
    repeatCountByTextVariables(node, values)
  );
};

const buildGridTree = (gridMap: any, position = [], viewport: any) => {
  const node = gridMap[getMapKey({ position })];
  if (!node) return { isEmpty: true, position };
  if (node.layout) {
    if (position.length > 0) node.isSubgrid = true;
    node.children = [];
    node.layout.forEach((layout: any, i: any) => {
      const nextPosition = [...position, i];
      // @ts-expect-error TS(2345): Argument of type 'any[]' is not assignable to para... Remove this comment to see the full error message
      const child = buildGridTree(gridMap, nextPosition, viewport);
      child.parent = node;
      node.children.push(child);
    });
  } else {
    if (!node.isEmpty) node.isElement = true;
  }
  return node;
};

export default Grid;
