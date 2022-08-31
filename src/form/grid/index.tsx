import React from 'react';
import Cell from './Cell.jsx';
import ApplyStyles from '../../elements/styles';
import { getDefaultFieldValue } from '../../utils/formHelperFunctions';
import { TEXT_VARIABLE_PATTERN } from '../../utils/hydration';

const Grid = ({ step, form, values, viewport }) => {
  const formattedStep = formatStep(JSON.parse(JSON.stringify(step)), viewport);

  const repeatPosition =
    viewport === 'mobile'
      ? step.mobile_repeat_position || step.repeat_position
      : step.repeat_position;

  if (Array.isArray(repeatPosition) && repeatPosition.length > 0) {
    const repeatNode =
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
}) => {
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
      <CellContainer node={node} axis={axis} layout={layout}>
        <GridContainer node={node}>
          {node.children.map((child, i) => {
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

const getCellStyle = (cell) => {
  const applyStyles = new ApplyStyles(cell, ['cell']);
  applyStyles.applyBorders('cell');
  applyStyles.applyCorners('cell');
  applyStyles.applyBackgroundImageStyles('cell');
  applyStyles.apply('cell', 'background_color', (c) => ({
    backgroundColor: `#${c}`
  }));
  return applyStyles.getTarget('cell');
};

const getCellContainerStyle = (axis, layout) => {
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
        [dimension]: 'fit-content',
        [minDimension]: 0
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

const CellContainer = ({ children, node, axis, layout }) => {
  if (!node.parent) return children;

  const cellContainerStyle = getCellContainerStyle(axis, layout);

  if (node.cellData) {
    const cellStyle = getCellStyle(node.cellData);

    return (
      <div style={{ ...cellContainerStyle, ...cellStyle }}>{children}</div>
    );
  }

  return <div style={cellContainerStyle}>{children}</div>;
};
const GridContainer = ({ children, node: { axis } }) => {
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

const formatStep = (step, viewport) => {
  step = convertStepToViewport(step, viewport);

  const map = buildGridMap(step);
  const tree = buildGridTree(map, [], viewport);

  return { map, tree };
};

const getMapKey = (node) => {
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

const convertStepToViewport = (step, viewport) => {
  fields.forEach((field) => {
    step[field].forEach((obj, i) => {
      step[field][i] =
        field === 'subgrids'
          ? convertToViewport(obj, viewport, viewportProperties.subgrids)
          : convertToViewport(obj, viewport, viewportProperties.elements);
    });
  });

  step.subgrids = step.subgrids.filter((subgrid) => subgrid.position);

  return step;
};

const viewportProperties = {
  step: ['width', 'height', 'repeat_position'],
  subgrids: ['layout', 'position', 'axis', 'styles'],
  elements: ['position']
};

const convertToViewport = (obj, viewport, props) => {
  if (viewport === 'desktop') return obj;

  props.forEach((prop) => {
    const viewportProp = `${viewport}_${prop}`;
    if (obj[viewportProp]) {
      obj[prop] = obj[viewportProp];
    }
  });

  return obj;
};

const buildGridMap = (step) => {
  const map = {};
  let rootSubgrid = {};
  const cells = [];

  const addObjectsToMap = (obj, type) => {
    if (typeMap[type]) obj.type = typeMap[type];
    if (type === 'subgrids' && obj.position.length === 0) {
      if (Array.isArray(obj.styles)) {
        obj.styles.forEach((style) => {
          const cellData = { ...style };
          cellData.position = [...obj.position, cellData.position];
          cells.push(cellData);
        });
      }

      return (rootSubgrid = obj);
    }
    map[getMapKey(obj)] = obj;
    if (type === 'subgrids') {
      if (Array.isArray(obj.styles)) {
        obj.styles.forEach((style) => {
          const cellData = { ...style };
          cellData.position = [...obj.position, cellData.position];
          cells.push(cellData);
        });
      }
    }
  };

  fields.forEach((field) =>
    step[field]?.forEach((obj) => addObjectsToMap(obj, field))
  );

  if (cells) {
    cells.forEach((cell) => {
      const key = getMapKey(cell);
      if (!map[key]) {
        map[key] = { isEmpty: true, position: cell.position };
      }
      map[key].cellData = cell;
    });
  }

  map.root = { step, ...rootSubgrid };

  return map;
};

const addRepeatedCells = (node, values) => {
  const index = [...node.position].pop();
  if (!node.parent) return 0;

  const numberOfRepeats = repeatCount(node, values);
  if (numberOfRepeats) {
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
    node.parent.children[index] = repeat({ ...node }, values, 0);
  }

  return numberOfRepeats;
};

const repeat = (node, values, repeatIndex, last) => {
  node.repeat = repeatIndex;
  node.lastRepeat = last;
  if (node.children) {
    const newChildren = [];
    node.children.forEach((child) => {
      newChildren.push(repeat({ ...child }, values, repeatIndex, last));
    });
    node.children = newChildren;
  }
  return node;
};

const getTextVariables = (node) => {
  let textVariables = [];

  const text = node?.properties?.text;
  if (text) {
    const match = text.match(TEXT_VARIABLE_PATTERN);
    if (match) textVariables = match;
  }

  return textVariables.map((variable) => variable.slice(2, -2));
};

const getAllTextVariables = (node, variables = []) => {
  const textVariables = getTextVariables(node);
  if (textVariables)
    textVariables.forEach((variable) => variables.push(variable));

  if (node.children) {
    node.children.forEach((child) => getAllTextVariables(child, variables));
  }

  return variables;
};

const repeatCountByTextVariables = (node, values) => {
  let count = 0;
  const textVariables = getAllTextVariables(node);
  textVariables.forEach((variable) => {
    const variableValues = values[variable];
    if (Array.isArray(variableValues))
      count = Math.max(count, variableValues.length - 1);
  });
  return count;
};

const getRepeatableFields = (node, servars = []) => {
  if (node.servar) {
    const { repeated, repeat_trigger: repeatTrigger } = node.servar;
    if (repeated && repeatTrigger) {
      servars.push(node);
    }
  }

  if (node.children) {
    node.children.forEach((child) => getRepeatableFields(child, servars));
  }

  return servars;
};

const repeatCountByFields = (node, values) => {
  let count = 0;
  const repeatableServars = getRepeatableFields(node);
  repeatableServars.forEach((servar) => {
    count = Math.max(count, getNumberOfRepeatableValues(servar, values));
  });
  return count;
};

// If the final value is still default, do not render another repeat
const getNumberOfRepeatableValues = (node, values) => {
  const defaultValue = getDefaultFieldValue(node);
  const fieldValues = values[node?.servar?.key];
  if (!Array.isArray(fieldValues)) return 0;
  const hasDefaultLastValue =
    fieldValues[fieldValues.length - 1] === defaultValue;
  return hasDefaultLastValue ? fieldValues.length - 1 : fieldValues.length;
};

const repeatCount = (node, values) => {
  return Math.max(
    repeatCountByFields(node, values),
    repeatCountByTextVariables(node, values)
  );
};

const buildGridTree = (gridMap, position = [], viewport) => {
  const node = gridMap[getMapKey({ position })];
  if (!node) return { isEmpty: true, position };
  if (node.layout) {
    if (position.length > 0) node.isSubgrid = true;
    node.children = [];
    node.layout.forEach((layout, i) => {
      const nextPosition = [...position, i];
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
