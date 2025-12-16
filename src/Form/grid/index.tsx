import React from 'react';
import Element from './Element';
import {
  getPositionKey,
  stepElementTypes,
  VisiblePositions
} from '../../utils/hideAndRepeats';
import { Container } from './Container';
import { getRepeatedContainers } from '../../utils/repeat';
import CalendlyEmbed from './CalendlyEmbed';
import QuikFormViewer from '../../elements/components/QuikFormViewer';

const Grid = ({ step, form, viewport }: any) => {
  if (!step || !form.visiblePositions) return null;

  const formattedStep: any = buildStepGrid(
    JSON.parse(JSON.stringify(step)),
    viewport,
    form.visiblePositions
  );

  return <Subgrid tree={formattedStep.tree} form={form} viewport={viewport} />;
};

const Subgrid = ({ tree: node, form, viewport }: any) => {
  const props = node.properties ?? {};
  if (node.isElement) {
    return (
      <Container node={node} viewport={viewport} form={form}>
        <Element form={form} node={node} />
      </Container>
    );
  } else {
    const { customClickSelectionState, runElementActions } = form;

    const children: any[] = (node.children || []).map((child: any, i: any) => {
      const fieldKey = child.servar?.key ?? '';
      return (
        <Subgrid
          key={getPositionKey(child) + ':' + i + ':' + fieldKey}
          tree={child}
          axis={node.axis}
          form={form}
          viewport={viewport}
        />
      );
    });

    if (props.embed_calendly && form.calendly?.api_key) {
      children.push(
        <CalendlyEmbed
          key='calendly'
          form={form}
          successStep={props.calendly_success_step}
        />
      );
    }

    if (props.embed_quik_viewer) {
      children.push(
        <QuikFormViewer
          key='quik'
          inline
          formKey={form.featheryContext.formId}
        />
      );
    }

    const customComponent = form.customComponents[node.key ?? ''];
    if (customComponent) children.push(customComponent);

    return (
      <Container
        node={node}
        form={form}
        viewport={viewport}
        selected={customClickSelectionState({
          ...node,
          id: node.key
        })}
        runElementActions={runElementActions}
      >
        {children.length ? children : null}
      </Container>
    );
  }
};

const buildStepGrid = (step: any, viewport: string, visiblePositions: any) => {
  step = convertStepToViewport(JSON.parse(JSON.stringify(step)), viewport);

  const map = buildGridMap(step);
  const repeatGrids = getRepeatedContainers(step);
  const repeatKeys = repeatGrids.map((repeatGrid: any) =>
    getPositionKey(repeatGrid)
  );
  const tree = buildGridTree(
    map,
    [],
    visiblePositions,
    repeatKeys,
    undefined,
    false
  );

  return { map, tree };
};

const convertStepToViewport = (step: any, viewport: any) => {
  stepElementTypes.forEach((type) => {
    // TODO (table): remove backwards compatibility

    step[type]?.forEach((obj: any, i: any) => {
      step[type][i] =
        type === 'subgrids'
          ? convertToViewport(obj, viewport, viewportProperties.subgrids)
          : convertToViewport(obj, viewport, viewportProperties.elements);
    });
  });

  return step;
};

const viewportProperties = {
  step: ['width', 'height'],
  subgrids: ['position', 'axis', 'styles', 'width', 'height'],
  elements: ['position']
};

const convertToViewport = (obj: any, viewport: any, props: any) => {
  if (viewport === 'desktop') return obj;

  props.forEach((prop: any) => {
    // Leave styles and mobile_styles untouched so deeper inheritance can happen between them depending on the viewport
    if (prop !== 'styles') {
      const viewportProp = `${viewport}_${prop}`;
      if (obj[viewportProp]) obj[prop] = obj[viewportProp];
    }
  });

  return obj;
};

// TODO use getAllElements
const typeMap = {
  progress_bars: 'progress_bar',
  images: 'image',
  texts: 'text',
  buttons: 'button',
  servar_fields: 'field',
  videos: 'video',
  tables: 'table'
};

const buildGridMap = (step: any) => {
  const map: any[string] = {};
  let rootSubgrid = {};

  const addObjectsToMap = (obj: any, type: any) => {
    // @ts-expect-error TS(7053): Element implicitly has an 'any' type because expre... Remove this comment to see the full error message
    if (typeMap[type]) obj.type = typeMap[type];

    if (type === 'subgrids') {
      if (obj.position.length === 0) {
        return (rootSubgrid = obj);
      }
    }

    const previous = map[getPositionKey(obj)];
    const prevObj: any = {};
    if (previous) {
      prevObj.width = previous.width;
      prevObj.height = previous.height;
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

const buildGridTree = (
  gridMap: any,
  position: any[],
  visiblePositions: VisiblePositions,
  repeatKeys: string[],
  repeatIndex: number | undefined,
  lastRepeat: boolean
) => {
  const positionKey = getPositionKey({ position });
  const node = { ...gridMap[positionKey] };
  if (!node) return;

  node.repeat = repeatIndex;
  node.lastRepeat = lastRepeat;

  let i = 0;
  let nextPos = [...position, i];
  let nextPosKey = getPositionKey({ position: nextPos });
  let hasNextChild = gridMap[nextPosKey];

  if (hasNextChild) node.children = [];

  while (hasNextChild) {
    const repeats = visiblePositions[nextPosKey];
    if (repeatKeys.includes(nextPosKey)) {
      repeats.forEach((flag, index) => {
        _recurseTree(
          flag,
          node,
          gridMap,
          nextPos,
          visiblePositions,
          repeatKeys,
          index,
          index === repeats.length - 1
        );
      });
    } else {
      _recurseTree(
        repeats[repeatIndex ?? 0],
        node,
        gridMap,
        nextPos,
        visiblePositions,
        repeatKeys,
        repeatIndex,
        lastRepeat
      );
    }

    i = i + 1;
    nextPos = [...position, i];
    nextPosKey = getPositionKey({ position: nextPos });
    hasNextChild = gridMap[nextPosKey];
  }

  return node;
};

function _recurseTree(flag: boolean, node: any, ...args: any[]) {
  if (flag) {
    // @ts-ignore
    const actualChild = buildGridTree(...args);
    if (actualChild) {
      actualChild.parent = node;
      node.children.push(actualChild);
    }
  }
}

export default Grid;
