import React from 'react';
import Cell from './cell';
import ApplyStyles from '../../elements/styles';
import { getDefaultFieldValue } from '../../utils/formHelperFunctions';

const Gig = ({ step, form, values, viewport }) => {
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
    <Grid
      tree={formattedStep.tree}
      form={form}
      values={values}
      viewport={viewport}
    />
  );
};

const Grid = ({
  tree: node,
  form,
  layout = null,
  axis = null,
  values,
  viewport = 'desktop'
}) => {
  const renderGrid = () => {
    return (
      <CellContainer node={node} axis={axis} layout={layout}>
        <GridContainer node={node}>
          {node.children.map((child, i) => {
            layout = node.layout[i];
            axis = node.axis;
            return (
              <Grid
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
  };

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
  }

  return renderGrid();
};

const getCellStyle = (cell) => {
  const applyStyles = new ApplyStyles(cell, ['cell']);
  applyStyles.applyBorders('cell');
  applyStyles.applyCorners('cell');
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

  const map = buildGridMap(step, viewport);
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
  servar_fields: 'field'
};

const fields = [
  'subgrids',
  'texts',
  'buttons',
  'servar_fields',
  'progress_bars',
  'images'
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

const buildGridMap = (step, viewport) => {
  const map = {};
  let rootSubgrid = {};
  const cells = [];

  const addObjectsToMap = (obj, type) => {
    if (typeMap[type]) obj.type = typeMap[type];
    // TODO: handle grids with mobile positions rather than desktop positions
    if (type === 'subgrids' && obj.position?.length === 0) {
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

  const numberOfRepeats = simpleRepeatCount(node, values, index);

  if (!node.parent) return 0;

  if (numberOfRepeats) {
    node.parent.children[index] = repeat({ ...node }, values, 0);
    for (let i = 0; i < numberOfRepeats; ++i) {
      node.parent.layout.splice(index + i, 0, node.parent.layout[index]);
      node.parent.children.splice(
        index + i + 1,
        0,
        repeat({ ...node.parent.children[index] }, values, i + 1)
      );
    }
  } else {
    node.parent.children[index] = repeat({ ...node }, values, 0);
  }

  return numberOfRepeats;
};

const repeat = (node, values, repeatIndex) => {
  node.repeat = repeatIndex;
  if (node.servar) node.servar.repeated = true;
  if (node.children) {
    const newChildren = [];
    node.children.forEach((child) => {
      newChildren.push(repeat({ ...child }, values, repeatIndex));
    });
    node.children = newChildren;
  }
  return node;
};

const findRepeatTrigger = (node) => {
  if (node?.servar?.repeated) return node;
  if (node.children) {
    for (let i = 0; i < node.children.length; ++i) {
      const child = node.children[i];
      const repeatTrigger = findRepeatTrigger(child);
      if (repeatTrigger) return repeatTrigger;
    }
  }
  return null;
};

const simpleRepeatCount = (node, values, index) => {
  node = findRepeatTrigger(node);
  let count = 0;
  if (!node) {
    return count;
  }
  const defaultValue = getDefaultFieldValue(node);
  const v = values[node?.servar?.key];
  if (!v) return 0;
  for (let i = 0; i < v.length; ++i) {
    const value = v[i];
    if (value !== defaultValue) count++;
  }
  return count;
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

export default Gig;
