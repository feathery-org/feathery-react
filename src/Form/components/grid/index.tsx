import React from 'react';
import Element from './Element';
import ResponsiveStyles from '../../../elements/styles';
import { getDefaultFieldValue } from '../../../utils/formHelperFunctions';
import { fieldValues } from '../../../utils/init';
import { TEXT_VARIABLE_PATTERN } from '../../../elements/components/TextNodes';
import { FIT, isFill, isFit, isPx, getPxValue } from '../../../utils/hydration';
import { getPositionKey, stepElementTypes } from '../../../utils/hideIfs';

const DEFAULT_MIN_SIZE = 50;
const DEFAULT_MIN_FILL_SIZE = 10;

const Grid = ({ step, form, viewport }: any) => {
  const formattedStep: any = formatStep(
    JSON.parse(JSON.stringify(step)),
    viewport,
    form.visibleElements
  );

  const repeatPosition =
    viewport === 'mobile'
      ? step.mobile_repeat_position || step.repeat_position
      : step.repeat_position;

  if (Array.isArray(repeatPosition) && repeatPosition.length > 0) {
    const repeatNode =
      formattedStep.map[getPositionKey({ position: repeatPosition })];
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
  if (node.isElement) {
    const styles = getElementContainerStyle(node, axis);
    return (
      <div css={styles} key={getPositionKey(node)}>
        <Element form={form} node={node} flags={flags} />
      </div>
    );
  } else {
    const { customClickSelectionState, runElementActions } = form;
    const containerId = node.properties?.callback_id ?? '';
    const customComponent = form.customComponents[containerId];

    const children: any[] = (node.children || []).map((child: any, i: any) => (
      <Subgrid
        key={getPositionKey(child) + ':' + i}
        tree={child}
        axis={node.axis}
        form={form}
        viewport={viewport}
        flags={flags}
      />
    ));
    if (customComponent) children.push(customComponent);

    return (
      <CellContainer
        key={getPositionKey(node)}
        node={node}
        axis={axis}
        viewport={viewport}
        selected={customClickSelectionState({
          id: node.key,
          properties: node.properties
        })}
        runElementActions={runElementActions}
      >
        {children.length ? (
          <GridContainer node={node}>{children}</GridContainer>
        ) : null}
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
  responsiveStyles.applyBoxShadow('cell');
  responsiveStyles.applyBackgroundImageStyles('cell');
  responsiveStyles.apply('cell', 'background_color', (c: any) => ({
    backgroundColor: c ? `#${c}` : null
  }));
  responsiveStyles.applySelectorStyles('cellActive', 'selected_', true);
  responsiveStyles.applySelectorStyles('cellHover', 'hover_');

  return [
    responsiveStyles.getTarget('cell'),
    responsiveStyles.getTarget('cellHover'),
    responsiveStyles.getTarget('cellActive')
  ];
};

const getCellContainerStyle = (
  node: any,
  trackAxis: string,
  viewport: string
) => {
  const parentStyles = node.parent?.cellStyles || {};
  const nodeStyles = node.cellStyles || {};
  const styles: any = {
    position: 'relative',
    display: 'flex',
    minWidth: !node.isElement ? `${DEFAULT_MIN_SIZE}px` : 'min-content',
    minHeight: !node.isElement ? `${DEFAULT_MIN_SIZE}px` : 'min-content',
    boxSizing: !node.isElement ? 'content-box' : 'border-box'
  };
  if (node.parent) styles.flexBasis = !node.isElement ? 0 : 'fit-content';

  // Apply axis styles
  styles.flexDirection = trackAxis;

  const nodeWidth = node.width;
  const nodeHeight = node.height;
  const isAligned =
    parentStyles.vertical_align || parentStyles.horizontal_align;

  // Used for "Fit" parents of purely px-width children cells
  const pxWidthChildren =
    node.children &&
    node.axis === 'column' &&
    node.children.every((child: any) => !child.isElement && isPx(child.width));

  /**
   * Width styles
   */
  if (isPx(nodeWidth)) {
    styles.minWidth = 'min-content';
    styles.width = '100%';

    if (trackAxis === 'column') {
      styles.flexBasis = '100%';
    }

    styles.maxWidth = nodeWidth;
  }

  if (isFit(nodeWidth)) {
    if (trackAxis === 'column') styles.flexBasis = '100%';

    styles.width = 'fit-content !important';
    styles.maxWidth = 'fit-content';
    styles.minWidth = 'min-content';

    // TODO: This is not ideal. This is calculating the px width of all px children (every child is px)
    // and setting that to the max width of fit parents. Ideally it should allow the children to grow to this size without
    // calculating the px size of children.
    if (pxWidthChildren) {
      const pxValueOfChildren = node.children.reduce(
        (pxValue: number, child: any) => {
          return pxValue + getPxValue(child.width);
        },
        0
      );

      styles.maxWidth = `${pxValueOfChildren}px`;
    }
  } else if (isFill(nodeWidth)) {
    if (!isAligned) styles.alignSelf = 'stretch';
    styles.width = 'auto';
    styles.minWidth = 'min-content';

    if (trackAxis === 'column') {
      styles.flexGrow = 1;
      styles.flexShrink = 0;
    } else styles.width = '100%';
  }

  /**
   * Height styles
   */
  if (isPx(nodeHeight)) {
    styles.minHeight = nodeHeight;
    styles.height = nodeHeight;

    if (trackAxis === 'row') styles.flexBasis = '100%';

    styles.maxHeight = nodeHeight;
  } else if (isFit(nodeHeight)) {
    styles.height = 'fit-content !important';
    styles.maxHeight = 'fit-content';
    styles.minHeight = 'min-content';
  } else if (isFill(nodeHeight)) {
    if (!isAligned) styles.alignSelf = 'stretch';
    styles.height = 'auto';
    styles.minHeight = `${DEFAULT_MIN_FILL_SIZE}px`;

    if (trackAxis === 'row') {
      styles.flexGrow = 1;
      styles.flexShrink = 0;
    } else if (!node.parent) {
      styles.minHeight = '100%';
    } else {
      styles.height = '100%';
    }

    if (node.parent) styles.minHeight = 'min-content';
  }

  const alignDirection = trackAxis === 'row' ? 'justifySelf' : 'alignSelf';
  if (nodeStyles.vertical_layout)
    styles[alignDirection] = nodeStyles.vertical_layout;

  if (nodeStyles.layout) {
    let targetStyle = nodeStyles.layout;
    if (targetStyle === 'left') targetStyle = 'flex-start';
    else if (targetStyle === 'right') targetStyle = 'flex-end';
    const alignDirection = trackAxis === 'row' ? 'alignSelf' : 'justifySelf';
    styles[alignDirection] = targetStyle;
  }

  // Style rules when the parent is a root cell that is not pixel sized
  const isMobile = viewport === 'mobile';
  const parentIsRoot = node.parent && !node.parent.children;
  if (
    parentIsRoot &&
    !isPx(node.parent.width) &&
    !isMobile &&
    isPx(node.width)
  ) {
    styles.minWidth = node.width;
  }

  if (
    parentIsRoot &&
    !isPx(node.parent.height) &&
    !isMobile &&
    isPx(node.height)
  ) {
    styles.minHeight = node.height;
  }

  // Style rules for an empty root cell
  const isEmptyRootNode = !node.parent && !node.children;
  if (isEmptyRootNode && isFit(node.width)) {
    styles.minWidth = `${DEFAULT_MIN_SIZE}px`;
  }

  if (isEmptyRootNode && isFit(node.height)) {
    styles.minHeight = `${DEFAULT_MIN_SIZE}px`;
  }

  // Apply margin
  styles.marginTop = nodeStyles.external_padding_top ?? 0;
  styles.marginRight = nodeStyles.external_padding_right ?? 0;
  styles.marginBottom = nodeStyles.external_padding_bottom ?? 0;
  styles.marginLeft = nodeStyles.external_padding_left ?? 0;

  const yTotalMargin = styles.marginTop + styles.marginBottom;
  const xTotalMargin = styles.marginLeft + styles.marginRight;

  if (xTotalMargin && styles.width === '100%')
    styles.width = `calc(100% - ${xTotalMargin}px)`;
  if (yTotalMargin && styles.height === '100%')
    styles.height = `calc(100% - ${yTotalMargin}px)`;

  return styles;
};

const getElementContainerStyle = (node: any, trackAxis: string) => {
  const styles: any = {
    display: 'flex',
    boxSizing: 'border-box'
  };
  if (node.parent) styles.flexBasis = 'fit-content';

  // Element has styles and mobile_styles, so must use ResponsiveStyles
  const rs = new ResponsiveStyles(node, ['container'], true);

  rs.apply(
    'container',
    ['width', 'width_unit'],
    (width: any, widthUnit: any) => {
      const styles = {} as any;
      if (widthUnit !== FIT) {
        if (trackAxis === 'column') {
          styles.flexBasis = `${width}${widthUnit}`;
          styles.minWidth = 'min-content';
        } else {
          styles.minWidth = `${width}${widthUnit}`;
          if (widthUnit === '%' || node.type === 'text')
            styles.width = `${width}${widthUnit}`;
        }
      } else {
        styles.width = 'fit-content !important';
        styles.maxWidth = 'fit-content';
        styles.minWidth = 'min-content';
      }
      return styles;
    }
  );

  rs.apply(
    'container',
    ['height', 'height_unit'],
    (height: any, heightUnit: any) => {
      const styles = {} as any;
      if (heightUnit !== FIT) {
        if (trackAxis === 'row') {
          styles.flexBasis = `${height}${heightUnit}`;
          styles.minHeight = 'min-content';
        } else {
          styles.minHeight = `${height}${heightUnit}`;
          if (heightUnit === '%') styles.height = `${height}${heightUnit}`;
        }
      } else {
        styles.height = 'fit-content !important';
        styles.maxHeight = 'fit-content';
        styles.minHeight = 'min-content';
      }
      return styles;
    }
  );

  rs.apply('container', 'vertical_layout', (layout: string) => {
    const alignDirection = trackAxis === 'row' ? 'justifySelf' : 'alignSelf';
    return { [alignDirection]: layout };
  });

  rs.apply('container', 'layout', (layout: string) => {
    if (layout === 'left') layout = 'flex-start';
    else if (layout === 'right') layout = 'flex-end';
    const alignDirection = trackAxis === 'row' ? 'alignSelf' : 'justifySelf';
    return { [alignDirection]: layout };
  });

  // Container content alignment happens in GridContainer, element alignment
  // needs to happen here
  styles.flexDirection = 'column';
  rs.apply('container', 'vertical_align', (align: string) => {
    return { justifyContent: align };
  });
  rs.apply('container', 'horizontal_align', (align: string) => {
    return { alignItems: align };
  });

  rs.applyPadding('container');

  return { ...styles, ...rs.getTarget('container') };
};

const CellContainer = ({
  children,
  node,
  axis,
  selected,
  viewport = 'desktop',
  runElementActions = () => {}
}: any) => {
  const { properties: _properties = null } = node;

  const cellContainerStyle = getCellContainerStyle(node, axis, viewport); // TODO: [Andy] Pass element render data as third param
  const properties = _properties ?? {};

  const actions = properties.actions ?? [];
  const nodeStyles =
    actions.length > 0 && !node.cellStyles ? {} : node.cellStyles;

  if (!nodeStyles) return <div css={cellContainerStyle}>{children}</div>;

  const [cellStyle, cellHoverStyle, cellActiveStyle] = getCellStyle({
    styles: nodeStyles
  });
  const selectableStyles =
    actions.length > 0
      ? {
          cursor: 'pointer',
          transition: '0.2s ease all',
          ...(selected ? cellActiveStyle : {}),
          '&:hover': cellHoverStyle
        }
      : {};

  return (
    <div
      css={{
        ...cellContainerStyle,
        ...cellStyle,
        ...selectableStyles
      }}
      onClick={() => {
        runElementActions({
          actions: actions,
          element: { id: properties.callback_id, properties },
          elementType: 'container'
        });
      }}
    >
      {children}
    </div>
  );
};

const GridContainer = ({ children, node }: any) => {
  const nodeStyles = node?.cellStyles || {};
  const styles: any = {};

  if (node.children) {
    if (node.axis === 'column') {
      styles.alignItems = nodeStyles.vertical_align || 'flex-start';
      styles.justifyContent = nodeStyles.horizontal_align || 'left';
    } else if (node.axis === 'row') {
      styles.alignItems = nodeStyles.horizontal_align || 'flex-start';
      styles.justifyContent = nodeStyles.vertical_align || 'left';
    }

    if (nodeStyles.gap) styles.gap = `${nodeStyles.gap}px`;

    if (nodeStyles.padding_top)
      styles.paddingTop = `${nodeStyles.padding_top}px`;

    if (nodeStyles.padding_right)
      styles.paddingRight = `${nodeStyles.padding_right}px`;

    if (nodeStyles.padding_bottom)
      styles.paddingBottom = `${nodeStyles.padding_bottom}px`;

    if (nodeStyles.padding_left)
      styles.paddingLeft = `${nodeStyles.padding_left}px`;
  } else {
    styles.alignItems = undefined;
    styles.justifyContent = undefined;
    styles.paddingTop = undefined;
    styles.paddingRight = undefined;
    styles.paddingBottom = undefined;
    styles.paddingLeft = undefined;
  }

  return (
    <div
      style={{
        flexDirection: node.axis === 'column' ? 'row' : 'column',
        flexWrap: 'nowrap',
        display: 'flex',
        position: 'relative',
        minHeight: '100%',
        minWidth: '100%',
        boxSizing: 'border-box',
        ...styles
      }}
    >
      {children}
    </div>
  );
};

const formatStep = (step: any, viewport: string, visibleElements: any) => {
  step = convertStepToViewport(JSON.parse(JSON.stringify(step)), viewport);

  const map = buildGridMap(step);
  const tree = buildGridTree(map, [], visibleElements);

  return { map, tree };
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

const convertStepToViewport = (step: any, viewport: any) => {
  stepElementTypes.forEach((type) => {
    step[type].forEach((obj: any, i: any) => {
      step[type][i] =
        type === 'subgrids'
          ? convertToViewport(obj, viewport, viewportProperties.subgrids)
          : convertToViewport(obj, viewport, viewportProperties.elements);
    });
  });

  step.subgrids = step.subgrids.filter((subgrid: any) => subgrid.position);

  return step;
};

const viewportProperties = {
  step: ['width', 'height', 'repeat_position'],
  subgrids: ['position', 'axis', 'style', 'styles', 'width', 'height'],
  elements: ['position']
};

const convertToViewport = (obj: any, viewport: any, props: any) => {
  if (viewport === 'desktop') return obj;

  props.forEach((prop: any) => {
    const viewportProp = `${viewport}_${prop}`;
    if (obj[viewportProp]) obj[prop] = obj[viewportProp];
  });

  return obj;
};

const buildGridMap = (step: any) => {
  const map: any[string] = {};
  let rootSubgrid = {};

  const addObjectsToMap = (obj: any, type: any) => {
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (typeMap[type]) obj.type = typeMap[type];

    if (type === 'subgrids') {
      obj.cellStyles = obj.styles;
      delete obj.styles;

      if (obj.position.length === 0) {
        return (rootSubgrid = obj);
      }
    }

    const previous = map[getPositionKey(obj)];
    const prevObj: any = {};
    if (previous) {
      prevObj.width = previous.width;
      prevObj.height = previous.height;
      prevObj.cellStyles = previous.cellStyles;
    }

    if (type !== 'subgrids') {
      prevObj.isElement = true;
    }

    map[getPositionKey(obj)] = { ...obj, ...prevObj };
  };

  stepElementTypes.forEach((type) =>
    step[type]?.forEach((obj: any) => addObjectsToMap(obj, type))
  );

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

const buildGridTree = (
  gridMap: any,
  position: any[] = [],
  visibleElements: any
) => {
  const positionKey = getPositionKey({ position });
  const node = gridMap[positionKey];
  if (!node || !visibleElements.positions.has(positionKey)) return;

  let i = 0;
  let nextPos = [...position, i];
  let hasNextChild = gridMap[getPositionKey({ position: nextPos })];

  if (hasNextChild) node.children = [];

  while (hasNextChild) {
    const actualChild = buildGridTree(
      gridMap,
      [...position, i],
      visibleElements
    );
    if (actualChild) {
      actualChild.parent = node;
      node.children.push(actualChild);
    }

    i = i + 1;
    nextPos = [...position, i];
    hasNextChild = gridMap[getPositionKey({ position: nextPos })];
  }

  return node;
};

export default Grid;
