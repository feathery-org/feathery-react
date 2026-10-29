import {
  child,
  children,
  childrenOf,
  descendant,
  descendants,
  getAttr,
  root,
  tagOf,
  type ONode
} from '../opc/xml';
import type { OPCPackage } from '../opc/package';

export type ChartKind =
  | 'column'
  | 'bar'
  | 'line'
  | 'area'
  | 'pie'
  | 'doughnut'
  | 'scatter'
  | 'radar'
  | 'combo'
  | 'unsupported';

export interface ChartTextStyle {
  sizePt?: number;
  color?: string;
  colorOpacityPct?: number;
  font?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: string;
  rotationDeg?: number;
  align?: string;
}
export interface ChartDataLabels {
  showValue: boolean;
  showCategory: boolean;
  showSeries: boolean;
  showPercent: boolean;
  showLegendKey?: boolean;
  showBubbleSize?: boolean;
  showLeaderLines?: boolean;
  separator?: string;
  position?: string;
  numberFormat?: string;
  style?: ChartTextStyle;
}
export interface ChartSeries {
  kind: Exclude<ChartKind, 'combo' | 'unsupported'>;
  name: string;
  categories: string[];
  values: number[];
  xValues?: number[];
  color?: string;
  fillOpacityPct?: number;
  lineColor?: string;
  lineVisible?: boolean;
  lineOpacityPct?: number;
  lineDash?: string;
  pointColors?: Record<number, string>;
  pointOpacityPct?: Record<number, number>;
  invertIfNegative?: boolean;
  smooth?: boolean;
  axisIds: number[];
  dataLabels?: ChartDataLabels;
  lineWidthEMU?: number;
  marker?: { symbol?: string; size?: number; color?: string };
}

export interface ChartAxis {
  id: number;
  type: 'category' | 'value';
  position: 'l' | 'r' | 't' | 'b';
  title?: string;
  titleStyle?: ChartTextStyle;
  min?: number;
  max?: number;
  majorUnit?: number;
  orientation?: string;
  deleted: boolean;
  numberFormat?: string;
  tickLabelPosition?: string;
  lineColor?: string;
  gridlineColor?: string;
  style?: ChartTextStyle;
  lineWidthEMU?: number;
  lineDash?: string;
  lineOpacityPct?: number;
  gridlineWidthEMU?: number;
  gridlineDash?: string;
  gridlineOpacityPct?: number;
  majorTickMark?: string;
  minorTickMark?: string;
  crosses?: string;
  crossesAt?: number;
  labelOffsetPct?: number;
  crossAxisId?: number;
  dimension?: 'x' | 'y';
  role?: 'primary' | 'secondary';
  seriesIndexes?: number[];
  seriesNames?: string[];
  resolvedScale?: {
    min: number;
    max: number;
    majorUnit: number;
    tickValues: number[];
    minAutomatic: boolean;
    maxAutomatic: boolean;
    majorUnitAutomatic: boolean;
  };
}
export interface ChartPlot {
  kind: ChartSeries['kind'];
  grouping?: string;
  gapWidth?: number;
  overlap?: number;
  axisIds: number[];
  seriesIndexes: number[];
  varyColors?: boolean;
  scatterStyle?:
    | 'none'
    | 'line'
    | 'lineMarker'
    | 'marker'
    | 'smooth'
    | 'smoothMarker';
  radarStyle?: 'standard' | 'marker' | 'filled';
  showMarker?: boolean;
  xAxisId?: number;
  yAxisId?: number;
}
export interface ChartLayout {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  target?: string;
  xMode?: string;
  yMode?: string;
  widthMode?: string;
  heightMode?: string;
}
export interface ChartAreaStyle {
  noFill: boolean;
  fillColor?: string;
  fillOpacityPct?: number;
  lineColor?: string;
  lineOpacityPct?: number;
  lineWidthEMU?: number;
  lineDash?: string;
}

export interface ChartData {
  kind: ChartKind;
  title?: string;
  series: ChartSeries[];
  showLegend: boolean;
  legendPosition?: 'r' | 'l' | 't' | 'b' | 'tr';
  titleStyle?: ChartTextStyle;
  defaultTextStyle?: ChartTextStyle;
  legendStyle?: ChartTextStyle;
  legendOverlay?: boolean;
  legendLayout?: ChartLayout;
  plotLayout?: ChartLayout;
  chartAreaStyle?: ChartAreaStyle;
  plotAreaStyle?: ChartAreaStyle;
  doughnutHolePct?: number;
  firstSliceAngle?: number;
  titleOverlay?: boolean;
  roundedCorners?: boolean;
  displayBlanksAs?: string;
  showDataLabelsOverMax?: boolean;
  axisTitles: {
    horizontal?: string;
    vertical?: string;
    secondaryVertical?: string;
  };
  axes: ChartAxis[];
  plots: ChartPlot[];
  stacked: boolean;
}

const PLOT_TAGS: Record<string, ChartKind> = {
  'c:barChart': 'column',
  'c:lineChart': 'line',
  'c:areaChart': 'area',
  'c:pieChart': 'pie',
  'c:doughnutChart': 'doughnut',
  'c:scatterChart': 'scatter',
  'c:radarChart': 'radar'
};

function nodeText(node: ONode | undefined, tag: string): string | undefined {
  const value = node && descendants(node, tag)[0];
  return value
    ? value[tag]?.map((entry: ONode) => entry['#text'] ?? '').join('')
    : undefined;
}

function pointValues(container: ONode | undefined): string[] {
  if (!container) return [];
  const cache = [
    'c:strCache',
    'c:numCache',
    'c:strLit',
    'c:numLit',
    'c:multiLvlStrCache'
  ]
    .map((tag) => descendants(container, tag)[0])
    .find(Boolean);
  if (!cache) {
    const direct = nodeText(container, 'c:v');
    return direct === undefined ? [] : [direct];
  }
  const points = descendants(cache, 'c:pt')
    .map((point) => ({
      index: Number(getAttr(point, 'idx')) || 0,
      value:
        nodeText(point, 'c:v') ??
        descendants(point, 'c:lvl')
          .map((level) => nodeText(level, 'c:v') ?? '')
          .filter(Boolean)
          .join(' / ')
    }))
    .sort((a, b) => a.index - b.index);
  if (!points.length) return [];
  const values = Array(
    Math.max(...points.map((point) => point.index)) + 1
  ).fill('');
  for (const point of points) values[point.index] = point.value;
  return values;
}

function explicitSeriesColor(series: ONode): string | undefined {
  const spPr = child(series, 'c:spPr');
  return (
    paintColor(spPr && child(spPr, 'a:solidFill')) ||
    paintColor(spPr && child(child(spPr, 'a:ln') || {}, 'a:solidFill'))
  );
}

function lineColor(container: ONode | undefined): string | undefined {
  const line =
    container &&
    (tagOf(container) === 'a:ln' ? container : child(container, 'a:ln'));
  return paintColor(line && child(line, 'a:solidFill'));
}

function paintColor(container: ONode | undefined): string | undefined {
  if (!container) return undefined;
  const srgb = child(container, 'a:srgbClr');
  if (srgb && getAttr(srgb, 'val')) return `#${getAttr(srgb, 'val')}`;
  const scheme = child(container, 'a:schemeClr');
  if (scheme && getAttr(scheme, 'val'))
    return `scheme:${getAttr(scheme, 'val')}`;
  const sys = child(container, 'a:sysClr');
  if (sys) return `#${getAttr(sys, 'lastClr') || getAttr(sys, 'val')}`;
  return undefined;
}

function paintOpacityPct(container: ONode | undefined): number | undefined {
  const color =
    container &&
    (child(container, 'a:srgbClr') ||
      child(container, 'a:schemeClr') ||
      child(container, 'a:sysClr'));
  const alpha = color && child(color, 'a:alpha');
  return alpha ? Number(getAttr(alpha, 'val')) / 1000 : undefined;
}

function lineDetails(container: ONode | undefined) {
  const line =
    container &&
    (tagOf(container) === 'a:ln' ? container : child(container, 'a:ln'));
  const fill = line && child(line, 'a:solidFill');
  return {
    color: paintColor(fill),
    opacityPct: paintOpacityPct(fill),
    widthEMU: Number(line && getAttr(line, 'w')) || undefined,
    dash: getAttr(child(line || {}, 'a:prstDash') || {}, 'val')
  };
}

function areaStyle(container: ONode | undefined): ChartAreaStyle | undefined {
  if (!container) return undefined;
  const fill = child(container, 'a:solidFill');
  const line = lineDetails(container);
  return {
    noFill: !!child(container, 'a:noFill'),
    fillColor: paintColor(fill),
    fillOpacityPct: paintOpacityPct(fill),
    lineColor: line.color,
    lineOpacityPct: line.opacityPct,
    lineWidthEMU: line.widthEMU,
    lineDash: line.dash
  };
}

function manualLayout(container: ONode | undefined): ChartLayout | undefined {
  const manual = container && descendant(container, 'c:manualLayout');
  if (!manual) return undefined;
  const value = (tag: string) => {
    const raw = getAttr(child(manual, tag) || {}, 'val');
    return raw === undefined ? undefined : Number(raw);
  };
  return {
    x: value('c:x'),
    y: value('c:y'),
    width: value('c:w'),
    height: value('c:h'),
    target: getAttr(child(manual, 'c:layoutTarget') || {}, 'val'),
    xMode: getAttr(child(manual, 'c:xMode') || {}, 'val'),
    yMode: getAttr(child(manual, 'c:yMode') || {}, 'val'),
    widthMode: getAttr(child(manual, 'c:wMode') || {}, 'val'),
    heightMode: getAttr(child(manual, 'c:hMode') || {}, 'val')
  };
}

function textStyle(container: ONode | undefined): ChartTextStyle | undefined {
  const rPr =
    container &&
    (descendants(container, 'a:rPr')[0] ||
      descendants(container, 'a:defRPr')[0]);
  if (!rPr) return undefined;
  const solid = child(rPr, 'a:solidFill');
  const latin = child(rPr, 'a:latin');
  const size = Number(getAttr(rPr, 'sz'));
  return {
    sizePt: size ? size / 100 : undefined,
    color: paintColor(solid),
    colorOpacityPct: paintOpacityPct(solid),
    font: latin ? getAttr(latin, 'typeface') : undefined,
    bold: getAttr(rPr, 'b') === '1' || undefined,
    italic: getAttr(rPr, 'i') === '1' || undefined,
    underline: getAttr(rPr, 'u'),
    rotationDeg: Number(getAttr(container || {}, 'rot')) / 60000 || undefined,
    align: getAttr(descendants(container || {}, 'a:pPr')[0] || {}, 'algn')
  };
}

const boolVal = (node: ONode | undefined, fallback = false) =>
  node ? getAttr(node, 'val') !== '0' : fallback;
function dataLabels(node: ONode | undefined): ChartDataLabels | undefined {
  if (!node) return undefined;
  return {
    showValue: boolVal(child(node, 'c:showVal')),
    showCategory: boolVal(child(node, 'c:showCatName')),
    showSeries: boolVal(child(node, 'c:showSerName')),
    showPercent: boolVal(child(node, 'c:showPercent')),
    showLegendKey: boolVal(child(node, 'c:showLegendKey')),
    showBubbleSize: boolVal(child(node, 'c:showBubbleSize')),
    showLeaderLines: boolVal(child(node, 'c:showLeaderLines')),
    separator: child(node, 'c:separator')
      ? childrenOf(child(node, 'c:separator')!)
          .map((entry) => entry['#text'] ?? '')
          .join('')
      : undefined,
    position: getAttr(child(node, 'c:dLblPos') || {}, 'val'),
    numberFormat: getAttr(child(node, 'c:numFmt') || {}, 'formatCode'),
    style: textStyle(child(node, 'c:txPr'))
  };
}

function titleText(title: ONode | undefined): string | undefined {
  if (!title) return undefined;
  const rich = descendants(title, 'a:t')
    .map(
      (textNode) =>
        textNode['a:t']?.map((entry: ONode) => entry['#text'] ?? '').join('') ??
        ''
    )
    .join('');
  return rich || pointValues(child(title, 'c:tx'))[0] || undefined;
}

function axisTitles(plotArea: ONode): ChartData['axisTitles'] {
  const titles: ChartData['axisTitles'] = {};
  for (const axis of childrenOf(plotArea).filter((node) =>
    ['c:catAx', 'c:dateAx', 'c:valAx'].includes(tagOf(node) || '')
  )) {
    const value = titleText(child(axis, 'c:title'));
    if (!value) continue;
    const position = getAttr(child(axis, 'c:axPos') || {}, 'val');
    if (position === 'b' || position === 't') titles.horizontal ??= value;
    else if (position === 'r') titles.secondaryVertical ??= value;
    else titles.vertical ??= value;
  }
  return titles;
}

function readAxes(plotArea: ONode, defaultStyle?: ChartTextStyle): ChartAxis[] {
  return childrenOf(plotArea)
    .filter((node) =>
      ['c:catAx', 'c:dateAx', 'c:valAx'].includes(tagOf(node) || '')
    )
    .map((axis) => {
      const scaling = child(axis, 'c:scaling');
      const number = (tag: string) => {
        const value = getAttr(child(scaling || {}, tag) || {}, 'val');
        return value === undefined ? undefined : Number(value);
      };
      const position = (getAttr(child(axis, 'c:axPos') || {}, 'val') ||
        'l') as ChartAxis['position'];
      return {
        id: Number(getAttr(child(axis, 'c:axId') || {}, 'val')) || 0,
        type: tagOf(axis) === 'c:valAx' ? 'value' : 'category',
        position,
        title: titleText(child(axis, 'c:title')),
        titleStyle: textStyle(child(axis, 'c:title')) || defaultStyle,
        min: number('c:min'),
        max: number('c:max'),
        majorUnit:
          Number(getAttr(child(axis, 'c:majorUnit') || {}, 'val')) || undefined,
        orientation: getAttr(
          child(scaling || {}, 'c:orientation') || {},
          'val'
        ),
        deleted: getAttr(child(axis, 'c:delete') || {}, 'val') === '1',
        numberFormat: getAttr(child(axis, 'c:numFmt') || {}, 'formatCode'),
        tickLabelPosition: getAttr(child(axis, 'c:tickLblPos') || {}, 'val'),
        lineColor: lineColor(child(axis, 'c:spPr')),
        gridlineColor: lineColor(
          child(child(axis, 'c:majorGridlines') || {}, 'c:spPr')
        ),
        lineWidthEMU: lineDetails(child(axis, 'c:spPr')).widthEMU,
        lineDash: lineDetails(child(axis, 'c:spPr')).dash,
        lineOpacityPct: lineDetails(child(axis, 'c:spPr')).opacityPct,
        gridlineWidthEMU: lineDetails(
          child(child(axis, 'c:majorGridlines') || {}, 'c:spPr')
        ).widthEMU,
        gridlineDash: lineDetails(
          child(child(axis, 'c:majorGridlines') || {}, 'c:spPr')
        ).dash,
        gridlineOpacityPct: lineDetails(
          child(child(axis, 'c:majorGridlines') || {}, 'c:spPr')
        ).opacityPct,
        majorTickMark: getAttr(child(axis, 'c:majorTickMark') || {}, 'val'),
        minorTickMark: getAttr(child(axis, 'c:minorTickMark') || {}, 'val'),
        crosses: getAttr(child(axis, 'c:crosses') || {}, 'val'),
        crossesAt:
          Number(getAttr(child(axis, 'c:crossesAt') || {}, 'val')) || undefined,
        labelOffsetPct:
          Number(getAttr(child(axis, 'c:lblOffset') || {}, 'val')) || undefined,
        crossAxisId:
          Number(getAttr(child(axis, 'c:crossAx') || {}, 'val')) || undefined,
        style: textStyle(child(axis, 'c:txPr')) || defaultStyle
      };
    });
}

export function readChartData(
  pkg: OPCPackage,
  chartPart: string
): ChartData | null {
  if (!pkg.hasPart(chartPart)) return null;
  const chartSpace = root(pkg.tree(chartPart));
  const chart = child(chartSpace, 'c:chart');
  const plotArea = chart && child(chart, 'c:plotArea');
  if (!chart || !plotArea) return null;
  const plots = childrenOf(plotArea).filter(
    (node) => !!PLOT_TAGS[tagOf(node) || '']
  );
  const legend = child(chart, 'c:legend');
  const defaultTextStyle = textStyle(child(chartSpace, 'c:txPr'));
  const legendPosition = getAttr(
    child(legend || {}, 'c:legendPos') || {},
    'val'
  ) as ChartData['legendPosition'];
  if (!plots.length)
    return {
      kind: 'unsupported',
      title: titleText(child(chart, 'c:title')),
      series: [],
      showLegend: !!legend,
      legendPosition,
      defaultTextStyle,
      titleStyle: textStyle(child(chart, 'c:title')) || defaultTextStyle,
      legendStyle: textStyle(legend) || defaultTextStyle,
      legendOverlay: boolVal(child(legend || {}, 'c:overlay')),
      legendLayout: manualLayout(child(legend || {}, 'c:layout')),
      plotLayout: manualLayout(child(plotArea, 'c:layout')),
      chartAreaStyle: areaStyle(child(chartSpace, 'c:spPr')),
      plotAreaStyle: areaStyle(child(plotArea, 'c:spPr')),
      titleOverlay: boolVal(child(child(chart, 'c:title') || {}, 'c:overlay')),
      roundedCorners: boolVal(child(chartSpace, 'c:roundedCorners')),
      displayBlanksAs: getAttr(child(chart, 'c:dispBlanksAs') || {}, 'val'),
      showDataLabelsOverMax: boolVal(child(chart, 'c:showDLblsOverMax')),
      axisTitles: axisTitles(plotArea),
      axes: readAxes(plotArea, defaultTextStyle),
      plots: [],
      stacked: false
    };
  const kinds = plots.map((plot) => {
    let kind = PLOT_TAGS[tagOf(plot)!];
    if (
      kind === 'column' &&
      getAttr(child(plot, 'c:barDir') || {}, 'val') === 'bar'
    )
      kind = 'bar';
    return kind as ChartSeries['kind'];
  });
  const plotAxisIds = plots.map((plot) =>
    children(plot, 'c:axId').map((axis) => Number(getAttr(axis, 'val')) || 0)
  );
  const series = plots.flatMap((plot, plotIndex) =>
    children(plot, 'c:ser').map((node, seriesIndex): ChartSeries => {
      const name =
        pointValues(child(node, 'c:tx'))[0] ||
        nodeText(child(node, 'c:tx'), 'c:v') ||
        `Series ${seriesIndex + 1}`;
      const categories = pointValues(child(node, 'c:cat'));
      const yContainer = child(node, 'c:val') || child(node, 'c:yVal');
      const marker = child(node, 'c:marker');
      const markerSpPr = marker && child(marker, 'c:spPr');
      const markerFill = markerSpPr && descendants(markerSpPr, 'a:srgbClr')[0];
      const spPr = child(node, 'c:spPr');
      const line = spPr && child(spPr, 'a:ln');
      const fill = spPr && child(spPr, 'a:solidFill');
      const lineFill = line && child(line, 'a:solidFill');
      const pointColors: Record<number, string> = {};
      const pointOpacityPct: Record<number, number> = {};
      for (const point of children(node, 'c:dPt')) {
        const index = Number(getAttr(child(point, 'c:idx') || {}, 'val')) || 0;
        const pointFill = child(child(point, 'c:spPr') || {}, 'a:solidFill');
        const pointColor = paintColor(pointFill);
        if (pointColor) pointColors[index] = pointColor;
        const opacity = paintOpacityPct(pointFill);
        if (opacity !== undefined) pointOpacityPct[index] = opacity;
      }
      return {
        kind: kinds[plotIndex],
        name,
        categories,
        values: pointValues(yContainer).map((value) => Number(value) || 0),
        xValues: pointValues(child(node, 'c:xVal')).map(
          (value) => Number(value) || 0
        ),
        color: explicitSeriesColor(node),
        fillOpacityPct: paintOpacityPct(fill),
        lineColor: paintColor(lineFill),
        lineOpacityPct: paintOpacityPct(lineFill),
        lineVisible: line ? !child(line, 'a:noFill') : undefined,
        lineDash: getAttr(child(line || {}, 'a:prstDash') || {}, 'val'),
        pointColors: Object.keys(pointColors).length ? pointColors : undefined,
        pointOpacityPct: Object.keys(pointOpacityPct).length
          ? pointOpacityPct
          : undefined,
        invertIfNegative: boolVal(child(node, 'c:invertIfNegative')),
        smooth: boolVal(child(node, 'c:smooth')),
        axisIds: plotAxisIds[plotIndex],
        dataLabels: dataLabels(
          child(node, 'c:dLbls') || child(plot, 'c:dLbls')
        ),
        lineWidthEMU: Number(line && getAttr(line, 'w')) || undefined,
        marker: marker
          ? {
              symbol: getAttr(child(marker, 'c:symbol') || {}, 'val'),
              size:
                Number(getAttr(child(marker, 'c:size') || {}, 'val')) ||
                undefined,
              color:
                markerFill && getAttr(markerFill, 'val')
                  ? `#${getAttr(markerFill, 'val')}`
                  : undefined
            }
          : undefined
      };
    })
  );
  const grouping = plots.map(
    (plot) => getAttr(child(plot, 'c:grouping') || {}, 'val') || ''
  );
  const uniqueKinds = new Set(kinds);
  const axisModels = readAxes(plotArea, defaultTextStyle);
  let seriesOffset = 0;
  const plotModels: ChartPlot[] = plots.map((plot, plotIndex) => {
    const count = children(plot, 'c:ser').length;
    const model: ChartPlot = {
      kind: kinds[plotIndex],
      grouping: getAttr(child(plot, 'c:grouping') || {}, 'val'),
      gapWidth:
        Number(getAttr(child(plot, 'c:gapWidth') || {}, 'val')) || undefined,
      overlap:
        Number(getAttr(child(plot, 'c:overlap') || {}, 'val')) || undefined,
      axisIds: plotAxisIds[plotIndex],
      seriesIndexes: Array.from(
        { length: count },
        (_, index) => seriesOffset + index
      ),
      varyColors: boolVal(child(plot, 'c:varyColors')),
      scatterStyle: getAttr(
        child(plot, 'c:scatterStyle') || {},
        'val'
      ) as ChartPlot['scatterStyle'],
      radarStyle: getAttr(
        child(plot, 'c:radarStyle') || {},
        'val'
      ) as ChartPlot['radarStyle'],
      showMarker: child(plot, 'c:marker')
        ? boolVal(child(plot, 'c:marker'))
        : undefined
    };
    seriesOffset += count;
    return model;
  });
  const niceStep = (range: number, target = 5) => {
    const raw = Math.abs(range) / Math.max(1, target);
    if (!Number.isFinite(raw) || raw <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(raw));
    const fraction = raw / power;
    return (
      (fraction >= Math.sqrt(50)
        ? 10
        : fraction >= Math.sqrt(10)
        ? 5
        : fraction >= Math.sqrt(2)
        ? 2
        : 1) * power
    );
  };
  const scaleTicks = (min: number, max: number, unit: number) => {
    const first = Math.ceil(min / unit - 1e-9) * unit;
    const values: number[] = [];
    for (
      let value = first;
      value <= max + unit * 1e-8 && values.length < 64;
      value += unit
    )
      values.push(+value.toFixed(12));
    if (!values.length || Math.abs(values[0] - min) > unit * 1e-8)
      values.unshift(min);
    if (Math.abs(values[values.length - 1] - max) > unit * 1e-8)
      values.push(max);
    return values;
  };
  for (const plot of plotModels) {
    const related = plot.axisIds
      .map((id) => axisModels.find((axis) => axis.id === id))
      .filter((axis): axis is ChartAxis => !!axis);
    if (plot.kind === 'scatter') {
      plot.xAxisId = related.find(
        (axis) => axis.position === 'b' || axis.position === 't'
      )?.id;
      plot.yAxisId = related.find(
        (axis) => axis.position === 'l' || axis.position === 'r'
      )?.id;
    } else {
      plot.xAxisId = related.find((axis) => axis.type === 'category')?.id;
      plot.yAxisId = related.find((axis) => axis.type === 'value')?.id;
    }
    const xAxis = axisModels.find((axis) => axis.id === plot.xAxisId);
    if (xAxis) xAxis.dimension = 'x';
    const yAxis = axisModels.find((axis) => axis.id === plot.yAxisId);
    if (yAxis) yAxis.dimension = 'y';
  }
  for (const axis of axisModels) {
    const relatedPlots = plotModels.filter(
      (plot) => plot.xAxisId === axis.id || plot.yAxisId === axis.id
    );
    const indexes = [
      ...new Set(relatedPlots.flatMap((plot) => plot.seriesIndexes))
    ];
    if (indexes.length) {
      axis.seriesIndexes = indexes;
      axis.seriesNames = indexes
        .map((index) => series[index]?.name)
        .filter((name): name is string => !!name);
    }
    if (axis.dimension === 'y')
      axis.role = axis.position === 'r' ? 'secondary' : 'primary';
  }
  for (const axis of axisModels.filter(
    (candidate) => candidate.type === 'value'
  )) {
    const boundPlots = plotModels.filter((plot) =>
      plot.axisIds.includes(axis.id)
    );
    const data: number[] = [];
    for (const plot of boundPlots) {
      const boundSeries = plot.seriesIndexes.map((index) => series[index]);
      if (
        plot.yAxisId === axis.id &&
        (plot.grouping === 'stacked' || plot.grouping === 'percentStacked')
      ) {
        const count = Math.max(
          0,
          ...boundSeries.map((item) => item.values.length)
        );
        for (let index = 0; index < count; index++) {
          data.push(
            boundSeries.reduce(
              (sum, item) => sum + Math.max(0, item.values[index] || 0),
              0
            ),
            boundSeries.reduce(
              (sum, item) => sum + Math.min(0, item.values[index] || 0),
              0
            )
          );
        }
        continue;
      }
      for (const item of boundSeries)
        data.push(
          ...(plot.kind === 'scatter' && plot.xAxisId === axis.id
            ? item.xValues || []
            : item.values
          ).filter(Number.isFinite)
        );
    }
    if (!data.length) continue;
    const rawMin = Math.min(0, ...data);
    const rawMax = Math.max(0, ...data);
    const initialMin = axis.min ?? rawMin;
    const initialMax = axis.max ?? rawMax;
    // PowerPoint gives secondary percentage/value axes a denser automatic
    // scale than the usual primary-axis heuristic (0..100 commonly uses 10).
    const unit =
      axis.majorUnit ||
      niceStep(initialMax - initialMin, axis.role === 'secondary' ? 10 : 5);
    const min = axis.min ?? Math.floor(initialMin / unit) * unit;
    const max = axis.max ?? Math.ceil(initialMax / unit) * unit;
    const resolvedMax = max === min ? min + unit : max;
    axis.resolvedScale = {
      min,
      max: resolvedMax,
      majorUnit: unit,
      tickValues: scaleTicks(min, resolvedMax, unit),
      minAutomatic: axis.min === undefined,
      maxAutomatic: axis.max === undefined,
      majorUnitAutomatic: axis.majorUnit === undefined
    };
  }
  return {
    kind: uniqueKinds.size > 1 ? 'combo' : kinds[0],
    title: titleText(child(chart, 'c:title')),
    series,
    showLegend: !!legend,
    legendPosition,
    defaultTextStyle,
    legendOverlay: boolVal(child(legend || {}, 'c:overlay')),
    legendLayout: manualLayout(child(legend || {}, 'c:layout')),
    plotLayout: manualLayout(child(plotArea, 'c:layout')),
    chartAreaStyle: areaStyle(child(chartSpace, 'c:spPr')),
    plotAreaStyle: areaStyle(child(plotArea, 'c:spPr')),
    doughnutHolePct:
      Number(
        getAttr(
          child(
            plots.find((plot) => tagOf(plot) === 'c:doughnutChart') || {},
            'c:holeSize'
          ) || {},
          'val'
        )
      ) || undefined,
    firstSliceAngle:
      Number(
        getAttr(
          child(
            plots.find((plot) =>
              ['c:pieChart', 'c:doughnutChart'].includes(tagOf(plot) || '')
            ) || {},
            'c:firstSliceAng'
          ) || {},
          'val'
        )
      ) || undefined,
    titleOverlay: boolVal(child(child(chart, 'c:title') || {}, 'c:overlay')),
    roundedCorners: boolVal(child(chartSpace, 'c:roundedCorners')),
    displayBlanksAs: getAttr(child(chart, 'c:dispBlanksAs') || {}, 'val'),
    showDataLabelsOverMax: boolVal(child(chart, 'c:showDLblsOverMax')),
    titleStyle: textStyle(child(chart, 'c:title')) || defaultTextStyle,
    legendStyle: textStyle(legend) || defaultTextStyle,
    axisTitles: axisTitles(plotArea),
    axes: axisModels,
    plots: plotModels,
    stacked: grouping.some(
      (value) => value === 'stacked' || value === 'percentStacked'
    )
  };
}
